// DocMind demo, rendering and interaction only.
// Extraction, validation, confidence and queue transitions live in ../src/.
import { FIXTURES } from "../src/fixtures.js";
import {
  STATUS,
  applyCorrections,
  confirmEntry,
  createQueue,
  exportEntry,
  markExported,
  queueSummary,
} from "../src/queue.js";
import { confidenceLabel, REVIEW_THRESHOLD } from "../src/confidence.js";
import { formatMoney, formatMoneyPlain } from "../src/money.js";

const el = A.el;
const $ = A.$;
const $$ = A.$$;

const FIELD_DEFS = [
  { name: "vendor", label: "Vendor", type: "text", wide: true },
  { name: "invoiceNumber", label: "Invoice no.", type: "text" },
  { name: "currency", label: "Currency", type: "text" },
  { name: "issueDate", label: "Issue date", type: "date" },
  { name: "dueDate", label: "Due date", type: "date" },
  { name: "subtotal", label: "Subtotal", type: "money" },
  { name: "tax", label: "Tax", type: "money" },
  { name: "taxRate", label: "Tax rate %", type: "number" },
  { name: "total", label: "Total", type: "money" },
];

const STATUS_META = {
  review: { tone: "gold", text: "needs review" },
  ready: { tone: "green", text: "ready" },
  confirmed: { tone: "blue", text: "confirmed" },
  exported: { tone: "purple", text: "exported" },
};

const state = {
  queue: [],
  selectedId: "fixture-005",
  view: "review",
  exports: [],
  activeExportId: null,
};

const current = () => state.queue.find((entry) => entry.id === state.selectedId) || state.queue[0];

/* ---------------------------------------------------------------- helpers */

const statusBadge = (status) => {
  const meta = STATUS_META[status] || STATUS_META.review;
  return el("span", { class: `badge ${meta.tone}`, text: meta.text });
};

function confidenceChip(field) {
  if (!field || field.value === null || field.value === undefined) {
    return el("span", { class: "conf missing", text: "missing" });
  }
  if (field.corrected) return el("span", { class: "conf high", text: "corrected" });
  const label = confidenceLabel(field.adjusted);
  return el("span", { class: `conf ${label}`, text: `${Math.round(field.adjusted * 100)}%` });
}

const formattedValue = (extraction, name) => {
  const value = extraction[name];
  if (value === null || value === undefined) return "";
  if (["subtotal", "tax", "total"].includes(name)) return formatMoneyPlain(value);
  return String(value);
};

const HIGHLIGHT = /(\d{4}-\d{2}-\d{2}|\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[a-z]*\.?\s+\d{4}\b)|((?:Rs\.?|[$€£₹])\s?\d[\d,]*\.\d{2}|\b\d[\d,]*\.\d{2}\b)/gi;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));

function highlightLine(line) {
  let html = "";
  let last = 0;
  for (const match of line.matchAll(HIGHLIGHT)) {
    html += escapeHtml(line.slice(last, match.index));
    const cls = match[1] ? "date" : "money";
    html += `<mark class="${cls}">${escapeHtml(match[0])}</mark>`;
    last = match.index + match[0].length;
  }
  html += escapeHtml(line.slice(last));
  return html;
}

/* ----------------------------------------------------------------- layout */

function renderStats() {
  const summary = queueSummary(state.queue);
  const stats = [
    { label: "Documents", value: summary.total, tone: "gold", note: `${summary.ready} ready to post` },
    { label: "Needs review", value: summary.review, tone: "", note: "below threshold or failed a check" },
    { label: "Open errors", value: summary.openErrors, tone: "red", note: "blocking reconciliation" },
    { label: "Avg confidence", value: `${Math.round(summary.averageConfidence * 100)}%`, tone: "green", note: `threshold ${REVIEW_THRESHOLD}` },
  ];
  $("#queue-stats").replaceChildren(
    ...stats.map((stat) =>
      el("div", { class: "card" },
        el("div", { class: "stat" },
          el("div", { class: "stat-label", text: stat.label }),
          el("div", { class: `stat-value ${stat.tone}`, text: String(stat.value) }),
          el("div", { class: "small muted", text: stat.note }),
        ),
      ),
    ),
  );
}

