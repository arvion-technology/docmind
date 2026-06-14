// Review queue state.
//
// An entry moves review → confirmed → exported. Corrections are applied to the
// extraction and the whole validation runs again, so fixing a total can clear a
// reconciliation error instead of leaving the red badge on screen. Exported
// entries are immutable: an export is a record of what was signed off.

import { isCurrencyCode, parseAmount } from "./money.js";
import { finalizeExtraction, processDocument } from "./pipeline.js";

export const STATUS = {
  review: "review",
  ready: "ready",
  confirmed: "confirmed",
  exported: "exported",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_FIELDS = new Set(["subtotal", "tax", "total"]);

export function coerceField(field, raw) {
  const value = typeof raw === "string" ? raw.trim() : raw;
  if (value === "" || value === null || value === undefined) return null;
  if (MONEY_FIELDS.has(field)) return parseAmount(value);
  if (field === "taxRate") {
    const rate = Number(String(value).replace("%", ""));
    return Number.isFinite(rate) ? rate : null;
  }
  if (field === "currency") {
    const code = String(value).toUpperCase();
    return isCurrencyCode(code) ? code : String(value);
  }
  if (field === "issueDate" || field === "dueDate") return String(value);
  return String(value);
}

export function createEntry(document) {
  const extraction = processDocument(document);
  return {
    id: extraction.documentId,
    label: extraction.label,
    extraction,
    status: extraction.needsReview ? STATUS.review : STATUS.ready,
    corrections: {},
    reviewer: null,
    confirmedAt: null,
  };
}

export function createQueue(documents) {
  return documents.map(createEntry);
}

/** Correct some fields, then validate the corrected document from scratch. */
export function applyCorrections(entry, corrections, { reviewer = "demo", at = null } = {}) {
  if (entry.status === STATUS.exported) throw new Error("an exported entry cannot be edited");
  const merged = { ...entry.extraction, fields: { ...entry.extraction.fields } };
  const applied = {};

  for (const [field, raw] of Object.entries(corrections || {})) {
    if (!(field in merged.fields)) continue;
    const value = coerceField(field, raw);
    merged[field] = value;
    merged.fields[field] = {
      ...merged.fields[field],
      value,
      confidence: 1,
      adjusted: 1,
      corrected: true,
      evidence: "human correction",
    };
    applied[field] = value;
  }

  const extraction = finalizeExtraction(merged);
  return {
    ...entry,
    extraction,
    corrections: { ...entry.corrections, ...applied },
    status: STATUS.confirmed,
    reviewer,
    confirmedAt: at,
  };
}

export function confirmEntry(entry, options = {}) {
  return applyCorrections(entry, {}, options);
}

export function markExported(entry, { at = null } = {}) {
  if (entry.status !== STATUS.confirmed) {
    throw new Error("only a confirmed entry can be exported");
  }
  return { ...entry, status: STATUS.exported, exportedAt: at };
}

export function exportEntry(entry) {
  const extraction = entry.extraction;
  return {
    schema: "docmind.extraction/1",
    documentId: extraction.documentId,
    label: extraction.label,
    reviewed: entry.status === STATUS.exported || entry.status === STATUS.confirmed,
    reviewer: entry.reviewer,
    confirmedAt: entry.confirmedAt,
    vendor: extraction.vendor,
    currency: extraction.currency,
    invoiceNumber: extraction.invoiceNumber,
    issueDate: extraction.issueDate,
    dueDate: extraction.dueDate,
    amounts: {
      currency: extraction.currency,
      subtotalMinor: extraction.subtotal,
      taxMinor: extraction.tax,
      totalMinor: extraction.total,
      taxRate: extraction.taxRate,
    },
    lineItems: extraction.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: item.unitPrice,
      amountMinor: item.amount,
    })),
    confidence: {
      overall: extraction.overall,
      fields: Object.fromEntries(
        Object.entries(extraction.fields).map(([name, field]) => [name, { value: field.value, confidence: field.adjusted }]),
      ),
    },
    corrections: entry.corrections,
    issues: extraction.issues,
  };
}

export function queueSummary(entries) {
  const counts = { review: 0, ready: 0, confirmed: 0, exported: 0 };
  for (const entry of entries) counts[entry.status] = (counts[entry.status] || 0) + 1;
  const reviewed = entries.filter((entry) => entry.status === STATUS.confirmed || entry.status === STATUS.exported);
  const average = reviewed.length
    ? reviewed.reduce((sum, entry) => sum + entry.extraction.overall, 0) / reviewed.length
    : entries.reduce((sum, entry) => sum + entry.extraction.overall, 0) / (entries.length || 1);
  return {
    total: entries.length,
    ...counts,
    averageConfidence: Math.round(average * 1000) / 1000,
    openErrors: entries.reduce((sum, entry) => sum + entry.extraction.issues.filter((issue) => issue.severity === "error").length, 0),
  };
}
