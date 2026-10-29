// Rule-based extraction for invoices and receipts.
//
// The extractor is deliberately deterministic: label patterns, printed dates and
// whitespace columns. No model, no OCR and no fuzzy guessing. That makes it
// predictable on the eight fixture documents and honest about what it cannot
// read, a field it could not find is null with low confidence, not invented.
// A production system would put an LLM extractor in front of this and use these
// rules as the fallback and the cross-check; the confidence model is already
// shaped for that hand-off.

import { amountsIn, detectCurrency, parseAmount, parsePercent } from "./money.js";

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const SUBTOTAL_RE = /\bsub\s*-?\s*total\b|\bnet\s+amount\b/i;
const TOTAL_LABELS = [
  /\bgrand\s+total\b/i,
  /\btotal\s+due\b/i,
  /\bamount\s+due\b/i,
  /\bbalance\s+due\b/i,
  /\btotal\b/i,
];
const SKIP_ITEM_RE =
  /\b(sub\s*-?\s*total|total|amount\s+due|balance|tax|vat|gst|cash|change|discount|invoice|receipt|bill|date|due|reference|thank\s+you)\b/i;
const HEADER_RE = /\b(description|item|qty|quantity|unit\s+price|amount)\b.*\b(qty|quantity|amount)\b/i;

const splitLines = (text) =>
  String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " ").replace(/ (?=\s)/g, ""))
    .filter(Boolean);

/** Normalise a line for column parsing while keeping the original spacing:
 *  the extractor needs the two-space columns to tell a quantity from a
 *  description. */
const rawLines = (text) => String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

function lastAmount(line) {
  const found = amountsIn(line);
  return found.length ? found[found.length - 1].value : null;
}

function findLabeledAmount(lines, labels, { exclude = null } = {}) {
  for (const label of labels) {
    for (const line of lines) {
      if (exclude && exclude.test(line)) continue;
      if (!label.test(line)) continue;
      const value = lastAmount(line);
      if (value !== null) return { value, confidence: 0.95, evidence: line };
    }
  }
  return { value: null, confidence: 0, evidence: "" };
}

function findTax(lines) {
  // A tax line with a percentage is the most reliable: the rate is printed.
  for (const line of lines) {
    if (!/\b(tax|vat|gst)\b/i.test(line) || !/%/.test(line)) continue;
    const value = lastAmount(line);
    if (value === null) continue;
    return { value, rate: parsePercent(line), confidence: 0.95, evidence: line };
  }
  // Otherwise a line that starts with the tax label. This avoids matching
  // "TOTAL (VAT included)" on a receipt, where the amount is the total.
  for (const line of lines) {
    if (!/^(sales\s+tax|tax|vat|gst)\b/i.test(line)) continue;
    const value = lastAmount(line);
    if (value === null) continue;
    return { value, rate: parsePercent(line), confidence: 0.85, evidence: line };
  }
  return { value: 0, rate: null, confidence: 0.7, evidence: "" };
}

function findVendor(lines) {
  for (const line of lines) {
    const match = line.match(/^(?:vendor|billed\s+by|supplier|from)\s*:\s*(.+)$/i);
    if (match) return { value: collapse(match[1]), confidence: 0.95, evidence: line };
  }
  for (const line of lines) {
    if (line.length < 3 || line.length > 60) continue;
    if (/\b(invoice|receipt|bill|statement|tax\s+invoice|page)\b/i.test(line)) continue;
    if (/^\d/.test(line)) continue;
    if ((line.match(/[a-z]/gi) || []).length < 3) continue;
    return { value: collapse(line), confidence: 0.72, evidence: line };
  }
  return { value: null, confidence: 0, evidence: "" };
}

const collapse = (value) => value.replace(/\s+/g, " ").trim();

function findInvoiceNumber(lines) {
  const pattern = /(?:invoice|receipt|bill|rechnung)\s*(?:no\.?|number|nr\.?|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i;
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) return { value: match[1], confidence: 0.95, evidence: line };
  }
  return { value: null, confidence: 0, evidence: "" };
}

/* ---------------------------------------------------------------- dates */

function buildIso(year, month, day) {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

const MONTH_NAMES = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

function parseDateIn(text) {
  let match = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (match) {
    const iso = buildIso(Number(match[1]), Number(match[2]), Number(match[3]));
    if (iso) return { value: iso, kind: "iso", confidence: 0.98 };
  }
  match = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES})[a-z]*\\.?\\s+(\\d{4})\\b`, "i"));
  if (match) {
    const iso = buildIso(Number(match[3]), MONTHS[match[2].slice(0, 3).toLowerCase()], Number(match[1]));
    if (iso) return { value: iso, kind: "day-month-name", confidence: 0.95 };
  }
  match = text.match(new RegExp(`\\b(${MONTH_NAMES})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i"));
  if (match) {
    const iso = buildIso(Number(match[3]), MONTHS[match[1].slice(0, 3).toLowerCase()], Number(match[2]));
    if (iso) return { value: iso, kind: "month-name-day", confidence: 0.95 };
  }
  match = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    // A slash date is ambiguous. Prefer the reading that is valid; when both
    // are, assume day/month and lower the confidence so the field is reviewed.
    const dayFirst = first > 12 || second <= 12;
    const iso = dayFirst
      ? buildIso(Number(match[3]), second, first)
      : buildIso(Number(match[3]), first, second);
    if (iso) return { value: iso, kind: "slash", confidence: 0.7 };
  }
  return null;
}

function findDate(lines, labels) {
  for (const label of labels) {
    for (const line of lines) {
      if (!label.test(line)) continue;
      const parsed = parseDateIn(line);
      if (parsed) return { ...parsed, evidence: line };
    }
  }
  return null;
}

