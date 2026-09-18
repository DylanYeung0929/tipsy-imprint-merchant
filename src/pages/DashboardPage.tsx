import { useCallback, useEffect, useRef, useState } from "react";
import { GlassWater, Hand, Radio, Sparkles, Users } from "lucide-react";
import type { AnalysisPayload, AnalysisReport, Drink, DrinkStats, User } from "../types";
import {
  fetchDrinks,
  fetchSessions,
  fetchTelemetrySummary,
  fetchUsers,
  generateAnalysis,
  round1,
  type TelemetrySummary,
} from "../lib/api";
import { mockStats } from "../lib/mock";
import { MatchBar, PageHeader, SimpleBarChart, StatCard } from "../components/ui";

/** 真实遥测 → AI 分析负载：按 drinkId/name 匹配酒单取 designIntent，匹配不到则合成占位酒款 */
function buildTelemetryPayload(drinks: Drink[], t: TelemetrySummary): AnalysisPayload {
  const analysisDrinks = t.stats.map((s) => {
    const hit = drinks.find((d) => d.id === s.drinkId) ?? drinks.find((d) => d.name === s.drinkName);
    const base: Drink =
      hit ??
      {
        id: s.drinkId || s.drinkName || "unknown",
        name: s.drinkName || "未知酒款",
        category: "",
        abv: 0,
        price: 0,
        flavor: "",
        designIntent: "（该酒款未配置设计初衷，请基于行为数据描述）",
        active: true,
      };
    return { ...base, id: s.drinkId || base.id, name: base.name || s.drinkName || "未知酒款" };
  });
  const counts = new Map<string, number>();
  for (const s of t.sessions) if (s.userId) counts.set(s.userId, (counts.get(s.userId) ?? 0) + 1);
  const users: User[] = [...counts.entries()].map(([id, sessionCount], i) => ({
    id,
    nickname: `用户${i + 1}`,
    sessionCount,
    lastActiveAt: "",
  }));
  return { drinks: analysisDrinks, stats: t.stats, sessions: t.sessions, users };
}

