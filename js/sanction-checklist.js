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
  fyInput, parseAmountLakh, parseFy, sectionSummary, summarize, visibleSections, yearProgress,
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
  toggled: new Map(),   // section id → open/closed chosen by the officer
  editDetails: false,
  editingRemark: null,
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
  overlay.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.target.dataset.remark || event.target.dataset.yearOf)) event.target.blur();
  });
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
  state.toggled = new Map();
  state.editDetails = false;
  state.editingRemark = null;
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
  if (!state.id) {
    body.innerHTML = detailsHtml(data) + createHtml(data, profileReady);
    return;
  }
  const editing = state.editDetails || !profileReady;
  body.innerHTML = `
    ${editing ? detailsHtml(data) + (profileReady ? `<button type="button" class="sc-link-btn sc-details-done" data-action="editDetails">Done editing</button>` : `<div class="sc-hint">Answer constitution, facility, collateral and premises to see the checklist.</div>`) : profileBarHtml(data)}
    ${profileReady ? summaryHtml(data, sections) + sections.map(sectionHtml).join("") + hiddenNoteHtml(sections) : ""}`;
  if (state.editingRemark) {
    const input = body.querySelector(`[data-remark="${state.editingRemark}"]`);
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }
}

// Once the checklist exists, the borrower details fold into one line.
function profileBarHtml(data) {
  const facts = [
    facilityShort(data.facility),
    fmtLakh(data.amountLakh),
    CONSTITUTIONS.find(opt => opt.value === data.constitution)?.label || "",
    data.collateral ? "Collateral" : "No collateral (CGTMSE)",
    data.rented ? "Rented" : "Owned premises",
  ].filter(Boolean);
  const warning = amountWarning(data.amountLakh);
  return `<div class="sc-profile">
    <div class="sc-profile-main">
      <span class="sc-profile-name">${esc(data.borrowerName || "Unnamed borrower")}</span>
      <span class="sc-profile-facts">${facts.map(esc).join(" · ")}</span>
      ${warning ? `<span class="sc-profile-warn">&#9888; Above ₹${AMOUNT_WARN_LAKH} lakh</span>` : ""}
    </div>
    <button type="button" class="sc-link-btn" data-action="editDetails" aria-label="Edit borrower details">Edit</button>
  </div>`;
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
  return `<div class="sc-summary">
    <div class="sc-ring" style="--pct:${sum.percent}" role="img" aria-label="${sum.percent}% complete"><span>${Math.round(sum.percent)}%</span></div>
    <div class="sc-summary-mid">
      <div class="sc-counts"><span class="sc-c-received"><b>${sum.received}</b> done</span><span class="sc-c-pending"><b>${sum.pending}</b> pending</span>${sum.na ? `<span><b>${sum.na}</b> N/A</span>` : ""}</div>
      <div class="sc-bar" aria-hidden="true"><span style="width:${sum.percent}%"></span></div>
    </div>
    <button type="button" class="sc-chip${state.pendingOnly ? " on" : ""}" aria-pressed="${state.pendingOnly}" data-action="pendingOnly">Pending only</button>
  </div>`;
}

// Sections open while they have pending items and fold away once complete,
// unless the officer has opened or closed one by hand.
function sectionOpen(section, complete) {
  return state.toggled.has(section.id) ? state.toggled.get(section.id) : !complete;
}

function sectionHtml(section) {
  const data = state.data;
  const sum = sectionSummary(data, section);
  const complete = sum.pending === 0;
  const open = sectionOpen(section, complete);
  const items = state.pendingOnly
    ? section.items.filter(item => itemStatus(data, item) === "pending")
    : section.items;
  const pct = sum.applicable ? Math.round((sum.received / sum.applicable) * 100) : 100;
  const doneWord = (section.doneLabel || "Received").toLowerCase();
  return `<section class="sc-section sc-section--${section.id.toLowerCase()}${complete ? " is-complete" : ""}">
    <div class="sc-section-head">
      <button type="button" class="sc-section-toggle" data-action="toggleSection" data-section="${section.id}" data-open="${open}" aria-expanded="${open}">
        <span class="sc-letter" aria-hidden="true">${complete ? "&#10003;" : section.id}</span>
        <span class="sc-section-text">
          <span class="sc-section-title">${esc(section.title)}</span>
          <span class="sc-section-sub">${complete ? "All done" : `Tick when ${doneWord}`}</span>
        </span>
        <span class="sc-section-count">${sum.received}/${sum.applicable}</span>
        <span class="sc-chevron" aria-hidden="true">${open ? "&#9662;" : "&#9656;"}</span>
      </button>
      ${complete ? "" : `<button type="button" class="sc-all-btn" data-action="sectionAll" data-section="${section.id}" aria-label="Tick all pending in ${esc(section.title)}">&#10003; All</button>`}
    </div>
    <div class="sc-section-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
    ${open ? `<div class="sc-items">${items.length ? items.map(item => itemHtml(item, section)).join("") : `<div class="sc-empty">Nothing pending</div>`}</div>` : ""}
  </section>`;
}

function remarkHtml(item) {
  const remark = state.data.items?.[item.key]?.remark || "";
  if (state.editingRemark === item.key) {
    return `<input type="text" class="sc-remark" data-remark="${item.key}" value="${esc(remark)}" placeholder="Add a remark" aria-label="Remark for item ${item.no}" enterkeyhint="done">`;
  }
  return remark ? `<button type="button" class="sc-remark-text" data-action="editRemark" data-key="${item.key}">${esc(remark)}</button>` : "";
}

function noteButton(item) {
  const has = Boolean(state.data.items?.[item.key]?.remark) || state.editingRemark === item.key;
  return has ? "" : `<button type="button" class="sc-icon-btn" data-action="editRemark" data-key="${item.key}" aria-label="Add remark for item ${item.no}" title="Add remark">&#9998;</button>`;
}

