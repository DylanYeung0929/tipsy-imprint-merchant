import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Stamp } from "lucide-react";
import type { Drink, ImprintCard, Session, User, WeatherInfo } from "../types";
import { addSession, fetchDrinks, fetchSessions, fetchTelemetrySummary, fetchUsers, fetchWeather, imprintLine } from "../lib/api";
import { buildImprint } from "../lib/mock";
import { ImprintCard as ImprintCardView } from "../components/ImprintCard";
import { Alert, EmptyState, Modal, PageHeader } from "../components/ui";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function behaviorSummary(s: Session): string {
  const durationMin = s.endedAt
    ? Math.round(
        (new Date(s.endedAt.replace(" ", "T")).getTime() -
          new Date(s.startedAt.replace(" ", "T")).getTime()) /
          60000,
      )
    : 0;
  const parts = [`拿起 ${s.pickupCount} 次`];
  parts.push(s.chugged ? "一饮而尽" : `平均每口 ${s.avgSipVolume} ml`);
  if (durationMin > 0) parts.push(`时长 ${durationMin} 分钟`);
  return parts.join(" · ");
}

/** 演示限流：每轮最多为 N 张缺文案的卡片调用云端 AI 生成，其余用模板句 */
const AI_LINE_LIMIT = 6;

const fmtTs = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export function ImprintCardsPage() {
  const [imprints, setImprints] = useState<ImprintCard[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [aiLines, setAiLines] = useState<Record<string, string>>({});
  const [aiPending, setAiPending] = useState<Record<string, boolean>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [telemetry, setTelemetry] = useState<Session[] | null>(null);
  const [pickerError, setPickerError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [adding, setAdding] = useState(false);
  const aiLinesRef = useRef(aiLines);
  aiLinesRef.current = aiLines;

  useEffect(() => {
    void (async () => {
      const [s, d, u] = await Promise.all([fetchSessions(), fetchDrinks(), fetchUsers()]);
      setSessions(s);
      setDrinks(d);
      setUsers(u);
      setImprints(s.map(buildImprint));
      fetchWeather().then(setWeather).catch(() => {});
    })();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  // AI 一句话：串行队列逐张生成（云端 1.2s 节流），失败重试一次后回退模板句
  useEffect(() => {
    if (!imprints.length || !drinks.length) return;
    let cancelled = false;
    const queue = imprints.filter((im) => !aiLinesRef.current[im.id]).slice(0, AI_LINE_LIMIT);
    void (async () => {
      for (const im of queue) {
        if (cancelled) return;
        const session = sessionById.get(im.sessionId);
        if (!session) continue;
        const drink = resolveDrink(im, session);
        setAiPending((m) => ({ ...m, [im.id]: true }));
        let line: string | null = null;
        for (let attempt = 0; attempt < 2 && line === null; attempt++) {
          try {
            line = await imprintLine({
              drinkName: drink.name,
              flavor: drink.flavor,
              behaviorProfile: `${im.title}：${behaviorSummary(session)}`,
              state: im.state,
              weather: weather ? `${weather.weather} ${weather.temperature}°C` : "—",
            });
          } catch {
            await sleep(1400);
          }
        }
        if (cancelled) return;
        if (line !== null) setAiLines((m) => ({ ...m, [im.id]: line }));
        setAiPending((m) => ({ ...m, [im.id]: false }));
        await sleep(1400);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imprints, drinks, weather, sessionById]);

  const userName = (id: string) => users.find((u) => u.id === id)?.nickname ?? id;
  const nowStr = now.toTimeString().slice(0, 5);

  const alreadyAdded = (id: string) => sessions.some((x) => x.id === id);

  /** 菜单匹配失败（如 d-manual 手动演示酒）时合成展示用酒款，保证卡片有酒名与默认视觉 */
  const resolveDrink = (im: ImprintCard, session?: Session): Drink =>
    drinks.find((d) => d.id === im.drinkId) ??
    drinks.find((d) => d.name === session?.drinkName) ?? {
      id: im.drinkId || session?.drinkName || "unknown",
      name: session?.drinkName ?? im.drinkId ?? "未知酒款",
      category: "",
      abv: 0,
      price: 0,
      flavor: "现场特调",
      designIntent: "",
      active: true,
    };

  const openPicker = () => {
    setPickerOpen(true);
    setSelectedId("");
    setPickerError("");
    setTelemetry(null);
    void fetchTelemetrySummary()
      .then((t) => {
        setTelemetry(
          (t.sessions ?? [])
            .filter((s) => s.endedAt && (s.pickupCount > 0 || s.shakeMax > 0 || s.sipVolumeTotal > 0))
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
        );
      })
      .catch((e) => {
        setTelemetry([]);
        setPickerError(e instanceof Error ? e.message : "真实会话加载失败");
      });
  };

  const generate = async () => {
    const t = (telemetry ?? []).find((s) => s.id === selectedId);
    if (!t || adding || alreadyAdded(t.id)) return;
    setAdding(true);
    try {
      const synth: Session = { ...t, drinkId: t.drinkId ?? "" };
      await addSession(synth);
      setSessions((prev) => [synth, ...prev]);
      setImprints((prev) => [buildImprint(synth), ...prev]);
      setPickerOpen(false);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <PageHeader
        en="TEN IMPRINTS"
        title="印记卡片"
        desc="每场饮酒会话生成一张数字版杯底印记：AI 配色的底色与花纹、当日天气与时间、酒款风味、用户行为与 AI 一句话，可直接用于实体卡片排版。"
      />

      <div className="card flex items-center gap-3 p-4">
        <Stamp className="size-4 shrink-0 text-amber-400" aria-hidden="true" />
        <p className="flex-1 text-sm text-stone-400">
          印记称号由行为特征规则映射生成；底色花纹来自酒单导入时 AI 生成的配色方案；一句话文案由云端 AI 逐张生成
          {weather ? (
            <>
              （今日 <span className="text-stone-200">{weather.weather} {weather.temperature}°C</span>）
            </>
          ) : (
            "（天气接口暂不可用）"
          )}
          。
        </p>
        <button type="button" className="btn-primary shrink-0" onClick={openPicker}>
          <Plus className="size-4" aria-hidden="true" />
          添加印记
        </button>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {imprints.map((im) => {
          const session = sessionById.get(im.sessionId);
          const drink = resolveDrink(im, session);
          return (
            <ImprintCardView
              key={im.id}
              imprint={im}
              drink={drink}
              userName={userName(im.userId)}
              behavior={session ? behaviorSummary(session) : "暂无行为数据"}
              weather={weather}
              now={nowStr}
              aiLine={aiLines[im.id]}
              aiPending={aiPending[im.id] === true}
            />
          );
        })}
        {imprints.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={Stamp}
              title="暂无印记卡片"
              description="印记卡片将随会话自动生成，也可从真实饮酒数据手动添加。"
              action={
                <button type="button" className="btn-primary" onClick={openPicker}>
                  <Plus className="size-4" aria-hidden="true" />
                  添加印记
                </button>
              }
            />
          </div>
        )}
      </div>

      {pickerOpen && (
        <Modal title="从饮酒数据生成印记" onClose={() => setPickerOpen(false)}>
          <div className="space-y-4">
            {pickerError && <Alert>{pickerError}</Alert>}
            {!pickerError && telemetry === null && (
              <p className="py-6 text-center text-sm text-stone-500">正在加载真实饮酒会话…</p>
            )}
            {!pickerError && telemetry !== null && telemetry.length === 0 && (
              <p className="py-6 text-center text-sm text-stone-500">
                暂无已完成且有数据的饮酒会话——先去「实时体验」跑一杯，再回来生成。
              </p>
            )}
            {telemetry !== null && telemetry.length > 0 && (
              <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {telemetry.map((t) => {
                  const added = alreadyAdded(t.id);
                  const active = selectedId === t.id;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        disabled={added}
                        onClick={() => setSelectedId(t.id)}
                        className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          active
                            ? "border-amber-400/50 bg-amber-500/10 text-amber-200"
                            : "border-white/10 bg-white/[0.03] text-stone-300 hover:border-white/25"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{t.drinkName ?? "未知酒款"}</span>
                          <span className="shrink-0 text-xs text-stone-500">{added ? "已生成" : fmtTs(t.startedAt)}</span>
                        </div>
                        <p className="mt-1 text-xs text-stone-500">
                          拿起 {t.pickupCount} 次 · 共 {t.sipVolumeTotal} ml
                          {t.shakeMax > 0 ? ` · 摇晃幅度 ${t.shakeMax}` : ""}
                          {t.chugged ? " · 一饮而尽" : ""}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex justify-end gap-3 pt-1">
              <button type="button" className="btn-ghost" onClick={() => setPickerOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!selectedId || adding || alreadyAdded(selectedId)}
                onClick={() => void generate()}
              >
                {adding ? "生成中…" : "生成印记"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