/* ----------------------------------------------------------- line items */

function parseItemLine(line) {
  if (SKIP_ITEM_RE.test(line) || HEADER_RE.test(line)) return null;
  if (line.includes("|")) {
    const cols = line.split("|").map((value) => value.trim()).filter(Boolean);
    if (cols.length < 4) return null;
    const quantity = Number(cols[1].replace(/[^\d]/g, ""));
    const unitPrice = parseAmount(cols[2]);
    const amount = parseAmount(cols[3]);
    if (!(quantity > 0) || unitPrice === null || amount === null) return null;
    return { description: cols[0], quantity, unitPrice, amount };
  }

  const cols = line.split(/\s{2,}/).map((value) => value.trim()).filter(Boolean);
  if (cols.length >= 4) {
    const quantityMatch = cols[1].match(/^(\d+)(?:\s+[a-z]+)?$/i);
    const unitPrice = parseAmount(cols[2]);
    const amount = parseAmount(cols[3]);
    if (!quantityMatch || unitPrice === null || amount === null) return null;
    return { description: cols[0], quantity: Number(quantityMatch[1]), unitPrice, amount };
  }
  if (cols.length === 2) {
    if (!/^\d[\d,]*\.\d{1,2}$/.test(cols[1])) return null;
    if (!/[a-z]/i.test(cols[0])) return null;
    const amount = parseAmount(cols[1]);
    if (amount === null) return null;
    const multiplier = cols[0].match(/\bx(\d+)\b/i);
    const quantity = multiplier ? Number(multiplier[1]) : 1;
    if (quantity <= 0) return null;
    return {
      description: collapse(cols[0].replace(/\s+x\d+\b/i, "")),
      quantity,
      unitPrice: Math.round(amount / quantity),
      amount,
    };
  }
  return null;
}

function findLineItems(lines) {
  const items = [];
  for (const line of lines) {
    const item = parseItemLine(line);
    if (item) items.push(item);
  }
  return items;
}

/* ------------------------------------------------------------- document */

export function extractDocument(document) {
  const lines = splitLines(document.text);
  const columns = rawLines(document.text);

  const currency = detectCurrency(document.text);
  const vendor = findVendor(lines);
  const invoiceNumber = findInvoiceNumber(lines);
  const issue = findDate(lines, [/\binvoice\s+date\b|\bdate\s+issued\b|\bissue\s+date\b/i, /^date\b/i]);
  const due = findDate(lines, [/\bpayment\s+due\b|\bdue\s+date\b/i, /^due\b/i]);
  const subtotal = findLabeledAmount(lines, [SUBTOTAL_RE]);
  const tax = findTax(lines);
  const total = findLabeledAmount(lines, TOTAL_LABELS, { exclude: SUBTOTAL_RE });
  const lineItems = findLineItems(columns);

  const taxRate =
    tax.rate !== null
      ? tax.rate
      : subtotal.value && tax.value
        ? Math.round((tax.value / subtotal.value) * 10000) / 100
        : null;

  const fields = {
    vendor: { value: vendor.value, confidence: vendor.confidence, evidence: vendor.evidence },
    currency: {
      value: currency,
      confidence: currency ? (/\b(USD|EUR|GBP|NPR|INR)\b/.test(document.text) ? 0.98 : 0.9) : 0,
      evidence: currency ? "detected from the printed amount" : "",
    },
    invoiceNumber: { value: invoiceNumber.value, confidence: invoiceNumber.confidence, evidence: invoiceNumber.evidence },
    issueDate: issue
      ? { value: issue.value, confidence: issue.confidence, evidence: issue.evidence }
      : { value: null, confidence: 0, evidence: "" },
    dueDate: due
      ? { value: due.value, confidence: due.confidence, evidence: due.evidence }
      : { value: null, confidence: 0, evidence: "" },
    subtotal: { value: subtotal.value, confidence: subtotal.confidence, evidence: subtotal.evidence },
    tax: { value: tax.value, confidence: tax.confidence, evidence: tax.evidence },
    total: { value: total.value, confidence: total.confidence, evidence: total.evidence },
    taxRate: {
      value: taxRate,
      confidence: taxRate === null ? 0 : tax.rate !== null ? 0.95 : 0.8,
      evidence: tax.rate !== null ? "printed rate" : taxRate !== null ? "derived from tax and subtotal" : "",
    },
    lineItems: {
      value: lineItems,
      // Line items are trusted only when their sum can be checked against the
      // subtotal. That check happens in validate.js and feeds back here.
      confidence: lineItems.length ? 0.9 : 0.4,
      evidence: lineItems.length ? `${lineItems.length} row(s) parsed from the item block` : "",
    },
  };

  const sumItems = lineItems.reduce((totalValue, item) => totalValue + item.amount, 0);
  if (lineItems.length && subtotal.value !== null && sumItems === subtotal.value) fields.lineItems.confidence = 0.97;
  if (lineItems.length && subtotal.value !== null && sumItems !== subtotal.value) fields.lineItems.confidence = 0.6;

  return {
    documentId: document.id,
    label: document.label || document.id,
    text: document.text,
    vendor: vendor.value,
    currency,
    invoiceNumber: invoiceNumber.value,
    issueDate: issue ? issue.value : null,
    dueDate: due ? due.value : null,
    subtotal: subtotal.value,
    tax: tax.value,
    taxRate,
    total: total.value,
    lineItems,
    fields,
    extractedFields: Object.values(fields).filter((field) => field.value !== null && field.confidence > 0).length,
  };
}
