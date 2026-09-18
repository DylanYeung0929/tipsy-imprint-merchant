import { useCallback, useEffect, useMemo, useState } from "react";
import { RadioTower, Sparkles, Terminal, Waves } from "lucide-react";
import type { EspEvent, EspSession, EventType } from "../types";
import { EVENT_TYPE_LABEL } from "../lib/mock";
import { fetchEspEvents, fetchEspSessions, fetchSessionAiNote } from "../lib/api";
import { Alert, Badge, CardHeader, PageHeader, Table, eventTypeMeta, sessionStatusMeta } from "../components/ui";

const EVENT_TYPES: EventType[] = ["pickup", "putdown", "sip", "shake", "chug"];

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });

const fmtValue = (e: EspEvent) => {
  if (e.value === undefined) return "";
  return e.type === "shake" ? `幅度 ${e.value}` : `${e.value} ml`;
};

const SAMPLE_PAYLOAD = JSON.stringify(
  {
    protocolVersion: 1,
    sessionId: "ses-xxxx",
    seq: 3,
    batchStartMs: 1789645109123,
    sampleRateHz: 25,
    samples: [
      { tMs: 0, fsrAdc: 2100, ax: 0.01, ay: 0.02, az: 9.81, gx: 0, gy: 0, gz: 0 },
      { tMs: 40, fsrAdc: 2087, ax: 0.03, ay: 0.01, az: 9.79, gx: 1.2, gy: -0.4, gz: 0.8 },
    ],
  },
  null,
  2,
);

const FIELD_TABLE: [string, string][] = [
  ["tMs", "包内毫秒偏移（从 0 起，步长 = 1000 / sampleRateHz）"],
  ["fsrAdc", "FSR 402 压力原始 ADC（承重 → 液量变化）"],
  ["ax ay az", "三轴加速度（g），az ≈ 9.81 为水平放置"],
  ["gx gy gz", "三轴角速度（deg/s），摇晃检测用"],
];

const RULES: [string, string][] = [
  ["拿起酒杯", "FSR 连续低于静息基线 50%"],
  ["放回桌面", "承重回升并稳定"],
  ["饮用", "倾角 ≥ 25° 且持续 ≥ 0.4s"],
  ["摇晃", "1s 窗口内角速度峰值 ≥ 90°/s 且过零 ≥ 4 次"],
  ["一饮而尽", "单次持续倾角 ≥ 3s（结合放下前后承重差算饮用量）"],
];

