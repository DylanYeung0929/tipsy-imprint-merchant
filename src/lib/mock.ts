import type {
  Drink,
  DrinkStats,
  ImprintCard,
  SensorEvent,
  Session,
  User,
} from "../types";

export const mockDrinks: Drink[] = [
  {
    id: "d1",
    name: "Old Fashioned",
    category: "威士忌",
    abv: 32,
    price: 78,
    flavor: "威士忌醇厚，橙皮与苦精的草本甜香",
    designIntent: "希望用户小口慢品、多次拿起、停留时间长",
    cardStyle: { pattern: "rings", bgFrom: "#3b2a1a", bgTo: "#14100b", accent: "#f5b83d" },
    active: true,
  },
  {
    id: "d2",
    name: "Negroni",
    category: "金酒",
    abv: 24,
    price: 68,
    flavor: "金酒杜松香，甜苦平衡，橙香悠长",
    designIntent: "苦甜平衡，预期用户先摇晃闻香、再小口品饮",
    cardStyle: { pattern: "slant", bgFrom: "#2e1a22", bgTo: "#120a10", accent: "#f97316" },
    active: true,
  },
  {
    id: "d3",
    name: "Martini",
    category: "金酒",
    abv: 30,
    price: 72,
    flavor: "杜松子冷冽，干爽利落，橄榄咸香",
    designIntent: "仪式感烈酒，预期用户极少拿起、每次仅小口",
    cardStyle: { pattern: "rings", bgFrom: "#16222b", bgTo: "#0a1014", accent: "#67e8f9" },
    active: true,
  },
  {
    id: "d4",
    name: "Mojito",
    category: "朗姆酒",
    abv: 12,
    price: 52,
    flavor: "青柠与薄荷清新，朗姆微甜",
    designIntent: "清爽畅饮，预期较快喝完、一饮而尽率高",
    cardStyle: { pattern: "ripple", bgFrom: "#0f2e28", bgTo: "#07150f", accent: "#34d399" },
    active: true,
  },
  {
    id: "d5",
    name: "Margarita",
    category: "龙舌兰",
    abv: 20,
    price: 58,
    flavor: "龙舌兰草本，青柠酸爽，盐边提味",
    designIntent: "派对酸甜，预期用户畅饮、摇晃动作多",
    cardStyle: { pattern: "diamond", bgFrom: "#2e1f10", bgTo: "#140d06", accent: "#a3e635" },
    active: true,
  },
  {
    id: "d6",
    name: "Whiskey Sour",
    category: "威士忌",
    abv: 22,
    price: 62,
    flavor: "波本甜润，柠檬明亮，蛋清绵密",
    designIntent: "酸甜顺口，预期用户中等节奏品饮",
    cardStyle: { pattern: "slant", bgFrom: "#33230f", bgTo: "#120c05", accent: "#fde047" },
    active: true,
  },
  {
    id: "d7",
    name: "Daiquiri",
    category: "朗姆酒",
    abv: 15,
    price: 54,
    flavor: "白朗姆干净，青柠尖锐，糖霜回甘",
    designIntent: "清爽酸味，预期较快喝完",
    cardStyle: { pattern: "ripple", bgFrom: "#0e2a33", bgTo: "#07141a", accent: "#38bdf8" },
    active: true,
  },
  {
    id: "d8",
    name: "Manhattan",
    category: "威士忌",
    abv: 30,
    price: 76,
    flavor: "黑麦辛香，甜味美思，樱桃收尾",
    designIntent: "经典烈性，预期用户慢品、长时间停留",
    cardStyle: { pattern: "rings", bgFrom: "#2b1410", bgTo: "#0f0705", accent: "#fb7185" },
    active: true,
  },
  {
    id: "d9",
    name: "Tom Collins",
    category: "金酒",
    abv: 10,
    price: 48,
    flavor: "金酒与柠檬，气泡轻盈，解渴长饮",
    designIntent: "气泡长饮，预期拿起次数多、久坐聊天",
    cardStyle: { pattern: "dots", bgFrom: "#102430", bgTo: "#08121a", accent: "#93c5fd" },
    active: true,
  },
  {
    id: "d10",
    name: "Espresso Martini",
    category: "伏特加",
    abv: 22,
    price: 66,
    flavor: "浓缩咖啡醇苦，香草利口酒回甘",
    designIntent: "提神甜烈，预期用户夜间较快饮完",
    cardStyle: { pattern: "dots", bgFrom: "#231712", bgTo: "#0e0906", accent: "#d6b98c" },
    active: true,
  },
  {
    id: "d11",
    name: "Gin Tonic",
    category: "金酒",
    abv: 9,
    price: 45,
    flavor: "杜松子与奎宁水，柑橘清爽，气泡悠长",
    designIntent: "长饮社交，预期多次拿起、小口饮用",
    cardStyle: { pattern: "ripple", bgFrom: "#0c2b2e", bgTo: "#061416", accent: "#22d3ee" },
    active: true,
  },
  {
    id: "d12",
    name: "Mai Tai",
    category: "朗姆酒",
    abv: 18,
    price: 60,
    flavor: "朗姆与杏仁坚果，热带果香",
    designIntent: "热带甜饮，预期用户畅饮、社交为主",
    cardStyle: { pattern: "diamond", bgFrom: "#2a1233", bgTo: "#120718", accent: "#f472b6" },
    active: true,
  },
];

