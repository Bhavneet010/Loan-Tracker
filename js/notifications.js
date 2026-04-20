import { collection, doc, limit, onSnapshot, orderBy, query, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./config.js";
import { S } from "./state.js";
import { fmtAmt, esc, toast } from "./utils.js";

const NOTIFICATION_LIMIT = 75;
const typeIcon = { added: '➕', sanctioned: '✓', returned: '↩', edited: '✎' };
const typeLabel = { added: 'New loan added', sanctioned: 'Loan sanctioned', returned: 'Loan returned', edited: 'Loan updated' };
const typeCls = { added: 'notif-added', sanctioned: 'notif-sanctioned', returned: 'notif-returned', edited: 'notif-edited' };

function timeAgo(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function notificationCard(n) {
  const unread = !(n.readBy || []).includes(S.user);
  const byWhom = n.by || n.allocatedTo || '';
  return `<div class="notif-card${unread ? ' unread' : ''}">
    <div class="notif-icon ${typeCls[n.type] || ''}">${typeIcon[n.type] || '•'}</div>
    <div class="notif-body">
      <div class="notif-top-row">
        <div class="notif-name">${esc(n.customerName)}</div>
        <div class="notif-time">${timeAgo(n.timestamp)}</div>
      </div>
      <div class="notif-meta">${typeLabel[n.type] || n.type} · ₹${fmtAmt(n.amount)}L · by ${esc(byWhom)}</div>
    </div>
  </div>`;
}

export async function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default')
    await Notification.requestPermission();
}

export function notifyLoanChange(loan) {
  if (Notification.permission !== 'granted') return;
  if (!document.hidden && document.hasFocus()) return;
  const labels = { pending: 'Pending', sanctioned: '✓ Sanctioned', returned: '↩ Returned' };
  const title = `${labels[loan.status] || loan.status} — ${loan.customerName}`;
  const body = `₹${fmtAmt(loan.amount)}L · ${loan.allocatedTo}`;
  try { new Notification(title, { body, icon: '/icon-192.png', tag: loan.id, renotify: true }); } catch (e) { }
}

export async function createNotification(type, loan) {
  const id = 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  await setDoc(doc(db, 'notifications', id), {
    type, loanId: loan.id || '',
    customerName: loan.customerName || '', amount: loan.amount || 0,
    branch: loan.branch || '', category: loan.category || '',
    allocatedTo: loan.allocatedTo || '',
    by: S.user, timestamp: new Date().toISOString(), readBy: []
  });
}

export function subscribeNotifications() {
  let firstLoad = true;
  onSnapshot(query(collection(db, 'notifications'), orderBy('timestamp', 'desc'), limit(NOTIFICATION_LIMIT)), snap => {
    S.notifications = [];
    snap.forEach(d => S.notifications.push({ id: d.id, ...d.data() }));
    updateNotifBadge();
    if (firstLoad && S.user && !sessionStorage.getItem('actOverlayShown')) {
      sessionStorage.setItem('actOverlayShown', '1');
      showActivityOverlay();
    }
    firstLoad = false;
  });
}

export function visibleNotifs() {
  const base = S.isAdmin ? S.notifications : S.notifications.filter(n =>
    n.allocatedTo === S.user && (n.type === 'added' || n.type === 'sanctioned' || n.type === 'returned')
  );
  return base.filter(n => !(n.clearedBy || []).includes(S.user));
}

export function renderNotifOverlay() {
  const c = document.getElementById('notifList'); if (!c) return;
  const notifs = visibleNotifs();
  if (!notifs.length) { c.innerHTML = `<div class="empty-state" style="padding:32px 20px;">🔔<br><br><b>No notifications</b><br><span style="font-size:12px;color:#7B7A9A;">Activity will appear here</span></div>`; return; }
  c.innerHTML = notifs.map(notificationCard).join('');
}

export function updateNotifBadge() {
  const el = document.getElementById('b-notifs'); if (!el || !S.user) return;
  const count = visibleNotifs().filter(n => !(n.readBy || []).includes(S.user)).length;
  el.textContent = count || '';
}

export async function markNotifsRead() {
  const unread = visibleNotifs().filter(n => !(n.readBy || []).includes(S.user));
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.forEach(n => batch.update(doc(db, 'notifications', n.id), { readBy: [...(n.readBy || []), S.user] }));
  await batch.commit().catch(() => { });
}

window.clearNotifications = async function () {
  const toHide = visibleNotifs();
  if (toHide.length) {
    const batch = writeBatch(db);
    toHide.forEach(n => batch.update(doc(db, 'notifications', n.id), { clearedBy: [...(n.clearedBy || []), S.user] }));
    await batch.commit().catch(() => { });
  }
  import("./ui-core.js").then(module => module.closeNotifOverlay());
  toast('Notifications cleared');
};

export function showActivityOverlay() {
  const notifs = visibleNotifs().filter(n => !(n.readBy || []).includes(S.user));
  if (!notifs.length) return;
  const counts = {};
  notifs.forEach(n => { counts[n.type] = (counts[n.type] || 0) + 1; });
  const icons = { added: '➕', sanctioned: '✓', returned: '↩', edited: '✎' };
  const labels = { added: 'loan added', sanctioned: 'loan sanctioned', returned: 'loan returned', edited: 'loan updated' };
  const lines = Object.entries(counts).map(([t, c]) =>
    `<div class="ab-line"><span class="ab-icon ${t}">${icons[t] || '•'}</span><span>${c} ${labels[t] || t}${c > 1 ? 's' : ''}</span></div>`
  ).join('');
  const ov = document.createElement('div');
  ov.id = 'activityOverlay';
  ov.innerHTML = `<div class="activity-bubble">
    <div class="ab-title">Recent Activity</div>
    <div class="ab-lines">${lines}</div>
    <div class="ab-hint">Tap anywhere to dismiss</div>
  </div>`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}

