// Pre-sanction checklist (Beta) — standalone admin tool opened from the
// admin menu (user pill dropdown). Loaded lazily; it does not read or
// write loans. Checklists are stored in the `sanctionChecklists` collection.
import {
  collection, deleteDoc, doc, getDocs, orderBy, query, setDoc, updateDoc,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./config.js";
import { S } from "./state.js";
import { appConfirm, esc, toast, todayStr } from "./utils.js";
import { closeOverlay, openOverlay } from "./animate.js";
import {
  AMOUNT_WARN_LAKH, CONSTITUTIONS, FACILITIES, HIDDEN_SECTION_REASONS, allowsNA, amountWarning,
  ayLabel, bsStage, fyLabel, isProfileComplete, itemLabel, itemStatus, newChecklist, nextYear,
  parseAmountLakh, ruleLabel, sectionSummary, summarize, visibleSections, yearOptions, yearProgress,
  yearRows,
} from "./sanction-checklist-model.js";

const COLLECTION = "sanctionChecklists";
const OVERLAY_ID = "sanctionChecklistOverlay";
const LIST_ID = "sanctionChecklistListOverlay";
const SAVE_DELAY_MS = 500;

const state = {
  id: null,          // Firestore id; null while a new checklist is a draft
  data: null,        // checklist being edited
  pendingOnly: false,
  collapsed: new Set(),
  dirty: {},         // field paths waiting to be written
  saveTimer: null,
};
let cachedList = [];

function ensureStyles() {
  if (document.getElementById("sanctionChecklistCss")) return;
  const link = document.createElement("link");
  link.id = "sanctionChecklistCss";
  link.rel = "stylesheet";
  link.href = new URL("../css/sanction-checklist.css", import.meta.url).href;
  document.head.appendChild(link);
}

const fmtDate = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "—";
};
const fmtLakh = value => (value == null ? "—" : `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`);
const facilityShort = value => ({ CC: "CC", TL: "TL", CCTL: "CC + TL" }[value] || "—");
const newId = () => `chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const stamp = () => ({ updatedAt: new Date().toISOString(), updatedBy: S.user || "" });

// ── Settings tab: list of saved checklists ───────────────────────────────

const isOpen = id => document.getElementById(id)?.getAttribute("aria-hidden") === "false";

function ensureListOverlay() {
  let overlay = document.getElementById(LIST_ID);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "overlay sc-overlay";
  overlay.id = LIST_ID;
  overlay.style.display = "none";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="sheet sc-sheet" role="dialog" aria-modal="true" aria-labelledby="scListTitle">
      <div class="sheet-handle"></div>
      <div class="sc-head">
        <h2 id="scListTitle">Pre-Sanction Checklists</h2>
        <span class="sc-beta">Beta</span>
        <button type="button" class="sc-close" aria-label="Close checklists" onclick="closeChecklistList()">&#215;</button>
      </div>
      <div class="sc-intro">For SME loans up to ₹${AMOUNT_WARN_LAKH} lakh.</div>
      <button type="button" class="btn btn-primary-full sc-new-btn" onclick="openSanctionChecklist()">+ New checklist</button>
      <div id="scList" class="sc-list"></div>
    </div>`;
  overlay.addEventListener("click", event => { if (event.target === overlay) closeChecklistList(); });
  document.body.appendChild(overlay);
  return overlay;
}

// Entry point from the admin menu: the list of saved checklists.
function openChecklistList() {
  if (!S.isAdmin) { toast("Admin access required"); return; }
  ensureStyles();
  const overlay = ensureListOverlay();
  openOverlay(overlay);
  loadList();
}

function closeChecklistList() {
  closeOverlay(LIST_ID);
}

async function loadList() {
  const list = document.getElementById("scList");
  if (!list) return;
  if (!cachedList.length) list.innerHTML = `<div class="sc-empty">Loading…</div>`;
  try {
    const snap = await getDocs(query(collection(db, COLLECTION), orderBy("updatedAt", "desc")));
    cachedList = snap.docs.map(d => ({ ...d.data(), id: d.id }));
  } catch (error) {
    console.error("[Checklist] load failed", error);
    list.innerHTML = `<div class="sc-empty">Could not load checklists.</div>`;
    return;
  }
  renderList();
}

