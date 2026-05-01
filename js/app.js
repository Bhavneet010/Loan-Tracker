import { S, loadSettings } from "./state.js";
import { initials, officerColor } from "./utils.js";
import { subscribeLoans } from "./db.js";
import { subscribeNotifications } from "./notifications.js";
import { render } from "./ui-render.js";
import { initPushNotifications } from "./push-notifications.js";

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
    render();
  });
}

document.addEventListener('click', e => {
  if (!S.openPop || e.target.closest('.fs-bar')) return;
  S.openPop = null;
  render();
});

/* ── INIT ── */
async function init() {
  const status = (txt) => {
    const el = document.querySelector('.loading-wrap span');
    if (el) el.textContent = txt;
    console.log('[INIT]', txt);
  };

  status('Loading configuration...');
  await loadSettings();
  
  status('Applying theme...');
  const darkPref = localStorage.getItem('lpDark');
  if (darkPref === '1') {
    S.dark = true;
    document.body.classList.add('dark');
  }
  
  status('Setting app mode...');
  S.appMode = 'tasks';
  S.taskView = 'overview';
  S.taskCategory = null;
  S.taskOfficer = null;
  S.renewalView = 'calendar';
  S.calendarOpenDay = null;
  localStorage.setItem('lpMode', 'tasks');
  document.querySelector('.brand')?.classList.add('brand--tasks-active');
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const mt = document.getElementById('mainTabs');
  if (mt) mt.style.display = 'none';
  
  status('Checking authentication...');
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
  
  status('Connecting to database...');
  subscribeLoans();
  subscribeNotifications();
  
  if (!S.user) {
    status('Please select a user...');
    if (window.showUserSelect) window.showUserSelect();
  } else {
    status('Retrieving data...');
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
