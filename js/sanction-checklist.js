// Pre-sanction checklist — standalone admin tool opened from the
// admin menu (user pill dropdown). Loaded lazily; it does not read or
// write loans. Checklists are stored in the `sanctionChecklists` collection.
import {
  collection, deleteDoc, doc, getDocs, orderBy, query, setDoc, updateDoc, where,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./config.js";
import { S } from "./state.js";
import { appConfirm, esc, toast, todayStr } from "./utils.js";
import { closeOverlay, openOverlay } from "./animate.js";
import {
  AMOUNT_WARN_LAKH, COLLATERAL_MODES, CONSTITUTIONS, EDU_COLLATERAL_LIMIT_LAKH, FACILITIES, RELATIONS,
  WORK_TYPES, allowsNA, amountWarning, ayLabel, bsStage, collateralRequired, facilityFromLoanType, fyLabel,
  hiddenSections, isEducation, isProfileComplete, itemLabel, itemStatus, newChecklist, nextYear, fyInput,
  parseAmountLakh, parseFy, pendingTags, relationLabel, sectionSummary, summarize, visibleSections,
  workLabel, yearProgress, yearRows,
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
  focusRemark: false,   // focus the remark box once, right after the pencil is tapped
  justToggled: null,
  meters: new Map(),    // last drawn percentage per bar, for animating changes    // "key" or "key:year" of the last tick, to animate just that one
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
        <button type="button" class="sc-close" aria-label="Close checklists" onclick="closeChecklistList()">&#215;</button>
      </div>
      <div class="sc-intro">For SME loans up to ₹${AMOUNT_WARN_LAKH} lakh and education loans.</div>
      <div class="sc-new-row">
        <button type="button" class="btn btn-primary-full sc-new-btn" onclick="openSanctionChecklist(null, 'sme')">+ SME checklist</button>
        <button type="button" class="btn btn-primary-full sc-new-btn" onclick="openSanctionChecklist(null, 'education')">+ Education checklist</button>
      </div>
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
        <span class="sc-list-meta">${isEducation(item) ? `<span class="sc-type-tag">Education</span>` : `<span class="sc-type-tag sc-type-tag--sme">SME</span> ${esc(facilityShort(item.facility))}`} · ${esc(fmtLakh(item.amountLakh))} · ${esc(fmtDate((item.createdAt || "").slice(0, 10)))}${done ? ` · ${done.pending} pending` : ""}</span>
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
        <span class="sc-save" id="scSaveState" data-state="" role="status" aria-live="polite"><span class="sc-sr-only"></span></span>
        <button type="button" class="sc-pdf-btn" id="scPdfBtn" data-action="exportPdf" hidden aria-label="Export checklist as PDF" title="Export PDF">
          <svg class="sc-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg><span>PDF</span>
        </button>
        <button type="button" class="sc-close" aria-label="Close checklist" data-action="close">&#215;</button>
      </div>
      <div id="scBody"></div>
    </div>`;
  overlay.addEventListener("click", onClick);
  overlay.addEventListener("change", onChange);
  overlay.addEventListener("input", onInput);
  overlay.addEventListener("keydown", event => {
    const field = event.target.dataset;
    if (event.key === "Enter" && (field.remark || field.yearOf)) event.target.blur();
    // Escape in a remark box just closes the box, not the whole checklist.
    if (event.key === "Escape" && field.remark) {
      event.stopPropagation();
      event.target.blur();
    }
  });
  // Leaving a remark box always ends the edit, even if nothing was typed
  // (an unchanged box fires no "change"), so later redraws don't re-focus it
  // and pop the keyboard up again.
  overlay.addEventListener("focusout", event => {
    if (event.target.dataset?.remark && state.editingRemark === event.target.dataset.remark) {
      state.editingRemark = null;
      state.focusRemark = false;
    }
  });
  document.body.appendChild(overlay);
  return overlay;
}

// Escape closes the top sheet: the open checklist first, then the list.
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(".confirm-overlay")) return;
  if (event.target?.dataset?.remark) return;
  if (isOpen(OVERLAY_ID)) closeSanctionChecklist();
  else if (isOpen(LIST_ID)) closeChecklistList();
});

// Load a checklist (existing doc, or a fresh draft) into the editor state and
// show the sheet. `id` is null for an unsaved draft.
function loadChecklistState(data, id, overlay) {
  state.id = id || null;
  state.data = structuredClone({ ...data, items: data.items || {} });
  delete state.data.id;
  state.pendingOnly = false;
  state.toggled = new Map();
  state.editDetails = false;
  state.editingRemark = null;
  state.focusRemark = false;
  state.meters = new Map();
  state.dirty = {};
  setSaveState("");
  render();
  overlay.querySelector(".sc-sheet").scrollTop = 0;
  openOverlay(overlay);
}

// `type` ("sme" / "education") picks the template for a new checklist.
function openSanctionChecklist(id, type = "sme") {
  if (!S.isAdmin) { toast("Admin access required"); return; }
  ensureStyles();
  const overlay = ensureOverlay();
  const existing = id ? cachedList.find(entry => entry.id === id) : null;
  if (id && !existing) { toast("Checklist not found"); return; }
  loadChecklistState(existing || newChecklist({ today: todayStr(), user: S.user, type }), existing?.id, overlay);
}

// ── Loan link ────────────────────────────────────────────────────────────
// The checklist for a loan is found by its `loanId`. There is at most one.
async function findChecklistForLoan(loanId) {
  const cached = cachedList.find(entry => entry.loanId === loanId);
  if (cached) return cached;
  const snap = await getDocs(query(collection(db, COLLECTION), where("loanId", "==", loanId)));
  if (snap.empty) return null;
  const found = { ...snap.docs[0].data(), id: snap.docs[0].id };
  // Keep it around so the admin list and later lookups see it too.
  if (!cachedList.some(entry => entry.id === found.id)) cachedList.push(found);
  return found;
}

// Opened from a pending SME or education loan's status sheet: open the loan's
// checklist, or start a new one pre-filled from the loan (borrower or
// student, facility for SME, amount). The loan's category picks the type.
async function openLoanChecklist(loanId) {
  const loan = S.loans.find(entry => entry.id === loanId);
  if (!loan) { toast("Loan not found"); return; }
  ensureStyles();
  const overlay = ensureOverlay();
  let existing = null;
  try {
    existing = await findChecklistForLoan(loanId);
  } catch (error) {
    console.error("[Checklist] loan lookup failed", error);
    toast("Could not load the checklist");
    return;
  }
  if (existing) { loadChecklistState(existing, existing.id, overlay); return; }
  const education = loan.category === "Education";
  const draft = newChecklist({ today: todayStr(), user: S.user, type: education ? "education" : "sme" });
  draft.loanId = loanId;
  draft.borrowerName = loan.customerName || "";
  if (!education) draft.facility = facilityFromLoanType(loan.loanType || (loan.isTermLoan ? "TL" : "CC"));
  draft.amountLakh = Number(loan.amount) || null;
  loadChecklistState(draft, null, overlay);
}

// Progress summary for a loan's checklist, for the status-sheet line. Returns
// null when none exists yet (so the sheet offers "Create checklist").
async function loanChecklistInfo(loanId) {
  const existing = await findChecklistForLoan(loanId);
  if (!existing) return null;
  const ready = isProfileComplete(existing);
  const sum = ready ? summarize(existing) : null;
  return {
    exists: true,
    id: existing.id,
    ready,
    received: sum ? sum.received : 0,
    applicable: sum ? sum.applicable : 0,
    pending: sum ? sum.pending : 0,
    percent: sum ? sum.percent : 0,
    // Short keywords of what's still outstanding, for the card snippet and the
    // branch reminder mail (branchTags drops the officer-pulled CIC/MCA items).
    tags: ready ? pendingTags(existing) : [],
    branchTags: ready ? pendingTags(existing, { branchOnly: true }) : [],
  };
}

function closeSanctionChecklist() {
  flushSave();
  const loanId = state.data?.loanId || null;
  // Re-read so the list shows this checklist's latest percentage.
  closeOverlay(OVERLAY_ID, () => { if (isOpen(LIST_ID)) loadList(); });
  // Let an open loan status sheet refresh its checklist line.
  if (loanId) document.dispatchEvent(new CustomEvent("loanchecklistchange", { detail: { loanId } }));
}

// Which sections are showing, to tell whether an amount change needs a redraw.
const sectionsKey = data => visibleSections(data).map(section => section.id).join("");

function render() {
  const body = document.getElementById("scBody");
  if (!body) return;
  const data = state.data;
  const sections = visibleSections(data);
  state.drawnSections = sections.map(section => section.id).join("");
  const profileReady = isProfileComplete(data);
  const pdfBtn = document.getElementById("scPdfBtn");
  const title = document.getElementById("scTitle");
  const edu = isEducation(data);
  if (title) title.textContent = edu ? "Education Checklist" : "Pre-Sanction Checklist";
  const details = edu ? eduDetailsHtml(data) : detailsHtml(data);
  if (!state.id) {
    if (pdfBtn) pdfBtn.hidden = true;
    body.innerHTML = details + createHtml(data, profileReady);
    return;
  }
  if (pdfBtn) pdfBtn.hidden = !profileReady;
  const editing = state.editDetails || !profileReady;
  const missingHint = edu
    ? "Answer the student and co-applicant questions (and the amount, for collateral by amount) to see the checklist."
    : "Answer constitution, facility, collateral and premises to see the checklist.";
  body.innerHTML = `
    ${editing ? details + (profileReady ? `<button type="button" class="sc-pill-btn sc-details-done" data-action="editDetails">Done editing</button>` : `<div class="sc-hint">${esc(missingHint)}</div>`) : ""}
    ${profileReady ? heroHtml(data, sections, editing) + sections.map(sectionHtml).join("") + hiddenNoteHtml(sections) : ""}`;
  state.justToggled = null;
  animateMeters(body);
  if (state.editingRemark && state.focusRemark) {
    state.focusRemark = false;
    const input = body.querySelector(`[data-remark="${state.editingRemark}"]`);
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }
}

function selectHtml(id, name, options, value, placeholder) {
  return `<select id="${id}" name="${name}" data-field="${name}">
    <option value="" ${value ? "" : "selected"} disabled>${esc(placeholder)}</option>
    ${options.map(opt => `<option value="${esc(opt.value)}" ${opt.value === value ? "selected" : ""}>${esc(opt.label)}</option>`).join("")}
  </select>`;
}

function yesNoHtml(id, label, action, value, field = "") {
  const yes = value === true;
  const no = value === false;
  const fieldAttr = field ? ` data-choice="${field}"` : "";
  return `<div class="form-group">
      <span class="form-label" id="${id}">${esc(label)}</span>
      <div class="sc-seg" role="radiogroup" aria-labelledby="${id}">
        <button type="button" role="radio" aria-checked="${yes}" class="${yes ? "on" : ""}" data-action="${action}"${fieldAttr} data-value="yes">Yes</button>
        <button type="button" role="radio" aria-checked="${no}" class="${no ? "on" : ""}" data-action="${action}"${fieldAttr} data-value="no">No</button>
      </div>
    </div>`;
}

// Segmented choice over a list of options (used for the collateral mode).
function choiceHtml(id, label, field, options, value) {
  return `<div class="form-group sc-full">
      <span class="form-label" id="${id}">${esc(label)}</span>
      <div class="sc-seg" role="radiogroup" aria-labelledby="${id}">
        ${options.map(opt => {
          const on = opt.value === value;
          return `<button type="button" role="radio" aria-checked="${on}" class="${on ? "on" : ""}" data-action="choice" data-choice="${field}" data-value="${esc(opt.value)}">${esc(opt.label)}</button>`;
        }).join("")}
      </div>
    </div>`;
}

// What collateral means for this education loan right now, in words.
function collateralNote(data) {
  const required = collateralRequired(data);
  const mode = data.collateralMode || "auto";
  if (mode !== "auto") return required ? "Collateral required – set manually." : "No collateral – set manually.";
  if (required == null) return `Enter the amount: collateral is needed above ₹${EDU_COLLATERAL_LIMIT_LAKH} lakh.`;
  return required
    ? `Above ₹${EDU_COLLATERAL_LIMIT_LAKH} lakh – collateral required.`
    : `Up to ₹${EDU_COLLATERAL_LIMIT_LAKH} lakh – no collateral needed.`;
}

function coApplicantFieldsHtml(data, n) {
  return `<div class="sc-subhead sc-full">Co-applicant ${n}</div>
    <div class="form-group">
      <label for="scCo${n}Relation">Relation to student</label>
      ${selectHtml(`scCo${n}Relation`, `co${n}Relation`, RELATIONS, data[`co${n}Relation`], "Select")}
    </div>
    <div class="form-group">
      <label for="scCo${n}Work">Work</label>
      ${selectHtml(`scCo${n}Work`, `co${n}Work`, WORK_TYPES, data[`co${n}Work`], "Select")}
    </div>`;
}

function eduDetailsHtml(data) {
  return `<div class="sc-card sc-details">
    <div class="form-group sc-full">
      <label for="scBorrower">Student Name</label>
      <input id="scBorrower" type="text" data-field="borrowerName" value="${esc(data.borrowerName)}" placeholder="e.g. RIYA SHARMA" autocomplete="off">
    </div>
    <div class="form-group">
      <label for="scCourse">Course / Institute</label>
      <input id="scCourse" type="text" data-field="course" value="${esc(data.course || "")}" placeholder="e.g. B.Tech, IIT Delhi" autocomplete="off">
    </div>
    <div class="form-group">
      <label for="scAmount">Amount (in Lakhs)</label>
      <input id="scAmount" type="number" inputmode="decimal" min="0" step="0.01" data-field="amountLakh" value="${data.amountLakh ?? ""}" placeholder="e.g. 12">
    </div>
    <div class="sc-yesno-row sc-full">
      ${yesNoHtml("scAbroadLabel", "Studying abroad?", "choice", data.studyAbroad, "studyAbroad")}
      ${yesNoHtml("scDegreeLabel", "Degree after 12th?", "choice", data.priorDegree, "priorDegree")}
    </div>
    ${coApplicantFieldsHtml(data, 1)}
    <div class="sc-yesno-row sc-full">
      ${yesNoHtml("scSecondCoLabel", "Second co-applicant?", "choice", data.secondCoApplicant, "secondCoApplicant")}
    </div>
    ${data.secondCoApplicant === true ? coApplicantFieldsHtml(data, 2) : ""}
    ${choiceHtml("scCollateralModeLabel", "Collateral", "collateralMode", COLLATERAL_MODES, data.collateralMode || "auto")}
    <div class="sc-note sc-full" id="scCollateralNote">${esc(collateralNote(data))}</div>
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

function createHint(data, profileReady) {
  if (profileReady && (data.borrowerName || "").trim()) return "Ready to start.";
  return isEducation(data)
    ? "Fill in the student name, amount, study and co-applicant questions to start."
    : "Fill in the borrower name, facility, constitution, collateral and premises to start.";
}

function createHtml(data, profileReady) {
  const ready = profileReady && (data.borrowerName || "").trim();
  return `<div class="sc-hint" id="scCreateHint">${esc(createHint(data, profileReady))}</div>
    <button type="button" class="btn btn-primary-full sc-create" data-action="create" ${ready ? "" : "disabled"}>Create checklist</button>`;
}

// ── Icons (inline SVG, drawn with currentColor) ──────────────────────────
const svg = (body, cls = "") => `<svg class="sc-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', "sc-ico-check"),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  close: svg('<path d="M7 7l10 10M17 7L7 17"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>', "sc-ico-chevron"),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>'),
  checks: svg('<path d="M3 12.5l4 4L15 8.5"/><path d="M11 16.5l1 1L21 8.5"/>'),
};
const SECTION_ICON = {
  A: svg('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.6-3.7 3.8-5.6 7.5-5.6s6.9 1.9 7.5 5.6"/>'),
  B: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.6-4.6"/>'),
  C: svg('<path d="M5 20V11M12 20V5M19 20v-7"/>'),
  D: svg('<path d="M3 21h18M5 21V10l5 3V10l5 3V6l4 2v13"/>'),
  E: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>'),
  F: svg('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>'),
  G: svg('<rect x="6" y="4.5" width="12" height="16.5" rx="2.5"/><path d="M9.5 3.5h5v3h-5z"/><path d="M9 13.5l2 2 4-4"/>'),
};
// Education sections name their icon (`section.icon`) instead of using the
// SME letter, since the letters mean different things there.
const NAMED_ICON = {
  student: svg('<path d="M2.5 9L12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.5c1.5 1.6 3.4 2.4 5.5 2.4s4-.8 5.5-2.4V11"/><path d="M21.5 9v5"/>'),
  people: svg('<circle cx="9" cy="8.5" r="3"/><path d="M3 19.5c.5-3.2 3-5 6-5s5.5 1.8 6 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.5 14.6c2.4.2 4.1 1.8 4.5 4.4"/>'),
  book: svg('<path d="M4 5.5c2.7-1 5.3-1 8 .8v13c-2.7-1.8-5.3-1.8-8-.8z"/><path d="M20 5.5c-2.7-1-5.3-1-8 .8v13c2.7-1.8 5.3-1.8 8-.8z"/>'),
  school: svg('<path d="M3 20.5h18"/><path d="M5 20.5V10l7-4.5 7 4.5v10.5"/><path d="M10 20.5v-5h4v5"/>'),
  plane: svg('<path d="M10.5 13.5L3 11l1.5-1.5 8 .5 4.5-4.5c.8-.8 2.2-.8 3 0s.8 2.2 0 3L15.5 13l.5 8-1.5 1.5-2.5-7.5-3.5 3.5V21l-1.5 1.5-1-3.5-3.5-1L4 16.5h2.5z"/>'),
  search: SECTION_ICON.B,
  lock: SECTION_ICON.F,
};
const sectionIcon = section => (section.icon ? NAMED_ICON[section.icon] : SECTION_ICON[section.id]) || section.id;

const initialsOf = name => (name || "?").trim().split(/\s+/).slice(0, 2).map(word => word[0] || "").join("").toUpperCase() || "?";

// Header card: who the borrower is, and how far the checklist has got.
// The Pending tile doubles as the "pending only" filter.
function heroFacts(data) {
  if (isEducation(data)) {
    const coApplicants = [1, ...(data.secondCoApplicant ? [2] : [])]
      .map(n => `${relationLabel(data[`co${n}Relation`])} (${workLabel(data[`co${n}Work`])})`);
    const auto = (data.collateralMode || "auto") === "auto";
    return {
      facts: ["Education", fmtLakh(data.amountLakh), data.course || ""].filter(Boolean),
      flags: [
        { text: data.studyAbroad ? "Study abroad" : "Study in India", tone: "sky" },
        { text: `Co-applicant${coApplicants.length > 1 ? "s" : ""}: ${coApplicants.join(", ")}`, tone: "sky" },
        { text: `${collateralRequired(data) ? "Collateral" : "No collateral"} – ${auto ? "by amount" : "overridden"}`, tone: "mint" },
      ],
    };
  }
  return {
    facts: [
      facilityShort(data.facility),
      fmtLakh(data.amountLakh),
      CONSTITUTIONS.find(opt => opt.value === data.constitution)?.label || "",
    ].filter(Boolean),
    flags: [
      { text: data.collateral ? "With collateral" : "CGTMSE", tone: "mint" },
      { text: data.rented ? "Rented premises" : "Owned premises", tone: "sky" },
    ],
  };
}

function heroHtml(data, sections, editing) {
  const sum = summarize(data, sections);
  const { facts, flags } = heroFacts(data);
  const warning = isEducation(data) ? "" : amountWarning(data.amountLakh);
  const complete = sum.applicable > 0 && sum.pending === 0;
  const status = complete
    ? "All items done"
    : `${sum.pending} ${sum.pending === 1 ? "item" : "items"} left to collect`;
  return `<div class="sc-hero${complete ? " is-complete" : ""}">
    <div class="sc-hero-top">
      <span class="sc-hero-avatar" aria-hidden="true">${esc(initialsOf(data.borrowerName))}</span>
      <div class="sc-hero-id">
        <span class="sc-hero-name">${esc(data.borrowerName || "Unnamed borrower")}</span>
        <span class="sc-hero-facts">${facts.map(esc).join('<i aria-hidden="true">•</i>')}</span>
      </div>
      ${editing ? "" : `<button type="button" class="sc-hero-icon" data-action="editDetails" aria-label="Edit ${isEducation(data) ? "student" : "borrower"} details" title="Edit details">${ICON.edit}</button>`}
    </div>
    <div class="sc-hero-flags">
      ${flags.map(flag => `<span class="sc-flag sc-flag--${flag.tone}">${esc(flag.text)}</span>`).join("")}
      ${warning ? `<span class="sc-hero-warn">&#9888; Above ₹${AMOUNT_WARN_LAKH} lakh</span>` : ""}
    </div>
    <div class="sc-hero-panel">
      <div class="sc-ring" ${meterAttrs("ring", sum.percent)} role="img" aria-label="${sum.percent}% complete">
        <span><b>${Math.round(sum.percent)}</b><small>%</small></span>
      </div>
      <div class="sc-hero-right">
        <span class="sc-hero-status">${esc(status)}</span>
        <div class="sc-hero-tiles">
          <span class="sc-tile sc-tile--done"><b>${sum.received}</b><small>Done</small></span>
          <button type="button" class="sc-tile sc-tile--pending${state.pendingOnly ? " on" : ""}" data-action="pendingOnly" aria-pressed="${state.pendingOnly}" aria-label="${sum.pending} pending. ${state.pendingOnly ? "Showing pending only – tap to show all" : "Tap to show pending only"}" title="${state.pendingOnly ? "Show all items" : "Show pending only"}">
            <b>${sum.pending}</b><small>Pending ${ICON.filter}</small>
          </button>
          <span class="sc-tile sc-tile--na"><b>${sum.na}</b><small>N/A</small></span>
        </div>
      </div>
    </div>
  </div>`;
}

// Every section starts closed; the officer opens the ones being worked on.
function sectionOpen(section) {
  return state.toggled.get(section.id) === true;
}

// Progress bars and the ring animate from their last value to the new one:
// they are drawn at the old value and moved to the new one after the redraw
// (see animateMeters). Opening the checklist animates them up from zero.
function meterAttrs(key, pct) {
  const from = state.meters.has(key) ? state.meters.get(key) : 0;
  state.meters.set(key, pct);
  return `data-meter-to="${pct}" style="--from:${from};--to:${pct}"`;
}

function animateMeters(root) {
  const meters = root.querySelectorAll("[data-meter-to]");
  if (!meters.length) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    meters.forEach(el => el.classList.add("is-set"));
  }));
}

function sectionHtml(section) {
  const data = state.data;
  const sum = sectionSummary(data, section);
  const complete = sum.pending === 0;
  const open = sectionOpen(section);
  const items = state.pendingOnly
    ? section.items.filter(item => itemStatus(data, item) === "pending")
    : section.items;
  const pct = sum.applicable ? Math.round((sum.received / sum.applicable) * 100) : 100;
  const doneWord = (section.doneLabel || "Received").toLowerCase();
  return `<section class="sc-section sc-section--${section.id.toLowerCase()}${complete ? " is-complete" : ""}${open ? " is-open" : ""}">
    <button type="button" class="sc-section-head" data-action="toggleSection" data-section="${section.id}" data-open="${open}" aria-expanded="${open}">
      <span class="sc-section-icon" aria-hidden="true">${complete ? ICON.check : sectionIcon(section)}</span>
      <span class="sc-section-text">
        <span class="sc-section-title"><span class="sc-section-letter">${section.id}</span><span class="sc-section-name">${esc(section.title)}</span></span>
        <span class="sc-section-progress">
          <span class="sc-section-meter" aria-hidden="true"><span class="sc-meter-fill" ${meterAttrs(`s:${section.id}`, pct)}></span></span>
          <span class="sc-section-count" aria-label="${sum.received} of ${sum.applicable} ${doneWord}">${complete ? "Done" : `${sum.received}/${sum.applicable}`}</span>
        </span>
      </span>
      ${ICON.chevron}
    </button>
    ${open ? `<div class="sc-items">${items.length ? items.map(item => itemHtml(item, section)).join("") : `<div class="sc-empty">Nothing pending here</div>`}</div>` : ""}
  </section>`;
}

function remarkHtml(item) {
  const remark = state.data.items?.[item.key]?.remark || "";
  if (state.editingRemark === item.key) {
    return `<input type="text" class="sc-remark" data-remark="${item.key}" value="${esc(remark)}" placeholder="Add a remark…" aria-label="Remark for item ${item.no}" enterkeyhint="done">`;
  }
  return remark ? `<button type="button" class="sc-remark-text" data-action="editRemark" data-key="${item.key}" aria-label="Edit remark">${ICON.pencil}<span>${esc(remark)}</span></button>` : "";
}

function noteButton(item) {
  const has = Boolean(state.data.items?.[item.key]?.remark) || state.editingRemark === item.key;
  return has ? "" : `<button type="button" class="sc-icon-btn" data-action="editRemark" data-key="${item.key}" aria-label="Add remark for item ${item.no}" title="Add remark">${ICON.pencil}</button>`;
}

function checkButton({ on, pop, cls = "", attrs, label }) {
  return `<button type="button" class="sc-check${on ? " on" : ""}${pop ? " pop" : ""} ${cls}" aria-pressed="${on}" ${attrs} aria-label="${esc(label)}" title="${esc(label)}">${ICON.check}</button>`;
}

function naButton({ on, attrs, label }) {
  return `<button type="button" class="sc-na${on ? " on" : ""}" aria-pressed="${on}" ${attrs} aria-label="${esc(label)}">N/A</button>`;
}

// One card per item: tap the check (or the label) to mark it done; N/A only
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
    <div class="sc-row-actions">
      ${noteButton(item)}
      ${allowsNA(item) ? naButton({ on: status === "na", attrs: `data-action="toggleNA" data-key="${item.key}"`, label: `Not applicable: item ${item.no}` }) : ""}
      ${checkButton({ on: status === "received", pop: state.justToggled === item.key, attrs: `data-action="toggleDone" data-key="${item.key}"`, label: `${doneWord}: item ${item.no}` })}
    </div>
  </div>`;
}

// Year-wise question: a compact table, one line per financial year with the
// same N/A and check buttons. The year is typed in; "+ Add year" adds the
// year after the latest one.
function yearRowHtml(item, row) {
  const sub = item.years === "itr" ? ayLabel(row.year) : bsStage(state.data, row.year);
  const tag = `${item.key}:${row.year}`;
  return `<div class="sc-yt-row sc-yt-row--${row.status}">
      <label class="sc-yt-field"><span class="sc-yt-prefix" aria-hidden="true">FY</span>
        <input type="text" class="sc-yt-input" inputmode="numeric" autocomplete="off" maxlength="12"
          data-year-of="${item.key}" data-year="${row.year}" value="${esc(fyInput(row.year))}"
          placeholder="2023-24" aria-label="Financial year, e.g. 2023-24">
      </label>
      <span class="sc-yt-sub">${esc(sub)}</span>
      ${naButton({ on: row.status === "na", attrs: `data-action="rowToggle" data-value="na" data-key="${item.key}" data-year="${row.year}"`, label: `Not applicable: ${fyLabel(row.year)}` })}
      ${checkButton({ on: row.status === "received", pop: state.justToggled === tag, cls: "sc-check--sm", attrs: `data-action="rowToggle" data-value="received" data-key="${item.key}" data-year="${row.year}"`, label: `Received: ${fyLabel(row.year)}` })}
      <button type="button" class="sc-yt-del" data-action="rowDelete" data-key="${item.key}" data-year="${row.year}" aria-label="Delete ${esc(fyLabel(row.year))}" title="Delete year">${ICON.close}</button>
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
        <span class="sc-count-pill${rows.length && !anyPending ? " done" : ""}">${done}/${total}${na ? ` · ${na} N/A` : ""}</span>
        ${noteButton(item)}
      </div>
      ${remarkHtml(item)}
    </div>
    <div class="sc-years-body">
      <div class="sc-yt">
        ${rows.length ? rows.map(row => yearRowHtml(item, row)).join("") : `<div class="sc-empty">No years – add at least one.</div>`}
      </div>
      <div class="sc-yt-actions">
        <button type="button" class="sc-pill-btn" data-action="rowAdd" data-key="${item.key}">${ICON.plus}<span>Add year</span></button>
        ${anyPending ? `<button type="button" class="sc-pill-btn sc-pill-btn--ok" data-action="rowsAll" data-key="${item.key}">${ICON.checks}<span>All years received</span></button>` : ""}
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
  const hidden = hiddenSections(state.data, sections);
  if (!hidden.length) return "";
  return `<div class="sc-hint sc-hidden-note">Not applicable: ${hidden.map(entry => esc(`${entry.id} – ${entry.title} (${entry.reason})`)).join(", ")}.</div>`;
}

// ── Events ───────────────────────────────────────────────────────────────

function onClick(event) {
  if (event.target.id === OVERLAY_ID) { closeSanctionChecklist(); return; }
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "close") closeSanctionChecklist();
  else if (action === "exportPdf") exportPdf(target);
  else if (action === "collateral") setField("collateral", target.dataset.value === "yes", true);
  else if (action === "rented") setField("rented", target.dataset.value === "yes", true);
  else if (action === "choice") {
    // Yes/No questions store booleans; the collateral mode keeps its word.
    const field = target.dataset.choice;
    const raw = target.dataset.value;
    const value = field === "collateralMode" ? raw : raw === "yes";
    setField(field, value, true);
  }
  else if (action === "create") createChecklist();
  else if (action === "editDetails") { state.editDetails = !state.editDetails; render(); }
  else if (action === "pendingOnly") { state.pendingOnly = !state.pendingOnly; render(); }
  else if (action === "toggleSection") {
    state.toggled.set(target.dataset.section, target.dataset.open !== "true");
    render();
  } else if (action === "editRemark") {
    state.editingRemark = target.dataset.key;
    state.focusRemark = true;
    render();
  } else if (action === "toggleDone" || action === "toggleNA") {
    const item = findItem(target.dataset.key);
    if (!item) return;
    const want = action === "toggleDone" ? "received" : "na";
    const next = itemStatus(state.data, item) === want ? "pending" : want;
    if (next === "received") state.justToggled = item.key;
    setItem(item.key, { status: next });
    render();
  } else if (action === "rowToggle") {
    const year = Number(target.dataset.year);
    const want = target.dataset.value;
    if (want === "received") state.justToggled = `${target.dataset.key}:${year}`;
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
  // Text boxes never redraw on change: the change fires as focus moves to the
  // next control, and a redraw would swallow that tap. For education loans
  // the amount can flip collateral, so redraw only a saved checklist, and
  // only when that changes which sections show.
  if (field === "amountLakh") {
    setField(field, parseAmountLakh(target.value), false);
    if (state.id && sectionsKey(state.data) !== state.drawnSections) render();
  } else if (field === "borrowerName" || field === "course") {
    setField(field, target.value.trim(), false);
  }
  else setField(field, target.value, true);
}

function onInput(event) {
  const target = event.target;
  if (target.dataset.field === "amountLakh") {
    const warn = document.getElementById("scAmountWarn");
    const message = isEducation(state.data) ? "" : amountWarning(target.value);
    if (warn) { warn.hidden = !message; warn.textContent = message ? `⚠ ${message}` : ""; }
    if (isEducation(state.data)) {
      // Keep the collateral note and the Create button in step while typing.
      state.data.amountLakh = parseAmountLakh(target.value);
      const note = document.getElementById("scCollateralNote");
      if (note) note.textContent = collateralNote(state.data);
      refreshCreateButton();
    }
  } else if (target.dataset.field === "borrowerName" && !state.id) {
    state.data.borrowerName = target.value;
    refreshCreateButton();
  }
}

// Enables "Create checklist" on a draft once everything needed is filled in.
function refreshCreateButton() {
  if (state.id) return;
  const button = document.querySelector(`#${OVERLAY_ID} [data-action="create"]`);
  if (button) button.disabled = !(isProfileComplete(state.data) && (state.data.borrowerName || "").trim());
  const hint = document.getElementById("scCreateHint");
  if (hint) hint.textContent = createHint(state.data, isProfileComplete(state.data));
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

// ── PDF export ───────────────────────────────────────────────────────────

async function exportPdf(button) {
  if (button.disabled || !state.id) return;
  flushSave();
  button.disabled = true;
  button.classList.add("is-busy");
  toast("Preparing PDF…");
  try {
    const { exportChecklistPdf } = await import("./sanction-checklist-pdf.js");
    await exportChecklistPdf(structuredClone(state.data), { today: todayStr(), user: S.user || "" });
  } catch (error) {
    console.error("[Checklist] PDF export failed", error);
    toast("Could not create the PDF. Check the connection and try again.");
  } finally {
    button.disabled = false;
    button.classList.remove("is-busy");
  }
}

// ── Persistence ──────────────────────────────────────────────────────────

// A fixed-size icon (spinner / tick / warning), so the header never changes
// size while saving – which used to push the whole list up and down.
function setSaveState(text) {
  const el = document.getElementById("scSaveState");
  if (!el) return;
  el.dataset.state = text === "Saving…" ? "saving" : text === "Saved" ? "saved" : text ? "error" : "";
  el.title = text;
  el.firstElementChild.textContent = text;
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
window.openLoanChecklist = openLoanChecklist;
window.loanChecklistInfo = loanChecklistInfo;
window.closeSanctionChecklist = closeSanctionChecklist;
window.deleteSanctionChecklist = deleteSanctionChecklist;
