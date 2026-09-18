import { useEffect, useMemo, useRef, useState } from "react";
import { CircleStop, RadioTower } from "lucide-react";
import type { EspPacket, EspSession } from "../types";
import { fetchEspPackets, fetchEspSessions, stopEspSession } from "../lib/api";
import { PageHeader } from "../components/ui";

/** 曲线最多保留最近 40 个数据包（约 1000 个采样点 ≈ 40 秒 @25Hz） */
const MAX_PACKETS = 40;

const STATUS_META: Record<EspSession["status"], { label: string; cls: string }> = {
  ACTIVE: { label: "进行中", cls: "bg-emerald-500/15 text-emerald-300" },
  STOP_REQUESTED: { label: "停止中", cls: "bg-amber-500/15 text-amber-300" },
  COMPLETED: { label: "已完成", cls: "bg-white/10 text-stone-400" },
};

function statusOf(s: EspSession) {
  if (s.status === "ACTIVE" && !s.started_at_ms) {
    return { label: "等待设备", cls: "bg-sky-500/15 text-sky-300" };
  }
  return STATUS_META[s.status];
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });
}

function fmtDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-xs text-stone-600">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-stone-100">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-stone-500">{unit}</span>}
      </p>
    </div>
  );
}

function LineChart({
  title,
  unit,
  series,
}: {
  title: string;
  unit: string;
  series: { name: string; color: string; values: number[] }[];
}) {
  const W = 600;
  const H = 130;
  const all = series.flatMap((s) => s.values);
  const empty = all.length < 2;
  const min = empty ? 0 : Math.min(...all);
  const max = empty ? 1 : Math.max(...all);
  const pad = (max - min) * 0.08 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const count = Math.max(...series.map((s) => s.values.length), 0);
  const toPath = (values: number[]) =>
    values
      .map((v, i) => {
        const x = count <= 1 ? 0 : (i / (count - 1)) * W;
        const y = H - ((v - lo) / (hi - lo)) * H;
        return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-stone-200">{title}</h3>
        <span className="text-[11px] text-stone-600">{unit}</span>
        <span className="ml-auto flex items-center gap-3">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-stone-500">
              <span className="size-1.5 rounded-full" style={{ background: s.color }} />
              {s.name}
              <span className="tabular-nums text-stone-300">
                {s.values.length ? s.values[s.values.length - 1].toFixed(1) : "–"}
              </span>
            </span>
          ))}
        </span>
      </div>
      <div className="mt-3">
        {empty ? (
          <div className="flex h-[130px] items-center justify-center rounded-lg border border-white/10 bg-black/30 text-xs text-stone-600">
            等待数据…
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="h-[130px] w-full" preserveAspectRatio="none" aria-label={title}>
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1="0"
                x2={W}
                y1={H * f}
                y2={H * f}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {series.map((s) =>
              s.values.length > 1 ? (
                <path
                  key={s.name}
                  d={toPath(s.values)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}
          </svg>
        )}
      </div>
      {!empty && (
        <div className="mt-2 flex justify-between text-[10px] tabular-nums text-stone-600">
          <span>min {min.toFixed(1)}</span>
          <span>max {max.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

export function LiveSessionPage() {
  const [sessions, setSessions] = useState<EspSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<EspSession | null>(null);
  const [packets, setPackets] = useState<EspPacket[]>([]);
  const [totalSamples, setTotalSamples] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stopPending, setStopPending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const lastSeqRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 会话列表：3 秒轮询，首次自动选中进行中的会话
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await fetchEspSessions(30);
        if (!alive) return;
        setSessions(list);
        setError("");
        setSelectedId((cur) => cur ?? list.find((s) => s.status !== "COMPLETED")?.id ?? list[0]?.id ?? null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // 选中会话：先拉历史包，之后每秒增量拉取
  useEffect(() => {
    if (!selectedId) {
      setSession(null);
      setPackets([]);
      return;
    }
    let alive = true;
    lastSeqRef.current = 0;
    busyRef.current = false;
    setPackets([]);
    setTotalSamples(0);
    setSession(sessions.find((s) => s.id === selectedId) ?? null);
    const pull = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const { session: s, packets: ps } = await fetchEspPackets(selectedId, lastSeqRef.current + 1, 200);
        if (!alive) return;
        setSession(s);
        setError("");
        if (ps.length) {
          lastSeqRef.current = ps[ps.length - 1].seq;
          setPackets((prev) => [...prev, ...ps].slice(-MAX_PACKETS));
          setTotalSamples((n) => n + ps.reduce((a, p) => a + p.sampleCount, 0));
        }
      } finally {
        busyRef.current = false;
      }
    };
    void pull().catch((e) => alive && setError((e as Error).message));
    const timer = setInterval(() => void pull().catch(() => {}), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const samples = useMemo(() => packets.flatMap((p) => p.samples), [packets]);
  const fsr = useMemo(() => samples.map((s) => s.fsrAdc), [samples]);

  const onStop = async () => {
    if (!session || stopPending || session.status !== "ACTIVE") return;
    setStopPending(true);
    try {
      await stopEspSession(session.id);
      setSession((s) => (s ? { ...s, status: "STOP_REQUESTED", stop_requested_at_ms: Date.now() } : s));
      setSessions((list) =>
        list.map((s) => (s.id === session.id ? { ...s, status: "STOP_REQUESTED" as const } : s)),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStopPending(false);
    }
  };

  const meta = session ? statusOf(session) : null;
  const elapsed = session
    ? fmtDuration((session.completed_at_ms ?? now) - (session.started_at_ms ?? session.created_at_ms))
    : "00:00";

  return (
    <div>
      <PageHeader
        en="LIVE CUP"
        title="实时体验"
        desc="智能酒杯以 25Hz 上报 FSR 与 IMU 数据。此处实时查看进行中的体验，并可在用户结束后一键停止采集。"
      />
      {error && (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}

      <section className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <div className="card p-4">
          <div className="flex items-center justify-between px-2 pt-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-200">
              <RadioTower className="size-4 text-amber-400" aria-hidden="true" />
              体验会话
            </h2>
            <span className="text-[10px] text-stone-600">3s 刷新</span>
          </div>
          <ul className="mt-3 space-y-2">
            {sessions.map((s) => {
              const m = statusOf(s);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={`w-full rounded-lg border px-3.5 py-3 text-left transition-colors ${
                      s.id === selectedId
                        ? "border-amber-400/40 bg-amber-500/10"
                        : "border-white/10 bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-stone-200">{s.drink?.name ?? "未知酒款"}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${m.cls}`}>{m.label}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-stone-600">
                      <span className="truncate">{s.device_id}</span>
                      <span className="tabular-nums">{s.last_seq} 包</span>
                    </div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-stone-600">{fmtTime(s.created_at_ms)}</div>
                  </button>
                </li>
              );
            })}
            {loading && <li className="px-2 py-10 text-center text-sm text-stone-600">加载中…</li>}
            {!loading && !sessions.length && (
              <li className="px-2 py-10 text-center text-sm text-stone-600">暂无体验会话</li>
            )}
          </ul>
        </div>

        <div className="space-y-6">
          {!session && (
            <div className="card flex h-64 items-center justify-center text-sm text-stone-600">
              选择左侧会话查看实时数据
            </div>
          )}
          {session && meta && (
            <>
              <div className="card p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-xl font-semibold text-stone-100">{session.drink?.name ?? "未知酒款"}</h2>
                  <span className={`rounded px-2 py-0.5 text-xs ${meta.cls}`}>{meta.label}</span>
                  <button
                    type="button"
                    className="btn-primary ml-auto"
                    onClick={() => void onStop()}
                    disabled={stopPending || session.status !== "ACTIVE"}
                  >
                    <CircleStop className="size-4" aria-hidden="true" />
                    {stopPending ? "请求中…" : session.status === "ACTIVE" ? "停止体验" : "已停止"}
                  </button>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
                  <Stat label="已进行" value={elapsed} />
                  <Stat label="数据包" value={String(session.last_seq)} unit="包" />
                  <Stat label="采样点" value={String(totalSamples)} unit="个" />
                  <Stat label="采样率" value="25" unit="Hz" />
                </div>
                <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-600">
                  <span>
                    会话 <span className="tabular-nums text-stone-400">{session.id}</span>
                  </span>
                  <span>
                    设备 <span className="text-stone-400">{session.device_id}</span>
                  </span>
                  <span>
                    用户 <span className="text-stone-400">{session.user_id ?? "匿名"}</span>
                  </span>
                </p>
              </div>

              <LineChart title="FSR 402 压力" unit="原始 ADC 值" series={[{ name: "fsrAdc", color: "#fbbf24", values: fsr }]} />
              <LineChart
                title="IMU 加速度"
                unit="m/s²"
                series={[
                  { name: "ax", color: "#fbbf24", values: samples.map((s) => s.ax) },
                  { name: "ay", color: "#34d399", values: samples.map((s) => s.ay) },
                  { name: "az", color: "#38bdf8", values: samples.map((s) => s.az) },
                ]}
              />
              <LineChart
                title="IMU 角速度"
                unit="deg/s"
                series={[
                  { name: "gx", color: "#fbbf24", values: samples.map((s) => s.gx) },
                  { name: "gy", color: "#34d399", values: samples.map((s) => s.gy) },
                  { name: "gz", color: "#38bdf8", values: samples.map((s) => s.gz) },
                ]}
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
