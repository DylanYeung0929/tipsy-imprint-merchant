/**
 * 纯白背景抠图：从四边洪水填充背景 → 连通区整体透明 → 清残影 → 裁成方形。
 * 生成式模型的白底并非纯 255（常是暖调近白渐变，实测 min(r,g,b) 在 205–245 游走），
 * 所以遍历阈值放宽到 200。**凡被洪水填充到的像素一律全透明**——它们按定义就是与画面
 * 四边连通的背景。曾按白度给它分级赋 alpha，导致近白背景拿到 20%–78% 不透明度，
 * 暗色卡片上留下大片灰雾。
 * 背景里还常有杯底的桌面阴影/反光：它比背景暗一档（min 降到 175 左右），洪水填充
 * 到不了，于是整块留在图上；在深色卡片上就是一团灰渍。降阈值去够它会连带啃掉玻璃
 * 高光，所以改用连通域判定：不连通主体、又整体偏灰的块一律清掉。
 */
const BG_MIN_CHANNEL = 200;
const ALPHA_FLOOR = 8;
const PAD_RATIO = 0.12;
/** 与主体不连通、又「又亮又灰」的块，视为模型画的桌面阴影/反光，整块清掉 */
const SHADOW_MAX_SATURATION = 80;
const SHADOW_MIN_LIGHTNESS = 150;

export interface Cutout {
  /** 抠好的透明 PNG data URL（正方形） */
  url: string;
  /** 全透明像素占比；低于 0.3 说明模型没给白底，抠图不可信 */
  coverage: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

/** 从图片四边洪水填充，返回背景连通区标记 */
function backgroundMask(px: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const minChannel = (p: number) => {
    const i = p * 4;
    return Math.min(px[i], px[i + 1], px[i + 2]);
  };
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let tail = 0;
  const push = (x: number, y: number) => {
    const p = y * w + x;
    if (seen[p] || minChannel(p) < BG_MIN_CHANNEL) return;
    seen[p] = 1;
    queue[tail++] = p;
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  for (let head = 0; head < tail; head++) {
    const p = queue[head];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return seen;
}

/**
 * 清掉与主体不连通的桌面阴影/反光与抠图毛刺。
 * 主体 = 面积最大的连通域，无论颜色一律保留；其余块满足「平均饱和度低 + 平均最暗通道亮」
 * 才整块透明——阴影是浅灰，而掉落的果皮、薄荷叶要么够艳要么够暗，都不会被误删。
 */
function stripDetachedShadows(px: Uint8ClampedArray, w: number, h: number): void {
  const total = w * h;
  const visited = new Uint8Array(total);
  const pixels = new Int32Array(total);
  const comps: { start: number; end: number; area: number; sat: number; minc: number }[] = [];
  let top = 0;
  for (let seed = 0; seed < total; seed++) {
    if (visited[seed] || px[seed * 4 + 3] <= ALPHA_FLOOR) continue;
    const start = top;
    let head = top;
    let area = 0;
    let satSum = 0;
    let minSum = 0;
    const push = (q: number) => {
      if (visited[q] || px[q * 4 + 3] <= ALPHA_FLOOR) return;
      visited[q] = 1;
      pixels[top++] = q;
    };
    push(seed);
    while (head < top) {
      const p = pixels[head++];
      const i = p * 4;
      const r = px[i];
      const g = px[i + 1];
      const bl = px[i + 2];
      area++;
      satSum += Math.max(r, g, bl) - Math.min(r, g, bl);
      minSum += Math.min(r, g, bl);
      const x = p % w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (p >= w) push(p - w);
      if (p < total - w) push(p + w);
    }
    comps.push({ start, end: top, area, sat: satSum / area, minc: minSum / area });
  }
  if (comps.length < 2) return;
  let main = 0;
  for (let k = 1; k < comps.length; k++) if (comps[k].area > comps[main].area) main = k;
  for (let k = 0; k < comps.length; k++) {
    const { sat, minc, start, end } = comps[k];
    if (k === main || sat >= SHADOW_MAX_SATURATION || minc < SHADOW_MIN_LIGHTNESS) continue;
    for (let t = start; t < end; t++) px[pixels[t] * 4 + 3] = 0;
  }
}

export async function makeCutout(src: string, side = 512): Promise<Cutout> {
  const img = await loadImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("浏览器不支持图片处理");
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  const bg = backgroundMask(px, w, h);
  for (let p = 0; p < w * h; p++) if (bg[p]) px[p * 4 + 3] = 0;
  stripDetachedShadows(px, w, h);

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let transparent = 0;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (px[i + 3] === 0) transparent++;
    if (px[i + 3] > ALPHA_FLOOR) {
      const x = p % w;
      const y = (p - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  let coverage = transparent / (w * h);
  let url = src;

  if (maxX >= minX && maxY >= minY) {
    const box = Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * (1 + PAD_RATIO));
    const cx = Math.round((minX + maxX) / 2);
    const cy = Math.round((minY + maxY) / 2);
    ctx.putImageData(image, 0, 0);
    const out = document.createElement("canvas");
    out.width = side;
    out.height = side;
    const octx = out.getContext("2d");
    if (!octx) throw new Error("浏览器不支持图片处理");
    octx.drawImage(canvas, cx - box / 2, cy - box / 2, box, box, 0, 0, side, side);
    url = out.toDataURL("image/png");
    const od = octx.getImageData(0, 0, side, side).data;
    let cleared = 0;
    for (let i = 3; i < od.length; i += 4) if (od[i] === 0) cleared++;
    coverage = cleared / (side * side);
  }
  return { url, coverage };
}