export const mockUsers: User[] = [
  { id: "u1", nickname: "夜航员", sessionCount: 6, favoriteDrinkId: "d8", lastActiveAt: "2026-09-13 23:41" },
  { id: "u2", nickname: "微醺小鹿", sessionCount: 4, favoriteDrinkId: "d12", lastActiveAt: "2026-09-13 22:18" },
  { id: "u3", nickname: "老酒馆常客", sessionCount: 9, favoriteDrinkId: "d1", lastActiveAt: "2026-09-13 21:56" },
  { id: "u4", nickname: "柠檬气泡", sessionCount: 5, favoriteDrinkId: "d4", lastActiveAt: "2026-09-13 21:30" },
  { id: "u5", nickname: "阿岚", sessionCount: 3, favoriteDrinkId: "d3", lastActiveAt: "2026-09-13 20:47" },
  { id: "u6", nickname: "石桥", sessionCount: 7, favoriteDrinkId: "d1", lastActiveAt: "2026-09-13 20:12" },
];

export const mockStats: DrinkStats[] = [
  { drinkId: "d1", sessions: 9, avgPickupCount: 12.4, avgSipVolume: 9, avgShake: 0.45, chugRate: 0, avgDurationMin: 45 },
  { drinkId: "d2", sessions: 6, avgPickupCount: 10.5, avgSipVolume: 8, avgShake: 0.72, chugRate: 0, avgDurationMin: 38 },
  { drinkId: "d3", sessions: 4, avgPickupCount: 5.2, avgSipVolume: 11, avgShake: 0.35, chugRate: 0, avgDurationMin: 50 },
  { drinkId: "d4", sessions: 11, avgPickupCount: 4.1, avgSipVolume: 27, avgShake: 0.22, chugRate: 0.64, avgDurationMin: 15 },
  { drinkId: "d5", sessions: 8, avgPickupCount: 6.3, avgSipVolume: 24, avgShake: 0.58, chugRate: 0.38, avgDurationMin: 22 },
  { drinkId: "d6", sessions: 7, avgPickupCount: 8.1, avgSipVolume: 18, avgShake: 0.4, chugRate: 0.14, avgDurationMin: 28 },
  { drinkId: "d7", sessions: 6, avgPickupCount: 4.8, avgSipVolume: 26, avgShake: 0.3, chugRate: 0.5, avgDurationMin: 14 },
  { drinkId: "d8", sessions: 10, avgPickupCount: 13.6, avgSipVolume: 8.5, avgShake: 0.62, chugRate: 0, avgDurationMin: 43 },
  { drinkId: "d9", sessions: 9, avgPickupCount: 11.2, avgSipVolume: 16, avgShake: 0.25, chugRate: 0.11, avgDurationMin: 55 },
  { drinkId: "d10", sessions: 5, avgPickupCount: 6.8, avgSipVolume: 22, avgShake: 0.48, chugRate: 0.4, avgDurationMin: 18 },
  { drinkId: "d11", sessions: 12, avgPickupCount: 9.6, avgSipVolume: 14, avgShake: 0.28, chugRate: 0.17, avgDurationMin: 48 },
  { drinkId: "d12", sessions: 8, avgPickupCount: 3.6, avgSipVolume: 23, avgShake: 0.2, chugRate: 0.25, avgDurationMin: 35 },
];

