import type { EspSessionStatus, EventType } from "../../types";
import type { BadgeTone } from "./Badge";

/** 会话状态 → 文案/色调（实时体验、数据接收、印记选择器共用同一事实源） */
export const sessionStatusMeta: Record<EspSessionStatus, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "进行中", tone: "emerald" },
  STOP_REQUESTED: { label: "停止中", tone: "gold" },
  COMPLETED: { label: "已完成", tone: "neutral" },
};

/** 已建会话但设备尚未开始上报 */
export const waitingStatusMeta: { label: string; tone: BadgeTone } = {
  label: "等待设备",
  tone: "sky",
};

/** 行为事件类型 → 文案/色调（文案与 lib/mock EVENT_TYPE_LABEL 保持一致） */
export const eventTypeMeta: Record<EventType, { label: string; tone: BadgeTone }> = {
  pickup: { label: "拿起酒杯", tone: "gold" },
  putdown: { label: "放回桌面", tone: "neutral" },
  sip: { label: "饮用", tone: "emerald" },
  shake: { label: "摇晃", tone: "sky" },
  chug: { label: "一饮而尽", tone: "rose" },
};

export type ActivityLevel = "高频" | "常客" | "新客";

export function activityLevelOf(sessionCount: number): ActivityLevel {
  return sessionCount >= 8 ? "高频" : sessionCount >= 4 ? "常客" : "新客";
}

export const activityTone: Record<ActivityLevel, BadgeTone> = {
  高频: "gold",
  常客: "emerald",
  新客: "neutral",
};

export const saleStatusMeta: Record<"on" | "off", { label: string; tone: BadgeTone }> = {
  on: { label: "在售", tone: "emerald" },
  off: { label: "停售", tone: "neutral" },
};
