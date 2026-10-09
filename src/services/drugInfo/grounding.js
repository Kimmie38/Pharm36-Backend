// Anti-hallucination guards. The AI may only restate what is in the label text we gave it.
// Any statement containing a number (dose, frequency, age, percentage...) that does not appear in the
// source text is dropped, and dosage statements must carry a verbatim quote from the label.

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
    const t = cleanItem(raw);
    if (t.length < 3 || t.length > maxLen || !source.numbersGrounded(t)) continue;
    if (!out.includes(t)) out.push(t);
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
    if (text.length < 3 || text.length > 500) continue;
    if (!source.numbersGrounded(text)) continue;
    if (!source.hasQuote(quote)) continue; // dosing must be traceable to the label
    out.push({ text, quote: quote.slice(0, 400) });
    if (out.length >= max) break;
  }
  return out;
}

module.exports = { Source, normText, numbersIn, groundedList, groundedStatements, cleanItem };
