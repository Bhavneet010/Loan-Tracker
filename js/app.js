import { S, loadSettings } from "./state.js";
import { subscribeLoans } from "./db.js";
import { subscribeNotifications } from "./notifications.js";
import { render } from "./ui-render.js";
import { initPushNotifications } from "./push-notifications.js";
import { initPresence } from "./presence.js";

// Import modules to register window actions and side effects
import { updateUserAvatar } from "./ui-core.js";
import "./ui-decision-sheet.js";
import "./importers.js";
import "./loan-actions.js";
import "./ui-settings.js";
import "./month-end.js";

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
  console.log('[INIT] Loading configuration...');
  await loadSettings();
  
  const savedTheme = localStorage.getItem('lpTheme');
  const darkPref = localStorage.getItem('lpDark');
  if (savedTheme === 'neo-brutalist') {
    S.dark = false;
    document.body.classList.add('theme-neo-brutalist');
    document.body.classList.remove('dark');
    localStorage.setItem('lpDark', '0');
  } else if (savedTheme === 'sketchnote') {
    S.dark = false;
    document.body.classList.add('theme-sketchnote');
    document.body.classList.remove('dark');
    localStorage.setItem('lpDark', '0');
  } else if (savedTheme === 'default') {
    /* user explicitly picked Light — leave as base */
    S.dark = false;
  } else if (darkPref === '1') {
    S.dark = true;
    document.body.classList.add('dark');
  } else {
    /* No explicit theme choice — sketchnote is the default. */
    S.dark = false;
    document.body.classList.add('theme-sketchnote');
    localStorage.setItem('lpTheme', 'sketchnote');
    localStorage.setItem('lpDark', '0');
  }
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    if (document.body.classList.contains('theme-neo-brutalist')) {
      themeMeta.setAttribute('content', '#FFFEF2');
    } else if (document.body.classList.contains('theme-sketchnote')) {
      themeMeta.setAttribute('content', '#E8EFE5');
    } else {
      themeMeta.setAttribute('content', S.dark ? '#15142C' : '#7c3aed');
    }
  }
  
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
        updateUserAvatar(su);
      }
    }
    initPresence();
  }
  
  console.log('[INIT] Connecting to database...');
  subscribeLoans();
  subscribeNotifications();
  
  if (!S.user) {
    if (window.showUserSelect) window.showUserSelect();
  }
  
  // Initial render replaces skeleton with real content
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

/* ── SHRINKING HEADER ON SCROLL ── */
(function initHeaderCompact() {
  const header = document.querySelector('.header');
  if (!header) return;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      header.classList.toggle('header--compact', window.scrollY > 32);
      ticking = false;
    });
  }, { passive: true });
}());
