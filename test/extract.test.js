import test from "node:test";
import assert from "node:assert/strict";

import { FIXTURES } from "../src/fixtures.js";
import { parseAmount, detectCurrency, amountsIn, taxFor } from "../src/money.js";
import { extractDocument } from "../src/extract.js";

test("money parses to integer minor units", () => {
  assert.equal(parseAmount("$2,592.00"), 259200);
  assert.equal(parseAmount("Rs. 10,000.00"), 1000000);
  assert.equal(parseAmount("1,500.00 EUR"), 150000);
  assert.equal(parseAmount("0.00"), 0);
  assert.equal(parseAmount("no digits"), null);
});

test("amountsIn requires a decimal point", () => {
  assert.equal(amountsIn("1420 Harbor Street, Portland OR 97209").length, 0);
  assert.equal(amountsIn("Total: $1,290.00").length, 1);
});

test("currency detection prefers ISO codes over symbols", () => {
  assert.equal(detectCurrency("Total: 1,500.00 EUR"), "EUR");
  assert.equal(detectCurrency("Total: £14.80"), "GBP");
  assert.equal(detectCurrency("Total: Rs. 11,300.00"), "NPR");
  assert.equal(detectCurrency("Total: $2,592.00"), "USD");
  assert.equal(detectCurrency("Total: 12.00"), null);
});

test("tax rounding happens once, in integer space", () => {
  assert.equal(taxFor(240000, 8), 19200);
  assert.equal(taxFor(3420000, 13), 444600);
  assert.equal(taxFor(120000, 7.5), 9000);
  assert.equal(taxFor(1000, 7.5), 75);
});

test("every fixture extracts the expected headline fields", () => {
  for (const fixture of FIXTURES) {
    const extraction = extractDocument(fixture);
    const expected = fixture.expected;
    for (const key of ["vendor", "currency", "invoiceNumber", "issueDate", "dueDate", "subtotal", "tax", "total"]) {
      if (expected[key] !== undefined) {
        assert.equal(extraction[key], expected[key], `${fixture.id} ${key}`);
      }
    }
    assert.equal(extraction.lineItems.length, expected.lineItems, `${fixture.id} line items`);
  }
});

test("every fixture reports the printed tax rate", () => {
  const rates = {
    "fixture-001": 8,
    "fixture-002": 0,
    "fixture-003": 13,
    "fixture-004": 20,
    "fixture-005": 8,
    "fixture-006": 7.5,
    "fixture-008": 13,
  };
  for (const fixture of FIXTURES) {
    const extraction = extractDocument(fixture);
    if (rates[fixture.id] !== undefined) assert.equal(extraction.taxRate, rates[fixture.id], fixture.id);
  }
});

test("ambiguous slash dates are parsed day-first and marked lower confidence", () => {
  const extraction = extractDocument(FIXTURES.find((fixture) => fixture.id === "fixture-005"));
  assert.equal(extraction.issueDate, "2026-03-05");
  assert.equal(extraction.dueDate, "2026-04-04");
  assert.equal(extraction.fields.issueDate.confidence, 0.7);
});

test("named-month dates parse without ambiguity", () => {
  const extraction = extractDocument(FIXTURES.find((fixture) => fixture.id === "fixture-002"));
  assert.equal(extraction.issueDate, "2026-02-03");
  assert.equal(extraction.fields.issueDate.confidence, 0.95);
});

test("line items handle whitespace columns, pipe tables and receipt lines", () => {
  const invoice = extractDocument(FIXTURES[0]);
  assert.deepEqual(invoice.lineItems[0], {
    description: "Brand identity",
    quantity: 1,
    unitPrice: 180000,
    amount: 180000,
  });

  const pipe = extractDocument(FIXTURES.find((fixture) => fixture.id === "fixture-006"));
  assert.equal(pipe.lineItems.length, 2);
  assert.equal(pipe.lineItems[0].quantity, 3);
  assert.equal(pipe.lineItems[0].amount, 90000);

  const receipt = extractDocument(FIXTURES.find((fixture) => fixture.id === "fixture-004"));
  const coffee = receipt.lineItems.find((item) => /flat white/i.test(item.description));
  assert.equal(coffee.quantity, 2);
  assert.equal(coffee.amount, 720);
});

test("receipt tax is not taken from the total line", () => {
  const receipt = extractDocument(FIXTURES.find((fixture) => fixture.id === "fixture-004"));
  assert.equal(receipt.tax, 247);
  assert.equal(receipt.total, 1480);
  assert.equal(receipt.subtotal, null);
});

test("vendor falls back to the first plausible line when unlabelled", () => {
  const receipt = extractDocument(FIXTURES.find((fixture) => fixture.id === "fixture-004"));
  assert.equal(receipt.vendor, "CORNER BAKERY");
  assert.equal(receipt.fields.vendor.confidence, 0.72);
});

test("a missing invoice number stays null instead of being guessed", () => {
  const extraction = extractDocument(FIXTURES.find((fixture) => fixture.id === "fixture-008"));
  assert.equal(extraction.invoiceNumber, null);
  assert.equal(extraction.fields.invoiceNumber.confidence, 0);
});

test("an empty document extracts nothing but does not throw", () => {
  const extraction = extractDocument({ id: "empty", text: "" });
  assert.equal(extraction.vendor, null);
  assert.equal(extraction.total, null);
  assert.deepEqual(extraction.lineItems, []);
});