function renderList() {
  $("#inbox-count").textContent = `${state.queue.length} documents`;
  $("#doc-list").replaceChildren(
    ...state.queue.map((entry) => {
      const extraction = entry.extraction;
      const isSelected = entry.id === state.selectedId;
      const errorCount = extraction.issues.filter((issue) => issue.severity === "error").length;
      return el("button", {
        class: "doc-item" + (isSelected ? " selected" : ""),
        type: "button",
        onclick: () => select(entry.id),
      },
        el("span", { class: "vendor", text: extraction.vendor || entry.label }),
        el("span", { class: "meta" },
          el("span", { class: "mono", text: extraction.invoiceNumber || "no number" }),
          el("span", { class: "spacer", style: "flex:1" }),
          errorCount ? el("span", { class: "badge red", text: `${errorCount} err` }) : statusBadge(entry.status),
        ),
        el("div", { class: "progress" },
          el("i", {
            style: `width:${Math.round(extraction.overall * 100)}%;${errorCount ? "background:linear-gradient(90deg,#b45454,#f87171)" : ""}`,
          }),
        ),
      );
    }),
  );
}

function renderSource(entry) {
  const extraction = entry.extraction;
  $("#source-title").textContent = extraction.vendor || entry.label;
  $("#source-sub").textContent = `${entry.label} · ${extraction.lineItems.length} line item${extraction.lineItems.length === 1 ? "" : "s"}`;
  $("#source-status").replaceChildren(statusBadge(entry.status));

  const lines = extraction.text.split(/\r?\n/);
  const view = el("div", {});
  lines.forEach((line, index) => {
    view.append(
      el("div", { class: "src-line" },
        el("span", { class: "ln", text: String(index + 1) }),
        el("span", { class: "tx", html: highlightLine(line) || "&nbsp;" }),
      ),
    );
  });
  $("#source-view").replaceChildren(view);
}

function renderFields(entry) {
  const extraction = entry.extraction;
  $("#field-sub").textContent = `${Object.values(extraction.fields).filter((field) => field.value !== null).length} of 10 fields found`;
  const badge = $("#overall-badge");
  badge.textContent = `${Math.round(extraction.overall * 100)}% confidence`;
  badge.className = "badge " + (extraction.needsReview ? "gold" : "green");

  const fieldsHost = el("div", { class: "fields-grid" });
  for (const def of FIELD_DEFS) {
    const field = extraction.fields[def.name];
    const stateClass = field?.value === null ? "" : confidenceLabel(field.adjusted);
    const input = el("input", {
      class: "input",
      type: "text",
      value: formattedValue(extraction, def.name),
      placeholder: "not found",
      "data-field": def.name,
      title: field?.evidence || "not found in the source",
      disabled: entry.status === STATUS.exported,
    });
    if (stateClass === "low" || stateClass === "check") input.dataset.state = stateClass;
    if (field?.corrected) input.dataset.state = "corrected";
    fieldsHost.append(
      el("div", { class: "field" + (def.wide ? " wide" : "") },
        el("div", { class: "field-label" },
          el("span", { text: def.label }),
          el("span", { class: "spacer" }),
          confidenceChip(field),
        ),
        input,
      ),
    );
  }

  const items = el("div", { class: "line-items" },
    el("div", { class: "line-items-head" },
      el("span", { text: `Line items · ${extraction.lineItems.length}` }),
      el("span", { class: "spacer", style: "flex:1" }),
      el("span", { class: "mono", text: formatMoney(extraction.subtotal, extraction.currency) }),
    ),
    ...(extraction.lineItems.length
      ? extraction.lineItems.map((item) =>
          el("div", { class: "line-item" },
            el("span", { class: "desc", text: item.description }),
            el("span", { class: "mono", text: `${item.quantity} × ${formatMoneyPlain(item.unitPrice)}` }),
            el("span", { class: "mono", style: "color:var(--text-2)", text: formatMoneyPlain(item.amount) }),
          ),
        )
      : [el("div", { class: "small muted", text: "No line items were parsed. That is common on receipts." })]),
  );

  $("#fields").replaceChildren(fieldsHost, items);

  const confirm = $("#confirm");
  const exportButton = $("#export");
  confirm.disabled = entry.status === STATUS.exported;
  exportButton.disabled = entry.status !== STATUS.confirmed;
}