export function DataReceivePage() {
  const [sessions, setSessions] = useState<EspSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [events, setEvents] = useState<EspEvent[]>([]);
  const [status, setStatus] = useState<EspSession["status"]>("COMPLETED");
  const [note, setNote] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [noteError, setNoteError] = useState("");

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  // 会话列表轮询；选中项优先保留，否则自动选最近一场未完成会话
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const list = await fetchEspSessions(15).catch(() => null);
      if (!alive || !list) return;
      setSessions(list);
      setSelectedId((cur) =>
        list.some((s) => s.id === cur)
          ? cur
          : (list.find((s) => s.status !== "COMPLETED") ?? list[0])?.id ?? "",
      );
    };
    void tick();
    const timer = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // 选中会话的行为事件轮询（后端从 25Hz 原始采样识别）
  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetchEspEvents(selectedId);
        if (!alive) return;
        setEvents(r.events);
        setStatus(r.status);
        setEventsError("");
      } catch (e) {
        if (alive) setEventsError(e instanceof Error ? e.message : "事件拉取失败");
      }
    };
    void tick();
    const timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [selectedId]);

  const counts = useMemo(() => {
    const m = Object.fromEntries(EVENT_TYPES.map((t) => [t, 0])) as Record<EventType, number>;
    for (const e of events) m[e.type] = (m[e.type] ?? 0) + 1;
    return m;
  }, [events]);

  const runAiNote = useCallback(async () => {
    if (!selectedId) return;
    setNoteLoading(true);
    setNoteError("");
    try {
      setNote(await fetchSessionAiNote(selectedId));
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : "AI 解读失败");
    } finally {
      setNoteLoading(false);
    }
  }, [selectedId]);

  return (
    <div>
      <PageHeader
        en="LIVE INGEST"
        title="数据接收"
        desc="智能酒杯按 25Hz 上传原始遥测，后端识别拿起 / 放下 / 饮用 / 摇晃 / 一饮而尽行为事件；接口约定与识别规则见右侧。"
      />

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="card min-w-0 p-5">
          <CardHeader
            title="行为事件流"
            icon={RadioTower}
            actions={
              selected && <Badge tone={sessionStatusMeta[status].tone}>{sessionStatusMeta[status].label}</Badge>
            }
          />

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs transition max-lg:py-2.5 ${
                  s.id === selectedId
                    ? "border-amber-400/50 bg-amber-500/10 text-amber-200"
                    : "border-white/10 bg-white/[0.02] text-stone-400 hover:border-white/20"
                }`}
              >
                {s.drink?.name ?? "未知酒款"}
                <span className="ml-2 text-2xs text-stone-500">{sessionStatusMeta[s.status].label}</span>
              </button>
            ))}
            {sessions.length === 0 && (
              <p className="py-2 text-sm text-fg-muted">暂无遥测会话，等待设备接入…</p>
            )}
          </div>

          {selected && (
            <p className="mt-1 text-xs text-fg-faint">
              {selected.id} · {selected.device_id} · 开始于 {fmtTime(selected.started_at_ms ?? selected.created_at_ms)}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2" data-event-counts>
            {EVENT_TYPES.map((t) => (
              <Badge key={t} tone={eventTypeMeta[t].tone} className="tabular-nums">
                {EVENT_TYPE_LABEL[t]} {counts[t]}
              </Badge>
            ))}
          </div>

          <ol className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1" data-event-list>
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2.5"
              >
                <span className="w-20 shrink-0 text-xs tabular-nums text-fg-faint">{fmtTime(e.tsMs)}</span>
                <Badge
                  tone={eventTypeMeta[e.type].tone}
                  className="w-20 shrink-0 justify-center whitespace-nowrap"
                >
                  {EVENT_TYPE_LABEL[e.type]}
                </Badge>
                <span className="text-sm text-stone-300">
                  {e.drinkName ?? "未知酒款"}
                  {e.value !== undefined && (
                    <span className="ml-2 tabular-nums text-stone-500">{fmtValue(e)}</span>
                  )}
                </span>
                <span className="ml-auto text-xs text-fg-faint">{e.userId ?? "匿名"}</span>
              </li>
            ))}
            {selectedId && events.length === 0 && (
              <li className="py-8 text-center text-sm text-fg-muted">
                该会话暂无事件，等待设备上传数据…
              </li>
            )}
          </ol>

          {eventsError && <Alert className="mt-3">{eventsError}</Alert>}

          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-200">
                <Waves className="size-4 text-amber-400" aria-hidden="true" />
                AI 行为解读
              </h3>
              <button className="btn-primary" onClick={runAiNote} disabled={!selectedId || noteLoading || events.length === 0}>
                <Sparkles className="size-4" aria-hidden="true" />
                {noteLoading ? "生成中…" : note ? "重新解读" : "AI 解读"}
              </button>
            </div>
            {note && (
              <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm leading-6 text-stone-300" data-ai-note>
                {note}
              </p>
            )}
            {noteError && <Alert className="mt-3">{noteError}</Alert>}
            {!note && !noteLoading && !noteError && (
              <p className="mt-2 text-xs text-fg-faint">
                将本场事件时间线与指标交给 AI，生成这位顾客的饮酒风格画像与门店观察建议。
              </p>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-6">
          <div className="card min-w-0 p-6">
            <CardHeader title="上报接口（协议 v1）" icon={Terminal} />
            <p className="mt-2 text-sm text-stone-500">
              酒杯固件在会话内按约 1 包/秒批量上报原始采样（HTTP，需 X-Device-Key 头）；seq 递增且幂等，重发同一包安全。
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-black/50 p-4 text-xs leading-5 text-emerald-300">
              {`POST /api/v1/devices/{deviceId}/telemetry-batches\n\n${SAMPLE_PAYLOAD}`}
            </pre>
            <div className="mt-4">
              <Table
                columns={[
                  { key: "field", label: "字段" },
                  { key: "desc", label: "说明" },
                ]}
                minWidth={420}
                caption="上报字段说明"
              >
                {FIELD_TABLE.map(([k, v]) => (
                  <tr key={k}>
                    <td className="whitespace-nowrap text-amber-300">{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </div>

          <div className="card p-5">
            <CardHeader title="事件识别规则" />
            <p className="text-xs text-fg-faint">后端从原始采样实时推导，阈值初值，待实机标定</p>
            <div className="mt-4 space-y-3">
              {RULES.map(([name, rule]) => (
                <div key={name} className="flex items-start gap-3 text-sm">
                  <span className="w-20 shrink-0 rounded bg-amber-500/10 px-2 py-0.5 text-center text-xs text-amber-300">
                    {name}
                  </span>
                  <span className="text-stone-400">{rule}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
