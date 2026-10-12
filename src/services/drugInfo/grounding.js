// Fail-closed evidence guards for AI-generated medicine information.
// Only text that can be located as an excerpt in the relevant official-label text is exposed.

const normText = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function numbersIn(s) {
  const t = String(s ?? '').replace(/(\d),(?=\d{3}\b)/g, '$1'); // 1,000 -> 1000
  return new Set((t.match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n))));
}

class Source {
  constructor(text) {
    this.norm = normText(text);
    this.nums = numbersIn(text);
  }
  numbersGrounded(text) {
    for (const n of numbersIn(text)) if (!this.nums.has(n)) return false;
    return true;
  }
  hasQuote(quote) {
    const q = normText(quote).replace(/^\W+|\W+$/g, '');
    return q.length >= 12 && this.norm.includes(q);
  }
}

const cleanItem = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '');

function groundedList(arr, source, { max = 12, maxLen = 400 } = {}) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const raw of arr) {
    const excerpt = cleanItem(raw);
    if (excerpt.length < 12 || excerpt.length > maxLen) continue;
    if (!source.hasQuote(excerpt) || !source.numbersGrounded(excerpt)) continue;
    if (!out.includes(excerpt)) out.push(excerpt);
    if (out.length >= max) break;
  }
  return out;
}

function groundedStatements(arr, source, { max = 8 } = {}) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const raw of arr) {
    const text = cleanItem(raw?.text);
    const quote = cleanItem(raw?.quote);
    if (quote.length < 12 || quote.length > 400) continue;
    if (!source.hasQuote(quote) || !source.numbersGrounded(quote)) continue;
    // A generated paraphrase is never displayed; the statement itself must be the verified excerpt.
    if (normText(text) !== normText(quote)) continue;
    out.push({ text: quote, quote });
    if (out.length >= max) break;
  }
  return out;
}

module.exports = { Source, normText, numbersIn, groundedList, groundedStatements, cleanItem };