function renderList() {
  const list = document.getElementById("scList");
  if (!list) return;
  if (!cachedList.length) {
    list.innerHTML = `<div class="sc-empty">No checklists yet.</div>`;
    return;
  }
  list.innerHTML = cachedList.map(item => {
    const done = isProfileComplete(item) ? summarize(item) : null;
    const pct = done ? `${done.percent}%` : "—";
    const tone = !done ? "" : done.pending === 0 ? " sc-pct--done" : "";
    return `<div class="sc-list-row">
      <button type="button" class="sc-list-open" data-id="${esc(item.id)}" onclick="openSanctionChecklist(this.dataset.id)">
        <span class="sc-list-name">${esc(item.borrowerName || "Unnamed borrower")}</span>
        <span class="sc-list-meta">${esc(facilityShort(item.facility))} · ${esc(fmtLakh(item.amountLakh))} · ${esc(fmtDate((item.createdAt || "").slice(0, 10)))}${done ? ` · ${done.pending} pending` : ""}</span>
      </button>
      <span class="sc-pct${tone}">${pct}</span>
      <button type="button" class="btn-sm-danger" data-id="${esc(item.id)}" aria-label="Delete checklist for ${esc(item.borrowerName || "borrower")}" onclick="deleteSanctionChecklist(this.dataset.id)">&#215;</button>
    </div>`;
  }).join("");
}

