// Validation rules for an extraction.
//
// These are the checks a finance reviewer would perform by hand: do the totals
// add up, does the tax rate match the tax amount, are the dates in order, do the
// line items sum to the subtotal. Each check returns pass, fail or skip, so the
// review screen can show what was verified as well as what failed, "no checks
// failed because there was nothing to check" is not the same as "verified".

import { SUPPORTED, taxFor } from "./money.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function check(id, label, status, detail) {
  return { id, label, status, detail };
}

export function validateExtraction(extraction) {
  const issues = [];
  const checks = [];
  const fail = (code, field, severity, message, detail = null) => {
    issues.push({ code, field, severity, message, detail });
  };

  // Currency ---------------------------------------------------------------
  if (!extraction.currency) {
    fail("missing_currency", "currency", "error", "No currency could be detected from the document.");
    checks.push(check("currency", "Currency is a known ISO code", "fail", "not detected"));
  } else if (!SUPPORTED.includes(extraction.currency)) {
    fail("unknown_currency", "currency", "error", `Currency ${extraction.currency} is not supported.`);
    checks.push(check("currency", "Currency is a known ISO code", "fail", extraction.currency));
  } else {
    checks.push(check("currency", "Currency is a known ISO code", "pass", extraction.currency));
  }

  // Total ------------------------------------------------------------------
  if (extraction.total === null) {
    fail("missing_total", "total", "error", "No total was found. The document cannot be posted without one.");
    checks.push(check("total", "Total is present", "fail", "not found"));
  } else {
    checks.push(check("total", "Total is present", "pass", "found"));
  }

  // Reconciliation ---------------------------------------------------------
  if (extraction.total !== null && extraction.subtotal !== null) {
    const expected = extraction.subtotal + (extraction.tax ?? 0);
    const difference = extraction.total - expected;
    if (difference !== 0) {
      fail(
        "total_mismatch",
        "total",
        "error",
        "Subtotal plus tax does not equal the printed total.",
        { expected, actual: extraction.total, difference },
      );
      checks.push(check("reconcile", "Subtotal + tax = total", "fail", `off by ${difference} minor units`));
    } else {
      checks.push(check("reconcile", "Subtotal + tax = total", "pass", "exact"));
    }
  } else {
    checks.push(check("reconcile", "Subtotal + tax = total", "skip", "subtotal not present"));
  }

  // Line items -------------------------------------------------------------
  if (extraction.lineItems.length && extraction.subtotal !== null) {
    const sum = extraction.lineItems.reduce((value, item) => value + item.amount, 0);
    if (sum !== extraction.subtotal) {
      fail("line_items_mismatch", "lineItems", "warning", "Line items do not sum to the subtotal.", {
        expected: extraction.subtotal,
        actual: sum,
        difference: sum - extraction.subtotal,
      });
      checks.push(check("line-items", "Line items sum to subtotal", "fail", `off by ${sum - extraction.subtotal} minor units`));
    } else {
      checks.push(check("line-items", "Line items sum to subtotal", "pass", `${extraction.lineItems.length} rows`));
    }
  } else {
    checks.push(check("line-items", "Line items sum to subtotal", "skip", extraction.lineItems.length ? "no subtotal" : "no rows"));
  }

  // Per-item math ----------------------------------------------------------
  const badItem = extraction.lineItems.find((item) => Math.abs(item.quantity * item.unitPrice - item.amount) > 1);
  if (badItem) {
    fail("line_item_math", "lineItems", "warning", "A line item's quantity times unit price does not match its amount.", {
      description: badItem.description,
    });
    checks.push(check("item-math", "Quantity × unit price = amount", "fail", badItem.description));
  } else if (extraction.lineItems.length) {
    checks.push(check("item-math", "Quantity × unit price = amount", "pass", `${extraction.lineItems.length} rows`));
  } else {
    checks.push(check("item-math", "Quantity × unit price = amount", "skip", "no rows"));
  }

  // Tax rate ---------------------------------------------------------------
  if (extraction.subtotal !== null && extraction.tax !== null && extraction.taxRate !== null) {
    const expected = taxFor(extraction.subtotal, extraction.taxRate);
    if (expected !== null && Math.abs(expected - extraction.tax) > 1) {
      fail("tax_rate_mismatch", "tax", "warning", "The tax amount does not match the printed rate.", {
        expected,
        actual: extraction.tax,
        rate: extraction.taxRate,
      });
      checks.push(check("tax-rate", "Tax matches the printed rate", "fail", `${extraction.taxRate}%`));
    } else {
      checks.push(check("tax-rate", "Tax matches the printed rate", "pass", `${extraction.taxRate}%`));
    }
  } else {
    checks.push(check("tax-rate", "Tax matches the printed rate", "skip", "rate or amounts not present"));
  }

  // Dates ------------------------------------------------------------------
  const dateIssues = [];
  for (const field of ["issueDate", "dueDate"]) {
    const value = extraction[field];
    if (value !== null && !ISO_DATE.test(value)) dateIssues.push(`${field} is not an ISO date`);
  }
  if (extraction.issueDate && extraction.dueDate && ISO_DATE.test(extraction.issueDate) && ISO_DATE.test(extraction.dueDate)) {
    if (extraction.dueDate < extraction.issueDate) dateIssues.push("due date is before the issue date");
  }
  if (dateIssues.length) {
    const invalidOrder = extraction.issueDate && extraction.dueDate && extraction.dueDate < extraction.issueDate;
    fail(
      invalidOrder ? "invalid_date_order" : "invalid_date",
      invalidOrder ? "dueDate" : "issueDate",
      "error",
      invalidOrder ? "The due date is before the issue date." : "A date is not a valid ISO date.",
    );
    checks.push(check("dates", "Dates are valid and ordered", "fail", dateIssues.join("; ")));
  } else if (extraction.issueDate && extraction.dueDate) {
    checks.push(check("dates", "Dates are valid and ordered", "pass", `${extraction.issueDate} → ${extraction.dueDate}`));
  } else {
    checks.push(check("dates", "Dates are valid and ordered", "skip", "one or both dates missing"));
  }

  // Presence warnings ------------------------------------------------------
  if (!extraction.invoiceNumber) {
    fail("missing_invoice_number", "invoiceNumber", "warning", "No invoice or receipt number was found.");
    checks.push(check("invoice-number", "Invoice number is present", "fail", "not found"));
  } else {
    checks.push(check("invoice-number", "Invoice number is present", "pass", extraction.invoiceNumber));
  }
  if (!extraction.dueDate) {
    fail("missing_due_date", "dueDate", "warning", "No due date was found.");
  }

  return {
    issues,
    checks,
    reconciled: issues.every((issue) => issue.severity !== "error"),
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    errors: issues.filter((issue) => issue.severity === "error").length,
  };
}
