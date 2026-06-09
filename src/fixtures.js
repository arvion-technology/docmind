// Eight synthetic documents used by the demo and the tests.
//
// The text is written the way invoices actually arrive by email: inconsistent
// spacing, labels on some lines and not others, amounts with mixed currency
// notation. That mess is the input the extractor has to survive. Every fixture
// carries the values a correct extraction should produce, in integer minor
// units, so the tests assert on money without floating-point comparisons.

export const FIXTURES = [
  {
    id: "fixture-001",
    label: "Northwind Studio · USD invoice",
    text: `NORTHWIND STUDIO LLC
1420 Harbor Street, Portland OR 97209
Vendor: Northwind Studio LLC

INVOICE #NW-2026-041
Invoice date: 2026-03-14
Payment due: 2026-04-13

Description                 Qty     Unit        Amount
Brand identity              1       1800.00     1800.00
Design system               1       450.00      450.00
Print production            2       75.00       150.00

Subtotal: $2,400.00
Tax (8%): $192.00
Total due: $2,592.00

Pay by bank transfer. Reference NW-2026-041.`,
    expected: {
      vendor: "Northwind Studio LLC",
      currency: "USD",
      invoiceNumber: "NW-2026-041",
      issueDate: "2026-03-14",
      dueDate: "2026-04-13",
      subtotal: 240000,
      tax: 19200,
      total: 259200,
      lineItems: 3,
    },
  },
  {
    id: "fixture-002",
    label: "Alpine Analytics · EUR reverse charge",
    text: `Alpine Analytics GmbH
Vendor: Alpine Analytics GmbH
VAT ID: DE811907980

Rechnung Nr. AA-8842
Invoice date: 03 February 2026
Due date: 05 March 2026

Services rendered
Data pipeline review        12 hours      125.00 EUR    1,500.00 EUR

Net amount: 1,500.00 EUR
VAT (0%): 0.00 EUR
Total: 1,500.00 EUR

Reverse charge: VAT to be accounted for by the recipient.`,
    expected: {
      vendor: "Alpine Analytics GmbH",
      currency: "EUR",
      invoiceNumber: "AA-8842",
      issueDate: "2026-02-03",
      dueDate: "2026-03-05",
      subtotal: 150000,
      tax: 0,
      total: 150000,
      lineItems: 1,
    },
  },
  {
    id: "fixture-003",
    label: "Kathmandu Print House · NPR invoice",
    text: `KATHMANDU PRINT HOUSE PVT. LTD.
Thamel, Kathmandu 44600, Nepal
Vendor: Kathmandu Print House Pvt. Ltd.

Bill No: KPH-2291
Date issued: 12 January 2026
Payment due: 26 January 2026

Item                        Qty     Rate        Amount
Offset printing 4-colour    5000    1.60        8000.00
Lamination                  5000    0.40        2000.00

Sub total: Rs. 10,000.00
VAT 13%: Rs. 1,300.00
Grand total: Rs. 11,300.00`,
    expected: {
      vendor: "Kathmandu Print House Pvt. Ltd.",
      currency: "NPR",
      invoiceNumber: "KPH-2291",
      issueDate: "2026-01-12",
      dueDate: "2026-01-26",
      subtotal: 1000000,
      tax: 130000,
      total: 1130000,
      lineItems: 2,
    },
  },
  {
    id: "fixture-004",
    label: "Corner Bakery · GBP receipt",
    text: `CORNER BAKERY
18 Market Lane, Bristol BS1 4QA
Receipt No: CB-0917
Date: 09/06/2026 14:42

Sourdough loaf                      4.50
Flat white x2                       7.20
Almond croissant                    3.10
TOTAL (VAT included): £14.80
VAT 20% included: £2.47
Cash: £20.00
Change: £5.20

Thank you. VAT No. GB 987 6543 21`,
    expected: {
      vendor: "CORNER BAKERY",
      currency: "GBP",
      invoiceNumber: "CB-0917",
      issueDate: "2026-06-09",
      dueDate: null,
      subtotal: null,
      tax: 247,
      total: 1480,
      lineItems: 3,
    },
  },
  {
    id: "fixture-005",
    label: "Blue Yonder Consulting · totals do not reconcile",
    text: `Blue Yonder Consulting
Vendor: Blue Yonder Consulting

Invoice No: BYC-7701
Invoice date: 05/03/2026
Payment due: 04/04/2026

Workshop facilitation       2 days      1600.00    3,200.00 USD

Subtotal: 3,200.00 USD
Tax (8%): 256.00 USD
Total due: 3,486.00 USD`,
    expected: {
      vendor: "Blue Yonder Consulting",
      currency: "USD",
      invoiceNumber: "BYC-7701",
      issueDate: "2026-03-05",
      dueDate: "2026-04-04",
      subtotal: 320000,
      tax: 25600,
      total: 348600,
      lineItems: 1,
      brokenReconciliation: true,
    },
  },
  {
    id: "fixture-006",
    label: "Hearth & Home · pipe-separated line items",
    text: `Hearth & Home Interiors
Vendor: Hearth & Home Interiors

Invoice number: HH-3308
Issue date: 2026-05-02
Due date: 2026-06-01

Description | Qty | Unit price | Amount
Oak shelving | 3 | 300.00 | 900.00
Installation | 1 | 300.00 | 300.00

Subtotal $1,200.00
Sales tax 7.5% $90.00
Amount due $1,290.00`,
    expected: {
      vendor: "Hearth & Home Interiors",
      currency: "USD",
      invoiceNumber: "HH-3308",
      issueDate: "2026-05-02",
      dueDate: "2026-06-01",
      subtotal: 120000,
      tax: 9000,
      total: 129000,
      lineItems: 2,
    },
  },
  {
    id: "fixture-007",
    label: "Metro Legal LLP · tax exempt, no tax line",
    text: `METRO LEGAL LLP
Vendor: Metro Legal LLP

Invoice #ML-5520
Date: 2026-01-20
Due: 2026-02-19

Legal consultation          5 hours     600.00     3,000.00
Filing fees                 1           2,000.00   2,000.00

Subtotal: $5,000.00
Total: $5,000.00
Tax exempt services.`,
    expected: {
      vendor: "Metro Legal LLP",
      currency: "USD",
      invoiceNumber: "ML-5520",
      issueDate: "2026-01-20",
      dueDate: "2026-02-19",
      subtotal: 500000,
      tax: 0,
      total: 500000,
      lineItems: 2,
    },
  },
  {
    id: "fixture-008",
    label: "Sagarmatha Devices · invalid due date",
    text: `SAGARMATHA DEVICES
Vendor: Sagarmatha Devices

Date issued: 2026-04-10
Payment due: 2026-03-25

Laptop stand x12             12     2,500.00    30,000.00
Cable kit                    12       350.00     4,200.00

Subtotal: Rs. 34,200.00
VAT 13%: Rs. 4,446.00
Total: Rs. 38,646.00`,
    expected: {
      vendor: "Sagarmatha Devices",
      currency: "NPR",
      invoiceNumber: null,
      issueDate: "2026-04-10",
      dueDate: "2026-03-25",
      subtotal: 3420000,
      tax: 444600,
      total: 3864600,
      lineItems: 2,
      invalidDates: true,
    },
  },
];

export const fixtureById = (id) => FIXTURES.find((fixture) => fixture.id === id) || null;
