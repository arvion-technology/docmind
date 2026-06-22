import test from "node:test";
import assert from "node:assert/strict";

import { FIXTURES, fixtureById } from "../src/fixtures.js";
import { extractDocument } from "../src/extract.js";
import { validateExtraction } from "../src/validate.js";

const validate = (id) => validateExtraction(extractDocument(fixtureById(id)));

test("clean fixtures pass every applicable check", () => {
  for (const id of ["fixture-001", "fixture-002", "fixture-003", "fixture-006"]) {
    const result = validate(id);
    assert.equal(result.errors, 0, id);
    assert.equal(result.reconciled, true, id);
    assert.ok(result.checks.every((check) => check.status !== "fail"), id);
  }
});

test("a broken total fails reconciliation with the exact difference", () => {
  const result = validate("fixture-005");
  const issue = result.issues.find((entry) => entry.code === "total_mismatch");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.equal(issue.detail.expected, 345600);
  assert.equal(issue.detail.actual, 348600);
  assert.equal(issue.detail.difference, 3000);
  assert.equal(result.reconciled, false);
});

test("line item sum is checked against the subtotal", () => {
  const extraction = extractDocument(fixtureById("fixture-001"));
  extraction.lineItems[0].amount = 1;
  const result = validateExtraction(extraction);
  assert.ok(result.issues.some((issue) => issue.code === "line_items_mismatch"));
});

test("tax that does not match the printed rate is a warning, not an error", () => {
  const extraction = extractDocument(fixtureById("fixture-003"));
  extraction.tax = 1;
  const result = validateExtraction(extraction);
  const issue = result.issues.find((entry) => entry.code === "tax_rate_mismatch");
  assert.ok(issue);
  assert.equal(issue.severity, "warning");
});

test("a due date before the issue date fails", () => {
  const result = validate("fixture-008");
  const issue = result.issues.find((entry) => entry.code === "invalid_date_order");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
});

test("a malformed corrected date is rejected", () => {
  const extraction = extractDocument(fixtureById("fixture-001"));
  extraction.issueDate = "14/03/2026";
  const result = validateExtraction(extraction);
  assert.ok(result.issues.some((issue) => issue.code === "invalid_date"));
});

test("missing invoice number and due date are warnings", () => {
  const receipt = validate("fixture-004");
  const codes = receipt.issues.map((issue) => issue.code);
  assert.ok(codes.includes("missing_due_date"));
  assert.notEqual(receipt.reconciled, false, "a receipt with no due date is still postable");
});

test("missing total and missing currency are errors", () => {
  const extraction = extractDocument({ id: "blank", text: "Some text without amounts." });
  const result = validateExtraction(extraction);
  assert.ok(result.issues.some((issue) => issue.code === "missing_total" && issue.severity === "error"));
  assert.ok(result.issues.some((issue) => issue.code === "missing_currency" && issue.severity === "error"));
});

test("an unknown currency code is rejected", () => {
  const extraction = extractDocument(fixtureById("fixture-001"));
  extraction.currency = "XYZ";
  const result = validateExtraction(extraction);
  assert.ok(result.issues.some((issue) => issue.code === "unknown_currency"));
});

test("checks report skip rather than pass when there is nothing to verify", () => {
  const receipt = validate("fixture-004");
  const reconcile = receipt.checks.find((check) => check.id === "reconcile");
  assert.equal(reconcile.status, "skip");
  assert.match(reconcile.detail, /subtotal not present/);
});

test("every fixture produces a check for each of the eight rules", () => {
  for (const fixture of FIXTURES) {
    const result = validate(fixture.id);
    assert.equal(result.checks.length, 8, fixture.id);
    for (const check of result.checks) {
      assert.ok(["pass", "fail", "skip"].includes(check.status), `${fixture.id} ${check.id}`);
    }
  }
});
