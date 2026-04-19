import { S, loadSettings } from "./state.js";
import { initials, officerColor } from "./utils.js";
import { subscribeLoans } from "./db.js";
import { subscribeNotifications } from "./notifications.js";
import { render } from "./ui-render.js";

// Import modules to register window actions and side effects
import "./ui-core.js";
import "./importers.js";
import "./loan-actions.js";
import "./ui-settings.js";

/* ── TABS CLICK LISTENER ── */
const mainTabs = document.getElementById('mainTabs');
if (mainTabs) {
  mainTabs.addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    document.querySelectorAll('#mainTabs .tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    S.tab = btn.dataset.tab;
    S.search = '';
    const si = document.getElementById('searchInput');
    if (si) si.value = '';
    if (S.tab === 'notifs') {
      import("./notifications.js").then(m => m.markNotifsRead());
    }
    render();
  });
}

/* ── INIT ── */
async function init() {
  await loadSettings();
  
  const darkPref = localStorage.getItem('lpDark');
  if (darkPref === '1') {
    S.dark = true;
    document.body.classList.add('dark');
  }
  
  const savedMode = localStorage.getItem('lpMode');
  if (savedMode === 'renewals') {
    S.appMode = 'renewals';
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.id === 'modeBtn-renewals'));
    const mt = document.getElementById('mainTabs');
    if (mt) mt.style.display = 'none';
  }
  
  const su = localStorage.getItem('lpUser');
  const sa = localStorage.getItem('lpAdmin') === 'true';
  if (su) {
    S.user = su; 
    S.isAdmin = sa;
    S.filter = { category: 'All', officer: sa ? 'All' : 'Mine' };
    const av = document.getElementById('userAv');
    if (av) {
      if (su === 'Admin') {
        av.textContent = '🔒';
      } else {
        av.textContent = initials(su);
        av.style.background = (officerColor(su) || {bg:''}).bg;
        av.style.color = '#fff';
      }
    }
  }
  
  subscribeLoans();
  subscribeNotifications();
  
  if (!S.user) {
    if (window.showUserSelect) window.showUserSelect();
  }
  
  // Initial render
  render();
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// Start the app
init();
