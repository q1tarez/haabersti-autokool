/** Extract numeric EUR amount from strings like "490 EUR" or "from 120 €" */
function parsePriceEur(priceStr) {
  const raw = String(priceStr || "").replace(/\s/g, " ").trim();
  const m = raw.replace(",", ".").match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

module.exports = { parsePriceEur };
