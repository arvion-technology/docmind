// The pipeline: extraction, validation, scoring. One function so the demo, the
// queue and the tests all take the same path.

import { scoreExtraction } from "./confidence.js";
import { extractDocument } from "./extract.js";
import { validateExtraction } from "./validate.js";

export function finalizeExtraction(extraction) {
  const validation = validateExtraction(extraction);
  const assessment = scoreExtraction(extraction, validation.issues);
  return {
    ...extraction,
    ...assessment,
    issues: validation.issues,
    checks: validation.checks,
    reconciled: validation.reconciled,
  };
}

export function processDocument(document) {
  return finalizeExtraction(extractDocument(document));
}