export const mockSessions: Session[] = [
  { id: "s01", userId: "u1", drinkId: "d8", startedAt: "2026-09-13 23:06", endedAt: "2026-09-13 23:41", pickupCount: 15, sipVolumeTotal: 118, avgSipVolume: 7.9, shakeMax: 0.71, chugged: false },
  { id: "s02", userId: "u3", drinkId: "d1", startedAt: "2026-09-13 21:14", endedAt: "2026-09-13 21:56", pickupCount: 13, sipVolumeTotal: 112, avgSipVolume: 8.6, shakeMax: 0.84, chugged: false },
  { id: "s03", userId: "u4", drinkId: "d4", startedAt: "2026-09-13 21:12", endedAt: "2026-09-13 21:30", pickupCount: 4, sipVolumeTotal: 108, avgSipVolume: 27, shakeMax: 0.22, chugged: true },
  { id: "s04", userId: "u2", drinkId: "d12", startedAt: "2026-09-13 21:30", endedAt: "2026-09-13 22:22", pickupCount: 3, sipVolumeTotal: 66, avgSipVolume: 22, shakeMax: 0.15, chugged: false },
  { id: "s05", userId: "u6", drinkId: "d1", startedAt: "2026-09-13 19:40", endedAt: "2026-09-13 20:12", pickupCount: 14, sipVolumeTotal: 102, avgSipVolume: 7.3, shakeMax: 0.66, chugged: false },
  { id: "s06", userId: "u5", drinkId: "d3", startedAt: "2026-09-13 20:11", endedAt: "2026-09-13 20:47", pickupCount: 6, sipVolumeTotal: 78, avgSipVolume: 13, shakeMax: 0.32, chugged: false },
  { id: "s07", userId: "u4", drinkId: "d7", startedAt: "2026-09-12 22:05", endedAt: "2026-09-12 22:19", pickupCount: 4, sipVolumeTotal: 96, avgSipVolume: 32, shakeMax: 0.28, chugged: true },
  { id: "s08", userId: "u1", drinkId: "d8", startedAt: "2026-09-12 23:20", endedAt: "2026-09-13 00:02", pickupCount: 13, sipVolumeTotal: 104, avgSipVolume: 8, shakeMax: 0.73, chugged: false },
  { id: "s09", userId: "u3", drinkId: "d1", startedAt: "2026-09-12 21:02", endedAt: "2026-09-12 21:39", pickupCount: 12, sipVolumeTotal: 105, avgSipVolume: 8.8, shakeMax: 0.58, chugged: false },
  { id: "s10", userId: "u2", drinkId: "d12", startedAt: "2026-09-12 20:30", endedAt: "2026-09-12 21:15", pickupCount: 4, sipVolumeTotal: 84, avgSipVolume: 21, shakeMax: 0.19, chugged: false },
];

export const mockEvents: SensorEvent[] = [
  { id: "e01", sessionId: "s01", userId: "u1", drinkId: "d8", type: "pickup", timestamp: "2026-09-13 23:06:12" },
  { id: "e02", sessionId: "s01", userId: "u1", drinkId: "d8", type: "shake", value: 0.62, timestamp: "2026-09-13 23:06:19" },
  { id: "e03", sessionId: "s01", userId: "u1", drinkId: "d8", type: "sip", value: 7.5, timestamp: "2026-09-13 23:06:25" },
  { id: "e04", sessionId: "s01", userId: "u1", drinkId: "d8", type: "putdown", timestamp: "2026-09-13 23:06:30" },
  { id: "e05", sessionId: "s03", userId: "u4", drinkId: "d4", type: "pickup", timestamp: "2026-09-13 21:12:03" },
  { id: "e06", sessionId: "s03", userId: "u4", drinkId: "d4", type: "chug", value: 96, timestamp: "2026-09-13 21:12:41" },
  { id: "e07", sessionId: "s02", userId: "u3", drinkId: "d1", type: "pickup", timestamp: "2026-09-13 21:14:08" },
  { id: "e08", sessionId: "s02", userId: "u3", drinkId: "d1", type: "shake", value: 0.84, timestamp: "2026-09-13 21:14:15" },
  { id: "e09", sessionId: "s04", userId: "u2", drinkId: "d12", type: "pickup", timestamp: "2026-09-13 21:30:22" },
  { id: "e10", sessionId: "s05", userId: "u6", drinkId: "d1", type: "pickup", timestamp: "2026-09-13 19:40:45" },
  { id: "e11", sessionId: "s05", userId: "u6", drinkId: "d1", type: "shake", value: 0.58, timestamp: "2026-09-13 19:40:51" },
  { id: "e12", sessionId: "s05", userId: "u6", drinkId: "d1", type: "sip", value: 6.9, timestamp: "2026-09-13 19:40:57" },
  { id: "e13", sessionId: "s06", userId: "u5", drinkId: "d3", type: "pickup", timestamp: "2026-09-13 20:11:36" },
  { id: "e14", sessionId: "s06", userId: "u5", drinkId: "d3", type: "sip", value: 14, timestamp: "2026-09-13 20:11:44" },
  { id: "e15", sessionId: "s07", userId: "u4", drinkId: "d7", type: "pickup", timestamp: "2026-09-12 22:05:17" },
  { id: "e16", sessionId: "s08", userId: "u1", drinkId: "d8", type: "shake", value: 0.7, timestamp: "2026-09-12 23:20:33" },
  { id: "e17", sessionId: "s09", userId: "u3", drinkId: "d1", type: "shake", value: 0.58, timestamp: "2026-09-12 21:02:40" },
  { id: "e18", sessionId: "s10", userId: "u2", drinkId: "d12", type: "pickup", timestamp: "2026-09-12 20:30:09" },
];

