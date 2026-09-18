/**
 * 微醺印记 · 商家端云端 API（Pages Functions）
 * 路由：/api/health /api/auth/* /api/data /api/analyze /api/v1/*（ESP 协议 v1）
 * 存储：KV（TIPSY_KV）+ D1（TIPSY_DB，遥测 sessions/packets）；密码：PBKDF2-SHA256 5万次 + HMAC pepper（PASSWORD_PEPPER 密钥）
 * 模型凭据：ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL（Pages 密钥）；设备共享密钥：DEVICE_KEY
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const PBKDF2_ITERATIONS = 50_000;
const TOKEN_TTL_SECONDS = 7 * 24 * 3600;
const ANALYZE_MIN_INTERVAL_MS = 20_000;
const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const TEXT_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const IMPRINT_LINE_MIN_INTERVAL_MS = 1_200;
const MENU_IMPORT_MIN_INTERVAL_MS = 10_000;
const CHAT_MIN_INTERVAL_MS = 1_500;
const AI_NOTE_MIN_INTERVAL_MS = 3_000;
let lastImprintLineAt = 0;
let lastMenuImportAt = 0;
let lastChatAt = 0;
let lastAiNoteAt = 0;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function sendJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

const LOGIN_MIN_INTERVAL_MS = 2_000;
let lastLoginAt = 0;

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > 5 * 1024 * 1024) throw new Error("请求体过大");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error("JSON 解析失败");
  }
}

// ---- 密码哈希：PBKDF2 5万次 + HMAC pepper ----
const encoder = new TextEncoder();

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacPepper(env, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.PASSWORD_PEPPER),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

async function hashPassword(env, password, saltHex) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return bytesToHex(await hmacPepper(env, new Uint8Array(bits)));
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- token：随机 32 字节 hex，存 KV 带 7 天 TTL ----
async function issueToken(env, username) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = bytesToHex(bytes);
  await env.TIPSY_KV.put(`token:${token}`, username, { expirationTtl: TOKEN_TTL_SECONDS });
  return token;
}

async function getAuthUser(request, env) {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return undefined;
  return env.TIPSY_KV.get(`token:${token}`);
}

// ---- 数据快照 ----
async function loadSnapshot(env, username) {
  const raw = await env.TIPSY_KV.get(`data:${username}`);
  return raw ? JSON.parse(raw) : null;
}

// ---- AI 分析（与本地 server/analysis.mjs 逻辑一致）----
let lastAnalyzeAt = 0;

const DrinkInsightSchema = z.object({
  drinkId: z.string(),
  drinkName: z.string(),
  behaviorProfile: z.string(),
  intentMatch: z.number(),
  intentComment: z.string(),
  riskFlag: z.string().optional(),
});

const ReportSchema = z.object({
  summary: z.string(),
  drinkInsights: z.array(DrinkInsightSchema),
  recommendations: z.array(z.string()),
});

// ---- 拍照导入酒单（Workers AI 视觉）与卡片风格 ----
const MenuDrinkSchema = z.object({
  name: z.string().min(1),
  category: z.string(),
  abv: z.number().min(0).max(100),
  price: z.number().min(0),
  flavor: z.string(),
  designIntent: z.string(),
});

const CardStyleSchema = z.object({
  name: z.string(),
  pattern: z.enum(["ripple", "diamond", "rings", "slant", "dots"]),
  bgFrom: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  bgTo: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const OCR_FIELDS = [
  "每一项包含字段：",
  'name：酒名（保留原文，如 "Old Fashioned"、"尼格罗尼"）',
  "category：品类（如 经典鸡尾酒/威士忌/精酿啤酒/葡萄酒，未知填 其他）",
  "abv：酒精度数字（不带 % 号，未知填 0）",
  "price：人民币价格数字（不带 ￥ 号，未知填 0）",
  "flavor：一句话风味描述（如「草本苦甜，橙皮油脂香」；未知填 未知）",
  "designIntent：设计初衷，即预期的用户饮用行为（如「预期用户小口慢品、多次拿起、停留时间长」；可结合酒款类型推断）",
].join("\n");

const TRANSCRIBE_PROMPT = [
  "你是酒吧酒单抄录助手。逐行抄录图片中的全部可见文字（酒名、分类、度数、价格、风味描述等），",
  "保持原始顺序与行结构，一字不漏。只输出抄录文字本身，不要任何解释、前缀或后缀。",
].join("\n");

const OCR_PROMPT = [
  "你是酒吧酒单信息提取助手。从下面的酒单文字抄录中提取全部酒款，输出严格的 JSON 数组。",
  OCR_FIELDS,
  "注意：只提取酒单条目本身，配料表（如威士忌、苦精、糖浆等原料文字）不要单独当成酒款；价格与酒精度请仔细核对数字。",
  "只输出 JSON 数组本身：第一个字符必须是 [，输出紧凑 JSON（不要换行和缩进），不要 markdown 代码块，不要任何解释文字。",
  "抄录中没有酒单内容时输出 []。",
  "酒单文字抄录：",
].join("\n");

const STYLE_PROMPT = [
  "你是鸡尾酒视觉设计师。为下列每款酒选择一张深色系卡片视觉方案，输出严格的 JSON 数组，与输入顺序一一对应。",
  "每一项包含字段：",
  "name：酒名（与输入完全一致）",
  "pattern：从 ripple（涟漪）/ diamond（菱形）/ rings（同心圆）/ slant（斜纹）/ dots（圆点）中选一个最贴合酒款气质的花纹",
  "bgFrom、bgTo：卡片背景渐变两端颜色（深色系 hex，如 #1c1917，对比度足够，贴合酒的色泽：琥珀酒用暖棕、清爽酒用深青、甜酒用紫红）",
  "accent：点缀色（金色系或与酒色呼应的亮色 hex，如 #f59e0b）",
  "只输出 JSON 数组本身：第一个字符必须是 [，输出紧凑 JSON（不要换行和缩进），不要 markdown 代码块，不要任何解释文字。",
  "酒款列表（JSON）：",
].join("\n");

function resolveArray(value, raw = "") {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.includes("[")) return JSON.parse(extractArray(value));
  throw new Error(`模型响应无法解析：${raw}`);
}

function extractText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value[0];
    if (first && typeof first === "object") {
      return String(first.text ?? first.response ?? first.content ?? first.answer ?? JSON.stringify(first));
    }
    return value.map((v) => String(v)).join("");
  }
  if (value && typeof value === "object") {
    return String(value.text ?? value.response ?? value.answer ?? value.content ?? JSON.stringify(value));
  }
  return String(value ?? "");
}

function extractArray(text) {
  const start = text.indexOf("[");
  if (start < 0) throw new Error("模型响应中未找到 JSON 数组");
  const end = text.lastIndexOf("]");
  const slice = end > start ? text.slice(start, end + 1) : text.slice(start);
  try {
    JSON.parse(slice);
    return slice;
  } catch {
    // 输出被截断时按最后一个完整对象收尾
    const lastBrace = slice.lastIndexOf("}");
    if (lastBrace > 0) return `${slice.slice(0, lastBrace + 1)}]`;
    throw new Error("模型响应 JSON 解析失败");
  }
}

function sanitizeMenuItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((raw) => ({
      name: String(raw?.name ?? "").trim(),
      category: String(raw?.category ?? "").trim() || "其他",
      abv: Math.min(100, Math.max(0, Number.parseFloat(String(raw?.abv ?? "").replace(/[^\d.]/g, "")) || 0)),
      price: Math.max(0, Number.parseFloat(String(raw?.price ?? "").replace(/[^\d.]/g, "")) || 0),
      flavor: String(raw?.flavor ?? "").trim() || "未知",
      designIntent: String(raw?.designIntent ?? "").trim(),
    }))
    .filter((d) => d.name);
}

const CATEGORY_STYLES = [
  { re: /威士忌|whisk|烈酒|白兰地|金酒|gin/i, style: { pattern: "rings", bgFrom: "#2b1a10", bgTo: "#100a06", accent: "#f59e0b" } },
  { re: /清爽|气泡|伏特加|vodka|汤力|tonic/i, style: { pattern: "ripple", bgFrom: "#0f2a33", bgTo: "#071418", accent: "#67e8f9" } },
  { re: /甜|朗姆|rum|利口|果味/i, style: { pattern: "diamond", bgFrom: "#2a1430", bgTo: "#120a16", accent: "#ec78ff" } },
  { re: /啤酒|beer|精酿|小麦/i, style: { pattern: "dots", bgFrom: "#1d2413", bgTo: "#0b0e06", accent: "#a3e635" } },
  { re: /葡萄酒|红酒|wine/i, style: { pattern: "slant", bgFrom: "#2e1020", bgTo: "#120710", accent: "#f43f5e" } },
];
const DEFAULT_STYLE = { pattern: "slant", bgFrom: "#1c1917", bgTo: "#0c0a09", accent: "#fbbf24" };

function defaultStyle(drink, index) {
  const hit = CATEGORY_STYLES.find((c) => c.re.test(`${drink.category} ${drink.name} ${drink.flavor}`));
  if (hit) return { ...hit.style };
  const shift = index % 3;
  return { ...DEFAULT_STYLE, accent: [DEFAULT_STYLE.accent, "#67e8f9", "#ec78ff"][shift] };
}

const SYSTEM_PROMPT = [
  "你是一位资深酒吧经营数据分析师，服务对象是酒吧老板。",
  "数据来自智能酒杯传感器（杯垫检测拿起/放下/饮用/摇晃/一饮而尽）。",
  "",
  "统计指标含义：",
  "- avgPickupCount：平均拿起酒杯次数",
  "- avgSipVolume：平均单次饮用量（ml）",
  "- avgShake：平均摇晃幅度（0-1）",
  "- chugRate：一饮而尽率（0-1）",
  "- avgDurationMin：平均停留时长（分钟）",
  "",
  "输入内容：",
  "1. drinks：酒单配置，含 designIntent（设计初衷，描述期望的用户行为）",
  "2. stats：每款酒传感器统计",
  "3. sessions：品饮会话（含时长、拿起次数、一饮而尽）",
  "4. users：用户（匿名昵称）",
  "",
  "分析要求：",
  "1. 必须为输入中的每一款酒各生成一条 drinkInsights（数量与酒款数量一致，一款也不能漏），每条包含一句话「行为画像」，例如：高频拿起+高摇晃+小口品饮（典型烈酒行为）",
  "2. 将行为画像与 designIntent（设计初衷）比对，给出 intentMatch 匹配度（0-100 整数）。",
  "   高匹配 = 用户行为符合设计预期；低匹配 = 行为偏离，需要关注",
  "3. intentComment 说明匹配或偏离的原因，偏离明显时用 riskFlag 给出简短警示",
  "4. summary 用 2-4 句话概括全场数据特征与关键发现",
  "5. recommendations 给出 3-5 条可执行的经营建议（如排班、定价、搭配、引导策略）",
  "6. 全部输出使用简体中文",
  "7. 只输出纯 JSON 对象，不要 markdown 代码块、不要任何额外文字",
  "8. JSON 字段名必须严格使用以下模板（不要改名、不要增减字段）：",
  '{ "summary": "字符串", "drinkInsights": [ { "drinkId": "字符串", "drinkName": "字符串", "behaviorProfile": "字符串", "intentMatch": 整数, "intentComment": "字符串", "riskFlag": "字符串或省略" } ], "recommendations": ["字符串"] }',
].join("\n");

const CHAT_SYSTEM_PROMPT = [
  "你是「微醺印记」商家数据台的 AI 助手，服务对象是酒吧老板。",
  "商家数据台功能：数据分析（AI 经营分析报告）、数据接收（智能酒杯传感器实时事件）、数据管理（会话/事件明细）、用户管理、酒单配置（支持拍照 AI 导入酒单）、印记卡片（每场会话生成一张数字杯底印记卡片，AI 配色花纹 + 一句话文案，可导出图片）。",
  "传感器指标含义：拿起次数（pickupCount，拿起酒杯的次数）、单次饮用量（avgSipVolume, ml）、摇晃幅度（0-1）、一饮而尽率（chugRate, 0-1）、停留时长（分钟）。",
  "回答要求：",
  "1. 全部使用简体中文，语气专业而亲切",
  "2. 简洁优先，一般 2-4 句话；列清单时不超过 5 条",
  "3. 涉及经营建议时结合下方数据摘要给出可执行建议",
  "4. 摘要中没有的数据不要编造，如实说明并建议去对应页面查看",
  "5. 不要输出 markdown 标题或代码块，可用「-」列表",
].join("\n");

function buildRequest(model, payload, extra = {}) {
  return {
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: SYSTEM_PROMPT }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "以下是酒款配置与传感器统计数据（JSON）：" },
          { type: "text", text: JSON.stringify(payload) },
        ],
      },
    ],
    ...extra,
  };
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  throw new Error("模型响应中未找到 JSON");
}

async function analyzeOnce(env, payload) {
  const client = new Anthropic({
    authToken: env.ANTHROPIC_AUTH_TOKEN,
    baseURL: env.ANTHROPIC_BASE_URL,
  });
  const model = env.ANTHROPIC_MODEL ?? "claude-opus-4-7";
  try {
    const response = await client.messages.parse(
      buildRequest(model, payload, {
        output_config: { format: zodOutputFormat(ReportSchema) },
      }),
    );
    if (response.parsed_output) return response.parsed_output;
  } catch (error) {
    console.warn("[analysis] 结构化输出不可用，降级手动解析:", error.message);
  }
  const msg = await client.messages.create(buildRequest(model, payload));
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const parsed = ReportSchema.safeParse(JSON.parse(extractJson(text)));
  if (!parsed.success) {
    throw new Error(`模型输出不符合 schema: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

async function analyze(env, payload) {
  const attempts = 2;
  for (let i = 0; i < attempts; i++) {
    const report = await analyzeOnce(env, payload);
    const expected = payload.drinks?.length ?? 0;
    if (!expected || report.drinkInsights.length >= expected) return report;
    console.warn(`[analysis] 洞察数不足（${report.drinkInsights.length}/${expected}），重试 ${i + 1}/${attempts - 1}`);
  }
  throw new Error("模型多次输出均缺少酒款洞察，请重试");
}

// ---- ESP 协议 v1（规格：ESP与后端的对接.pdf）----
const ESP_PROTOCOL_VERSION = 1;
const TELEMETRY_MAX_SAMPLES = 120;
const DEVICE_ID_PATTERN = /^[\w.-]{1,64}$/;

function espEnvelope({ ok = true, command, sessionId = null, ackSeq = null, error = null }) {
  return {
    protocolVersion: ESP_PROTOCOL_VERSION,
    ok,
    serverTimeMs: Date.now(),
    command,
    sessionId,
    ackSeq,
    error,
  };
}

function espError(code, message, sessionId = null) {
  return sendJson(espEnvelope({ ok: false, command: "ERROR", sessionId, error: { code, message } }));
}

function deviceAuthorized(request, env) {
  const expected = String(env.DEVICE_KEY ?? "");
  const given = request.headers.get("X-Device-Key") ?? "";
  return expected.length > 0 && timingSafeEqualHex(given, expected);
}

const EspSampleSchema = z.object({
  tMs: z.number().finite(),
  fsrAdc: z.number().finite(),
  ax: z.number().finite(),
  ay: z.number().finite(),
  az: z.number().finite(),
  gx: z.number().finite(),
  gy: z.number().finite(),
  gz: z.number().finite(),
});

const EspBatchSchema = z.object({
  protocolVersion: z.number().optional(),
  sessionId: z.string().min(1).max(64),
  seq: z.number().int().min(1),
  batchStartMs: z.number().int().nonnegative(),
  sampleRateHz: z.number().positive(),
  samples: z.array(EspSampleSchema).min(1).max(TELEMETRY_MAX_SAMPLES),
});

function protocolVersionOk(body) {
  return body.protocolVersion == null || Number(body.protocolVersion) === ESP_PROTOCOL_VERSION;
}

async function handleDeviceCommand(env, deviceId) {
  const row = await env.TIPSY_DB.prepare(
    `SELECT id, status, last_seq, started_at_ms FROM sessions
     WHERE device_id = ? AND status IN ('ACTIVE', 'STOP_REQUESTED')
     ORDER BY created_at_ms DESC LIMIT 1`,
  )
    .bind(deviceId)
    .first();
  if (!row) return sendJson(espEnvelope({ command: "WAIT" }));
  if (row.status === "STOP_REQUESTED") {
    return sendJson(espEnvelope({ command: "STOP", sessionId: row.id, ackSeq: row.last_seq }));
  }
  if (!row.started_at_ms) {
    await env.TIPSY_DB.prepare("UPDATE sessions SET started_at_ms = ? WHERE id = ? AND started_at_ms IS NULL")
      .bind(Date.now(), row.id)
      .run();
    return sendJson(espEnvelope({ command: "START", sessionId: row.id }));
  }
  return sendJson(espEnvelope({ command: "CONTINUE", sessionId: row.id, ackSeq: row.last_seq }));
}

async function handleTelemetryBatch(request, env, deviceId) {
  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    return espError("BAD_REQUEST", error.message);
  }
  if (!protocolVersionOk(body)) {
    return espError("UNSUPPORTED_VERSION", `仅支持 protocolVersion=${ESP_PROTOCOL_VERSION}`);
  }
  const parsed = EspBatchSchema.safeParse(body);
  if (!parsed.success) {
    const sid = typeof body.sessionId === "string" ? body.sessionId : null;
    return espError("INVALID_PAYLOAD", `数据包校验失败：${parsed.error.issues[0]?.message ?? "格式错误"}`, sid);
  }
  const batch = parsed.data;
  const session = await env.TIPSY_DB.prepare("SELECT id, device_id, status FROM sessions WHERE id = ?")
    .bind(batch.sessionId)
    .first();
  if (!session || session.device_id !== deviceId) {
    return espError("INVALID_SESSION", "会话不存在或不属于该设备", batch.sessionId);
  }
  if (session.status !== "ACTIVE" && session.status !== "STOP_REQUESTED") {
    return espError("INVALID_SESSION", "会话已结束", batch.sessionId);
  }
  const inserted = await env.TIPSY_DB.prepare(
    `INSERT OR IGNORE INTO packets
       (session_id, seq, device_id, batch_start_ms, sample_rate_hz, sample_count, samples, received_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      batch.sessionId,
      batch.seq,
      deviceId,
      batch.batchStartMs,
      Math.round(batch.sampleRateHz),
      batch.samples.length,
      JSON.stringify(batch.samples),
      Date.now(),
    )
    .run();
  if (inserted.meta.changes) {
    await env.TIPSY_DB.prepare(
      "UPDATE sessions SET last_seq = MAX(last_seq, ?), last_packet_at_ms = ? WHERE id = ?",
    )
      .bind(batch.seq, Date.now(), batch.sessionId)
      .run();
  }
  const command = session.status === "STOP_REQUESTED" ? "STOP" : "CONTINUE";
  return sendJson(espEnvelope({ command, sessionId: batch.sessionId, ackSeq: batch.seq }));
}

async function handleSessionComplete(request, env, deviceId, sessionId) {
  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    return espError("BAD_REQUEST", error.message, sessionId);
  }
  if (!protocolVersionOk(body)) {
    return espError("UNSUPPORTED_VERSION", `仅支持 protocolVersion=${ESP_PROTOCOL_VERSION}`, sessionId);
  }
  const lastSeq = Number(body.lastSeq);
  if (!Number.isInteger(lastSeq) || lastSeq < 1) {
    return espError("INVALID_PAYLOAD", "lastSeq 需为 ≥1 的整数", sessionId);
  }
  const session = await env.TIPSY_DB.prepare("SELECT id, device_id, status FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first();
  if (!session || session.device_id !== deviceId) {
    return espError("INVALID_SESSION", "会话不存在或不属于该设备", sessionId);
  }
  if (session.status === "COMPLETED") {
    return sendJson(espEnvelope({ command: "COMPLETED", sessionId, ackSeq: lastSeq }));
  }
  const stat = await env.TIPSY_DB.prepare(
    "SELECT COUNT(*) AS received, MAX(seq) AS maxSeq FROM packets WHERE session_id = ?",
  )
    .bind(sessionId)
    .first();
  const received = Number(stat?.received ?? 0);
  const maxSeq = Number(stat?.maxSeq ?? 0);
  if (received !== lastSeq || maxSeq !== lastSeq) {
    return espError(
      "INCOMPLETE",
      `数据未收齐（已收 ${received} 包 / 声明 ${lastSeq}，最大 seq ${maxSeq}），请补传后再试`,
      sessionId,
    );
  }
  await env.TIPSY_DB.prepare("UPDATE sessions SET status = 'COMPLETED', completed_at_ms = ? WHERE id = ?")
    .bind(Date.now(), sessionId)
    .run();
  return sendJson(espEnvelope({ command: "COMPLETED", sessionId, ackSeq: lastSeq }));
}

async function handleSessionCreate(request, env) {
  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    return sendJson({ ok: false, error: error.message }, 400);
  }
  const userId = String(body.userId ?? "").trim();
  const deviceId = String(body.deviceId ?? "").trim();
  if (!userId || userId.length > 64) return sendJson({ ok: false, error: "userId 无效" }, 400);
  if (!DEVICE_ID_PATTERN.test(deviceId)) return sendJson({ ok: false, error: "deviceId 格式无效" }, 400);
  const drinkJson = body.drink == null ? null : JSON.stringify(body.drink).slice(0, 4000);
  const busy = await env.TIPSY_DB.prepare(
    `SELECT id, device_id FROM sessions
     WHERE status IN ('ACTIVE', 'STOP_REQUESTED') AND (device_id = ? OR user_id = ?)
     LIMIT 1`,
  )
    .bind(deviceId, userId)
    .first();
  if (busy) {
    const deviceBusy = busy.device_id === deviceId;
    return sendJson(
      {
        ok: false,
        code: deviceBusy ? "DEVICE_BUSY" : "USER_BUSY",
        error: deviceBusy ? "杯子正在使用中，请稍后再试" : "你还有一杯进行中",
      },
      409,
    );
  }
  const sessionId = `ses-${bytesToHex(crypto.getRandomValues(new Uint8Array(4)))}`;
  await env.TIPSY_DB.prepare(
    `INSERT INTO sessions (id, device_id, user_id, drink, status, created_at_ms, last_seq)
     VALUES (?, ?, ?, ?, 'ACTIVE', ?, 0)`,
  )
    .bind(sessionId, deviceId, userId, drinkJson, Date.now())
    .run();
  return sendJson({ ok: true, sessionId, deviceId, status: "WAITING_DEVICE", serverTimeMs: Date.now() });
}

async function handleSessionStop(request, env, sessionId) {
  const username = await getAuthUser(request, env);
  if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
  const session = await env.TIPSY_DB.prepare("SELECT id, status FROM sessions WHERE id = ?").bind(sessionId).first();
  if (!session) return sendJson({ ok: false, error: "会话不存在" }, 404);
  if (session.status !== "ACTIVE") {
    return sendJson(
      { ok: false, error: session.status === "STOP_REQUESTED" ? "已请求停止" : "会话已结束" },
      409,
    );
  }
  await env.TIPSY_DB.prepare("UPDATE sessions SET status = 'STOP_REQUESTED', stop_requested_at_ms = ? WHERE id = ?")
    .bind(Date.now(), sessionId)
    .run();
  return sendJson({ ok: true, sessionId, status: "STOP_REQUESTED" });
}

// ---- 行为事件识别：从 25Hz 原始采样推导语义事件（阈值初值，待实机标定）----
const EVENT_TUNING = {
  liftRatio: 0.5, // fsr 低于静息中位数的一半 → 杯子离座
  tiltDeg: 25, // 倾角阈值（饮用姿态）
  tiltMinMs: 400, // 倾角持续下限（过滤抖动）
  chugTiltMs: 3_000, // 单次持续倾角超过该时长 → 一饮而尽
  shakePeakDps: 90, // 摇晃：角速度峰值（deg/s）
  shakeMinSignFlips: 4, // 摇晃：1 秒窗口内 gz 过零次数
  shakeCooldownMs: 2_000,
  unitsPerMl: 10, // FSR 计数 → 毫升换算
};

function tiltDegrees(s) {
  const mag = Math.hypot(s.ax, s.ay, s.az) || 1;
  return (Math.acos(Math.min(Math.max(s.az / mag, -1), 1)) * 180) / Math.PI;
}

function emitDrinkEvents(events, bouts, consumed) {
  const valid = bouts.filter((b) => b.endMs - b.startMs >= EVENT_TUNING.tiltMinMs);
  if (!valid.length) return;
  const ml = Math.round(consumed / EVENT_TUNING.unitsPerMl);
  if (valid.some((b) => b.endMs - b.startMs >= EVENT_TUNING.chugTiltMs)) {
    events.push({ type: "chug", tsMs: valid[0].startMs, value: ml });
    return;
  }
  const total = valid.reduce((a, b) => a + (b.endMs - b.startMs), 0) || 1;
  for (const b of valid) {
    events.push({ type: "sip", tsMs: b.startMs, value: Math.round((ml * (b.endMs - b.startMs)) / total) });
  }
}

function detectSessionEvents(packets) {
  const samples = [];
  for (const p of packets) {
    for (const s of p.samples) samples.push({ ...s, absMs: p.batchStartMs + s.tMs });
  }
  if (!samples.length) return [];
  // 静息基线：取明显承重样本的中位数（会话中离座时段可能占多数，直接取中位数会偏低）
  const sorted = samples.map((s) => s.fsrAdc).sort((a, b) => a - b);
  const maxFsr = sorted[sorted.length - 1];
  const onBase = sorted.filter((v) => v > maxFsr * 0.3);
  const restW = onBase.length ? onBase[Math.floor(onBase.length / 2)] : maxFsr;
  const onThresh = restW * EVENT_TUNING.liftRatio;

  const events = [];
  let lifted = false;
  let weightBeforeLift = 0;
  let tiltBoutStart = null;
  let tiltBouts = [];
  let shakeWindow = [];
  let shakeCooldownUntil = 0;
  let pendingDrink = null; // 放下后等承重稳定再结算消耗（避开拿起/放下的斜坡采样）
  let lastOnFsr = null;
  let stableCount = 0;
  let quietCount = 0;
  const settleEps = restW * 0.05; // 放回后结算：允许稍慢的稳定
  const restEps = Math.max(restW * 0.02, 8); // 离桌前静息：更紧，明显变化即停止刷新离线重量

  const closeBout = (endMs) => {
    if (tiltBoutStart !== null) {
      tiltBouts.push({ startMs: tiltBoutStart, endMs });
      tiltBoutStart = null;
    }
  };

  for (const s of samples) {
    const isLifted = s.fsrAdc < onThresh;

    if (isLifted && !lifted) {
      lifted = true;
      tiltBouts = [];
      tiltBoutStart = null;
      shakeWindow = [];
      events.push({ type: "pickup", tsMs: s.absMs });
    } else if (!isLifted && lifted) {
      lifted = false;
      closeBout(s.absMs);
      pendingDrink = { weightBefore: weightBeforeLift, bouts: tiltBouts };
      events.push({ type: "putdown", tsMs: s.absMs });
      lastOnFsr = null; // 新承重段：放回斜坡采样不能与拿起前的残留值比较
      stableCount = 0;
    }

    if (!isLifted) {
      // 连续两拍变化小才算承重稳定（放回斜坡是渐变，单拍阈值可能误判）
      const prevFsr = lastOnFsr;
      const delta = lastOnFsr === null ? Infinity : Math.abs(s.fsrAdc - lastOnFsr);
      stableCount = delta < settleEps ? stableCount + 1 : 0;
      quietCount = delta < restEps ? quietCount + 1 : 0;
      lastOnFsr = s.fsrAdc;
      const stable = stableCount >= 2;
      if (pendingDrink && stable) {
        emitDrinkEvents(events, pendingDrink.bouts, Math.max(0, pendingDrink.weightBefore - s.fsrAdc));
        pendingDrink = null;
      }
      // 离线重量比当前拍滞后一拍：拿起斜坡的首拍可能平缓到小于静息阈值，取其前一拍可避免斜坡值混入
      if (quietCount >= 2) weightBeforeLift = prevFsr;
    }

    if (lifted) {
      if (tiltDegrees(s) >= EVENT_TUNING.tiltDeg) {
        if (tiltBoutStart === null) tiltBoutStart = s.absMs;
      } else {
        closeBout(s.absMs);
      }
      shakeWindow.push(s);
      while (shakeWindow.length && s.absMs - shakeWindow[0].absMs > 1_000) shakeWindow.shift();
      if (s.absMs >= shakeCooldownUntil && shakeWindow.length > 8) {
        let peak = 0;
        let flips = 0;
        let prevSign = 0;
        for (const w of shakeWindow) {
          const dps = Math.hypot(w.gx, w.gy, w.gz);
          if (dps > peak) peak = dps;
          const sign = w.gz >= 0 ? 1 : -1;
          if (prevSign !== 0 && sign !== prevSign) flips++;
          prevSign = sign;
        }
        if (peak >= EVENT_TUNING.shakePeakDps && flips >= EVENT_TUNING.shakeMinSignFlips) {
          events.push({
            type: "shake",
            tsMs: s.absMs,
            value: Math.min(1, Math.max(0.05, Number((peak / 200).toFixed(2)))),
          });
          shakeCooldownUntil = s.absMs + EVENT_TUNING.shakeCooldownMs;
        }
      }
    } else {
      shakeWindow = [];
    }
  }
  if (lifted) closeBout(samples[samples.length - 1].absMs); // 会话在举杯状态结束：不判定饮用量
  events.sort((a, b) => a.tsMs - b.tsMs);
  return events;
}

const EVENT_TYPE_CN = { pickup: "拿起酒杯", putdown: "放回桌面", sip: "饮用", shake: "摇晃", chug: "一饮而尽" };

/** 单场会话 AI 解读：事件时间线 + 会话指标 → 一段行为画像（Workers AI，与 imprint-line 同管道） */
async function handleSessionAiNote(request, env, sessionId) {
  const username = await getAuthUser(request, env);
  if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
  const since = Date.now() - lastAiNoteAt;
  if (since < AI_NOTE_MIN_INTERVAL_MS) {
    return sendJson(
      { error: `操作过于频繁，请 ${Math.ceil((AI_NOTE_MIN_INTERVAL_MS - since) / 1000)} 秒后重试` },
      429,
    );
  }
  lastAiNoteAt = Date.now();
  if (!env.AI) return sendJson({ error: "AI 服务未配置" }, 503);
  const session = await env.TIPSY_DB.prepare("SELECT id, user_id, drink, started_at_ms, completed_at_ms FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first();
  if (!session) return sendJson({ ok: false, error: "会话不存在" }, 404);
  const { results } = await env.TIPSY_DB.prepare(
    "SELECT batch_start_ms, samples FROM packets WHERE session_id = ? ORDER BY seq",
  )
    .bind(sessionId)
    .all();
  const packets = results.map((r) => ({ batchStartMs: r.batch_start_ms, samples: JSON.parse(r.samples) }));
  const events = detectSessionEvents(packets);
  if (!events.length) return sendJson({ error: "该会话暂无遥测数据，无法解读" }, 400);
  const m = summarizeSessionEvents(events);
  const drink = session.drink ? JSON.parse(session.drink) : null;
  const durationSec = Math.max(1, Math.round(((session.completed_at_ms ?? events[events.length - 1].tsMs) - session.started_at_ms) / 1000));
  const timeline = events.map((e) => {
    const t = ((e.tsMs - session.started_at_ms) / 1000).toFixed(1);
    const v = e.value === undefined ? "" : e.type === "shake" ? `（幅度 ${e.value}）` : `（${e.value} ml）`;
    return `${t}s ${EVENT_TYPE_CN[e.type] ?? e.type}${v}`;
  });
  const prompt = [
    "你是「微醺印记」智能酒杯的行为分析师，为酒吧老板解读一场顾客的品饮行为。",
    `酒款：${drink?.name ?? "未知酒款"}`,
    `会话时长：约 ${durationSec} 秒；拿起 ${m.pickupCount} 次；饮用合计 ${m.sipVolumeTotal} ml；最大摇晃幅度 ${m.shakeMax}；一饮而尽：${m.chugged ? "是" : "否"}`,
    "行为时间线：",
    ...timeline,
    "要求：用 2-3 句简体中文概括这位顾客的饮酒风格（如悠闲慢品/社交小酌/豪爽畅饮）并给出面向门店的一句话观察建议；",
    "只输出这段文字本身，不要标题、引号、列表符号或 markdown。",
  ].join("\n");
  try {
    const out = await env.AI.run(TEXT_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 320,
      temperature: 0.7,
    });
    const note = String(out?.response ?? out?.result ?? "")
      .trim()
      .replace(/^["「『]|["」』]$/g, "")
      .replace(/\n+/g, " ");
    if (!note) return sendJson({ error: "AI 未返回内容，请重试" }, 502);
    return sendJson({ ok: true, sessionId, note });
  } catch (error) {
    return sendJson({ error: `AI 调用失败：${error.message}` }, 502);
  }
}

