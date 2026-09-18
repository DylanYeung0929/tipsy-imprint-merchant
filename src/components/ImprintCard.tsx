import { useId, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Loader2 } from "lucide-react";
import type { CardStyle, Drink, ImprintCard, WeatherInfo } from "../types";
import { COCKTAIL_IMAGES } from "../lib/cocktailImages";
import { cocktailImageFor } from "../lib/mock";
import imprintBadge from "../assets/imprint-badge.png";

/** 五种花纹的 SVG pattern 定义（accent 低透明度，铺满卡片背景） */
function Pattern({ id, pattern, accent }: { id: string; pattern: CardStyle["pattern"]; accent: string }) {
  const stroke = `${accent}3d`;
  const fill = `${accent}12`;
  switch (pattern) {
    case "rings":
      return (
        <pattern id={id} width="120" height="120" patternUnits="userSpaceOnUse">
          {[16, 34, 52].map((r) => (
            <circle key={r} cx="60" cy="60" r={r} fill="none" stroke={stroke} strokeWidth="1" />
          ))}
        </pattern>
      );
    case "ripple":
      return (
        <pattern id={id} width="110" height="60" patternUnits="userSpaceOnUse">
          {[10, 24, 38].map((r) => (
            <path
              key={r}
              d={`M ${55 - r} 30 A ${r} ${r * 0.62} 0 0 1 ${55 + r} 30`}
              fill="none"
              stroke={stroke}
              strokeWidth="1"
            />
          ))}
          {[10, 24, 38].map((r) => (
            <path
              key={`b${r}`}
              d={`M ${55 - r} 30 A ${r} ${r * 0.62} 0 0 0 ${55 + r} 30`}
              fill="none"
              stroke={stroke}
              strokeWidth="1"
            />
          ))}
        </pattern>
      );
    case "diamond":
      return (
        <pattern id={id} width="56" height="56" patternUnits="userSpaceOnUse">
          <rect x="14" y="14" width="28" height="28" transform="rotate(45 28 28)" fill={fill} />
          <rect x="14" y="14" width="28" height="28" transform="rotate(45 28 28)" fill="none" stroke={stroke} strokeWidth="1" />
        </pattern>
      );
    case "slant":
      return (
        <pattern id={id} width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="28" stroke={stroke} strokeWidth="1" />
        </pattern>
      );
    case "dots":
      return (
        <pattern id={id} width="34" height="34" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="1.6" fill={fill} />
          <circle cx="27" cy="27" r="1.6" fill={fill} />
        </pattern>
      );
  }
}

export function ImprintCard({
  imprint,
  drink,
  userName,
  behavior,
  weather,
  now,
  aiLine,
  aiPending,
}: {
  imprint: ImprintCard;
  drink?: Drink;
  userName: string;
  behavior: string;
  weather: WeatherInfo | null;
  now: string;
  aiLine?: string;
  aiPending: boolean;
}) {
  const pid = useId().replace(/[:]/g, "");
  const style = drink?.cardStyle ?? { pattern: "slant" as const, bgFrom: "#1c1917", bgTo: "#0c0a09", accent: "#fbbf24" };
  const imgKey = cocktailImageFor(drink?.name ?? "");
  const imgSrc = imgKey ? COCKTAIL_IMAGES[imgKey] : undefined;
  const line = aiLine ?? imprint.line;
  const cardRef = useRef<HTMLElement>(null);
  const saveBtnRef = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);

  const saveImage = async () => {
    const node = cardRef.current;
    const btn = saveBtnRef.current;
    if (!node || saving) return;
    setSaving(true);
    // 导出前隐藏按钮本身（保留占位），使其不被拍进图片
    if (btn) btn.style.visibility = "hidden";
    try {
      await document.fonts.ready;
      const dataUrl = await toPng(node, { pixelRatio: 3, cacheBust: true });
      const a = document.createElement("a");
      a.download = `微醺印记-${drink?.name ?? imprint.drinkId}-${imprint.date}.png`;
      a.href = dataUrl;
      a.click();
    } catch {
      // 导出失败静默降级，不打断浏览
    } finally {
      if (btn) btn.style.visibility = "";
      setSaving(false);
    }
  };

  return (
    <article
      ref={cardRef}
      className="display-serif relative flex min-h-[400px] flex-col overflow-hidden rounded-2xl border border-white/10"
      style={{ background: `linear-gradient(165deg, ${style.bgFrom}, ${style.bgTo})` }}
    >
      <svg className="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <Pattern id={pid} pattern={style.pattern} accent={style.accent} />
        </defs>
        <rect width="100%" height="100%" fill={`url(#${pid})`} />
      </svg>
      <div
        className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full blur-3xl"
        style={{ background: `${style.accent}26` }}
      />
      <div
        className="pointer-events-none absolute inset-[7px] rounded-xl border"
        style={{ borderColor: `${style.accent}24` }}
        aria-hidden="true"
      />

      <div className="relative flex flex-1 flex-col p-6">
        <img
          src={imprintBadge}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-4 size-[72px] rotate-[10deg] select-none opacity-90 drop-shadow-[0_6px_16px_rgba(0,0,0,0.5)]"
        />
        <header className="flex items-start justify-between gap-3 pr-[76px]">
          <p className="text-[11px] font-bold tracking-[.3em]" style={{ color: style.accent }}>
            TIPSY IMPRINT
          </p>
          <div className="text-right text-[11px] leading-5 text-white/50">
            <p className="tabular-nums">
              {imprint.date} {now}
            </p>
            {weather && (
              <p>
                {weather.city} · {weather.weather} {weather.temperature}°C
              </p>
            )}
          </div>
        </header>

        <div className="mt-5 flex items-center gap-4">
          {imgSrc && (
            <img
              src={imgSrc}
              alt={drink?.name ?? "鸡尾酒"}
              className="size-24 shrink-0 object-contain drop-shadow-[0_10px_28px_rgba(0,0,0,0.55)]"
            />
          )}
          <div className="min-w-0">
            <h3 className="truncate text-[27px] leading-9 text-white/95">{drink?.name ?? imprint.drinkId}</h3>
            <p className="mt-1.5 text-xs leading-5 text-white/55">{drink?.flavor || "风味未知"}</p>
          </div>
        </div>

        <p className="mt-4 text-xs leading-5 text-white/45">{behavior}</p>

        <div
          className="mt-4 rounded-xl border px-4 py-3"
          style={{ borderColor: `${style.accent}4d`, background: `${style.accent}0d` }}
        >
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-wide" style={{ color: style.accent }}>
            {imprint.title} · {imprint.state}
            {aiPending && (
              <span className="inline-block size-1.5 animate-pulse rounded-full" style={{ background: style.accent }} />
            )}
          </span>
          <p className="mt-1.5 text-[15px] leading-7 text-white/90">「{line}」</p>
        </div>

        <footer className="mt-auto flex items-center justify-between gap-2 pt-5 text-[11px] text-white/40">
          <span>{userName}</span>
          <span className="flex items-center gap-2">
            <span>{imprint.venue}</span>
            <button
              ref={saveBtnRef}
              type="button"
              onClick={() => void saveImage()}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-60"
              title="将卡片导出为 PNG 图片"
            >
              {saving ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
              保存图片
            </button>
          </span>
        </footer>
      </div>
    </article>
  );
}