export const EVENT_TYPE_LABEL: Record<SensorEvent["type"], string> = {
  pickup: "拿起酒杯",
  putdown: "放回桌面",
  sip: "饮用",
  shake: "摇晃",
  chug: "一饮而尽",
};

/** 可变 mock 存储：供酒单配置/新增数据演示内存态 CRUD */
export const drinkStore: Drink[] = [...mockDrinks];
export const userStore: User[] = [...mockUsers];
export const sessionStore: Session[] = [...mockSessions];
export const eventStore: SensorEvent[] = [...mockEvents];

/** 登录后用服务端快照覆盖内存数据 */
export function resetStores(snapshot: {
  drinks?: Drink[];
  users?: User[];
  sessions?: Session[];
  events?: SensorEvent[];
} | null) {
  if (!snapshot) return;
  if (Array.isArray(snapshot.drinks)) drinkStore.splice(0, drinkStore.length, ...snapshot.drinks);
  if (Array.isArray(snapshot.users)) userStore.splice(0, userStore.length, ...snapshot.users);
  if (Array.isArray(snapshot.sessions)) sessionStore.splice(0, sessionStore.length, ...snapshot.sessions);
  if (Array.isArray(snapshot.events)) eventStore.splice(0, eventStore.length, ...snapshot.events);
}

/** 当前内存数据快照（供持久化到服务端） */
export function getSnapshot() {
  return {
    drinks: [...drinkStore],
    users: [...userStore],
    sessions: [...sessionStore],
    events: [...eventStore],
  };
}

/** 十种印记：称号 → AI 一句话模板 */
const IMPRINT_LINES: Record<string, { state: string; line: string }> = {
  慢品探索者: { state: "慢品型", line: "十四次拿起，七毫升一口——耐心是最好的下酒菜。" },
  轻盈漫游者: { state: "慢品型", line: "杯子跟着聊天漫游，拿起放下都很轻。" },
  节奏收藏家: { state: "探索型", line: "像节拍器一样规律：拿起，抿一口，放下。" },
  热烈碰杯者: { state: "豪饮型", line: "一口到底，痛快收场——今晚的节奏由 ta 来定。" },
  安静观察者: { state: "慢品型", line: "安静地喝，安静地想，杯子几乎没离开过视线。" },
  风味实验家: { state: "探索型", line: "闻香、轻晃、再抿——今晚的杯子被认真对待。" },
  夜色叙事者: { state: "慢品型", line: "夜色越深，喝得越慢，故事越长。" },
  自在畅饮者: { state: "豪饮型", line: "一杯到底，畅快收场，不拖泥带水。" },
  社交引力场: { state: "慢品型", line: "杯子只拿起三次，聊天却一刻没停过。" },
  余韵守望者: { state: "慢品型", line: "最后一口放下后，ta 还多坐了一会儿——好酒值得目送。" },
};

const IMPRINT_VENUES = ["梧桐小馆", "临江露台", "巷尾清吧"];
const IMPRINT_WEATHERS = ["晴", "多云", "小雨"];

