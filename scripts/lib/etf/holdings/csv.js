// scripts/lib/etf/holdings/csv.js — pure. Minimal RFC-4180-ish CSV parser
// shared by the issuer adapters. Handles quoted fields with embedded commas
// and newlines, "" escaping, and CRLF/LF. Returns string[][] — no header
// interpretation, blank lines come back as [''].

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false, sawAny = false;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true; sawAny = true;
    } else if (c === ',') {
      row.push(field); field = ''; sawAny = true;
    } else if (c === '\n') {
      row.push(field); rows.push(row);
      row = []; field = ''; sawAny = false;
    } else if (c === '\r') {
      // swallow — the \n handles the row break
    } else {
      field += c; sawAny = true;
    }
  }
  if (sawAny || field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

module.exports = { parseCsv };
