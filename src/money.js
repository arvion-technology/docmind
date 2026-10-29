// Money and currency helpers.
//
// Every amount inside the pipeline is an integer number of minor units (cents
// for all currencies here). Parsing to floats and rounding at the end is how
// invoice tools end up one cent out on totals; integer arithmetic makes the
// reconciliation check exact instead of approximate.

export const CURRENCIES = {
  USD: { symbol: "$", name: "US dollar" },
  EUR: { symbol: "€", name: "Euro" },
  GBP: { symbol: "£", name: "Pound sterling" },
  NPR: { symbol: "Rs.", name: "Nepalese rupee" },
  INR: { symbol: "₹", name: "Indian rupee" },
};

export const SUPPORTED = Object.keys(CURRENCIES);

const CODE_RE = /\b(USD|EUR|GBP|NPR|INR)\b/;
const SYMBOL_RE = /(Rs\.?|NPR|₹|€|£|\$)/;

/** Detect the document currency. Explicit ISO codes win over symbols, because
 *  a symbol can be ambiguous across markets. Returns null when nothing matches. */
export function detectCurrency(text) {
  const code = text.match(CODE_RE);
  if (code) return code[1];
  const symbol = text.match(SYMBOL_RE);
  if (!symbol) return null;
  const found = symbol[1];
  if (/^Rs/i.test(found)) return "NPR";
  return { $: "USD", "€": "EUR", "£": "GBP", "₹": "INR" }[found] || null;
}

const AMOUNT_RE = /\d[\d,]*(?:\.\d{1,2})?/g;

/** Parse a printed amount into minor units. Assumes a dot decimal separator and
 *  commas as thousands separators, which is the convention in the fixtures. */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const match = String(raw).match(/\d[\d,]*(?:\.\d{1,2})?/);
  if (!match) return null;
  const cleaned = match[0].replace(/,/g, "");
  const [whole, fraction = ""] = cleaned.split(".");
  const minor = fraction.length === 0 ? "00" : fraction.padEnd(2, "0");
  return Number(whole) * 100 + Number(minor);
}

export function parsePercent(raw) {
  const match = String(raw ?? "").match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

/** All amount-looking tokens on a line, in order. Decimal places are required
 *  so that addresses, quantities and reference numbers are not mistaken for
 *  money. */
export function amountsIn(line) {
  const out = [];
  for (const match of line.matchAll(/\d[\d,]*(?:\.\d{1,2})(?![\d])/g)) {
    out.push({ raw: match[0], value: parseAmount(match[0]), index: match.index });
  }
  return out;
}

export function formatMoney(minor, currency = "USD") {
  if (minor === null || minor === undefined) return ", ";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const fraction = String(abs % 100).padStart(2, "0");
  const code = CURRENCIES[currency];
  return code ? `${sign}${code.symbol} ${whole}.${fraction}` : `${sign}${whole}.${fraction}`;
}

export function formatMoneyPlain(minor) {
  if (minor === null || minor === undefined) return "";
  return (minor / 100).toFixed(2);
}

export function isCurrencyCode(value) {
  return typeof value === "string" && value in CURRENCIES;
}

/** Tax amount for a subtotal at a rate, rounded once to the nearest cent. */
export function taxFor(subtotal, rate) {
  if (subtotal === null || subtotal === undefined || rate === null || rate === undefined) return null;
  return Math.round((subtotal * rate) / 100);
}
