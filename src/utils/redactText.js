const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<![A-Z0-9])(?:\+?\d[\d ().-]{8,}\d)(?![A-Z0-9])/g;

function redactText(value, maxLength = 1200) {
  return String(value || '')
    .replace(EMAIL, '[redacted email]')
    .replace(PHONE, '[redacted phone]')
    .slice(0, maxLength);
}

module.exports = { redactText };
