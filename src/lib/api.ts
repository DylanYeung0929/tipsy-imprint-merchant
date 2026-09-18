import type {
  AnalysisPayload,
  AnalysisReport,
  Drink,
  DrinkStats,
  EspEvent,
  EspPacket,
  EspSession,
  MenuImportItem,
  SensorEvent,
  Session,
  User,
  WeatherInfo,
} from "../types";
import {
  drinkStore,
  eventStore,
  sessionStore,
  userStore,
} from "./mock";
import { getToken, scheduleSnapshotSave } from "./auth";

/**
 * 接口层：默认使用内存 Mock（后端就绪后置 VITE_USE_BACKEND=true 切换）。
 * REST 约定：
 *   GET    /api/drinks             酒单
 *   POST   /api/drinks             新增酒款
 *   PUT    /api/drinks/:id         更新酒款
 *   DELETE /api/drinks/:id         删除酒款
 *   GET    /api/users              用户列表
 *   GET    /api/sessions           会话列表
 *   GET    /api/events             传感器事件（支持 ?since= 增量拉取）
 *   POST   /api/analyze            触发 AI 分析（Node 服务，见 server/analysis.mjs）
 */
const USE_BACKEND = import.meta.env.VITE_USE_BACKEND === "true";
const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

const delay = (ms = 180) => new Promise((r) => setTimeout(r, ms));

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`接口错误 ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ---- 酒单 ----
export async function fetchDrinks(): Promise<Drink[]> {
  if (USE_BACKEND) return request<Drink[]>("/drinks");
  await delay();
  return [...drinkStore];
}

export async function createDrink(data: Omit<Drink, "id">): Promise<Drink> {
  if (USE_BACKEND) return request<Drink>("/drinks", { method: "POST", body: JSON.stringify(data) });
  await delay();
  const drink: Drink = { ...data, id: `d${Date.now()}` };
  drinkStore.unshift(drink);
  scheduleSnapshotSave();
  return drink;
}

export async function updateDrink(id: string, data: Partial<Drink>): Promise<Drink> {
  if (USE_BACKEND) return request<Drink>(`/drinks/${id}`, { method: "PUT", body: JSON.stringify(data) });
  await delay();
  const idx = drinkStore.findIndex((d) => d.id === id);
  if (idx < 0) throw new Error("酒款不存在");
  drinkStore[idx] = { ...drinkStore[idx], ...data };
  scheduleSnapshotSave();
  return drinkStore[idx];
}

export async function deleteDrink(id: string): Promise<void> {
  if (USE_BACKEND) {
    await request<void>(`/drinks/${id}`, { method: "DELETE" });
    return;
  }
  await delay();
  const idx = drinkStore.findIndex((d) => d.id === id);
  if (idx >= 0) {
    drinkStore.splice(idx, 1);
    scheduleSnapshotSave();
  }
}

// ---- 用户 / 会话 / 事件 ----
export async function fetchUsers(): Promise<User[]> {
  if (USE_BACKEND) return request<User[]>("/users");
  await delay();
  return [...userStore];
}

export async function fetchSessions(): Promise<Session[]> {
  if (USE_BACKEND) return request<Session[]>("/sessions");
  await delay();
  return [...sessionStore];
}

/** 把一次真实饮酒会话并入经营档案（内存 + 防抖快照持久化） */
export async function addSession(session: Session): Promise<Session> {
  sessionStore.unshift(session);
  scheduleSnapshotSave();
  return session;
}

export async function fetchEvents(): Promise<SensorEvent[]> {
  if (USE_BACKEND) return request<SensorEvent[]>("/events");
  await delay();
  return [...eventStore];
}

/** 上报一条传感器事件（数据接收页的接口示例） */
export async function postEvent(e: Omit<SensorEvent, "id">): Promise<SensorEvent> {
  if (USE_BACKEND) return request<SensorEvent>("/events", { method: "POST", body: JSON.stringify(e) });
  await delay(60);
  const event: SensorEvent = { ...e, id: `e${Date.now()}` };
  eventStore.push(event);
  scheduleSnapshotSave();
  return event;
}

// ---- AI 分析 ----
/**
 * 数据传入 → AI 分析 → 结构化输出。
 * 优先调用 Node 分析服务（server/analysis.mjs，Claude API）；
 * 服务不可用或无 API Key 时降级为本地 Mock 报告，保证流程可演示。
 */
export async function generateAnalysis(
  payload: AnalysisPayload,
): Promise<AnalysisReport> {
  try {
    const res = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const report = (await res.json()) as AnalysisReport;
    return { ...report, source: "claude" };
  } catch {
    await delay(1200);
    return mockAnalysis(payload);
  }
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function mockAnalysis(payload: AnalysisPayload): AnalysisReport {
  const { drinks, stats } = payload;
  const byId = new Map(stats.map((s) => [s.drinkId, s]));
  const insights = drinks.map((d) => {
    const s = byId.get(d.id);
    if (!s) {
      return {
        drinkId: d.id,
        drinkName: d.name,
        behaviorProfile: "暂无行为数据",
        intentMatch: 0,
        intentComment: "样本不足，建议继续观察。",
      };
    }
    const strong =
      s.avgShake > 0.6 && s.avgPickupCount > 10 && s.chugRate < 0.1;
    const sweet =
      s.avgPickupCount < 4.5 && s.avgSipVolume > 20 && s.avgDurationMin > 45;
    const chuggable = s.chugRate > 0.5 && s.avgDurationMin < 20;
    const slow = s.avgPickupCount > 8 && s.avgSipVolume < 15 && s.avgDurationMin > 30;
    const profile = strong
      ? "高频拿起 + 高摇晃 + 小口品饮"
      : sweet
        ? "低频拿起 + 大饮用量 + 长停留"
        : chuggable
          ? "低拿起 + 一饮而尽 + 短停留"
          : slow
            ? "多次小口慢品"
            : "行为特征混合";
    const has烈 = /烈|少饮|小口|多次/.test(d.designIntent);
    const has甜 = /甜|社交|聊天/.test(d.designIntent);
    const has畅 = /畅|快|一饮/.test(d.designIntent);
    const has慢 = /慢|慢慢|品味/.test(d.designIntent);
    const match = has烈
      ? strong || slow
      : has甜
        ? sweet
        : has畅
          ? chuggable
          : has慢
            ? slow
            : true;
    const intentMatch = match ? 85 + Math.round(Math.random() * 12) : 30 + Math.round(Math.random() * 35);
    return {
      drinkId: d.id,
      drinkName: d.name,
      behaviorProfile: profile,
      intentMatch,
      intentComment: match
        ? `用户行为与「${d.designIntent}」的预期基本一致。`
        : `行为偏离「${d.designIntent}」的预期，建议关注。`,
      riskFlag: match
        ? undefined
        : chuggable
          ? "预期慢品但实际出现高比例一饮而尽"
          : "预期快饮但用户停留时间明显偏长",
    };
  });
  const totalSessions = stats.reduce((a, s) => a + s.sessions, 0);
  const summary =
    `本期共记录 ${totalSessions} 次饮酒会话，覆盖 ${drinks.length} 款酒。` +
    `烈酒类（Manhattan、Old Fashioned、Negroni）呈现多次拿起、小口品饮、高摇晃的典型行为画像；` +
    `Mojito 与 Daiquiri 一饮而尽率最高，符合畅饮定位；` +
    `Mai Tai 拿起频率低、停留时间长，符合社交甜饮预期。`;
  const recommendations = [
    "烈酒款可强化「闻香」引导：杯垫灯光在首次摇晃时给予反馈",
    "Mojito、Daiquiri 翻台快，适合安排在高客流时段推荐",
    "Mai Tai 用户停留久，可考虑搭配小食提升客单价",
    "建议将设计初衷写入每款酒的标签，便于持续追踪匹配度变化",
  ];
  return {
    generatedAt: new Date().toISOString(),
    source: "mock",
    summary,
    drinkInsights: insights,
    recommendations,
  };
}

export { round1 };

// ---- 拍照导入酒单 / 天气 / 印记一句话 ----

/** 拍照酒单 → AI 识别（视觉抄录 + 结构化 + 卡片配色） */
export async function importMenu(image: string): Promise<MenuImportItem[]> {
  const res = await fetch(`${API_BASE}/menu-import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify({ image }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`识别失败（${res.status}）：${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { drinks?: MenuImportItem[]; error?: string };
  if (data.error) throw new Error(data.error);
  return data.drinks ?? [];
}

/** 酒款配图：按固定风格 AI 生成（杯子类型 + 详细配料 → 英语视觉描述 → 文生图） */
export async function generateDrinkImage(payload: {
  name: string;
  glass: string;
  ingredients: string;
  flavor: string;
}): Promise<{ image: string; prompt: string }> {
  const res = await fetch(`${API_BASE}/drink-image`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as {
    image?: string;
    prompt?: string;
    error?: string;
  };
  if (!res.ok || data.error) throw new Error(data.error ?? `生成失败（${res.status}）`);
  if (!data.image) throw new Error("AI 未返回图片，请重试");
  return { image: data.image, prompt: data.prompt ?? "" };
}

/** 酒款配图：压缩图写入 KV，返回可直链短 URL（酒款记录只存这个短路径） */
export async function storeDrinkImage(image: string): Promise<string> {
  const res = await fetch(`${API_BASE}/drink-image/store`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify({ image }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `图片保存失败（${res.status}）`);
  if (!data.url) throw new Error("图片保存失败，请重试");
  return data.url;
}

/** 天气：前端直连 uapis.cn（免 key、支持 CORS、按客户端 IP 定位） */
export async function fetchWeather(): Promise<WeatherInfo> {
  const res = await fetch("https://uapis.cn/api/v1/misc/weather?lang=zh");
  if (!res.ok) throw new Error(`天气接口 HTTP ${res.status}`);
  const raw = (await res.json()) as Record<string, unknown>;
  return {
    city: String(raw.city ?? raw.district ?? ""),
    weather: String(raw.weather ?? "未知"),
    temperature: Number(raw.temperature ?? 0),
    humidity: Number(raw.humidity ?? 0),
    windDirection: String(raw.wind_direction ?? ""),
    windPower: String(raw.wind_power ?? ""),
  };
}

/** AI 助手对话：带上下文摘要的多轮问答 */
export async function chatAssistant(
  messages: { role: "user" | "assistant"; content: string }[],
  context: string,
): Promise<string> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify({ messages, context }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text.slice(0, 160);
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? msg;
    } catch {
      // 保留原始文本
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { reply?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return data.reply ?? "";
}

/** 印记卡片 AI 一句话 */
export async function imprintLine(payload: {
  drinkName: string;
  flavor: string;
  behaviorProfile: string;
  state: string;
  weather: string;
}): Promise<string> {
  const res = await fetch(`${API_BASE}/imprint-line`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI 文案失败（${res.status}）：${text.slice(0, 160)}`);
  }
  const data = (await res.json()) as { line?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return data.line ?? "";
}

