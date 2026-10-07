// "0803 555 0142" / "234803..." / "+234 803 555 0142"  ->  "+2348035550142"
function normalizePhone(input) {
  if (!input) return null;
  let p = String(input).replace(/[\s\-().]/g, '');
  if (p.startsWith('+')) return /^\+\d{10,15}$/.test(p) ? p : null;
  if (p.startsWith('00')) p = '+' + p.slice(2);
  else if (p.startsWith('234')) p = '+' + p;
  else if (p.startsWith('0') && p.length === 11) p = '+234' + p.slice(1);
  else return null;
  return /^\+\d{10,15}$/.test(p) ? p : null;
}

module.exports = { normalizePhone };