function renderIssues(entry) {
  const extraction = entry.extraction;
  const issues = extraction.issues;
  $("#issue-count").textContent = issues.length ? `${issues.length} open` : "none";
  if (!issues.length) {
    $("#issues").replaceChildren(el("div", { class: "empty-good" }, el("span", { class: "dot", style: "color:var(--green)" }), el("span", { text: "All checks passed. Nothing to review." })));
    return;
  }
  $("#issues").replaceChildren(
    ...issues.map((issue) => {
      const detail = issue.detail
        ? Object.entries(issue.detail)
            .map(([key, value]) => `${key}: ${typeof value === "number" && /minor|expected|actual|difference/i.test(key) ? formatMoney(value, entry.extraction.currency) : value}`)
            .join(" · ")
        : "";
      return el("div", { class: `issue ${issue.severity}` },
        el("span", { class: "badge " + (issue.severity === "error" ? "red" : "gold"), text: issue.severity }),
        el("div", {},
          el("div", { class: "msg", text: issue.message }),
          detail ? el("div", { class: "detail", text: detail }) : null,
        ),
      );
    }),
  );
}

function renderReview() {
  const entry = current();
  renderList();
  renderSource(entry);
  renderFields(entry);
  renderIssues(entry);
}

/* -------------------------------------------------------------- validation */

function renderValidation() {
  const entry = current();
  $("#checks-title").textContent = `${entry.extraction.vendor || entry.label}, checks`;
  $("#checks-sub").textContent = entry.extraction.reconciled ? "all blocking checks passed" : "blocking issues present";

  $("#checks").replaceChildren(
    ...entry.extraction.checks.map((check) =>
      el("div", { class: "check-row" },
        el("div", {},
          el("div", { class: "check-label", text: check.label }),
          el("div", { class: "check-detail", text: check.detail || "" }),
        ),
        el("div", { class: "check-status" },
          el("span", {
            class: check.status === "pass" ? "badge green" : check.status === "fail" ? "badge red" : "badge",
            text: check.status,
          }),
        ),
      ),
    ),
  );

  $("#validation-table").replaceChildren(
    A.dataTable({
      columns: [
        { key: "vendor", label: "Document", render: (row) => el("span", { class: "strong", text: row.vendor || row.id }) },
        { key: "status", label: "Status", render: (row) => statusBadge(row.status) },
        { key: "errors", label: "Errors", align: "right", render: (row) => el("span", { class: row.errors ? "badge red" : "muted", text: String(row.errors) }) },
        { key: "confidence", label: "Confidence", align: "right", render: (row) => el("span", { class: "mono", text: `${Math.round(row.confidence * 100)}%` }) },
        { key: "total", label: "Total", align: "right", render: (row) => el("span", { class: "mono", text: formatMoney(row.totalMinor, row.currency) }) },
      ],
      rows: state.queue.map((item) => ({
        id: item.id,
        vendor: item.extraction.vendor,
        status: item.status,
        errors: item.extraction.issues.filter((issue) => issue.severity === "error").length,
        confidence: item.extraction.overall,
        totalMinor: item.extraction.total,
        currency: item.extraction.currency,
      })),
      onRowClick: (row) => select(row.id, { stay: true }),
    }),
  );
}

/* ------------------------------------------------------------------ export */

function jsonFor(entry) {
  return JSON.stringify(exportEntry(entry), null, 2);
}