// One line per item: tap the tick (or the label) to mark it done; N/A only
// where allowed; remarks open from the pencil.
function itemHtml(item, section) {
  if (item.years) return yearItemHtml(item);
  const status = itemStatus(state.data, item);
  const doneWord = section.doneLabel || "Received";
  return `<div class="sc-row sc-row--${status}">
    <span class="sc-no">${item.no}</span>
    <div class="sc-row-main">
      <button type="button" class="sc-row-label" data-action="toggleDone" data-key="${item.key}">${esc(itemLabel(item))}</button>
      ${remarkHtml(item)}
    </div>
    ${noteButton(item)}
    ${allowsNA(item) ? `<button type="button" class="sc-na${status === "na" ? " on" : ""}" aria-pressed="${status === "na"}" data-action="toggleNA" data-key="${item.key}" aria-label="Not applicable: item ${item.no}">N/A</button>` : ""}
    <button type="button" class="sc-check${status === "received" ? " on" : ""}" aria-pressed="${status === "received"}" data-action="toggleDone" data-key="${item.key}" aria-label="${esc(doneWord)}: item ${item.no}" title="${esc(doneWord)}">&#10003;</button>
  </div>`;
}

// Year-wise question: a compact table, one line per financial year with the
// same N/A and tick buttons. The year is typed in; "+ Add year" adds the
// year after the latest one.
function yearRowHtml(item, row) {
  const sub = item.years === "itr" ? ayLabel(row.year) : bsStage(state.data, row.year);
  return `<div class="sc-yt-row sc-yt-row--${row.status}">
      <label class="sc-yt-field"><span aria-hidden="true">FY</span>
        <input type="text" class="sc-yt-input" inputmode="numeric" autocomplete="off" maxlength="12"
          data-year-of="${item.key}" data-year="${row.year}" value="${esc(fyInput(row.year))}"
          placeholder="2023-24" aria-label="Financial year, e.g. 2023-24">
      </label>
      <span class="sc-yt-sub">${esc(sub)}</span>
      <button type="button" class="sc-na${row.status === "na" ? " on" : ""}" aria-pressed="${row.status === "na"}" data-action="rowToggle" data-value="na" data-key="${item.key}" data-year="${row.year}" aria-label="Not applicable: ${esc(fyLabel(row.year))}">N/A</button>
      <button type="button" class="sc-check sc-check--sm${row.status === "received" ? " on" : ""}" aria-pressed="${row.status === "received"}" data-action="rowToggle" data-value="received" data-key="${item.key}" data-year="${row.year}" aria-label="Received: ${esc(fyLabel(row.year))}">&#10003;</button>
      <button type="button" class="sc-yt-del" data-action="rowDelete" data-key="${item.key}" data-year="${row.year}" aria-label="Delete ${esc(fyLabel(row.year))}">&#215;</button>
    </div>`;
}