const CATEGORY_STYLES: { re: RegExp; style: Drink["cardStyle"] }[] = [
  { re: /威士忌|whisk|烈酒|白兰地|金酒|gin/i, style: { pattern: "rings", bgFrom: "#2b1a10", bgTo: "#100a06", accent: "#f59e0b" } },
  { re: /清爽|气泡|伏特加|vodka|汤力|tonic/i, style: { pattern: "ripple", bgFrom: "#0f2a33", bgTo: "#071418", accent: "#67e8f9" } },
  { re: /甜|朗姆|rum|利口|果味/i, style: { pattern: "diamond", bgFrom: "#2a1430", bgTo: "#120a16", accent: "#ec78ff" } },
  { re: /啤酒|beer|精酿|小麦/i, style: { pattern: "dots", bgFrom: "#1d2413", bgTo: "#0b0e06", accent: "#a3e635" } },
  { re: /葡萄酒|红酒|wine/i, style: { pattern: "slant", bgFrom: "#2e1020", bgTo: "#120710", accent: "#f43f5e" } },
];

/** 无 AI 配色时的默认卡片视觉方案（与云端 fallback 逻辑一致） */
export function defaultCardStyle(drink: Pick<Drink, "category" | "name" | "flavor">, index = 0): NonNullable<Drink["cardStyle"]> {
  const hit = CATEGORY_STYLES.find((c) => c.re.test(`${drink.category} ${drink.name} ${drink.flavor}`));
  if (hit && hit.style) return { ...hit.style };
  const accents = ["#fbbf24", "#67e8f9", "#ec78ff"];
  return { pattern: "slant", bgFrom: "#1c1917", bgTo: "#0c0a09", accent: accents[index % accents.length] };
}

/** 酒名 → 官网鸡尾酒素材图（按名称关键词匹配） */
const COCKTAIL_IMAGES: { re: RegExp; src: string }[] = [
  { re: /old.?fashioned/i, src: "old-fashioned" },
  { re: /negroni|尼格罗尼/i, src: "negroni" },
  { re: /martini/i, src: "martini" },
  { re: /mojito|莫吉托/i, src: "mojito" },
  { re: /margarita|玛格丽特/i, src: "margarita" },
  { re: /whiskey.?sour|威士忌酸/i, src: "whiskey-sour" },
  { re: /daiquiri|代基里/i, src: "daiquiri" },
  { re: /manhattan|曼哈顿/i, src: "manhattan" },
  { re: /tom.?collins/i, src: "tom-collins" },
  { re: /espresso.?martini/i, src: "espresso-martini" },
  { re: /gin.?tonic|金汤力/i, src: "gin-tonic" },
  { re: /mai.?tai|迈泰/i, src: "mai-tai" },
];

export function cocktailImageFor(name: string): string | undefined {
  return COCKTAIL_IMAGES.find((c) => c.re.test(name))?.src;
}

/**
 * 行为特征 → 印记称号（规则引擎）。
 * 演示用确定性映射；正式版由 AI 分析服务生成（预留 /api/imprint）。
 */
export function buildImprint(session: Session): ImprintCard {
  const durationMin = session.endedAt
    ? Math.round(
        (new Date(session.endedAt.replace(" ", "T")).getTime() -
          new Date(session.startedAt.replace(" ", "T")).getTime()) /
          60000,
      )
    : 0;

  let title: string;
  if (session.chugged && session.avgSipVolume >= 28) title = "热烈碰杯者";
  else if (session.chugged) title = "自在畅饮者";
  else if (session.shakeMax >= 0.8) title = "风味实验家";
  else if (session.pickupCount >= 14 && session.shakeMax >= 0.7) title = "余韵守望者";
  else if (session.pickupCount >= 14) title = "慢品探索者";
  else if (session.pickupCount <= 4 && durationMin >= 50) title = "社交引力场";
  else if (session.pickupCount <= 4) title = "轻盈漫游者";
  else if (session.pickupCount <= 7) title = "安静观察者";
  else if (session.shakeMax >= 0.6) title = "节奏收藏家";
  else title = "夜色叙事者";

  const { state, line } = IMPRINT_LINES[title];
  const n = session.id.charCodeAt(session.id.length - 1);
  return {
    id: `im-${session.id}`,
    sessionId: session.id,
    userId: session.userId,
    drinkId: session.drinkId,
    title,
    state,
    line,
    date: session.startedAt.slice(0, 10).replaceAll("-", "."),
    venue: IMPRINT_VENUES[n % IMPRINT_VENUES.length],
    weather: IMPRINT_WEATHERS[(n * 7) % IMPRINT_WEATHERS.length],
  };
}