function summarizeSessionEvents(events) {
  const pickups = events.filter((e) => e.type === "pickup").length;
  const drinks = events.filter((e) => e.type === "sip" || e.type === "chug");
  const sipVolumeTotal = drinks.reduce((a, e) => a + (e.value ?? 0), 0);
  return {
    pickupCount: pickups,
    sipVolumeTotal,
    avgSipVolume: drinks.length ? Math.round(sipVolumeTotal / drinks.length) : 0,
    shakeMax: events.filter((e) => e.type === "shake").reduce((a, e) => Math.max(a, e.value ?? 0), 0),
    chugged: drinks.some((e) => e.type === "chug"),
  };
}

/** 聚合 D1 真实遥测 → 前端分析页可用的 sessions/stats（compute-on-read） */
async function handleTelemetrySummary(request, env) {
  const username = await getAuthUser(request, env);
  if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
  const { results } = await env.TIPSY_DB.prepare(
    `SELECT id, user_id, drink, started_at_ms, stop_requested_at_ms, completed_at_ms
     FROM sessions WHERE started_at_ms IS NOT NULL ORDER BY created_at_ms DESC LIMIT 50`,
  ).all();

  const sessions = [];
  const byDrink = new Map();
  for (const row of results) {
    const { results: pktRows } = await env.TIPSY_DB.prepare(
      "SELECT batch_start_ms, samples FROM packets WHERE session_id = ? ORDER BY seq",
    )
      .bind(row.id)
      .all();
    if (!pktRows.length) continue;
    const packets = pktRows.map((r) => ({ batchStartMs: r.batch_start_ms, samples: JSON.parse(r.samples) }));
    const m = summarizeSessionEvents(detectSessionEvents(packets));
    const drink = row.drink ? JSON.parse(row.drink) : null;
    const lastMs = packets[packets.length - 1].batchStartMs;
    const endMs = row.completed_at_ms ?? row.stop_requested_at_ms ?? lastMs;
    const durationMin = Math.max(1, Math.round((endMs - row.started_at_ms) / 60_000));
    sessions.push({
      id: row.id,
      userId: row.user_id,
      drinkId: drink?.drinkId ?? null,
      drinkName: drink?.name ?? null,
      startedAt: new Date(row.started_at_ms).toISOString(),
      endedAt: new Date(Math.max(endMs, row.started_at_ms)).toISOString(),
      ...m,
    });

    const key = drink?.drinkId ?? drink?.name ?? "unknown";
    const agg =
      byDrink.get(key) ??
      { drinkId: drink?.drinkId ?? "", drinkName: drink?.name ?? "未知酒款", sessions: 0, pickupSum: 0, sipSum: 0, shakeSum: 0, chugCount: 0, durationSum: 0 };
    agg.sessions++;
    agg.pickupSum += m.pickupCount;
    agg.sipSum += m.avgSipVolume;
    agg.shakeSum += m.shakeMax;
    agg.chugCount += m.chugged ? 1 : 0;
    agg.durationSum += durationMin;
    byDrink.set(key, agg);
  }

  const stats = [...byDrink.values()].map((a) => ({
    drinkId: a.drinkId,
    drinkName: a.drinkName,
    sessions: a.sessions,
    avgPickupCount: Number((a.pickupSum / a.sessions).toFixed(1)),
    avgSipVolume: Math.round(a.sipSum / a.sessions),
    avgShake: Number((a.shakeSum / a.sessions).toFixed(2)),
    chugRate: Number((a.chugCount / a.sessions).toFixed(2)),
    avgDurationMin: Math.round(a.durationSum / a.sessions),
  }));

  return sendJson({
    ok: true,
    source: "telemetry",
    sessionCount: sessions.length,
    userCount: new Set(sessions.map((s) => s.userId).filter(Boolean)).size,
    sessions,
    stats,
  });
}

