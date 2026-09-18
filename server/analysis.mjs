/**
 * 微醺印记 · AI 数据分析服务
 * 数据流：前端 POST /api/analyze {drinks, stats, sessions, users}
 *        → Claude（结构化输出）→ 分析报告 JSON
 * 启动：npm start（需 ANTHROPIC_API_KEY，无 Key 时前端自动降级为 Mock 报告）
 */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, "auth.json");
const DATA_DIR = path.join(__dirname, "data");

// ---- 账号存储（scrypt 哈希，不存明文）----
function loadAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveAuth(auth) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}

function verifyPassword(password, { salt, hash }) {
  const test = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  return test.length === stored.length && crypto.timingSafeEqual(test, stored);
}

// 预置演示账号 owner / 123456
{
  const auth = loadAuth();
  if (!auth.owner) {
    auth.owner = hashPassword("123456");
    saveAuth(auth);
    console.log("[auth] 已预置演示账号 owner / 123456");
  }
}

const tokens = new Map(); // token -> username

function issueToken(username) {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, username);
  return token;
}

function getAuthUser(req) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token ? tokens.get(token) : undefined;
}

function dataFile(username) {
  return path.join(DATA_DIR, `${username}.json`);
}

function loadSnapshot(username) {
  try {
    return JSON.parse(fs.readFileSync(dataFile(username), "utf8"));
  } catch {
    return null;
  }
}

function saveSnapshot(username, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(dataFile(username), JSON.stringify(data, null, 2));
}

const PORT = Number(process.env.PORT ?? 8787);
const MODEL =
  process.env.CLAUDE_MODEL ??
  process.env.ANTHROPIC_MODEL ??
  "claude-opus-4-7";
const HAS_KEY = Boolean(
  process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
);

// 公网暴露后防刷：analyze 全局最小间隔
let lastAnalyzeAt = 0;
const ANALYZE_MIN_INTERVAL_MS = 20_000;

const client = new Anthropic();

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

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON 解析失败"));
      }
    });
    req.on("error", reject);
  });
}

function buildRequest(payload, extra = {}) {
  return {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    cache_control: { type: "ephemeral" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
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

async function analyze(payload) {
  const attempts = 2;
  for (let i = 0; i < attempts; i++) {
    const report = await analyzeOnce(payload);
    const expected = payload.drinks?.length ?? 0;
    if (!expected || report.drinkInsights.length >= expected) return report;
    console.warn(`[analysis] 洞察数不足（${report.drinkInsights.length}/${expected}），重试 ${i + 1}/${attempts - 1}`);
  }
  throw new Error("模型多次输出均缺少酒款洞察，请重试");
}

async function analyzeOnce(payload) {
  // 优先结构化输出；网关不支持时降级为手动解析（兼容 markdown 包裹的 JSON）
  try {
    const response = await client.messages.parse(
      buildRequest(payload, {
        output_config: { format: zodOutputFormat(ReportSchema) },
      }),
    );
    if (response.parsed_output) return response.parsed_output;
  } catch (error) {
    console.warn("[analysis] 结构化输出不可用，降级手动解析:", error.message);
  }
  const msg = await client.messages.create(buildRequest(payload));
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

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      model: MODEL,
      hasApiKey: HAS_KEY,
    });
    return;
  }

  // ---- 商家账号：注册 / 登录 / 身份 ----
  if (req.method === "POST" && req.url === "/api/auth/register") {
    try {
      const { username, password } = await readBody(req);
      if (!/^[\w\u4e00-\u9fa5-]{2,32}$/.test(String(username ?? ""))) {
        sendJson(res, 400, { error: "账号需为 2-32 位字母、数字、中文或连字符" });
        return;
      }
      if (typeof password !== "string" || password.length < 6) {
        sendJson(res, 400, { error: "密码至少 6 位" });
        return;
      }
      const auth = loadAuth();
      if (auth[username]) {
        sendJson(res, 409, { error: "账号已存在" });
        return;
      }
      auth[username] = hashPassword(password);
      saveAuth(auth);
      sendJson(res, 200, { token: issueToken(username), username });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/auth/login") {
    try {
      const { username, password } = await readBody(req);
      const auth = loadAuth();
      const record = auth[String(username ?? "")];
      if (!record || !verifyPassword(String(password ?? ""), record)) {
        sendJson(res, 401, { error: "账号或密码错误" });
        return;
      }
      sendJson(res, 200, { token: issueToken(username), username });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/auth/me") {
    const username = getAuthUser(req);
    if (!username) {
      sendJson(res, 401, { error: "未登录或登录已过期" });
      return;
    }
    sendJson(res, 200, { username });
    return;
  }

  // ---- 账号数据快照：登录后恢复 / 变更后保存 ----
  if (req.method === "GET" && req.url === "/api/data") {
    const username = getAuthUser(req);
    if (!username) {
      sendJson(res, 401, { error: "未登录或登录已过期" });
      return;
    }
    sendJson(res, 200, loadSnapshot(username));
    return;
  }

  if (req.method === "PUT" && req.url === "/api/data") {
    const username = getAuthUser(req);
    if (!username) {
      sendJson(res, 401, { error: "未登录或登录已过期" });
      return;
    }
    try {
      const data = await readBody(req);
      saveSnapshot(username, data);
      sendJson(res, 200, { savedAt: new Date().toISOString() });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/analyze") {
    if (!getAuthUser(req)) {
      sendJson(res, 401, { error: "未登录或登录已过期" });
      return;
    }
    const since = Date.now() - lastAnalyzeAt;
    if (since < ANALYZE_MIN_INTERVAL_MS) {
      sendJson(res, 429, {
        error: `分析请求过于频繁，请 ${Math.ceil((ANALYZE_MIN_INTERVAL_MS - since) / 1000)} 秒后重试`,
      });
      return;
    }
    lastAnalyzeAt = Date.now();
    if (!HAS_KEY) {
      sendJson(res, 503, {
        error: "未配置 API Key（ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN），请设置后重启服务",
      });
      return;
    }
    try {
      const payload = await readBody(req);
      const startedAt = Date.now();
      const report = await analyze(payload);
      sendJson(res, 200, {
        generatedAt: new Date().toISOString(),
        source: "claude",
        ...report,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        sendJson(res, 401, { error: "API Key 无效或已过期" });
      } else if (error instanceof Anthropic.RateLimitError) {
        sendJson(res, 429, { error: "触发限流，请稍后重试" });
      } else if (error instanceof Anthropic.APIError) {
        sendJson(res, 502, { error: `Claude API 错误 ${error.status}: ${error.message}` });
      } else {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : "请求处理失败",
        });
      }
    }
    return;
  }

  sendJson(res, 404, { error: "接口不存在" });
});

server.listen(PORT, () => {
  console.log(`[analysis] 服务已启动 http://localhost:${PORT}`);
  console.log(`[analysis] 模型: ${MODEL}`);
  console.log(
    HAS_KEY
      ? "[analysis] API Key: 已配置"
      : "[analysis] 警告: 未配置 API Key，将返回 503（前端自动降级 Mock）",
  );
});
