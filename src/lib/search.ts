/** Arabic-friendly search: ignores diacritics/tatweel, unifies alef/ya/ta-marbuta/hamza forms, Arabic-Indic digits, case, punctuation. */
const DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const normalize = (s: string | null | undefined): string =>
  (s || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')            // tashkeel + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي').replace(/ئ/g, 'ي').replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (c) => String(DIGITS.indexOf(c)))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')                       // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim();

export const tokenize = (q: string): string[] => normalize(q).split(' ').filter(Boolean);
/** Every word of the query must appear somewhere in the (already normalized) text. */
export const matchesAll = (normalizedText: string, tokens: string[]): boolean => tokens.every((t) => normalizedText.includes(t));
