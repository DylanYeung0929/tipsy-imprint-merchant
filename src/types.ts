/** AI 生成的卡片视觉方案（底色 + 花纹 + 点缀色） */
export interface CardStyle {
  pattern: "ripple" | "diamond" | "rings" | "slant" | "dots";
  bgFrom: string;
  bgTo: string;
  accent: string;
}

/** 酒款 */
export interface Drink {
  id: string;
  name: string;
  category: string;
  abv: number;
  price: number;
  /** 风味一句话描述 */
  flavor: string;
  /** 设计初衷：供 AI 做行为匹配分析 */
  designIntent: string;
  /** 杯子类型（AI 生成配图用） */
  glass?: string;
  /** 详细配料（AI 生成配图用） */
  ingredients?: string;
  /** AI 生成的酒款配图短链（/api/drink-image/xxx，图片本体存 KV） */
  image?: string;
  /** 卡片视觉方案（AI 生成，可缺省回退默认配色） */
  cardStyle?: CardStyle;
  active: boolean;
}

/** 用户（顾客） */
export interface User {
  id: string;
  nickname: string;
  sessionCount: number;
  favoriteDrinkId?: string;
  lastActiveAt: string;
}

/** 传感器事件类型 */
export type EventType = "pickup" | "putdown" | "sip" | "shake" | "chug";

export interface SensorEvent {
  id: string;
  sessionId: string;
  userId: string;
  drinkId: string;
  type: EventType;
  /** 摇晃幅度 0-1 或饮用量 ml，按事件类型而定 */
  value?: number;
  timestamp: string;
}

/** 一次饮酒会话 */
export interface Session {
  id: string;
  userId: string;
  drinkId: string;
  /** 真实遥测会话携带（酒单匹配用） */
  drinkName?: string;
  startedAt: string;
  endedAt?: string;
  pickupCount: number;
  /** 总饮用量 ml */
  sipVolumeTotal: number;
  /** 平均单次饮用量 ml */
  avgSipVolume: number;
  /** 最大摇晃幅度 0-1 */
  shakeMax: number;
  /** 是否一饮而尽 */
  chugged: boolean;
}

/** 酒款聚合统计 */
export interface DrinkStats {
  drinkId: string;
  /** 真实遥测聚合时携带（酒单匹配用） */
  drinkName?: string;
  sessions: number;
  avgPickupCount: number;
  avgSipVolume: number;
  avgShake: number;
  /** 0-1 */
  chugRate: number;
  avgDurationMin: number;
}

/** AI 分析：单款酒洞察 */
export interface DrinkInsight {
  drinkId: string;
  drinkName: string;
  /** 行为画像一句话 */
  behaviorProfile: string;
  /** 与设计初衷匹配度 0-100 */
  intentMatch: number;
  intentComment: string;
  riskFlag?: string;
}

/** AI 分析报告（结构化输出） */
export interface AnalysisReport {
  generatedAt: string;
  source: "claude" | "mock";
  summary: string;
  drinkInsights: DrinkInsight[];
  recommendations: string[];
}

/** 分析请求负载：发给 /api/analyze */
export interface AnalysisPayload {
  drinks: Drink[];
  stats: DrinkStats[];
  sessions: Session[];
  users: User[];
}

/** 拍照导入识别结果（/api/menu-import 单条酒款，尚无 id/active） */
export interface MenuImportItem {
  name: string;
  category: string;
  abv: number;
  price: number;
  flavor: string;
  designIntent: string;
  cardStyle?: CardStyle;
}

/** 天气（uapis.cn 免费接口，按城市定位） */
export interface WeatherInfo {
  city: string;
  weather: string;
  temperature: number;
  humidity: number;
  windDirection: string;
  windPower: string;
}

/** 数字版杯底印记（每场会话一张） */
export interface ImprintCard {
  id: string;
  sessionId: string;
  userId: string;
  drinkId: string;
  /** 印记称号（十种印记之一） */
  title: string;
  /** 今日状态：慢品型 / 探索型 / 豪饮型 */
  state: string;
  /** AI 生成的一句话 */
  line: string;
  date: string;
  venue: string;
  weather: string;
}

// ---- ESP 遥测（D1 后端，字段与 /api/v1 返回一致）----
export type EspSessionStatus = "ACTIVE" | "STOP_REQUESTED" | "COMPLETED";

export interface EspSession {
  id: string;
  device_id: string;
  user_id: string | null;
  drink: { drinkId?: string; name?: string; price?: number } | null;
  status: EspSessionStatus;
  created_at_ms: number;
  started_at_ms: number | null;
  stop_requested_at_ms: number | null;
  completed_at_ms: number | null;
  last_seq: number;
  /** 最近一包遥测的接收时间（设备在线判定用，无数据为 null） */
  last_packet_at_ms?: number | null;
}

export interface EspSample {
  tMs: number;
  fsrAdc: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
}

export interface EspPacket {
  seq: number;
  batchStartMs: number;
  sampleRateHz: number;
  sampleCount: number;
  samples: EspSample[];
  receivedAtMs: number;
}

/** 后端从原始采样识别出的行为事件 */
export interface EspEvent {
  id: string;
  sessionId: string;
  userId: string | null;
  drinkName: string | null;
  type: EventType;
  /** 摇晃幅度 0-1 或饮用量 ml */
  value?: number;
  tsMs: number;
}
