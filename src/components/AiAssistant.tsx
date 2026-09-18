import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { chatAssistant } from "../lib/api";
import { drinkStore, sessionStore, userStore } from "../lib/mock";

type Msg = { role: "user" | "assistant"; content: string };

const BALL = 56;
const EDGE = 12;
const POS_KEY = "tipsy_assistant_pos";

function clampPos(x: number, y: number) {
  return {
    x: Math.min(Math.max(EDGE, x), window.innerWidth - BALL - EDGE),
    y: Math.min(Math.max(EDGE, y), window.innerHeight - BALL - EDGE),
  };
}

function initialPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { x?: number; y?: number };
      if (typeof p.x === "number" && typeof p.y === "number") return clampPos(p.x, p.y);
    }
  } catch {
    // 忽略损坏的本地记录
  }
  return clampPos(window.innerWidth - BALL - 24, window.innerHeight - BALL - 24);
}

/** 汇总当前后台数据，作为助手回答的上下文 */
function buildContext(): string {
  const drinks = drinkStore;
  const sessions = sessionStore;
  const countByDrink = new Map<string, number>();
  for (const s of sessions) countByDrink.set(s.drinkId, (countByDrink.get(s.drinkId) ?? 0) + 1);
  const top = [...countByDrink.entries()]
    .map(([id, n]) => ({ name: drinks.find((d) => d.id === id)?.name ?? id, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  return [
    "酒吧：微醺印记（演示数据）",
    `酒单 ${drinks.length} 款：${drinks.map((d) => d.name).join("、")}`,
    `饮酒会话 ${sessions.length} 场，匿名用户 ${userStore.length} 位`,
    top.length ? `会话最多的酒款：${top.map((t) => `${t.name}（${t.n} 场）`).join("、")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function AiAssistant() {
  const [pos, setPos] = useState(initialPos);
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  const posRef = useRef(pos);
  posRef.current = pos;
  const dragRef = useRef<{ startX: number; startY: number; offX: number; offY: number; moved: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      setPos((p) => clampPos(p.x, p.y));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, open]);

  // 面板贴靠在悬浮球内侧：左右、上下按球所在半屏选择，位置与缩放原点随球实时更新
  const panel = useMemo(() => {
    const gap = 14;
    const w = Math.min(380, viewport.w - EDGE * 2);
    const h = Math.min(560, viewport.h - 128);
    const ballCx = pos.x + BALL / 2;
    const ballCy = pos.y + BALL / 2;
    let left = ballCx < viewport.w / 2 ? pos.x + BALL + gap : pos.x - w - gap;
    let top = ballCy < viewport.h / 2 ? pos.y + BALL + gap : pos.y - h - gap;
    left = Math.min(Math.max(EDGE, left), viewport.w - w - EDGE);
    top = Math.min(Math.max(EDGE, top), viewport.h - h - EDGE);
    const ox = Math.min(Math.max(ballCx - left, 0), w);
    const oy = Math.min(Math.max(ballCy - top, 0), h);
    return { w, h, left, top, origin: `${((ox / w) * 100).toFixed(1)}% ${((oy / h) * 100).toFixed(1)}%` };
  }, [pos, viewport]);

  const toggle = (next: boolean) => setOpen(next);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - pos.x,
      offY: e.clientY - pos.y,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5) d.moved = true;
    if (d.moved) setPos(clampPos(e.clientX - d.offX, e.clientY - d.offY));
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(posRef.current));
      } catch {
        // 存储不可用时保持运行
      }
    } else {
      toggle(!open);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || pending) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setPending(true);
    try {
      const reply = await chatAssistant(
        next.map(({ role, content }) => ({ role, content })),
        buildContext(),
      );
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `抱歉，助手暂时不可用：${(e as Error).message}` },
      ]);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div
        data-assistant-panel
        style={{ left: panel.left, top: panel.top, width: panel.w, height: panel.h, transformOrigin: panel.origin }}
        className={`fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#151210]/95 shadow-2xl shadow-black/60 backdrop-blur-xl transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          open ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0"
        }`}
        aria-hidden={!open}
      >
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-600 text-stone-900">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-stone-100">微醺助手</p>
            <p className="display-en text-[10px] tracking-[.18em] text-stone-500">AI ASSISTANT</p>
          </div>
          <button
            type="button"
            onClick={() => toggle(false)}
            className="ml-auto rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-white/5 hover:text-stone-200"
            aria-label="关闭助手"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[.06] px-3.5 py-2.5 text-[13px] leading-6 text-stone-200">
            你好，我是微醺印记 AI 助手。可以问我数据指标含义、经营建议、印记卡片玩法，或结合当前酒单与会话数据的任何问题。
          </div>
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-amber-400/25 bg-amber-500/15 px-3.5 py-2.5 text-[13px] leading-6 text-amber-50"
                  : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-white/10 bg-white/[.06] px-3.5 py-2.5 text-[13px] leading-6 text-stone-200"
              }
            >
              {m.content}
            </div>
          ))}
          {pending && (
            <div className="flex w-fit items-center gap-1.5 rounded-2xl rounded-bl-md border border-white/10 bg-white/[.06] px-4 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-bounce rounded-full bg-amber-400/80"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder="输入问题，Enter 发送"
              aria-label="向助手提问"
              className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-[13px] leading-5 text-stone-200 placeholder:text-fg-faint focus:border-amber-400/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={pending || !input.trim()}
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-300 to-amber-600 text-stone-900 transition-opacity disabled:opacity-40"
              aria-label="发送"
            >
              <Send className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ left: pos.x, top: pos.y, touchAction: "none" }}
        className={`fixed z-50 grid size-14 cursor-grab select-none place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-600 text-stone-900 shadow-lg shadow-amber-500/25 ring-1 ring-amber-200/40 transition-transform hover:scale-105 active:cursor-grabbing ${
          open ? "" : "animate-[assistant-glow_2.4s_ease-in-out_infinite]"
        }`}
        aria-label={open ? "关闭 AI 助手" : "打开 AI 助手"}
        title={open ? "关闭 AI 助手" : "打开 AI 助手（可拖动）"}
      >
        {open ? <X className="size-6" aria-hidden="true" /> : <Sparkles className="size-6" aria-hidden="true" />}
      </button>
    </>
  );
}