async function deleteSanctionChecklist(id) {
  if (!S.isAdmin) return;
  const item = cachedList.find(entry => entry.id === id);
  if (!item) return;
  const ok = await appConfirm({
    title: "Delete checklist?",
    message: `Delete the checklist for ${item.borrowerName || "this borrower"}. This cannot be undone.`,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await deleteDoc(doc(db, COLLECTION, id));
    cachedList = cachedList.filter(entry => entry.id !== id);
    renderList();
    toast("Checklist deleted");
  } catch (error) {
    console.error("[Checklist] delete failed", error);
    toast("Could not delete checklist");
  }
}

// ── Checklist sheet ──────────────────────────────────────────────────────

function ensureOverlay() {
  let overlay = document.getElementById(OVERLAY_ID);
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "overlay sc-overlay sc-overlay--item";
  overlay.id = OVERLAY_ID;
  overlay.style.display = "none";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="sheet sc-sheet" role="dialog" aria-modal="true" aria-labelledby="scTitle">
      <div class="sheet-handle"></div>
      <div class="sc-head">
        <h2 id="scTitle">Pre-Sanction Checklist</h2>
        <span class="sc-beta">Beta</span>
        <span class="sc-save" id="scSaveState" aria-live="polite"></span>
        <button type="button" class="sc-close" aria-label="Close checklist" data-action="close">&#215;</button>
      </div>
      <div id="scBody"></div>
    </div>`;
  overlay.addEventListener("click", onClick);
  overlay.addEventListener("change", onChange);
  overlay.addEventListener("input", onInput);
  document.body.appendChild(overlay);
  return overlay;
}

// Escape closes the top sheet: the open checklist first, then the list.
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || document.querySelector(".confirm-overlay")) return;
  if (isOpen(OVERLAY_ID)) closeSanctionChecklist();
  else if (isOpen(LIST_ID)) closeChecklistList();
});

function openSanctionChecklist(id) {
  if (!S.isAdmin) { toast("Admin access required"); return; }
  ensureStyles();
  const overlay = ensureOverlay();
  const existing = id ? cachedList.find(entry => entry.id === id) : null;
  if (id && !existing) { toast("Checklist not found"); return; }
  state.id = existing ? existing.id : null;
  state.data = existing
    ? structuredClone({ ...existing, items: existing.items || {} })
    : newChecklist({ today: todayStr(), user: S.user });
  delete state.data.id;
  state.pendingOnly = false;
  state.collapsed = new Set();
  state.dirty = {};
  setSaveState("");
  render();
  overlay.querySelector(".sc-sheet").scrollTop = 0;
  openOverlay(overlay);
}

function closeSanctionChecklist() {
  flushSave();
  // Re-read so the list shows this checklist's latest percentage.
  closeOverlay(OVERLAY_ID, () => { if (isOpen(LIST_ID)) loadList(); });
}

function render() {
  const body = document.getElementById("scBody");
  if (!body) return;
  const data = state.data;
  const sections = visibleSections(data);
  const profileReady = isProfileComplete(data);
  body.innerHTML = `
    ${detailsHtml(data)}
    ${!state.id ? createHtml(data, profileReady) : ""}
    ${state.id && !profileReady ? `<div class="sc-hint">Answer constitution, facility, collateral and premises to see the checklist.</div>` : ""}
    ${state.id && profileReady ? summaryHtml(data, sections) + sections.map(sectionHtml).join("") + hiddenNoteHtml(sections) : ""}`;
}

function selectHtml(id, name, options, value, placeholder) {
  return `<select id="${id}" name="${name}" data-field="${name}">
    <option value="" ${value ? "" : "selected"} disabled>${esc(placeholder)}</option>
    ${options.map(opt => `<option value="${esc(opt.value)}" ${opt.value === value ? "selected" : ""}>${esc(opt.label)}</option>`).join("")}
  </select>`;
}

function yesNoHtml(id, label, action, value) {
  const yes = value === true;
  const no = value === false;
  return `<div class="form-group">
      <span class="form-label" id="${id}">${esc(label)}</span>
      <div class="sc-seg" role="radiogroup" aria-labelledby="${id}">
        <button type="button" role="radio" aria-checked="${yes}" class="${yes ? "on" : ""}" data-action="${action}" data-value="yes">Yes</button>
        <button type="button" role="radio" aria-checked="${no}" class="${no ? "on" : ""}" data-action="${action}" data-value="no">No</button>
      </div>
    </div>`;
}

function detailsHtml(data) {
  const warning = amountWarning(data.amountLakh);
  return `<div class="sc-card sc-details">
    <div class="form-group sc-full">
      <label for="scBorrower">Borrower Name</label>
      <input id="scBorrower" type="text" data-field="borrowerName" value="${esc(data.borrowerName)}" placeholder="e.g. SHARMA TRADERS" autocomplete="off">
    </div>
    <div class="form-group">
      <label for="scFacility">Facility</label>
      ${selectHtml("scFacility", "facility", FACILITIES, data.facility, "Select")}
    </div>
    <div class="form-group">
      <label for="scAmount">Amount (in Lakhs)</label>
      <input id="scAmount" type="number" inputmode="decimal" min="0" step="0.01" data-field="amountLakh" value="${data.amountLakh ?? ""}" placeholder="e.g. 45">
    </div>
    <div class="sc-warn sc-full" id="scAmountWarn" role="status" ${warning ? "" : "hidden"}>&#9888; ${esc(warning)}</div>
    <div class="form-group sc-full">
      <label for="scConstitution">Constitution</label>
      ${selectHtml("scConstitution", "constitution", CONSTITUTIONS, data.constitution, "Select")}
    </div>
    <div class="sc-yesno-row sc-full">
      ${yesNoHtml("scCollateralLabel", "Collateral offered?", "collateral", data.collateral)}
      ${yesNoHtml("scRentedLabel", "Rented premises?", "rented", data.rented)}
    </div>
    ${data.collateral === false ? `<div class="sc-note sc-full">No collateral – treated as covered under CGTMSE.</div>` : ""}
  </div>`;
}

function createHtml(data, profileReady) {
  const ready = profileReady && data.borrowerName.trim();
  return `<div class="sc-hint">${ready ? "Ready to start." : "Fill in the borrower name, facility, constitution, collateral and premises to start."}</div>
    <button type="button" class="btn btn-primary-full sc-create" data-action="create" ${ready ? "" : "disabled"}>Create checklist</button>`;
}

function summaryHtml(data, sections) {
  const sum = summarize(data, sections);
  return `<div class="sc-card sc-summary">
    <div class="sc-summary-top">
      <span class="sc-summary-pct">${sum.percent}%</span>
      <span class="sc-summary-label">complete</span>
    </div>
    <div class="sc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${sum.percent}" aria-label="Checklist completion"><span style="width:${sum.percent}%"></span></div>
    <div class="sc-counts">
      <span><b>${sum.applicable}</b> Applicable</span>
      <span class="sc-c-received"><b>${sum.received}</b> Done</span>
      <span class="sc-c-pending"><b>${sum.pending}</b> Pending</span>
      ${sum.na ? `<span><b>${sum.na}</b> N/A</span>` : ""}
    </div>
    <label class="sc-toggle"><input type="checkbox" data-action="pendingOnly" ${state.pendingOnly ? "checked" : ""}> Show pending only</label>
  </div>`;
}

function sectionHtml(section) {
  const data = state.data;
  const sum = sectionSummary(data, section);
  const open = !state.collapsed.has(section.id);
  const items = state.pendingOnly
    ? section.items.filter(item => itemStatus(data, item) === "pending")
    : section.items;
  const complete = sum.pending === 0;
  return `<section class="sc-section">
    <button type="button" class="sc-section-head" data-action="toggleSection" data-section="${section.id}" aria-expanded="${open}">
      <span class="sc-chevron" aria-hidden="true">${open ? "&#9662;" : "&#9656;"}</span>
      <span class="sc-section-title">${section.id}. ${esc(section.title)}</span>
      <span class="sc-section-count${complete ? " done" : ""}">${complete ? "&#10003; " : ""}${sum.received}/${sum.applicable}</span>
    </button>
    ${open ? `<div class="sc-items">${items.length ? items.map(item => itemHtml(item, section)).join("") : `<div class="sc-empty">Nothing pending</div>`}</div>` : ""}
  </section>`;
}

function itemHtml(item, section) {
  const data = state.data;
  if (item.years) return yearItemHtml(item);
  const status = itemStatus(data, item);
  const remark = data.items?.[item.key]?.remark || "";
  const options = [["pending", "Pending"], ["received", section.doneLabel || "Received"]];
  if (allowsNA(item)) options.push(["na", "N/A"]);
  const labelId = `scItem_${item.key}`;
  return `<div class="sc-item sc-item--${status}">
    <div class="sc-item-top">
      <span class="sc-sr">${item.no}</span>
      <span class="sc-item-label" id="${labelId}">${esc(itemLabel(item))}</span>
      ${item.rule === "all" ? "" : `<span class="sc-rule">${esc(ruleLabel(item.rule))}</span>`}
    </div>
    <div class="sc-item-controls">
      <div class="sc-seg sc-seg--status" role="radiogroup" aria-labelledby="${labelId}">
        ${options.map(([value, label]) => `<button type="button" role="radio" aria-checked="${status === value}" class="${status === value ? `on on--${value}` : ""}" data-action="status" data-key="${item.key}" data-value="${value}">${label}</button>`).join("")}
      </div>
      <input type="text" class="sc-remark" data-remark="${item.key}" value="${esc(remark)}" placeholder="Remarks" aria-label="Remarks for item ${item.no}">
    </div>
  </div>`;
}

// Year-wise question as a compact table: one row per financial year with
// its own Pending / Received / N/A. The year can be changed from the
// dropdown or the row deleted; "+ Add year" inserts the latest free year.
const ROW_OPTIONS = [["pending", "Pending"], ["received", "Received"], ["na", "N/A"]];

function yearRowHtml(item, row) {
  const data = state.data;
  const sub = item.years === "itr" ? ayLabel(row.year) : bsStage(data, row.year);
  const selectId = `scYear_${item.key}_${row.year}`;
  return `<div class="sc-yt-row sc-yt-row--${row.status}">
      <div class="sc-yt-year">
        <select id="${selectId}" class="sc-yt-select" data-year-of="${item.key}" data-year="${row.year}" aria-label="Financial year">
          ${yearOptions(data, item, row.year).map(year => `<option value="${year}" ${year === row.year ? "selected" : ""}>${esc(fyLabel(year))}</option>`).join("")}
        </select>
        <small>${esc(sub)}</small>
      </div>
      <div class="sc-seg sc-seg--status sc-seg--compact" role="radiogroup" aria-label="${esc(`${itemLabel(item)} ${fyLabel(row.year)}`)}">
        ${ROW_OPTIONS.map(([option, label]) => `<button type="button" role="radio" aria-checked="${row.status === option}" class="${row.status === option ? `on on--${option}` : ""}" data-action="rowStatus" data-key="${item.key}" data-year="${row.year}" data-value="${option}">${label}</button>`).join("")}
      </div>
      <button type="button" class="sc-yt-del" data-action="rowDelete" data-key="${item.key}" data-year="${row.year}" aria-label="Delete ${esc(fyLabel(row.year))}">&#215;</button>
    </div>`;
}

function yearItemHtml(item) {
  const data = state.data;
  const status = itemStatus(data, item);
  const remark = data.items?.[item.key]?.remark || "";
  const rows = yearRows(data, item);
  const { done, na, total } = yearProgress(data, item);
  const anyPending = rows.some(row => row.status === "pending");
  const canAdd = nextYear(data, item) != null;
  return `<div class="sc-item sc-item--${status}">
    <div class="sc-item-top">
      <span class="sc-sr">${item.no}</span>
      <span class="sc-item-label">${esc(itemLabel(item))}</span>
      <span class="sc-fin-count${rows.length && !anyPending ? " done" : ""}">${done}/${total}${na ? ` · ${na} N/A` : ""}</span>
    </div>
    <div class="sc-yt">
      ${rows.length ? rows.map(row => yearRowHtml(item, row)).join("") : `<div class="sc-empty">No years – add at least one.</div>`}
    </div>
    <div class="sc-yt-actions">
      ${canAdd ? `<button type="button" class="sc-yt-btn" data-action="rowAdd" data-key="${item.key}">+ Add year</button>` : ""}
      ${anyPending ? `<button type="button" class="sc-yt-btn sc-yt-btn--all" data-action="rowsAll" data-key="${item.key}">Mark all received</button>` : ""}
    </div>
    <div class="sc-item-controls">
      <input type="text" class="sc-remark" data-remark="${item.key}" value="${esc(remark)}" placeholder="Remarks" aria-label="Remarks for item ${item.no}">
    </div>
  </div>`;
}

const findItem = key => visibleSections(state.data).flatMap(section => section.items).find(entry => entry.key === key);

// Every edit stores the full row list, so defaults become explicit once touched.
function updateRows(key, change) {
  const item = findItem(key);
  if (!item) return;
  const rows = change(yearRows(state.data, item));
  setItem(key, { rows: rows.sort((a, b) => a.year - b.year) });
  render();
}

// Tell the user which sections are hidden and why, so nothing looks missing.
function hiddenNoteHtml(sections) {
  const shown = new Set(sections.map(section => section.id));
  const reasons = HIDDEN_SECTION_REASONS;
  const hidden = Object.keys(reasons).filter(id => !shown.has(id));
  if (!hidden.length) return "";
  return `<div class="sc-hint sc-hidden-note">Not applicable: ${hidden.map(id => `${id} (${reasons[id]})`).join(", ")}.</div>`;
}

// ── Events ───────────────────────────────────────────────────────────────

function onClick(event) {
  if (event.target.id === OVERLAY_ID) { closeSanctionChecklist(); return; }
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "close") closeSanctionChecklist();
  else if (action === "collateral") setField("collateral", target.dataset.value === "yes", true);
  else if (action === "rented") setField("rented", target.dataset.value === "yes", true);
  else if (action === "create") createChecklist();
  else if (action === "toggleSection") {
    const id = target.dataset.section;
    if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
    render();
  } else if (action === "rowStatus") {
    const year = Number(target.dataset.year);
    updateRows(target.dataset.key, rows => rows.map(row => (row.year === year ? { ...row, status: target.dataset.value } : row)));
  } else if (action === "rowDelete") {
    const year = Number(target.dataset.year);
    updateRows(target.dataset.key, rows => rows.filter(row => row.year !== year));
  } else if (action === "rowAdd") {
    const item = findItem(target.dataset.key);
    const year = item ? nextYear(state.data, item) : null;
    if (year != null) updateRows(target.dataset.key, rows => [...rows, { year, status: "pending" }]);
  } else if (action === "rowsAll") {
    updateRows(target.dataset.key, rows => rows.map(row => (row.status === "pending" ? { ...row, status: "received" } : row)));
  } else if (action === "status") {
    setItem(target.dataset.key, { status: target.dataset.value });
    render();
  }
}

function onChange(event) {
  const target = event.target;
  if (target.dataset.action === "pendingOnly") {
    state.pendingOnly = target.checked;
    render();
    return;
  }
  if (target.dataset.yearOf) {
    const from = Number(target.dataset.year);
    const to = Number(target.value);
    updateRows(target.dataset.yearOf, rows => rows.map(row => (row.year === from ? { ...row, year: to } : row)));
    return;
  }
  if (target.dataset.remark) {
    setItem(target.dataset.remark, { remark: target.value.trim() });
    return;
  }
  const field = target.dataset.field;
  if (!field) return;
  if (field === "amountLakh") setField(field, parseAmountLakh(target.value), false);
  else if (field === "borrowerName") setField(field, target.value.trim(), !state.id);
  else setField(field, target.value, true);
}

function onInput(event) {
  const target = event.target;
  if (target.dataset.field === "amountLakh") {
    const warn = document.getElementById("scAmountWarn");
    const message = amountWarning(target.value);
    if (warn) { warn.hidden = !message; warn.textContent = message ? `⚠ ${message}` : ""; }
  } else if (target.dataset.field === "borrowerName" && !state.id) {
    state.data.borrowerName = target.value;
    const button = document.querySelector(`#${OVERLAY_ID} [data-action="create"]`);
    if (button) button.disabled = !(isProfileComplete(state.data) && target.value.trim());
  }
}

