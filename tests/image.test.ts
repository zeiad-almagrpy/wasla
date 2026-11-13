import { describe, expect, it } from 'vitest';
import { fitToBudget, formatBytes, thumbPath } from '../src/lib/image';

const blobOf = (n: number) => new Blob([new Uint8Array(n)]);
describe('image budget logic', () => {
  it('returns the first quality that fits (best quality wins)', async () => {
    const sizeAt: Record<number, number> = { 0.85: 400_000, 0.78: 250_000, 0.7: 170_000, 0.62: 120_000 };
    const tried: number[] = [];
    const r = await fitToBudget(async (q) => { tried.push(q); return blobOf(sizeAt[q] ?? 50_000); }, 180_000, [0.85, 0.78, 0.7, 0.62]);
    expect(r.quality).toBe(0.7); expect(r.fits).toBe(true); expect(tried).toEqual([0.85, 0.78, 0.7]);   // stops early, no wasted encodes
  });
  it('when nothing fits, returns the smallest attempt and says so', async () => {
    const r = await fitToBudget(async (q) => blobOf(Math.round(q * 1_000_000)), 100, [0.8, 0.6, 0.5]);
    expect(r.fits).toBe(false); expect(r.quality).toBe(0.5); expect(r.blob.size).toBe(500_000);
  });
  it('thumbnail path sits next to the image and is derived, not stored', () => {
    expect(thumbPath('u1/abc.jpg')).toBe('u1/abc-s.jpg'); expect(thumbPath('u1/abc.JPG')).toBe('u1/abc-s.jpg');
  });
  it('human readable sizes', () => { expect(formatBytes(6_815_744)).toBe('6.5 MB'); expect(formatBytes(143_000)).toBe('140 KB'); expect(formatBytes(10)).toBe('1 KB'); });
});
