import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./config.js";
import { S } from "./state.js";
import { esc, toast, initials, officerColor } from "./utils.js";
import { openOverlay, closeOverlay } from "./animate.js";

/* Personal to-do list stored per officer. Each document is one task.
   Tasks only cover a rolling 30-day window on screen and are wiped in full
   during the month-end data cleanup, so the board starts fresh each month. */
const COLLECTION = "officerTasks";
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 86400000;

const newTaskId = () => "task_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

const withinWindow = t => !t.createdAt || (Date.now() - new Date(t.createdAt).getTime()) <= WINDOW_MS;

/* Who the currently open board belongs to. Officers only ever see their own
   list; Admin picks an officer (defaults to the first one). */
function activeOfficer() {
  if (!S.isAdmin) return S.user;
  if (S.taskListOfficer && S.officers.includes(S.taskListOfficer)) return S.taskListOfficer;
  return S.officers[0] || null;
}

function tasksFor(officer) {
  return S.officerTasks.filter(t => t.officer === officer && withinWindow(t));
}

/* Active tasks first (oldest at the top), completed tasks sink to the bottom
   ordered by when they were checked off (most recent first). */
function sortTasks(list) {
  const active = list.filter(t => !t.done)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  const done = list.filter(t => t.done)
    .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
  return { active, done };
}

/* ── DATA LAYER ── */
export function subscribeOfficerTasks() {
  onSnapshot(collection(db, COLLECTION), snap => {
    S.officerTasks = [];
    snap.forEach(d => S.officerTasks.push({ id: d.id, ...d.data() }));
    updateTaskListBadge();
    if (isOverlayOpen()) renderTaskListBody();
  }, err => console.error("[Tasks] Snapshot error:", err));
}

async function createTask(officer, text) {
  const id = newTaskId();
  await setDoc(doc(db, COLLECTION, id), {
    officer,
    text,
    done: false,
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

/* ── BADGE ── */
export function updateTaskListBadge() {
  const el = document.getElementById("b-tasklist");
  if (!el || !S.user) return;
  const open = S.isAdmin
    ? S.officerTasks.filter(t => !t.done && withinWindow(t))
    : tasksFor(S.user).filter(t => !t.done);
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
  openOverlay("taskListOverlay", "block");
  document.body.style.overflow = "hidden";
  renderTaskListShell();
};

window.closeTaskListOverlay = function () {
  closeOverlay("taskListOverlay", () => { document.body.style.overflow = ""; });
};

window.setTaskListOfficer = function (name) {
  S.taskListOfficer = name;
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
    await createTask(officer, text);
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
  try {
    await removeTask(id);
  } catch (e) {
    console.error("[Tasks] delete failed:", e);
    toast("Could not delete task");
  }
};

/* Full content: officer selector (admin), add row, and the list. */
function renderTaskListShell() {
  const c = document.getElementById("taskListContent");
  if (!c) return;
  const officer = activeOfficer();

  const selector = S.isAdmin ? `
    <div class="tl-officer-bar">
      <span class="tl-officer-bar-label">Create for</span>
      <div class="tl-officer-chips">
        ${S.officers.map(o => {
          const active = o === officer;
          const openCount = tasksFor(o).filter(t => !t.done).length;
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
        placeholder="Add a task for ${esc(officer)}…" onkeydown="handleTaskInputKey(event)">
      <button type="button" class="tl-add-btn" onclick="submitOfficerTask()" aria-label="Add task" title="Add task">+</button>
    </div>` : "";

  c.innerHTML = `
    ${selector}
    <div class="tl-board">
      <div class="tl-board-head">
        <span class="tl-board-who">${officer ? esc(officer) + "'s tasks" : "No officer"}</span>
        <span class="tl-board-note">Last ${WINDOW_DAYS} days · resets monthly</span>
      </div>
      ${addRow}
      <div id="tlList" class="tl-list"></div>
    </div>`;

  renderTaskListBody();
  const input = document.getElementById("tlInput");
  if (input) input.focus();
}

/* List only — safe to re-run on every Firestore snapshot without disturbing
   the text input the user may be typing in. */
function renderTaskListBody() {
  const list = document.getElementById("tlList");
  if (!list) return;
  const officer = activeOfficer();
  if (!officer) {
    list.innerHTML = `<div class="tl-empty">No officers configured.</div>`;
    return;
  }

  const { active, done } = sortTasks(tasksFor(officer));

  if (!active.length && !done.length) {
    list.innerHTML = `<div class="tl-empty">
      <div class="tl-empty-icon">📝</div>
      <div class="tl-empty-title">No tasks yet</div>
      <div class="tl-empty-sub">Add ${esc(officer)}'s first task above.</div>
    </div>`;
    return;
  }

  const rowsHtml = rows => rows.map(taskRowHtml).join("");
  const doneSection = done.length ? `
    <div class="tl-done-label">Completed · ${done.length}</div>
    ${rowsHtml(done)}` : "";

  list.innerHTML = `${rowsHtml(active)}${doneSection}`;
}

function taskRowHtml(t) {
  return `<div class="tl-task${t.done ? " tl-task--done" : ""}">
    <button type="button" class="tl-check${t.done ? " checked" : ""}" onclick="toggleOfficerTask('${t.id}')"
      role="checkbox" aria-checked="${t.done}" aria-label="${t.done ? "Mark not done" : "Mark done"}">
      <span class="tl-check-tick">✓</span>
    </button>
    <span class="tl-task-text">${esc(t.text)}</span>
    <button type="button" class="tl-del" onclick="deleteOfficerTask('${t.id}')" aria-label="Delete task" title="Delete">✕</button>
  </div>`;
}
