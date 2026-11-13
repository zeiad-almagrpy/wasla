import { describe, expect, it } from 'vitest';
import { matchesAll, normalize, tokenize } from '../src/lib/search';

describe('arabic-friendly search normalization', () => {
  it('unifies hamza / alef forms', () => { expect(normalize('مأكولات')).toBe(normalize('ماكولات')); expect(normalize('إنارة')).toBe(normalize('انارة')); expect(normalize('آيس')).toBe(normalize('ايس')); });
  it('treats ة/ه and ى/ي as the same', () => { expect(normalize('جبنة')).toBe(normalize('جبنه')); expect(normalize('مستشفى')).toBe(normalize('مستشفي')); });
  it('ignores tashkeel and tatweel', () => { expect(normalize('لَبَنٌ')).toBe('لبن'); expect(normalize('مخبـــز')).toBe('مخبز'); });
  it('maps arabic-indic digits and lowercases latin', () => { expect(normalize('٢ كيلو')).toBe('2 كيلو'); expect(normalize('PEPSI')).toBe('pepsi'); });
  it('strips punctuation and extra spaces', () => { expect(normalize('  لبن،   جهينة!! ')).toBe('لبن جهينه'); });
  it('requires every word, in any order', () => {
    const hay = normalize('لبن جهينة كامل الدسم بقالة النور');
    expect(matchesAll(hay, tokenize('جهينه لبن'))).toBe(true);
    expect(matchesAll(hay, tokenize('لبن السلام'))).toBe(false);
    expect(matchesAll(hay, tokenize('   '))).toBe(true); // empty query matches everything
  });
});
