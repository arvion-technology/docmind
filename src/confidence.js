// Confidence scoring.
//
// Confidence is not "how sure the regex is", it is a per-field estimate that
// has to answer one question: would a human sign this off without looking? Three
// signals feed it: how the value was found (label vs heuristic), whether the
// cross-checks passed, and how the document hangs together. A failed
// reconciliation lowers the confidence of the total, not the vendor, because the
// failure says nothing about the vendor.

export const REVIEW_THRESHOLD = 0.8;

// Importance weights for the document-level score. A wrong total costs money; a
// wrong vendor costs a phone call.
const WEIGHTS = {
  total: 3,
  subtotal: 2,
  tax: 2,
  currency: 2,
  lineItems: 2,
  vendor: 1,
  invoiceNumber: 1,
  issueDate: 1,
  dueDate: 1,
};

// Issue code → fields it undermines, and by how much.
const PENALTIES = {
  total_mismatch: { total: 0.45, subtotal: 0.15, tax: 0.15 },
  missing_total: { total: 0.5 },
  missing_currency: { currency: 0.5 },
  unknown_currency: { currency: 0.5 },
  line_items_mismatch: { lineItems: 0.2 },
  line_item_math: { lineItems: 0.15 },
  tax_rate_mismatch: { tax: 0.2, taxRate: 0.3 },
  invalid_date_order: { dueDate: 0.5, issueDate: 0.2 },
  invalid_date: { issueDate: 0.5, dueDate: 0.5 },
  missing_invoice_number: { invoiceNumber: 0.2 },
  missing_due_date: { dueDate: 0.15 },
};

const round = (value) => Math.round(value * 1000) / 1000;

export function scoreExtraction(extraction, issues = []) {
  const fields = {};
  for (const [name, field] of Object.entries(extraction.fields)) {
    fields[name] = { ...field, adjusted: field.confidence, corrected: Boolean(field.corrected) };
  }
  for (const issue of issues) {
    const penalty = PENALTIES[issue.code];
    if (!penalty) continue;
    for (const [name, amount] of Object.entries(penalty)) {
      if (fields[name]) fields[name].adjusted = Math.max(0, round(fields[name].adjusted - amount));
    }
  }

  let weighted = 0;
  let weightTotal = 0;
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const field = fields[name];
    weighted += (field ? field.adjusted : 0) * weight;
    weightTotal += weight;
  }
  const overall = weightTotal ? round(weighted / weightTotal) : 0;

  // Missing fields are listed too: a null subtotal is not "confident", and the
  // reviewer needs to see which field is absent rather than a blank cell.
  const lowFields = Object.entries(fields)
    .filter(([, field]) => field.adjusted < REVIEW_THRESHOLD)
    .map(([name, field]) => ({ name, confidence: field.adjusted, value: field.value }));

  const errors = issues.filter((issue) => issue.severity === "error");
  const needsReview = errors.length > 0 || lowFields.length > 0 || overall < REVIEW_THRESHOLD;

  return {
    fields,
    overall,
    lowFields,
    needsReview,
    reviewReason: errors.length
      ? `${errors.length} validation error${errors.length === 1 ? "" : "s"}`
      : lowFields.length
        ? `${lowFields.length} field${lowFields.length === 1 ? "" : "s"} below ${REVIEW_THRESHOLD}`
        : "",
  };
}

export function confidenceLabel(value) {
  if (value >= 0.95) return "high";
  if (value >= REVIEW_THRESHOLD) return "good";
  if (value >= 0.6) return "check";
  return "low";
}