export function DashboardPage() {
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [stats, setStats] = useState<DrinkStats[]>(mockStats);
  const [telemetry, setTelemetry] = useState<TelemetrySummary | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [userCount, setUserCount] = useState(0);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void (async () => {
      const [d, s, u] = await Promise.all([
        fetchDrinks(),
        fetchSessions(),
        fetchUsers(),
      ]);
      setDrinks(d);
      setSessionCount(s.length);
      setUserCount(u.length);
      // 真实遥测可用时优先展示（无数据/未登录失败则保持 mock）
      const t = await fetchTelemetrySummary().catch(() => null);
      if (t && t.stats.length > 0) {
        setTelemetry(t);
        setStats(t.stats);
        setSessionCount(t.sessionCount);
        setUserCount(t.userCount);
      }
    })();
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    },
    [],
  );

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError("");
    setProgress(0);
    // 单次非流式请求拿不到真实进度：估算曲线渐近爬升到 92%，返回后跳到 100%
    timerRef.current = setInterval(() => {
      setProgress((p) => (p >= 92 ? 92 : p + (92 - p) * 0.06));
    }, 200);
    try {
      const [d, s, u] = await Promise.all([
        fetchDrinks(),
        fetchSessions(),
        fetchUsers(),
      ]);
      const payload =
        telemetry && telemetry.stats.length > 0
          ? buildTelemetryPayload(d, telemetry)
          : { drinks: d, stats, sessions: s, users: u };
      const r = await generateAnalysis(payload);
      setProgress(100);
      await new Promise((res) => setTimeout(res, 400));
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setLoading(false);
    }
  }, [stats, telemetry]);

  const progressStage =
    progress < 35 ? "正在整理酒单与行为数据…" : "正在调用 AI 模型生成洞察（通常需要 30–60 秒）…";

  const totalSessions = stats.reduce((a, s) => a + s.sessions, 0);
  const avgPickup =
    totalSessions === 0
      ? 0
      : round1(stats.reduce((a, s) => a + s.avgPickupCount * s.sessions, 0) / totalSessions);
  const chugRate =
    totalSessions === 0
      ? 0
      : Math.round(
          (stats.reduce((a, s) => a + s.chugRate * s.sessions, 0) / totalSessions) * 100,
        );

  const isReal = Boolean(telemetry && telemetry.stats.length > 0);
  const rows = stats.map((s) => ({
    key: s.drinkId || s.drinkName || "unknown",
    name: s.drinkName ?? drinks.find((d) => d.id === s.drinkId)?.name ?? "未知酒款",
    s,
  }));

  return (
    <div>
      <PageHeader
        en="NIGHT IN NUMBERS"
        title="数据分析"
        desc="智能酒杯传感器数据聚合：拿起次数、单次饮用量、摇晃度与一饮而尽行为，结合 AI 生成经营洞察。"
      />

      {isReal && (
        <p className="mb-4 flex items-center gap-2 text-xs text-emerald-400">
          <Radio className="size-3.5" aria-hidden="true" />
          数据来源：智能酒杯真实遥测 · {telemetry?.sessionCount} 场已完成会话（含行为事件识别结果）
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={GlassWater} label="累计会话" value={String(sessionCount)} unit="次" hint={`覆盖 ${isReal ? rows.length : drinks.length} 款酒`} />
        <StatCard icon={Users} label="活跃用户" value={String(userCount)} unit="人" hint={isReal ? "真实遥测去重用户" : "近 7 天有饮酒记录"} />
        <StatCard icon={Hand} label="平均拿起次数" value={String(avgPickup)} unit="次/杯" hint="全场加权平均" />
        <StatCard icon={Sparkles} label="一饮而尽率" value={String(chugRate)} unit="%" hint="畅饮型酒款指标" />
      </section>

      <section className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-stone-100">酒款行为对比</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="table-base min-w-[640px]">
              <thead>
                <tr>
                  <th>酒款</th>
                  <th>平均拿起</th>
                  <th>平均单次饮量</th>
                  <th>摇晃度</th>
                  <th>一饮而尽率</th>
                  <th>平均停留</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ key, name, s }) => (
                  <tr key={key} className="hover:bg-white/[0.02]">
                    <td className="text-stone-100">
                      <span className="mr-3 inline-block size-2 rounded-full bg-amber-400" />
                      {name}
                    </td>
                    <td className="tabular-nums">{s.avgPickupCount} 次</td>
                    <td className="tabular-nums">{s.avgSipVolume} ml</td>
                    <td className="tabular-nums">{Math.round(s.avgShake * 100)}%</td>
                    <td className="tabular-nums">{Math.round(s.chugRate * 100)}%</td>
                    <td className="tabular-nums">{s.avgDurationMin} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="mt-8 text-sm text-stone-500">各酒款平均拿起次数</h3>
          <div className="mt-4">
            <SimpleBarChart
              data={rows
                .map((r) => ({ label: r.name, value: r.s.avgPickupCount }))
                .filter((x) => x.value > 0)}
            />
          </div>
        </div>

        <div className="card flex flex-col p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-stone-100">AI 经营分析</h2>
            <button className="btn-primary" onClick={runAnalysis} disabled={loading}>
              <Sparkles className="size-4" aria-hidden="true" />
              {loading ? "分析中…" : report ? "重新生成" : "生成分析"}
            </button>
          </div>

          {loading && (
            <div className="mt-5 space-y-2" data-testid="analyze-progress">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-300"
                  style={{ width: `${progress}%`, transition: "width 200ms ease-out" }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-stone-500">
                <span>{progressStage}</span>
                <span className="tabular-nums">{Math.round(progress)}%</span>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {!report && !loading && (
            <p className="mt-6 text-sm leading-6 text-stone-500">
              点击「生成分析」将{isReal ? "真实遥测行为数据（会话 + 事件聚合）" : "当前酒款配置与行为统计"}
              与酒单设计初衷发送至 AI 分析服务（Claude），
              返回结构化报告：行为画像、与设计初衷的匹配度及经营建议。
            </p>
          )}

          {report && (
            <div className="mt-5 flex-1 space-y-5">
              <p className="text-xs text-stone-600">
                {new Date(report.generatedAt).toLocaleString("zh-CN")} · 来源：
                <span className={report.source === "claude" ? "text-emerald-400" : "text-amber-400"}>
                  {report.source === "claude" ? " Claude API" : " Mock 演示"}
                </span>
              </p>
              <p className="text-sm leading-6 text-stone-300">{report.summary}</p>

              <div className="space-y-4">
                <h3 className="text-sm text-stone-500">设计初衷匹配度</h3>
                {report.drinkInsights.map((ins) => (
                  <div key={ins.drinkId} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-stone-100">{ins.drinkName}</p>
                      <MatchBar value={ins.intentMatch} />
                    </div>
                    <p className="mt-2 text-xs text-stone-500">{ins.behaviorProfile}</p>
                    <p className="mt-1 text-sm text-stone-300">{ins.intentComment}</p>
                    {ins.riskFlag && (
                      <p className="mt-2 text-xs text-amber-300">⚠ {ins.riskFlag}</p>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <h3 className="text-sm text-stone-500">经营建议</h3>
                <ul className="mt-2 space-y-2">
                  {report.recommendations.map((r, i) => (
                    <li key={i} className="flex gap-2 text-sm text-stone-300">
                      <span className="text-amber-400">•</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
