import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL ?? "deepseek-v4-pro";

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
  "1. 对每款酒生成一句话「行为画像」，例如：高频拿起+高摇晃+小口品饮（典型烈酒行为）",
  "2. 将行为画像与 designIntent（设计初衷）比对，给出 intentMatch 匹配度（0-100 整数）。",
  "   高匹配 = 用户行为符合设计预期；低匹配 = 行为偏离，需要关注",
  "3. intentComment 说明匹配或偏离的原因，偏离明显时用 riskFlag 给出简短警示",
  "4. summary 用 2-4 句话概括全场数据特征与关键发现",
  "5. recommendations 给出 3-5 条可执行的经营建议（如排班、定价、搭配、引导策略）",
  "6. 全部输出使用简体中文",
  "7. 只输出纯 JSON 对象，不要 markdown 代码块、不要任何额外文字",
].join("\n");

const payload = { drinks: [{ id: "d1", name: "山海拾光", designIntent: "慢品型，适合慢慢品味，小口多次" }], stats: { d1: { avgPickupCount: 8, avgSipVolume: 18, avgShake: 0.3, chugRate: 0.05, avgDurationMin: 42 } }, sessions: [], users: [] };

const req = {
  model: MODEL,
  max_tokens: 16000,
  thinking: { type: "adaptive" },
  system: [{ type: "text", text: SYSTEM_PROMPT }],
  messages: [{ role: "user", content: [
    { type: "text", text: "以下是酒款配置与传感器统计数据（JSON）：" },
    { type: "text", text: JSON.stringify(payload) },
  ] }],
};

const res = await client.messages.create(req);
const text = res.content.filter(b => b.type === "text").map(b => b.text).join("\n");
console.log("===RAW===");
console.log(text.slice(0, 1500));