// ---- ESP 遥测（/api/v1，商家 token 鉴权）----
function espHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
  };
}

/** 最近会话列表（进行中 + 历史） */
export async function fetchEspSessions(limit = 30): Promise<EspSession[]> {
  const res = await fetch(`${API_BASE}/v1/sessions?limit=${limit}`, { headers: espHeaders() });
  const data = (await res.json().catch(() => ({}))) as { sessions?: EspSession[]; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `接口错误 ${res.status}`);
  return data.sessions ?? [];
}

/** 增量拉取会话数据包（fromSeq 起） */
export async function fetchEspPackets(
  sessionId: string,
  fromSeq = 1,
  limit = 200,
): Promise<{ session: EspSession; packets: EspPacket[] }> {
  const res = await fetch(
    `${API_BASE}/v1/sessions/${encodeURIComponent(sessionId)}/packets?fromSeq=${fromSeq}&limit=${limit}`,
    { headers: espHeaders() },
  );
  const data = (await res.json().catch(() => ({}))) as {
    session?: EspSession;
    packets?: EspPacket[];
    error?: string;
  };
  if (!res.ok || data.error || !data.session) throw new Error(data.error ?? `接口错误 ${res.status}`);
  return { session: data.session, packets: data.packets ?? [] };
}

/** 会话的行为事件（后端从 25Hz 原始采样识别） */
export async function fetchEspEvents(
  sessionId: string,
): Promise<{ status: EspSession["status"]; events: EspEvent[] }> {
  const res = await fetch(`${API_BASE}/v1/sessions/${encodeURIComponent(sessionId)}/events`, {
    headers: espHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    status?: EspSession["status"];
    events?: EspEvent[];
    error?: string;
  };
  if (!res.ok || data.error) throw new Error(data.error ?? `接口错误 ${res.status}`);
  return { status: data.status ?? "COMPLETED", events: data.events ?? [] };
}

/** 单场会话 AI 解读：根据事件时间线生成一段行为画像文字 */
export async function fetchSessionAiNote(sessionId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/v1/sessions/${encodeURIComponent(sessionId)}/ai-note`, {
    method: "POST",
    headers: espHeaders(),
    body: "{}",
  });
  const data = (await res.json().catch(() => ({}))) as { note?: string; error?: string };
  if (!res.ok || data.error || !data.note) throw new Error(data.error ?? `接口错误 ${res.status}`);
  return data.note;
}

/** 真实遥测聚合（D1 会话 + 行为事件识别），供经营分析页使用；无数据时 stats 为空数组 */
export interface TelemetrySummary {
  sessionCount: number;
  userCount: number;
  sessions: Session[];
  stats: DrinkStats[];
}

export async function fetchTelemetrySummary(): Promise<TelemetrySummary> {
  const res = await fetch(`${API_BASE}/v1/telemetry/summary`, { headers: espHeaders() });
  const data = (await res.json().catch(() => ({}))) as Partial<TelemetrySummary> & { error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `接口错误 ${res.status}`);
  return {
    sessionCount: data.sessionCount ?? 0,
    userCount: data.userCount ?? 0,
    sessions: data.sessions ?? [],
    stats: data.stats ?? [],
  };
}

/** 老板点击「停止体验」→ 后端标记 STOP_REQUESTED，ESP 下一包响应收到 STOP */
export async function stopEspSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
    headers: espHeaders(),
    body: "{}",
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `接口错误 ${res.status}`);
}
