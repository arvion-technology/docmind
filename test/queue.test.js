import test from "node:test";
import assert from "node:assert/strict";

import { FIXTURES, fixtureById } from "../src/fixtures.js";
import {
  STATUS,
  applyCorrections,
  coerceField,
  confirmEntry,
  createEntry,
  createQueue,
  exportEntry,
  markExported,
  queueSummary,
} from "../src/queue.js";

const entry = (id) => createEntry(fixtureById(id));

test("the queue classifies fixtures into review and ready", () => {
  const queue = createQueue(FIXTURES);
  assert.equal(queue.length, 8);
  const statuses = queue.map((item) => item.status);
  assert.equal(statuses.filter((status) => status === STATUS.ready).length, 4);
  assert.equal(statuses.filter((status) => status === STATUS.review).length, 4);
});

test("correcting the total clears the reconciliation error", () => {
  const before = entry("fixture-005");
  assert.equal(before.extraction.reconciled, false);
  const after = applyCorrections(before, { total: "3,456.00" });
  assert.equal(after.status, STATUS.confirmed);
  assert.equal(after.extraction.total, 345600);
  assert.equal(after.extraction.reconciled, true);
  assert.equal(after.extraction.fields.total.corrected, true);
  assert.equal(after.extraction.fields.total.adjusted, 1);
  assert.deepEqual(after.corrections, { total: 345600 });
});

test("correcting the due date fixes the date order error", () => {
  const after = applyCorrections(entry("fixture-008"), { dueDate: "2026-04-24", invoiceNumber: "SD-1002" });
  assert.equal(after.extraction.dueDate, "2026-04-24");
  assert.equal(after.extraction.reconciled, true);
  assert.ok(!after.extraction.issues.some((issue) => issue.code === "invalid_date_order"));
  assert.ok(!after.extraction.issues.some((issue) => issue.code === "missing_invoice_number"));
});

test("corrections re-run validation instead of trusting the edit", () => {
  const after = applyCorrections(entry("fixture-001"), { total: "1.00" });
  assert.equal(after.extraction.total, 100);
  assert.ok(after.extraction.issues.some((issue) => issue.code === "total_mismatch"));
  assert.equal(after.extraction.reconciled, false);
});

test("confirming without changes keeps the extraction and marks it reviewed", () => {
  const before = entry("fixture-001");
  const confirmed = confirmEntry(before, { reviewer: "sita", at: "2026-10-28T09:00:00Z" });
  assert.equal(confirmed.status, STATUS.confirmed);
  assert.equal(confirmed.reviewer, "sita");
  assert.equal(confirmed.extraction.total, before.extraction.total);
});

test("export requires confirmation", () => {
  assert.throws(() => markExported(entry("fixture-001")), /only a confirmed entry/i);
});

test("exported entries are immutable", () => {
  const exported = markExported(confirmEntry(entry("fixture-001")));
  assert.equal(exported.status, STATUS.exported);
  assert.throws(() => applyCorrections(exported, { total: "1.00" }), /cannot be edited/i);
});

test("export JSON carries minor units, confidence and issues", () => {
  const exported = markExported(confirmEntry(entry("fixture-003"), { reviewer: "demo" }));
  const payload = exportEntry(exported);
  assert.equal(payload.schema, "docmind.extraction/1");
  assert.equal(payload.reviewed, true);
  assert.equal(payload.amounts.subtotalMinor, 1000000);
  assert.equal(payload.amounts.taxMinor, 130000);
  assert.equal(payload.amounts.totalMinor, 1130000);
  assert.equal(payload.lineItems.length, 2);
  assert.equal(payload.lineItems[0].unitPriceMinor, 160);
  assert.equal(payload.confidence.fields.total.confidence, 0.95);
  assert.deepEqual(payload.issues, []);
});

test("queue summary counts statuses and open errors", () => {
  const queue = createQueue(FIXTURES);
  const summary = queueSummary(queue);
  assert.equal(summary.total, 8);
  assert.equal(summary.review, 4);
  assert.equal(summary.ready, 4);
  assert.equal(summary.openErrors, 2);
  assert.ok(summary.averageConfidence > 0.8);
});

test("corrections coerce money, rates, currency and dates", () => {
  assert.equal(coerceField("total", "$2,592.00"), 259200);
  assert.equal(coerceField("subtotal", "100"), 10000);
  assert.equal(coerceField("taxRate", "7.5%"), 7.5);
  assert.equal(coerceField("currency", "eur"), "EUR");
  assert.equal(coerceField("dueDate", "2026-05-01"), "2026-05-01");
  assert.equal(coerceField("total", ""), null);
});

test("unknown fields in a correction payload are ignored", () => {
  const after = applyCorrections(entry("fixture-001"), { taxRate: "10", notAField: "x" });
  assert.equal(after.corrections.taxRate, 10);
  assert.ok(!("notAField" in after.corrections));
});
