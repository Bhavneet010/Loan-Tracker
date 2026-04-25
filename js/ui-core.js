import { S, PIN } from "./state.js";
import { renderSettingsList } from "./ui-settings.js";
import { toast, initials, officerColor } from "./utils.js";
import { getLoanMetrics } from "./derived.js";
import { requestNotifPermission } from "./notifications.js";

window.toggleDark = function () {
  S.dark = !S.dark;
  document.body.classList.toggle('dark', S.dark);
  localStorage.setItem('lpDark', S.dark ? '1' : '0');
};

window.toggleUserMenu = function () {
  const menu = document.getElementById('userMenu');
  if (menu.style.display === 'none') {
    menu.innerHTML = `
      ${S.isAdmin ? `<button class="udrop-item" onclick="closeUserMenu();handleSettings()">⚙️ Settings</button>` : ''}
      <button class="udrop-item" onclick="closeUserMenu();toggleDark()">${S.dark ? '☀️ Light theme' : '🌙 Dark theme'}</button>
      <button class="udrop-item" onclick="closeUserMenu();showUserSelect()">👤 Change officer</button>`;
    menu.style.display = 'block';
    setTimeout(() => document.addEventListener('click', _closeMenuOutside, { once: true }), 0);
  } else {
    menu.style.display = 'none';
  }
};

window.closeUserMenu = () => {
  const menu = document.getElementById('userMenu');
  if (menu) menu.style.display = 'none';
};

function _closeMenuOutside(e) {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.contains(e.target)) menu.style.display = 'none';
}

window.showNotifOverlay = function () {
  document.getElementById('notifOverlay').style.display = 'flex';
  import("./notifications.js").then(module => {
    module.renderNotifOverlay();
    module.markNotifsRead();
  });
};

window.closeNotifOverlay = () => {
  document.getElementById('notifOverlay').style.display = 'none';
};

window.showPerfOverlay = async function () {
  document.getElementById('perfOverlay').style.display = 'block';
  document.body.style.overflow = 'hidden';
  const target = document.getElementById('perfOverlayContent');
  if (target) target.innerHTML = '<div class="loading-wrap"><div class="spinner"></div><span>Loading performance...</span></div>';
  await import("./performance.js");
  if (typeof window.showDailySnapshot === 'function') window.showDailySnapshot();
};

window.closePerfOverlay = function () {
  const perfOverlay = document.getElementById('perfOverlay');
  if (perfOverlay) perfOverlay.style.display = 'none';
  document.body.style.overflow = '';
  // Charts are handled in performance.js
};

window.handleSearch = v => { 
  S.search = v.toLowerCase().trim(); 
  window.render(); 
};

window.setFreshTab = function (tab) {
  S.tab = tab;
  S.openPop = null;
  S.search = '';
  const si = document.getElementById('searchInput');
  if (si) si.value = '';
  window.render();
};

window.setAppMode = function (v) {
  S.appMode = v; S.openPop = null;
  localStorage.setItem('lpMode', v);
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.id === 'modeBtn-' + v));
  const mainTabs = document.getElementById('mainTabs');
  if (mainTabs) mainTabs.style.display = v === 'fresh' ? '' : 'none';
  window.render();
};

window.showUserSelect = function () {
  const pending = getLoanMetrics().pending;
  document.getElementById('userList').innerHTML = S.officers.map(o => {
    const n = pending.filter(l => l.allocatedTo === o).length;
    const badge = n ? `<span class="officer-count">${n}</span>` : '';
    return `<button class="user-btn" onclick="selectUser('${o}')">
      <div class="av" style="background:${officerColor(o).bg};">${initials(o)}</div><span>${o}</span>${badge}
    </button>`;
  }).join('');
  document.getElementById('userModal').style.display = 'flex';
};

window.selectUser = function (name) {
  S.user = name; S.isAdmin = false;
  S.filter = { category: 'All', officer: 'Mine' };
  localStorage.setItem('lpUser', name); localStorage.setItem('lpAdmin', 'false');
  const av = document.getElementById('userAv');
  av.textContent = initials(name);
  av.style.background = officerColor(name).bg;
  av.style.color = '#fff';
  document.getElementById('userModal').style.display = 'none';
  requestNotifPermission();
  window.render();
};

window.promptAdmin = function () {
  document.getElementById('userModal').style.display = 'none';
  document.getElementById('pinModal').style.display = 'flex';
  setTimeout(() => document.getElementById('pinInput').focus(), 100);
};

window.checkPin = function () {
  if (document.getElementById('pinInput').value === PIN) {
    S.user = 'Admin'; S.isAdmin = true;
    S.filter = { category: 'All', officer: 'All' };
    localStorage.setItem('lpUser', 'Admin'); localStorage.setItem('lpAdmin', 'true');
    const av = document.getElementById('userAv');
    av.textContent = '🔒'; av.style.background = ''; av.style.color = '';
    document.getElementById('pinInput').value = '';
    document.getElementById('pinModal').style.display = 'none';
    requestNotifPermission();
    toast('Admin mode active'); window.render();
  } else {
    toast('Incorrect PIN'); document.getElementById('pinInput').value = '';
  }
};

window.closePinModal = function () { 
  document.getElementById('pinInput').value = ''; 
  document.getElementById('pinModal').style.display = 'none'; 
};

window.handleSettings = function () {
  if (!S.isAdmin) { toast('Admin access required'); return; }
  S.settingsTab = 'officers';
  renderSettingsList();
  document.getElementById('settingsModal').style.display = 'flex';
};

window.closeSettings = function () { 
  document.getElementById('settingsModal').style.display = 'none'; 
};

window.setSettingsTab = function (tab) { 
  S.settingsTab = tab; 
  renderSettingsList(); 
};

window.toggleExpand = function (id) {
  const el = document.getElementById('li-' + id);
  if (el) el.classList.toggle('expanded');
};