function renderExport() {
  $("#export-count").textContent = `${state.exports.length} exported`;
  $("#export-list").replaceChildren(
    ...(state.exports.length
      ? state.exports.map((entry) =>
          el("div", { class: "export-row" },
            el("div", { class: "doc" },
              el("span", { class: "vendor", text: entry.extraction.vendor || entry.id }),
              el("span", { class: "meta", text: entry.id }),
            ),
            el("button", { class: "btn sm", text: "View", onclick: () => showExport(entry.id) }),
          ),
        )
      : [el("div", { class: "empty" }, el("strong", { text: "No exports yet" }), "Confirm a document, then press Export JSON.")]),
  );

  const active = state.exports.find((entry) => entry.id === state.activeExportId);
  $("#export-title").textContent = active ? `${active.extraction.vendor} · ${active.id}` : "Nothing exported yet";
  $("#export-json").textContent = active ? jsonFor(active) : "";
  $("#download-export").disabled = !active;
  $("#download-export").onclick = () => {
    if (!active) return;
    A.download(`${active.id}.json`, jsonFor(active), "application/json");
    A.toast(`Downloaded ${active.id}.json`, "success");
  };
}

function showExport(id) {
  state.activeExportId = id;
  renderExport();
  show("export");
}

/* ----------------------------------------------------------------- actions */

function select(id, { stay = false } = {}) {
  state.selectedId = id;
  renderReview();
  if (state.view === "validation") renderValidation();
  if (stay && state.view !== "validation") show("validation");
}

function collectCorrections(entry) {
  const updates = {};
  for (const def of FIELD_DEFS) {
    const input = $(`[data-field="${def.name}"]`);
    if (!input) continue;
    const before = formattedValue(entry.extraction, def.name);
    const after = input.value.trim();
    if (after !== before) updates[def.name] = after;
  }
  return updates;
}

function confirmSelected() {
  const entry = current();
  if (entry.status === STATUS.exported) return;
  const updates = collectCorrections(entry);
  const updated = Object.keys(updates).length ? applyCorrections(entry, updates) : confirmEntry(entry);
  replace(updated);
  A.toast(Object.keys(updates).length ? `Saved ${Object.keys(updates).length} correction${Object.keys(updates).length === 1 ? "" : "s"}` : "Fields confirmed", "success");
}

function exportSelected() {
  const entry = current();
  if (entry.status !== STATUS.confirmed) {
    A.toast("Confirm the fields before exporting.", "error");
    return;
  }
  const exported = markExported(entry, { at: new Date().toISOString() });
  replace(exported);
  state.exports = [exported, ...state.exports.filter((item) => item.id !== exported.id)];
  state.activeExportId = exported.id;
  renderExport();
  A.toast(`Exported ${exported.id}.json`, "success");
}

function replace(entry) {
  state.queue = state.queue.map((item) => (item.id === entry.id ? entry : item));
  renderStats();
  renderReview();
  renderValidation();
}

function resetDemo() {
  state.queue = createQueue(FIXTURES);
  state.selectedId = "fixture-005";
  state.exports = [];
  state.activeExportId = null;
  renderStats();
  renderReview();
  renderValidation();
  renderExport();
  A.toast("Demo reset to the eight seeded documents", "success");
}

/* -------------------------------------------------------------- navigation */

function show(view) {
  if (!["review", "validation", "export"].includes(view)) view = "review";
  state.view = view;
  $$("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  $$(".nav-item[data-view]").forEach((link) => link.classList.toggle("active", link.dataset.view === view));
  if (view === "validation") renderValidation();
  if (view === "export") renderExport();
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
}

function bind() {
  $("#confirm").addEventListener("click", confirmSelected);
  $("#export").addEventListener("click", exportSelected);
  $("#revert").addEventListener("click", () => {
    renderReview();
    A.toast("Unsaved edits discarded");
  });
  $("#reset-demo").addEventListener("click", resetDemo);
  window.addEventListener("hashchange", () => show(location.hash.replace("#", "")));
  $$(".nav-item[data-view]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      show(link.dataset.view);
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "e" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      exportSelected();
    }
  });
}

/* -------------------------------------------------------------------- boot */

state.queue = createQueue(FIXTURES);
bind();
renderStats();
renderReview();
renderValidation();
renderExport();
show(location.hash.replace("#", "") || "review");
