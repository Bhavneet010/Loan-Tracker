import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./config.js";
import { S } from "./state.js";
import { esc, toast, initials, officerColor, todayStr } from "./utils.js";
import { openOverlay, closeOverlay, animateOverlayIn, animateOverlayOut } from "./animate.js";

/* Personal to-do list stored per officer, per day. Each document is one task
   tagged with the date it belongs to. The board opens on today and steps a day
   at a time with the arrows. Tasks only cover a rolling 30-day window and the
   whole collection is wiped during month-end cleanup, so each month starts fresh. */
const COLLECTION = "officerTasks";
const WINDOW_DAYS = 30;

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const newTaskId = () => "task_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

/* Older tasks were stored without a date field; fall back to their creation day. */
const taskDate = t => t.date || (t.createdAt || "").slice(0, 10);

function shiftDate(dateStr, delta) {
  // Work in UTC so the ISO conversion can't shift the calendar day in
  // non-UTC timezones (e.g. IST +5:30 would otherwise roll the date back).
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/* The day the board is currently showing (defaults to today). */
function activeDate() {
  return S.taskListDate || todayStr();
}

/* Who the currently open board belongs to. Officers only ever see their own
   list; Admin picks an officer (defaults to the first one). */
function activeOfficer() {
  if (!S.isAdmin) return S.user;
  if (S.taskListOfficer && S.officers.includes(S.taskListOfficer)) return S.taskListOfficer;
  return S.officers[0] || null;
}

const orderOf = t => (typeof t.order === "number" ? t.order : Number.POSITIVE_INFINITY);

/* Officers may remove only tasks they created; a task added by Admin can be
   removed only by Admin. Admin can remove anything. */
function canDelete(t) {
  return S.isAdmin || t.createdBy === S.user;
}

const completedDay = t => (t.completedAt || "").slice(0, 10) || taskDate(t);

/* Whole days between two YYYY-MM-DD dates (never negative). */
function ageDays(fromStr, toStr) {
  const a = new Date(fromStr + "T00:00:00");
  const b = new Date(toStr + "T00:00:00");
  return Math.max(0, Math.round((b - a) / 86400000));
}

/* Tasks visible on officer O's board for day D:
   - active: every incomplete task dated on/before D — anything left unfinished
     rolls forward and keeps showing until it is completed.
   - done:   tasks completed on day D.
   Active tasks are grouped oldest day first (so carried-forward items sit on
   top), then by their manual order within the day. */
function boardTasks(officer, D) {
  const mine = S.officerTasks.filter(t => t.officer === officer);
  const active = mine
    .filter(t => !t.done && taskDate(t) <= D)
    .sort((a, b) =>
      taskDate(a).localeCompare(taskDate(b)) ||
      (orderOf(a) - orderOf(b)) ||
      (a.createdAt || "").localeCompare(b.createdAt || ""));
  const done = mine
    .filter(t => t.done && completedDay(t) === D)
    .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
  return { active, done };
}

/* Incomplete tasks on an officer's plate for day D (dated on/before D). */
function boardPending(officer, D) {
  return S.officerTasks.filter(t => t.officer === officer && !t.done && taskDate(t) <= D);
}

/* Small "how old" badge for a task carried forward to day D. */
function ageBadgeHtml(t, D) {
  const age = ageDays(taskDate(t), D);
  if (age < 1) return "";
  const cls = age >= 3 ? "tl-age tl-age--old" : "tl-age";
  return `<span class="${cls}" title="Carried forward · ${age} day${age > 1 ? "s" : ""} old">${age}d</span>`;
}

/* ── DATE LABELS ── */
function relativeLabel(dateStr) {
  const diff = Math.round(
    (new Date(dateStr + "T00:00:00") - new Date(todayStr() + "T00:00:00")) / 86400000
  );
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return null;
}

function dateMainLabel(dateStr) {
  const rel = relativeLabel(dateStr);
  if (rel) return rel;
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

function dateSubLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${WD[d.getDay()]} · ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

/* ── DATA LAYER ── */
export function subscribeOfficerTasks() {
  let firstLoad = true;
  onSnapshot(collection(db, COLLECTION), snap => {
    S.officerTasks = [];
    snap.forEach(d => S.officerTasks.push({ id: d.id, ...d.data() }));
    updateTaskListBadge();
    if (isOverlayOpen()) renderTaskListBody();
    if (isDailyPopupOpen()) renderDailyPopupBody();
    if (firstLoad) { firstLoad = false; maybeShowDailyTaskPopup(); }
  }, err => console.error("[Tasks] Snapshot error:", err));
}

async function createTask(officer, date, text) {
  // Append new tasks below the existing ones for this officer/day.
  const maxOrder = S.officerTasks
    .filter(t => t.officer === officer && taskDate(t) === date)
    .reduce((mx, t) => Math.max(mx, orderOf(t) === Infinity ? -1 : t.order), -1);
  const id = newTaskId();
  await setDoc(doc(db, COLLECTION, id), {
    officer,
    date,
    text,
    done: false,
    order: maxOrder + 1,
    createdAt: new Date().toISOString(),
    createdBy: S.user || "Unknown",
    completedAt: null,
  });
}

async function setTaskDone(id, done) {
  await updateDoc(doc(db, COLLECTION, id), {
    done,
    completedAt: done ? new Date().toISOString() : null,
  });
}

async function removeTask(id) {
  await deleteDoc(doc(db, COLLECTION, id));
}

/* Wipe every task board. Called from the month-end cleanup so each new month
   starts with an empty list. */
export async function purgeOfficerTasks() {
  const snap = await getDocs(collection(db, COLLECTION));
  const ids = snap.docs.map(d => d.id);
  for (let start = 0; start < ids.length; start += 450) {
    const batch = writeBatch(db);
    ids.slice(start, start + 450).forEach(id => batch.delete(doc(db, COLLECTION, id)));
    await batch.commit();
  }
  return ids.length;
}

/* ── BADGE ── (open tasks on today's plate, incl. carried-forward) */
export function updateTaskListBadge() {
  const el = document.getElementById("b-tasklist");
  if (!el || !S.user) return;
  const today = todayStr();
  const open = S.officerTasks.filter(t =>
    !t.done && taskDate(t) <= today && (S.isAdmin || t.officer === S.user)
  );
  el.textContent = open.length || "";
}

/* ── OVERLAY ── */
function isOverlayOpen() {
  const el = document.getElementById("taskListOverlay");
  return !!el && el.classList.contains("is-open");
}

window.showTaskListOverlay = function () {
  if (!S.user) { toast("Select your name first"); return; }
  if (S.isAdmin && !S.taskListOfficer) S.taskListOfficer = S.officers[0] || null;
  S.taskListDate = todayStr();
  S.taskEditMode = false;
  openOverlay("taskListOverlay", "block");
  document.body.style.overflow = "hidden";
  syncEditToggle();
  renderTaskListShell();
};

window.closeTaskListOverlay = function () {
  closeOverlay("taskListOverlay", () => { document.body.style.overflow = ""; });
};

window.setTaskListOfficer = function (name) {
  S.taskListOfficer = name;
  renderTaskListShell();
};

window.taskListNavDate = function (delta) {
  S.taskListDate = shiftDate(activeDate(), delta);
  renderTaskListShell();
};

window.taskListToday = function () {
  if (activeDate() === todayStr()) return;
  S.taskListDate = todayStr();
  renderTaskListShell();
};

window.submitOfficerTask = async function () {
  const input = document.getElementById("tlInput");
  if (!input) return;
  const text = input.value.trim();
  const officer = activeOfficer();
  if (!officer) { toast("No officer selected"); return; }
  if (!text) { input.focus(); return; }
  input.value = "";
  input.focus();
  try {
    await createTask(officer, activeDate(), text);
  } catch (e) {
    console.error("[Tasks] create failed:", e);
    toast("Could not add task");
    input.value = text;
  }
};

window.handleTaskInputKey = function (e) {
  if (e.key === "Enter") { e.preventDefault(); window.submitOfficerTask(); }
};

window.toggleOfficerTask = async function (id) {
  const task = S.officerTasks.find(t => t.id === id);
  if (!task) return;
  try {
    await setTaskDone(id, !task.done);
  } catch (e) {
    console.error("[Tasks] toggle failed:", e);
    toast("Could not update task");
  }
};

window.deleteOfficerTask = async function (id) {
  const task = S.officerTasks.find(t => t.id === id);
  if (!task) return;
  if (!canDelete(task)) { toast("Added by Admin — only Admin can remove it"); return; }
  try {
    await removeTask(id);
  } catch (e) {
    console.error("[Tasks] delete failed:", e);
    toast("Could not delete task");
  }
};

/* Reorder an active task up (dir=-1) or down (dir=1) within its own day
   (carried-forward tasks from other days keep their own order), then persist
   the new serial order for every task in that day's group. */
window.moveOfficerTask = async function (id, dir) {
  const task = S.officerTasks.find(t => t.id === id);
  if (!task) return;
  const group = S.officerTasks
    .filter(t => t.officer === task.officer && taskDate(t) === taskDate(task) && !t.done)
    .sort((a, b) => (orderOf(a) - orderOf(b)) || (a.createdAt || "").localeCompare(b.createdAt || ""));
  const i = group.findIndex(t => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= group.length) return;
  const arr = group.slice();
  const [moved] = arr.splice(i, 1);
  arr.splice(j, 0, moved);
  try {
    const batch = writeBatch(db);
    arr.forEach((t, idx) => { if (t.order !== idx) batch.update(doc(db, COLLECTION, t.id), { order: idx }); });
    await batch.commit();
  } catch (e) {
    console.error("[Tasks] reorder failed:", e);
    toast("Could not reorder");
  }
};

window.toggleTaskEditMode = function () {
  S.taskEditMode = !S.taskEditMode;
  syncEditToggle();
  renderTaskListBody();
};

function syncEditToggle() {
  const btn = document.getElementById("tlEditToggle");
  if (!btn) return;
  btn.textContent = S.taskEditMode ? "Done" : "Edit";
  btn.classList.toggle("active", S.taskEditMode);
}

/* ── DAILY REMINDER POPUP ──
   Shown once per session when an officer opens the app: today's pending tasks
   with a completed-today counter. Tasks can be checked off here, and the whole
   thing closes on a tap outside the card. */
let _popupKeyHandler = null;

function isDailyPopupOpen() { return !!document.getElementById("tlDailyPopup"); }

export function maybeShowDailyTaskPopup() {
  if (!S.user || S.isAdmin) return;
  if (sessionStorage.getItem("tlDailyPopupShown")) return;
  if (!boardPending(S.user, todayStr()).length) return;
  sessionStorage.setItem("tlDailyPopupShown", "1");
  showDailyTaskPopup();
}
window.maybeShowDailyTaskPopup = maybeShowDailyTaskPopup;

function showDailyTaskPopup() {
  const existing = document.getElementById("tlDailyPopup");
  if (existing) existing.remove();
  const ov = document.createElement("div");
  ov.className = "overlay center tl-popup-overlay";
  ov.id = "tlDailyPopup";
  ov.innerHTML = `<div class="modal-box tl-popup" role="dialog" aria-modal="true" aria-label="Today's tasks"></div>`;
  ov.addEventListener("click", e => { if (e.target === ov) window.closeDailyTaskPopup(); });
  document.body.appendChild(ov);
  renderDailyPopupBody();
  animateOverlayIn(ov);
  _popupKeyHandler = e => { if (e.key === "Escape") window.closeDailyTaskPopup(); };
  document.addEventListener("keydown", _popupKeyHandler);
}

function renderDailyPopupBody() {
  const box = document.querySelector("#tlDailyPopup .tl-popup");
  if (!box) return;
  const today = todayStr();
  const { active: pending, done } = boardTasks(S.user, today);
  const doneCount = done.length;
  const d = new Date(today + "T00:00:00");
  const dateLbl = `${WD[d.getDay()]} · ${d.getDate()} ${MON[d.getMonth()]}`;

  const list = pending.length
    ? pending.map((t, i) => `
        <div class="tl-popup-task">
          <span class="tl-serial">${i + 1}</span>
          <span class="tl-popup-text">${esc(t.text)}</span>
          ${ageBadgeHtml(t, today)}
          <button type="button" class="tl-popup-check" onclick="markDailyPopupTask('${t.id}')" aria-label="Mark done" title="Mark done">
            <span class="tl-check-tick">✓</span>
          </button>
        </div>`).join("")
    : `<div class="tl-popup-alldone">
        <div class="tl-popup-alldone-icon">🎉</div>
        <div class="tl-popup-alldone-title">All done for today!</div>
        <div class="tl-popup-alldone-sub">Every task is complete.</div>
      </div>`;

  const pendingNote = pending.length
    ? `${pending.length} task${pending.length === 1 ? "" : "s"} pending`
    : "Nothing pending";

  box.innerHTML = `
    <div class="tl-popup-head">
      <div class="tl-popup-heading">
        <div class="tl-popup-title">Today's Tasks</div>
        <div class="tl-popup-sub">${dateLbl} · ${pendingNote}</div>
      </div>
      <div class="tl-popup-counter" title="Tasks completed today">
        <span class="tl-popup-counter-num">${doneCount}</span>
        <span class="tl-popup-counter-lbl">done today</span>
      </div>
    </div>
    <div class="tl-popup-list">${list}</div>
    <div class="tl-popup-hint">Tap anywhere outside to close</div>`;
}

window.closeDailyTaskPopup = function () {
  if (_popupKeyHandler) { document.removeEventListener("keydown", _popupKeyHandler); _popupKeyHandler = null; }
  const ov = document.getElementById("tlDailyPopup");
  if (ov) animateOverlayOut(ov);
};

window.markDailyPopupTask = async function (id) {
  const t = S.officerTasks.find(x => x.id === id);
  if (!t || t.done) return;
  try {
    await setTaskDone(id, true);
  } catch (e) {
    console.error("[Tasks] mark done failed:", e);
    toast("Could not update task");
  }
};

/* Full content: officer selector (admin), date nav, add row, and the list. */
function renderTaskListShell() {
  const c = document.getElementById("taskListContent");
  if (!c) return;
  const officer = activeOfficer();
  const date = activeDate();
  const isToday = date === todayStr();

  const selector = S.isAdmin ? `
    <div class="tl-officer-bar">
      <div class="tl-officer-chips">
        ${S.officers.map(o => {
          const active = o === officer;
          const openCount = boardPending(o, date).length;
          return `<button type="button" class="tl-officer-chip${active ? " active" : ""}" onclick="setTaskListOfficer('${esc(o)}')">
            <span class="tl-chip-av" style="background:${officerColor(o).bg};">${initials(o)}</span>
            <span class="tl-chip-name">${esc(o)}</span>
            ${openCount ? `<span class="tl-chip-count">${openCount}</span>` : ""}
          </button>`;
        }).join("")}
      </div>
    </div>` : "";

  const addRow = officer ? `
    <div class="tl-add-row">
      <input type="text" id="tlInput" class="tl-input" maxlength="200" autocomplete="off"
        placeholder="Add a task${S.isAdmin ? " for " + esc(officer) : ""}…" onkeydown="handleTaskInputKey(event)">
      <button type="button" class="tl-add-btn" onclick="submitOfficerTask()" aria-label="Add task" title="Add task">+</button>
    </div>` : "";

  c.innerHTML = `
    <div class="tl-datenav">
      <button type="button" class="tl-nav-btn" onclick="taskListNavDate(-1)" aria-label="Previous day">&lsaquo;</button>
      <button type="button" class="tl-date-label${isToday ? " is-today" : ""}" onclick="taskListToday()" title="${isToday ? "Today" : "Jump to today"}">
        <span class="tl-date-main">${dateMainLabel(date)}</span>
        <span class="tl-date-sub">${dateSubLabel(date)}</span>
      </button>
      <button type="button" class="tl-nav-btn" onclick="taskListNavDate(1)" aria-label="Next day">&rsaquo;</button>
    </div>
    ${selector}
    <div class="tl-board">
      ${addRow}
      <div id="tlList" class="tl-list"></div>
    </div>`;

  renderTaskListBody();
  const input = document.getElementById("tlInput");
  if (input && isToday) input.focus();
}

/* List only — safe to re-run on every Firestore snapshot without disturbing
   the text input the user may be typing in. */
function renderTaskListBody() {
  const list = document.getElementById("tlList");
  if (!list) return;
  const officer = activeOfficer();
  const date = activeDate();
  if (!officer) {
    list.innerHTML = `<div class="tl-empty">No officers configured.</div>`;
    return;
  }

  const { active, done } = boardTasks(officer, date);

  if (!active.length && !done.length) {
    const rel = relativeLabel(date);
    const when = rel ? rel.toLowerCase() : "this day";
    list.innerHTML = `<div class="tl-empty">
      <div class="tl-empty-icon">📝</div>
      <div class="tl-empty-title">No tasks for ${esc(rel || dateMainLabel(date))}</div>
      <div class="tl-empty-sub">Add ${S.isAdmin ? esc(officer) + "'s" : "your"} first task for ${esc(when)} above.</div>
    </div>`;
    return;
  }

  const activeHtml = active.map((t, i) => {
    // Reorder is only allowed between tasks of the same day (adjacent in the list).
    const canUp = i > 0 && taskDate(active[i - 1]) === taskDate(t);
    const canDown = i < active.length - 1 && taskDate(active[i + 1]) === taskDate(t);
    return taskRowHtml(t, i + 1, date, canUp, canDown);
  }).join("");
  const doneHtml = done.map((t, i) => taskRowHtml(t, active.length + i + 1, date, false, false)).join("");
  const doneSection = done.length ? `
    <div class="tl-done-label">Completed · ${done.length}</div>
    ${doneHtml}` : "";

  list.innerHTML = `${activeHtml}${doneSection}`;
}

/* serial: 1-based running number (active tasks first, then completed).
   D: the day being viewed (for the carried-forward age badge).
   canUp/canDown: whether reorder arrows are enabled (same-day neighbour). */
function taskRowHtml(t, serial, D, canUp, canDown) {
  const edit = S.taskEditMode;
  const serialCell = `<span class="tl-serial">${serial}</span>`;
  const ageBadge = t.done ? "" : ageBadgeHtml(t, D);

  let right;
  if (edit) {
    const reorder = (!t.done && (canUp || canDown))
      ? `<div class="tl-reorder">
          <button type="button" class="tl-move" ${canUp ? "" : "disabled"} onclick="moveOfficerTask('${t.id}',-1)" aria-label="Move up">&#9650;</button>
          <button type="button" class="tl-move" ${canDown ? "" : "disabled"} onclick="moveOfficerTask('${t.id}',1)" aria-label="Move down">&#9660;</button>
        </div>`
      : "";
    const action = canDelete(t)
      ? `<button type="button" class="tl-del" onclick="deleteOfficerTask('${t.id}')" aria-label="Delete task" title="Delete">✕</button>`
      : `<span class="tl-lock" title="Added by Admin — can't remove" aria-label="Added by Admin">🔒</span>`;
    right = `${reorder}${action}`;
  } else {
    right = `<button type="button" class="tl-check${t.done ? " checked" : ""}" onclick="toggleOfficerTask('${t.id}')"
      role="checkbox" aria-checked="${t.done}" aria-label="${t.done ? "Mark not done" : "Mark done"}">
      <span class="tl-check-tick">✓</span>
    </button>`;
  }

  return `<div class="tl-task${t.done ? " tl-task--done" : ""}${edit ? " tl-task--edit" : ""}">
    ${serialCell}
    <span class="tl-task-text">${esc(t.text)}</span>
    ${ageBadge}
    ${right}
  </div>`;
}
