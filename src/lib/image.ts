/**
 * Client-side image pipeline: the shop owner picks ANY photo (up to 40 MB), we shrink it before upload.
 * Output: a main JPEG (<=1024px, aimed at ~180 KB) + a thumbnail (<=400px, aimed at ~35 KB). Re-encoding also strips EXIF (GPS location etc.).
 */
export type Compressed = { main: Blob; thumb: Blob; originalBytes: number; width: number; height: number };

export const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAIN_MAX = 1024, THUMB_MAX = 400;
const MAIN_TARGET = 180 * 1024, THUMB_TARGET = 35 * 1024;
const MAIN_QUALITIES = [0.85, 0.78, 0.7, 0.62, 0.55];
const THUMB_QUALITIES = [0.8, 0.7, 0.6, 0.5];

export const formatBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** `<uid>/<uuid>.jpg` -> `<uid>/<uuid>-s.jpg` (the thumbnail lives next to the full image) */
export const thumbPath = (path: string) => path.replace(/\.jpg$/i, '-s.jpg');

/** Tries qualities from best to worst and returns the first result that fits the byte budget (or the smallest one). */
export async function fitToBudget(encode: (quality: number) => Promise<Blob>, targetBytes: number, qualities: number[]) {
  let last: { blob: Blob; quality: number; fits: boolean } | null = null;
  for (const q of qualities) {
    const blob = await encode(q);
    last = { blob, quality: q, fits: blob.size <= targetBytes };
    if (last.fits) return last;
  }
  if (!last) throw new Error('no quality levels');
  return last;
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });   // applies the phone's rotation flag
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('decode')); i.src = url; });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch { URL.revokeObjectURL(url); throw new Error('صيغة الصورة غير مدعومة على هذا الجهاز. جرّب صورة JPG أو PNG، أو صوّرها من الكاميرا مباشرة.'); }
}

/** Downscales in halving steps (much better quality than one huge jump from a 12 MP photo). */
function drawScaled(src: CanvasImageSource, sw: number, sh: number, maxSide: number): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const tw = Math.max(1, Math.round(sw * k)), th = Math.max(1, Math.round(sh * k));
  let cur: CanvasImageSource = src; let w = sw, h = sh;
  const paint = (to: HTMLCanvasElement, from: CanvasImageSource) => {
    const g = to.getContext('2d'); if (!g) throw new Error('تعذر معالجة الصورة');
    g.fillStyle = '#fff'; g.fillRect(0, 0, to.width, to.height); g.imageSmoothingQuality = 'high'; g.drawImage(from, 0, 0, to.width, to.height);
  };
  while (w / 2 >= tw && h / 2 >= th) { const c = document.createElement('canvas'); w = Math.round(w / 2); h = Math.round(h / 2); c.width = w; c.height = h; paint(c, cur); cur = c; }
  const out = document.createElement('canvas'); out.width = tw; out.height = th; paint(out, cur);
  return out;
}
const toBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('تعذر ضغط الصورة'))), 'image/jpeg', q));

export async function compressImage(file: File): Promise<Compressed> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('اختر صورة (JPG أو PNG)');
  if (file.size > MAX_INPUT_BYTES) throw new Error(`الصورة كبيرة جدًا (${formatBytes(file.size)}). اختر صورة أصغر من ${formatBytes(MAX_INPUT_BYTES)}`);
  const dec = await decode(file);
  try {
    let canvas = drawScaled(dec.source, dec.width, dec.height, MAIN_MAX);
    let best = await fitToBudget((q) => toBlob(canvas, q), MAIN_TARGET, MAIN_QUALITIES);
    for (const scale of [0.85, 0.7]) {            // still too heavy (very detailed photo)? shrink the picture itself a bit
      if (best.fits) break;
      canvas = drawScaled(dec.source, dec.width, dec.height, Math.round(MAIN_MAX * scale));
      const r = await fitToBudget((q) => toBlob(canvas, q), MAIN_TARGET, MAIN_QUALITIES);
      if (r.blob.size < best.blob.size) best = r;
    }
    const tc = drawScaled(canvas, canvas.width, canvas.height, THUMB_MAX);
    const thumb = await fitToBudget((q) => toBlob(tc, q), THUMB_TARGET, THUMB_QUALITIES);
    return { main: best.blob, thumb: thumb.blob, originalBytes: file.size, width: canvas.width, height: canvas.height };
  } finally { dec.close(); }
}