function setField(field, value, rerender) {
  state.data[field] = value;
  queueSave({ [field]: value });
  if (rerender) render();
}

function setItem(key, patch) {
  const next = { ...(state.data.items[key] || {}), ...patch, ...stamp() };
  if (!next.status) next.status = "pending";
  state.data.items = { ...state.data.items, [key]: next };
  queueSave({ [`items.${key}`]: next });
}

// ── Persistence ──────────────────────────────────────────────────────────

function setSaveState(text) {
  const el = document.getElementById("scSaveState");
  if (el) el.textContent = text;
}

function queueSave(fields) {
  if (!state.id) return; // drafts are saved by createChecklist
  Object.assign(state.dirty, fields);
  setSaveState("Saving…");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
}

function flushSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (!state.id || !Object.keys(state.dirty).length) return;
  const id = state.id;
  const fields = { ...state.dirty, ...stamp() };
  state.dirty = {};
  Object.assign(state.data, { updatedAt: fields.updatedAt, updatedBy: fields.updatedBy });
  const cached = cachedList.find(entry => entry.id === id);
  if (cached) Object.assign(cached, structuredClone(state.data));
  // Firestore resolves only once the server acknowledges; offline writes are
  // queued by the SDK, so the UI does not wait on it.
  updateDoc(doc(db, COLLECTION, id), fields)
    .then(() => { if (state.id === id && !state.saveTimer) setSaveState("Saved"); })
    .catch(error => {
      console.error("[Checklist] save failed", error);
      setSaveState("Not saved");
      toast("Could not save checklist");
    });
}

function createChecklist() {
  const data = state.data;
  data.borrowerName = (document.getElementById("scBorrower")?.value || data.borrowerName).trim();
  if (!data.borrowerName || !isProfileComplete(data)) { toast("Fill in the borrower details first"); return; }
  const id = newId();
  const now = new Date().toISOString();
  Object.assign(data, { createdAt: now, createdBy: S.user || "", updatedAt: now, updatedBy: S.user || "" });
  state.id = id;
  cachedList = [{ ...structuredClone(data), id }, ...cachedList];
  setSaveState("Saving…");
  setDoc(doc(db, COLLECTION, id), data)
    .then(() => { if (state.id === id && !state.saveTimer) setSaveState("Saved"); })
    .catch(error => {
      console.error("[Checklist] create failed", error);
      setSaveState("Not saved");
      toast("Could not save checklist");
    });
  render();
}

window.openChecklistList = openChecklistList;
window.closeChecklistList = closeChecklistList;
window.openSanctionChecklist = openSanctionChecklist;
window.closeSanctionChecklist = closeSanctionChecklist;
window.deleteSanctionChecklist = deleteSanctionChecklist;