async function handleSessionEvents(request, env, sessionId) {
  const username = await getAuthUser(request, env);
  if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
  const session = await env.TIPSY_DB.prepare("SELECT id, device_id, user_id, drink, status FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first();
  if (!session) return sendJson({ ok: false, error: "会话不存在" }, 404);
  const { results } = await env.TIPSY_DB.prepare(
    "SELECT batch_start_ms, samples FROM packets WHERE session_id = ? ORDER BY seq",
  )
    .bind(sessionId)
    .all();
  const packets = results.map((r) => ({ batchStartMs: r.batch_start_ms, samples: JSON.parse(r.samples) }));
  const drink = session.drink ? JSON.parse(session.drink) : null;
  return sendJson({
    ok: true,
    sessionId,
    status: session.status,
    userId: session.user_id,
    drinkName: drink?.name ?? null,
    events: detectSessionEvents(packets).map((e, i) => ({
      id: `${sessionId}-e${i}`,
      sessionId,
      userId: session.user_id,
      drinkName: drink?.name ?? null,
      type: e.type,
      value: e.value,
      tsMs: e.tsMs,
    })),
  });
}

async function handleSessionList(request, env, url) {
  const username = await getAuthUser(request, env);
  if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(url.searchParams.get("limit")) || 30)));
  const { results } = await env.TIPSY_DB.prepare(
    `SELECT id, device_id, user_id, drink, status, created_at_ms, started_at_ms, stop_requested_at_ms,
            completed_at_ms, last_seq, last_packet_at_ms
     FROM sessions ORDER BY created_at_ms DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return sendJson({
    ok: true,
    sessions: results.map((s) => ({ ...s, drink: s.drink ? JSON.parse(s.drink) : null })),
  });
}

async function handleSessionPackets(request, env, sessionId, url) {
  const username = await getAuthUser(request, env);
  if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
  const session = await env.TIPSY_DB.prepare(
    `SELECT id, device_id, user_id, drink, status, created_at_ms, started_at_ms, stop_requested_at_ms,
            completed_at_ms, last_seq
     FROM sessions WHERE id = ?`,
  )
    .bind(sessionId)
    .first();
  if (!session) return sendJson({ ok: false, error: "会话不存在" }, 404);
  const fromSeq = Math.max(1, Math.trunc(Number(url.searchParams.get("fromSeq")) || 1));
  const limit = Math.min(600, Math.max(1, Math.trunc(Number(url.searchParams.get("limit")) || 60)));
  const { results } = await env.TIPSY_DB.prepare(
    `SELECT seq, batch_start_ms, sample_rate_hz, sample_count, samples, received_at_ms FROM packets
     WHERE session_id = ? AND seq >= ? ORDER BY seq LIMIT ?`,
  )
    .bind(sessionId, fromSeq, limit)
    .all();
  return sendJson({
    ok: true,
    session: { ...session, drink: session.drink ? JSON.parse(session.drink) : null },
    fromSeq,
    packets: results.map((r) => ({
      seq: r.seq,
      batchStartMs: r.batch_start_ms,
      sampleRateHz: r.sample_rate_hz,
      sampleCount: r.sample_count,
      samples: JSON.parse(r.samples),
      receivedAtMs: r.received_at_ms,
    })),
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // ---- 健康检查 ----
  if (request.method === "GET" && path === "/health") {
    return sendJson({ ok: true, model: env.ANTHROPIC_MODEL, hasApiKey: Boolean(env.ANTHROPIC_AUTH_TOKEN) });
  }

  // ---- 注册 ----
  if (request.method === "POST" && path === "/auth/register") {
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return sendJson({ error: error.message }, 400);
    }
    const { username, password } = body;
    if (!/^[\w\u4e00-\u9fa5-]{2,32}$/.test(String(username ?? ""))) {
      return sendJson({ error: "账号需为 2-32 位字母、数字、中文或连字符" }, 400);
    }
    if (typeof password !== "string" || password.length < 6) {
      return sendJson({ error: "密码至少 6 位" }, 400);
    }
    if (await env.TIPSY_KV.get(`auth:${username}`)) {
      return sendJson({ error: "账号已存在" }, 409);
    }
    const saltHex = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const record = {
      algo: "pbkdf2-sha256",
      iterations: PBKDF2_ITERATIONS,
      salt: saltHex,
      hash: await hashPassword(env, password, saltHex),
    };
    await env.TIPSY_KV.put(`auth:${username}`, JSON.stringify(record));
    return sendJson({ token: await issueToken(env, username), username });
  }

  // ---- 登录 ----
  if (request.method === "POST" && path === "/auth/login") {
    const now = Date.now();
    if (now - lastLoginAt < LOGIN_MIN_INTERVAL_MS) {
      return sendJson({ error: "登录过于频繁，请稍后再试" }, 429);
    }
    lastLoginAt = now;
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return sendJson({ error: error.message }, 400);
    }
    const { username, password } = body;
    const raw = await env.TIPSY_KV.get(`auth:${String(username ?? "")}`);
    if (!raw) {
      return sendJson({ error: "账号或密码错误" }, 401);
    }
    const record = JSON.parse(raw);
    const hash = await hashPassword(env, String(password ?? ""), record.salt);
    if (!timingSafeEqualHex(hash, record.hash)) {
      return sendJson({ error: "账号或密码错误" }, 401);
    }
    return sendJson({ token: await issueToken(env, username), username });
  }

  // ---- 身份 ----
  if (request.method === "GET" && path === "/auth/me") {
    const username = await getAuthUser(request, env);
    if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
    return sendJson({ username });
  }

  // ---- 数据快照 ----
  if (request.method === "GET" && path === "/data") {
    const username = await getAuthUser(request, env);
    if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
    return sendJson(await loadSnapshot(env, username));
  }

  if (request.method === "PUT" && path === "/data") {
    const username = await getAuthUser(request, env);
    if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
    try {
      const data = await request.text();
      if (data.length > 5 * 1024 * 1024) throw new Error("请求体过大");
      JSON.parse(data);
      await env.TIPSY_KV.put(`data:${username}`, data);
      return sendJson({ savedAt: new Date().toISOString() });
    } catch (error) {
      return sendJson({ error: error.message }, 400);
    }
  }

  // ---- AI 分析 ----
  if (request.method === "POST" && path === "/analyze") {
    const username = await getAuthUser(request, env);
    if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
    const since = Date.now() - lastAnalyzeAt;
    if (since < ANALYZE_MIN_INTERVAL_MS) {
      return sendJson(
        { error: `分析请求过于频繁，请 ${Math.ceil((ANALYZE_MIN_INTERVAL_MS - since) / 1000)} 秒后重试` },
        429,
      );
    }
    lastAnalyzeAt = Date.now();
    if (!env.ANTHROPIC_AUTH_TOKEN) {
      return sendJson({ error: "未配置模型凭据，请联系管理员" }, 503);
    }
    try {
      const payload = await readBody(request);
      const startedAt = Date.now();
      const report = await analyze(env, payload);
      return sendJson({
        generatedAt: new Date().toISOString(),
        source: "claude",
        ...report,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        return sendJson({ error: "模型凭据无效或已过期" }, 401);
      } else if (error instanceof Anthropic.RateLimitError) {
        return sendJson({ error: "触发限流，请稍后重试" }, 429);
      } else if (error instanceof Anthropic.APIError) {
        return sendJson({ error: `模型 API 错误 ${error.status}: ${error.message}` }, 502);
      }
      return sendJson({ error: error instanceof Error ? error.message : "请求处理失败" }, 400);
    }
  }

  // ---- 天气（代理 uapis.cn，转发访客 IP 自动定位）----
  if (request.method === "GET" && path === "/weather") {
    const username = await getAuthUser(request, env);
    if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
    const city = url.searchParams.get("city")?.trim();
    const u = new URL("https://uapis.cn/api/v1/misc/weather");
    if (city) u.searchParams.set("city", city);
    u.searchParams.set("lang", "zh");
    try {
      // uapis 按真实客户端 IP 定位且忽略 XFF；从 CF 机房出口无法定位，因此本代理需显式 city 才有意义（前端默认直连 uapis）
      const res = await fetch(u);
      const data = await res.json();
      if (!res.ok || data?.code) {
        return sendJson({ error: `天气服务不可用：${data?.message ?? `HTTP ${res.status}`}` }, 502);
      }
      return sendJson({
        city: data.city,
        province: data.province,
        weather: data.weather,
        temperature: data.temperature,
        humidity: data.humidity,
        wind_direction: data.wind_direction,
        wind_power: data.wind_power,
        weather_icon: data.weather_icon,
        report_time: data.report_time,
      });
    } catch (error) {
      return sendJson({ error: `天气服务不可用：${error.message}` }, 502);
    }
  }

  // ---- AI 绑定自检（可 ?model= 探测）----
  if (request.method === "GET" && path === "/ai-test") {
    const username = await getAuthUser(request, env);
    if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
    if (!env.AI) return sendJson({ error: "AI 绑定未配置" }, 503);
    const model = url.searchParams.get("model")?.trim() || TEXT_MODEL;
    try {
      const out = await env.AI.run(model, {
        messages: [{ role: "user", content: "回复两个字：你好" }],
        max_tokens: 32,
      });
      return sendJson({ ok: true, model, response: out?.response ?? out?.result ?? "" });
    } catch (error) {
      return sendJson({ error: `AI 调用失败：${error.message}`, model }, 502);
    }
  }

  // ---- 拍照导入酒单（视觉 OCR + 卡片风格）----
  if (request.method === "POST" && path === "/menu-import") {
    const username = await getAuthUser(request, env);
    if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
    const since = Date.now() - lastMenuImportAt;
    if (since < MENU_IMPORT_MIN_INTERVAL_MS) {
      return sendJson(
        { error: `操作过于频繁，请 ${Math.ceil((MENU_IMPORT_MIN_INTERVAL_MS - since) / 1000)} 秒后重试` },
        429,
      );
    }
    lastMenuImportAt = Date.now();
    if (!env.AI) return sendJson({ error: "AI 服务未配置" }, 503);
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return sendJson({ error: error.message }, 400);
    }
    const image = typeof body.image === "string" ? body.image : "";
    if (!image.startsWith("data:image/") || image.length > 4 * 1024 * 1024) {
      return sendJson({ error: "请上传 4MB 以内的图片（data URL）" }, 400);
    }
    let rawOcr = "";
    try {
      // 第一步：视觉抄录全部文字（OpenAI 式 image_url 内容数组）
      const ocr = await env.AI.run(VISION_MODEL, {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: TRANSCRIBE_PROMPT },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        max_tokens: 4096,
        temperature: 0.1,
      });
      const transcript = extractText(ocr?.response ?? ocr?.result ?? "");
      if (!transcript.trim()) throw new Error(`视觉抄录为空：${JSON.stringify(ocr).slice(0, 300)}`);
      rawOcr = transcript.slice(0, 800);
      // 第二步：文本模式从抄录提取结构化 JSON
      const textOut = await env.AI.run(TEXT_MODEL, {
        messages: [{ role: "user", content: OCR_PROMPT + transcript }],
        max_tokens: 4096,
        temperature: 0.1,
      });
      const rawItems = resolveArray(textOut?.response ?? textOut?.result ?? "", JSON.stringify(textOut).slice(0, 300));
      const drinks = sanitizeMenuItems(rawItems).map((d) => {
        const parsed = MenuDrinkSchema.safeParse(d);
        return parsed.success ? parsed.data : d;
      });
      if (drinks.length) {
        let styles = { success: false, data: [] };
        try {
          const styleOut = await env.AI.run(TEXT_MODEL, {
            messages: [
              {
                role: "user",
                content:
                  STYLE_PROMPT +
                  JSON.stringify(drinks.map((d) => ({ name: d.name, category: d.category, flavor: d.flavor }))),
              },
            ],
            max_tokens: 2048,
            temperature: 0.7,
          });
          const styleOutRaw = styleOut?.response ?? styleOut?.result ?? "";
          styles = z.array(CardStyleSchema).safeParse(resolveArray(styleOutRaw, JSON.stringify(styleOut).slice(0, 300)));
        } catch (error) {
          console.warn("[menu-import] 卡片风格生成失败，使用默认配色:", error.message);
        }
        const byName = new Map((styles.success ? styles.data : []).map((s) => [s.name, s]));
        drinks.forEach((d, i) => {
          d.cardStyle = byName.get(d.name) ?? defaultStyle(d, i);
        });
      }
      return sendJson({ drinks });
    } catch (error) {
      return sendJson({ error: `识别失败：${error.message}`, raw: rawOcr }, 502);
    }
  }

  // ---- 印记卡片 AI 一句话 ----
  if (request.method === "POST" && path === "/imprint-line") {
    const username = await getAuthUser(request, env);
    if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
    const since = Date.now() - lastImprintLineAt;
    if (since < IMPRINT_LINE_MIN_INTERVAL_MS) {
      return sendJson(
        { error: `操作过于频繁，请 ${Math.ceil((IMPRINT_LINE_MIN_INTERVAL_MS - since) / 1000)} 秒后重试` },
        429,
      );
    }
    lastImprintLineAt = Date.now();
    if (!env.AI) return sendJson({ error: "AI 服务未配置" }, 503);
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return sendJson({ error: error.message }, 400);
    }
    const prompt = [
      "为这杯酒写一句专属印记文案。",
      `酒款：${String(body.drinkName ?? "")}（${String(body.flavor ?? "风味未知")}）`,
      `用户行为画像：${String(body.behaviorProfile ?? "—")}`,
      `今日状态：${String(body.state ?? "")}`,
      `天气：${String(body.weather ?? "—")}`,
      "要求：15-30 字中文，诗意、克制、有画面感，不要引号与表情，只输出这一句话本身。",
    ].join("\n");
    try {
      const out = await env.AI.run(TEXT_MODEL, {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 128,
        temperature: 0.9,
      });
      const line = String(out?.response ?? out?.result ?? "")
        .trim()
        .replace(/^["「『]|["」』]$/g, "")
        .replace(/\n+/g, " ");
      return sendJson({ line });
    } catch (error) {
      return sendJson({ error: `AI 调用失败：${error.message}` }, 502);
    }
  }

  // ---- AI 助手对话 ----
  if (request.method === "POST" && path === "/chat") {
    const username = await getAuthUser(request, env);
    if (!username) return sendJson({ error: "未登录或登录已过期" }, 401);
    const since = Date.now() - lastChatAt;
    if (since < CHAT_MIN_INTERVAL_MS) {
      return sendJson(
        { error: `回复太快啦，请 ${Math.ceil((CHAT_MIN_INTERVAL_MS - since) / 1000)} 秒后重试` },
        429,
      );
    }
    lastChatAt = Date.now();
    if (!env.AI) return sendJson({ error: "AI 服务未配置" }, 503);
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return sendJson({ error: error.message }, 400);
    }
    const history = Array.isArray(body.messages) ? body.messages : [];
    const messages = history
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && String(m.content ?? "").trim())
      .slice(-10)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 1_000) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return sendJson({ error: "messages 需以用户消息结尾" }, 400);
    }
    const context = String(body.context ?? "").slice(0, 1_500);
    try {
      const out = await env.AI.run(TEXT_MODEL, {
        messages: [
          { role: "system", content: CHAT_SYSTEM_PROMPT },
          { role: "user", content: `【当前数据摘要】\n${context || "（暂无数据摘要）"}\n\n以上是后台背景信息，请勿直接复述，仅供回答时参考。` },
          { role: "assistant", content: "好的，我已了解当前数据情况，请提问。" },
          ...messages,
        ],
        max_tokens: 1_024,
        temperature: 0.6,
      });
      const reply = extractText(out?.response ?? out?.result ?? "").trim();
      if (!reply) throw new Error("模型返回空回复");
      return sendJson({ reply });
    } catch (error) {
      return sendJson({ error: `AI 调用失败：${error.message}` }, 502);
    }
  }

  // ---- ESP 协议 v1 ----
  if (path.startsWith("/v1/")) {
    if (!env.TIPSY_DB) return espError("DB_UNAVAILABLE", "遥测库未绑定");
    if (path.startsWith("/v1/devices/") && !deviceAuthorized(request, env)) {
      return espError("UNAUTHORIZED", "设备密钥校验失败");
    }
    let m = path.match(/^\/v1\/devices\/([^/]+)\/command$/);
    if (request.method === "GET" && m) return handleDeviceCommand(env, decodeURIComponent(m[1]));
    m = path.match(/^\/v1\/devices\/([^/]+)\/telemetry-batches$/);
    if (request.method === "POST" && m) return handleTelemetryBatch(request, env, decodeURIComponent(m[1]));
    m = path.match(/^\/v1\/devices\/([^/]+)\/sessions\/([^/]+)\/complete$/);
    if (request.method === "POST" && m) {
      return handleSessionComplete(request, env, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    }
    if (request.method === "POST" && path === "/v1/sessions") {
      return handleSessionCreate(request, env);
    }
    if (request.method === "GET" && path === "/v1/sessions") {
      return handleSessionList(request, env, url);
    }
    m = path.match(/^\/v1\/sessions\/([^/]+)\/stop$/);
    if (request.method === "POST" && m) return handleSessionStop(request, env, decodeURIComponent(m[1]));
    m = path.match(/^\/v1\/sessions\/([^/]+)\/packets$/);
    if (request.method === "GET" && m) {
      return handleSessionPackets(request, env, decodeURIComponent(m[1]), url);
    }
    m = path.match(/^\/v1\/sessions\/([^/]+)\/events$/);
    if (request.method === "GET" && m) {
      return handleSessionEvents(request, env, decodeURIComponent(m[1]));
    }
    m = path.match(/^\/v1\/sessions\/([^/]+)\/ai-note$/);
    if (request.method === "POST" && m) {
      return handleSessionAiNote(request, env, decodeURIComponent(m[1]));
    }
    if (request.method === "GET" && path === "/v1/telemetry/summary") {
      return handleTelemetrySummary(request, env);
    }
    return espError("NOT_FOUND", "接口不存在");
  }

  return sendJson({ error: "接口不存在" }, 404);
}