function yearItemHtml(item) {
  const data = state.data;
  const status = itemStatus(data, item);
  const rows = yearRows(data, item);
  const { done, na, total } = yearProgress(data, item);
  const anyPending = rows.some(row => row.status === "pending");
  return `<div class="sc-row sc-row--years sc-row--${status}">
    <span class="sc-no">${item.no}</span>
    <div class="sc-row-main">
      <div class="sc-years-head">
        <span class="sc-years-title">${esc(itemLabel(item))}</span>
        <span class="sc-fin-count${rows.length && !anyPending ? " done" : ""}">${done}/${total}${na ? ` · ${na} N/A` : ""}</span>
        ${noteButton(item)}
      </div>
      ${remarkHtml(item)}
      <div class="sc-yt">
        ${rows.length ? rows.map(row => yearRowHtml(item, row)).join("") : `<div class="sc-empty">No years – add at least one.</div>`}
      </div>
      <div class="sc-yt-actions">
        <button type="button" class="sc-link-btn" data-action="rowAdd" data-key="${item.key}">+ Add year</button>
        ${anyPending ? `<button type="button" class="sc-link-btn sc-link-btn--ok" data-action="rowsAll" data-key="${item.key}">&#10003; All years received</button>` : ""}
      </div>
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
  else if (action === "editDetails") { state.editDetails = !state.editDetails; render(); }
  else if (action === "pendingOnly") { state.pendingOnly = !state.pendingOnly; render(); }
  else if (action === "toggleSection") {
    state.toggled.set(target.dataset.section, target.dataset.open !== "true");
    render();
  } else if (action === "sectionAll") {
    markSectionDone(target.dataset.section);
  } else if (action === "editRemark") {
    state.editingRemark = target.dataset.key;
    render();
  } else if (action === "toggleDone" || action === "toggleNA") {
    const item = findItem(target.dataset.key);
    if (!item) return;
    const want = action === "toggleDone" ? "received" : "na";
    setItem(item.key, { status: itemStatus(state.data, item) === want ? "pending" : want });
    render();
  } else if (action === "rowToggle") {
    const year = Number(target.dataset.year);
    const want = target.dataset.value;
    updateRows(target.dataset.key, rows => rows.map(row => (row.year === year ? { ...row, status: row.status === want ? "pending" : want } : row)));
  } else if (action === "rowDelete") {
    const year = Number(target.dataset.year);
    updateRows(target.dataset.key, rows => rows.filter(row => row.year !== year));
  } else if (action === "rowAdd") {
    const item = findItem(target.dataset.key);
    const year = item ? nextYear(state.data, item) : null;
    if (year != null) updateRows(target.dataset.key, rows => [...rows, { year, status: "pending" }]);
  } else if (action === "rowsAll") {
    updateRows(target.dataset.key, rows => rows.map(row => (row.status === "pending" ? { ...row, status: "received" } : row)));
  }
}

// "✓ All" on a section: ticks every pending item (and pending year) after a
// confirmation, leaving N/A choices alone.
async function markSectionDone(sectionId) {
  const section = visibleSections(state.data).find(entry => entry.id === sectionId);
  if (!section) return;
  const pending = section.items.filter(item => itemStatus(state.data, item) === "pending");
  if (!pending.length) return;
  const word = (section.doneLabel || "Received").toLowerCase();
  const ok = await appConfirm({
    title: `Tick all in ${section.title}?`,
    message: `Mark ${pending.length} pending ${pending.length === 1 ? "item" : "items"} as ${word}.`,
    confirmLabel: "Tick all",
  });
  if (!ok) return;
  for (const item of pending) {
    if (item.years) {
      const rows = yearRows(state.data, item).map(row => (row.status === "pending" ? { ...row, status: "received" } : row));
      setItem(item.key, { rows });
    } else {
      setItem(item.key, { status: "received" });
    }
  }
  render();
}

function onChange(event) {
  const target = event.target;
  if (target.dataset.yearOf) {
    const key = target.dataset.yearOf;
    const from = Number(target.dataset.year);
    const to = parseFy(target.value);
    const item = findItem(key);
    if (to == null) { toast("Type the year like 2023-24"); render(); return; }
    if (to === from) { render(); return; }
    if (item && yearRows(state.data, item).some(row => row.year === to)) { toast(`${fyLabel(to)} is already listed`); render(); return; }
    updateRows(key, rows => rows.map(row => (row.year === from ? { ...row, year: to } : row)));
    return;
  }
  if (target.dataset.remark) {
    // Saved without re-drawing: a redraw here would swallow the tap that
    // moved focus away. The next redraw shows it as plain text.
    setItem(target.dataset.remark, { remark: target.value.trim() });
    state.editingRemark = null;
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
