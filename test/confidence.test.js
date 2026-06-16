import test from "node:test";
import assert from "node:assert/strict";

import { FIXTURES, fixtureById } from "../src/fixtures.js";
import { processDocument } from "../src/pipeline.js";
import { REVIEW_THRESHOLD, confidenceLabel, scoreExtraction } from "../src/confidence.js";
import { validateExtraction } from "../src/validate.js";
import { extractDocument } from "../src/extract.js";

const processed = (id) => processDocument(fixtureById(id));

test("clean documents are ready without review", () => {
  for (const id of ["fixture-001", "fixture-003", "fixture-006"]) {
    const extraction = processed(id);
    assert.equal(extraction.needsReview, false, id);
    assert.ok(extraction.overall >= REVIEW_THRESHOLD, id);
    assert.deepEqual(extraction.lowFields, [], id);
  }
});

test("a reconciliation failure lowers the total, not the vendor", () => {
  const extraction = processed("fixture-005");
  assert.equal(extraction.needsReview, true);
  assert.ok(extraction.fields.total.adjusted < extraction.fields.total.confidence);
  assert.equal(extraction.fields.vendor.adjusted, extraction.fields.vendor.confidence);
  assert.match(extraction.reviewReason, /validation error/);
});

test("a missing subtotal drags the document score down even without errors", () => {
  const extraction = processed("fixture-004");
  assert.equal(extraction.reconciled, true);
  assert.equal(extraction.needsReview, true);
  assert.ok(extraction.lowFields.some((field) => field.name === "subtotal"));
});

test("low confidence appears in the field list with a name", () => {
  const extraction = processed("fixture-004");
  assert.ok(extraction.lowFields.every((field) => typeof field.name === "string" && field.confidence < REVIEW_THRESHOLD));
});

test("overall confidence is weighted by field importance", () => {
  const extraction = extractDocument(fixtureById("fixture-001"));
  const withIssues = scoreExtraction(extraction, [
    { code: "total_mismatch", field: "total", severity: "error" },
  ]);
  const clean = scoreExtraction(extraction, []);
  assert.ok(withIssues.overall < clean.overall);
  assert.ok(withIssues.fields.total.adjusted < clean.fields.total.adjusted);
});

test("confidence labels map to the thresholds the UI uses", () => {
  assert.equal(confidenceLabel(0.99), "high");
  assert.equal(confidenceLabel(0.85), "good");
  assert.equal(confidenceLabel(0.7), "check");
  assert.equal(confidenceLabel(0.2), "low");
});

test("extraction without validation still scores the printed fields", () => {
  const extraction = extractDocument(fixtureById("fixture-002"));
  const assessment = scoreExtraction(extraction, []);
  assert.ok(assessment.overall > 0.9);
  assert.equal(assessment.needsReview, false);
});

test("every fixture carries a confidence and a review decision", () => {
  for (const fixture of FIXTURES) {
    const extraction = processDocument(fixture);
    assert.equal(typeof extraction.overall, "number");
    assert.ok(extraction.overall >= 0 && extraction.overall <= 1, fixture.id);
    assert.equal(typeof extraction.needsReview, "boolean");
    assert.equal(extraction.issues.length, extraction.issues.length); // issues array present
    assert.ok(Array.isArray(extraction.checks));
  }
});

test("a document with an error is never marked ready", () => {
  for (const fixture of FIXTURES) {
    const extraction = processDocument(fixture);
    const errors = extraction.issues.filter((issue) => issue.severity === "error");
    if (errors.length) assert.equal(extraction.needsReview, true, fixture.id);
  }
});

test("validation issues and confidence come from the same pipeline pass", () => {
  const extraction = extractDocument(fixtureById("fixture-005"));
  const validation = validateExtraction(extraction);
  const assessment = scoreExtraction(extraction, validation.issues);
  assert.equal(assessment.needsReview, true);
  assert.ok(assessment.fields.total.adjusted < 0.8);
});
