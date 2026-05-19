import { S, PIN, saveSettings } from "./state.js";
import { renderSettingsList } from "./ui-settings.js";
import { toast, initials, officerColor, timeAgo, esc } from "./utils.js";
import { initPresence } from "./presence.js";
import { getLoanMetrics } from "./derived.js";
import { requestNotifPermission } from "./notifications.js";
import { isBiometricRegistered, authenticateBiometric, isBiometricAvailable } from "./biometric.js";
import { openOverlay, closeOverlay, transitionContentSwap } from "./animate.js";
import { updateBadges, updateHero } from "./ui-stats.js";

/* ── AVATAR HELPER ── */
export function updateUserAvatar(officer) {
  const el = document.getElementById('userAv');
  if (!el) return;
  const photo = S.officerPhotos?.[officer];
  if (photo) {
    el.innerHTML = `<img src="${photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${initials(officer)}">`;
    el.style.background = '';
    el.style.color = '';
  } else {
    el.innerHTML = '';
    el.textContent = initials(officer);
    el.style.background = officerColor(officer).bg;
    el.style.color = '#fff';
  }
}

function _getTheme() {
  if (document.body.classList.contains('theme-neo-brutalist')) return 'neo-brutalist';
  if (document.body.classList.contains('dark')) return 'dark';
  return 'default';
}

function _themeLabel() {
  const t = _getTheme();
  if (t === 'neo-brutalist') return '◼ Neo-Brutalist  →  Light';
  if (t === 'dark')          return '🌙 Dark  →  Neo-Brutalist';
  return '☀️ Light  →  Dark';
}

window.cycleTheme = function () {
  const current = _getTheme();
  if (current === 'default') {
    S.dark = true;
    document.body.classList.remove('theme-neo-brutalist');
    document.body.classList.add('dark');
    localStorage.setItem('lpDark', '1');
    localStorage.setItem('lpTheme', 'default');
    toast('Dark theme active');
  } else if (current === 'dark') {
    S.dark = false;
    document.body.classList.remove('dark');
    document.body.classList.add('theme-neo-brutalist');
    localStorage.setItem('lpDark', '0');
    localStorage.setItem('lpTheme', 'neo-brutalist');
    toast('Neo-Brutalist theme active');
  } else {
    S.dark = false;
    document.body.classList.remove('theme-neo-brutalist');
    document.body.classList.remove('dark');
    localStorage.setItem('lpTheme', 'default');
    localStorage.setItem('lpDark', '0');
    toast('Light theme active');
  }
  updateThemeColor();
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = _themeLabel();
  // re-arm outside-click dismissal (the once:true listener was consumed by this click)
  document.removeEventListener('click', _closeMenuOutside);
  setTimeout(() => document.addEventListener('click', _closeMenuOutside, { once: true }), 0);
};

window.toggleDark = function () {
  document.body.classList.remove('theme-neo-brutalist');
  localStorage.setItem('lpTheme', 'default');
  S.dark = !S.dark;
  document.body.classList.toggle('dark', S.dark);
  localStorage.setItem('lpDark', S.dark ? '1' : '0');
  updateThemeColor();
};

function updateThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content',
    document.body.classList.contains('theme-neo-brutalist') ? '#FFFEF2' : (S.dark ? '#15142C' : '#7c3aed')
  );
}

window.toggleUserMenu = function () {
  const menu = document.getElementById('userMenu');
  if (menu.style.display === 'none') {
    menu.innerHTML = `
      ${S.isAdmin ? `<button class="udrop-item" onclick="closeUserMenu();handleSettings()">&#9881; Settings</button>` : ''}
      ${S.isAdmin ? `<button class="udrop-item" onclick="closeUserMenu();showOnlineOverlay()">&#128101; Who\'s Online</button>` : ''}
      ${!S.isAdmin && S.user ? `<button class="udrop-item" onclick="closeUserMenu();openPhotoOverlay()">&#128247; My Photo</button>` : ''}
      <button class="udrop-item" id="themeToggleBtn" onclick="cycleTheme()">${_themeLabel()}</button>
      <button class="udrop-item" onclick="closeUserMenu();showUserSelect()">&#128100; Change officer</button>`;
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
  openOverlay('notifOverlay');
  import("./notifications.js").then(module => {
    module.renderNotifOverlay();
    module.markNotifsRead();
  });
};

window.closeNotifOverlay = () => closeOverlay('notifOverlay');

window.showPerfOverlay = async function () {
  openOverlay('perfOverlay', 'block');
  document.body.style.overflow = 'hidden';
  const target = document.getElementById('perfOverlayContent');
  if (target) target.innerHTML = '<div class="skeleton-wrap"><div class="skeleton-row"><div class="skel-circle"></div><div class="skel-bar skel-bar--md"></div><div class="skel-bar skel-bar--lg skel-bar--right"></div></div><div class="skeleton-row"><div class="skel-circle"></div><div class="skel-bar skel-bar--md"></div><div class="skel-bar skel-bar--lg skel-bar--right"></div></div><div class="skeleton-row"><div class="skel-circle"></div><div class="skel-bar skel-bar--md"></div><div class="skel-bar skel-bar--lg skel-bar--right"></div></div></div>';
  await import(`./performance.js?t=${Date.now()}`);
  if (typeof window.showDailySnapshot === 'function') window.showDailySnapshot();
};

window.closePerfOverlay = function () {
  closeOverlay('perfOverlay', () => { document.body.style.overflow = ''; });
};

window.handleSearch = v => { 
  S.search = v.toLowerCase().trim(); 
  window.render(); 
};

window.setFreshTab = function (tab) {
  if (S.tab === tab) return;
  S.tab = tab;
  S.openPop = null;
  S.search = '';
  const si = document.getElementById('searchInput');
  if (si) si.value = '';
  updateHero();
  transitionContentSwap(() => window.renderContentOnly?.() || window.render());
};

window.toggleTasksMode = function () {
  window.setAppMode(S.appMode === 'tasks' ? 'fresh' : 'tasks');
};

window.setAppMode = function (v) {
  if (S.appMode === v) return;
  if (S.appMode === 'renewals' && v !== 'renewals') { S.renewalView = 'calendar'; S.calendarOpenDay = null; }
  if (S.appMode === 'tasks' && v !== 'tasks') { S.taskView = 'overview'; S.taskCategory = null; S.taskOfficer = null; }
  S.appMode = v; S.openPop = null;
  if (v === 'renewals') { S.renewalView = 'calendar'; S.calendarOpenDay = null; }
  document.body.classList.toggle('tasks-mode', v === 'tasks');
  document.body.classList.toggle('fresh-mode', v === 'fresh');
  document.body.classList.toggle('renewals-mode', v === 'renewals');
  localStorage.setItem('lpMode', v);
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.id === 'modeBtn-' + v));
  document.querySelector('.brand')?.classList.toggle('brand--tasks-active', v === 'tasks');
  const mainTabs = document.getElementById('mainTabs');
  if (mainTabs) mainTabs.style.display = v === 'fresh' ? '' : 'none';
  const searchWrap = document.getElementById('searchWrap');
  if (searchWrap) searchWrap.style.display = v === 'fresh' ? '' : 'none';
  updateHero();
  updateBadges();
  transitionContentSwap(() => window.renderContentOnly?.() || window.render());
};

window.showUserSelect = function () {
  const pending = getLoanMetrics().pending;
  document.getElementById('userList').innerHTML = S.officers.map(o => {
    const n = pending.filter(l => l.allocatedTo === o).length;
    const badge = n ? `<span class="officer-count">${n}</span>` : '';
    const photo = S.officerPhotos?.[o];
    const avInner = photo
      ? `<img src="${photo}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm);" alt="${initials(o)}">`
      : initials(o);
    const avStyle = photo ? '' : `background:${officerColor(o).bg};`;
    return `<button class="user-btn" onclick="selectUser('${o}')">
      <div class="av" style="${avStyle}">${avInner}</div><span>${o}</span>${badge}
    </button>`;
  }).join('');
  openOverlay('userModal');
};

window.selectUser = function (name) {
  S.user = name; S.isAdmin = false;
  S.filter = { category: 'All', officer: 'Mine' };
  localStorage.setItem('lpUser', name); localStorage.setItem('lpAdmin', 'false');
  updateUserAvatar(name);
  closeOverlay('userModal', () => { requestNotifPermission(); initPresence(); window.render(); });
};

let _bioAvailableForModal = false;

function _showBiometricView() {
  document.getElementById('biometricView').style.display = '';
  document.getElementById('pinView').style.display = 'none';
  document.getElementById('pinUnlockBtn').style.display = 'none';
}

function _showPinView() {
  document.getElementById('biometricView').style.display = 'none';
  document.getElementById('pinView').style.display = '';
  document.getElementById('pinUnlockBtn').style.display = '';
  document.getElementById('biometricSwitchBtn').style.display = _bioAvailableForModal ? '' : 'none';
  setTimeout(() => document.getElementById('pinInput').focus(), 50);
}

window.showBiometricView = function () {
  _showBiometricView();
  loginWithBiometric();
};

window.showPinView = function () {
  _showPinView();
};

window.promptAdmin = async function () {
  closeOverlay('userModal', async () => {
    const registered = isBiometricRegistered();
    _bioAvailableForModal = registered && await isBiometricAvailable();

    if (_bioAvailableForModal) {
      _showBiometricView();
    } else {
      _showPinView();
    }

    openOverlay('pinModal');

    if (_bioAvailableForModal) {
      loginWithBiometric();
    }
  });
};

window.checkPin = function () {
  if (document.getElementById('pinInput').value === PIN) {
    document.getElementById('pinInput').value = '';
    closeOverlay('pinModal', _grantAdminAccess);
  } else {
    toast('Incorrect PIN'); document.getElementById('pinInput').value = '';
  }
};

window.closePinModal = function () {
  document.getElementById('pinInput').value = '';
  closeOverlay('pinModal');
};

window.loginWithBiometric = async function () {
  const bioBtn = document.getElementById('biometricBtn');
  if (bioBtn) { bioBtn.disabled = true; bioBtn.classList.add('bio-btn--loading'); }
  try {
    const ok = await authenticateBiometric();
    if (ok) closeOverlay('pinModal', _grantAdminAccess);
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      // user dismissed the prompt — stay on biometric view so they can retry
    } else {
      toast('Biometric failed &mdash; use PIN instead');
      _showPinView();
    }
  } finally {
    if (bioBtn) { bioBtn.disabled = false; bioBtn.classList.remove('bio-btn--loading'); }
  }
};

function _grantAdminAccess() {
  S.user = 'Admin'; S.isAdmin = true;
  S.filter = { category: 'All', officer: 'All' };
  localStorage.setItem('lpUser', 'Admin'); localStorage.setItem('lpAdmin', 'true');
  const av = document.getElementById('userAv');
  av.textContent = '🔒'; av.style.background = ''; av.style.color = '';
  requestNotifPermission();
  initPresence();
  toast('Admin mode active'); window.render();
}

/* ── OFFICER PHOTO OVERLAY ── */
function _compressAvatarPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const SIZE = 96;
        const scale = Math.min(SIZE / img.width, SIZE / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.80));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function _refreshPhotoOverlayAv() {
  const officer = S.user;
  const photo = S.officerPhotos?.[officer];
  const avEl = document.getElementById('photoOverlayAv');
  const delBtn = document.getElementById('photoOverlayDeleteBtn');
  if (!avEl) return;
  if (photo) {
    avEl.innerHTML = `<img src="${photo}" alt="${initials(officer)}">`;
    avEl.style.background = '';
    avEl.style.color = '';
  } else {
    avEl.innerHTML = '';
    avEl.textContent = initials(officer);
    avEl.style.background = officerColor(officer).bg;
    avEl.style.color = '#fff';
  }
  if (delBtn) delBtn.style.display = photo ? '' : 'none';
}

window.openPhotoOverlay = function () {
  if (!S.user || S.isAdmin) return;
  const nameEl = document.getElementById('photoOverlayName');
  if (nameEl) nameEl.textContent = S.user;
  _refreshPhotoOverlayAv();
  const fi = document.getElementById('avatarPhotoInput');
  if (fi) fi.value = '';
  openOverlay('photoOverlay');
};

window.closePhotoOverlay = function () {
  closeOverlay('photoOverlay');
};

window.handleAvatarPhotoUpload = async function (event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await _compressAvatarPhoto(file);
    S.officerPhotos = { ...(S.officerPhotos || {}), [S.user]: dataUrl };
    await saveSettings();
    updateUserAvatar(S.user);
    _refreshPhotoOverlayAv();
    window.render?.();
    toast('Photo updated &#10003;');
  } catch (e) {
    toast('Could not process photo');
    console.error(e);
  }
};

window.deleteAvatarPhoto = async function () {
  if (!S.officerPhotos?.[S.user]) return;
  delete S.officerPhotos[S.user];
  await saveSettings();
  updateUserAvatar(S.user);
  _refreshPhotoOverlayAv();
  window.render?.();
  toast('Photo removed');
};

/* ── WHO'S ONLINE OVERLAY ── */
let _onlineUnsub = null;
let _onlineTimer = null;

function _stopOnline() {
  if (_onlineUnsub) { _onlineUnsub(); _onlineUnsub = null; }
  if (_onlineTimer) { clearInterval(_onlineTimer); _onlineTimer = null; }
}

window.showOnlineOverlay = function () {
  if (!S.isAdmin) return;
  openOverlay('onlineOverlay');
  document.getElementById('onlineList').innerHTML = '<div class="skeleton-wrap"><div class="skeleton-row"><div class="skel-circle"></div><div class="skel-bar skel-bar--md"></div><div class="skel-bar skel-bar--lg skel-bar--right"></div></div><div class="skeleton-row"><div class="skel-circle"></div><div class="skel-bar skel-bar--md"></div><div class="skel-bar skel-bar--lg skel-bar--right"></div></div><div class="skeleton-row"><div class="skel-circle"></div><div class="skel-bar skel-bar--md"></div><div class="skel-bar skel-bar--lg skel-bar--right"></div></div></div>';
  import('./presence.js').then(m => {
    let latestData = {};
    function renderOnline() {
      const listEl = document.getElementById('onlineList');
      if (!listEl) { _stopOnline(); return; }
      const users = [...S.officers, 'Admin'];
      listEl.innerHTML = users.map(user => {
        const p = latestData[user];
        const lastSeen = p?.lastSeen;
        const online = m.isOnline(lastSeen);
        const recent = lastSeen && !online && (Date.now() - new Date(lastSeen).getTime()) < 60 * 60 * 1000;
        const dotColor = online ? '#10B981' : recent ? '#F59E0B' : '#D1D5DB';
        const statusText = lastSeen ? timeAgo(lastSeen) : 'Never seen';
        const deviceText = p?.isMobile ? ' · Mobile' : p?.lastSeen ? ' · Desktop' : '';
        const isAdmin = user === 'Admin';
        const avInner = isAdmin ? '🔒'
          : (S.officerPhotos?.[user]
            ? `<img src="${S.officerPhotos[user]}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${esc(initials(user))}">` 
            : esc(initials(user)));
        const avStyle = isAdmin ? 'font-size:18px;' : (!S.officerPhotos?.[user] ? `background:${officerColor(user).bg};` : '');
        return `<div class="setting-item" style="gap:10px;align-items:center;">
          <div style="width:10px;height:10px;border-radius:50%;background:${dotColor};flex-shrink:0;box-shadow:${online ? '0 0 6px ' + dotColor : 'none'};"></div>
          <div class="officer-av-initials" style="${avStyle}display:flex;align-items:center;justify-content:center;">${avInner}</div>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:14px;">${esc(user)}</div>
            <div style="font-size:12px;color:#7B7A9A;">${statusText}${deviceText}</div>
          </div>
          ${online ? '<span style="font-size:11px;font-weight:700;color:#10B981;background:rgba(16,185,129,0.1);padding:2px 8px;border-radius:20px;">Online</span>' : ''}
        </div>`;
      }).join('');
    }
    _onlineUnsub = m.subscribePresence(data => { latestData = data; renderOnline(); });
    _onlineTimer = setInterval(renderOnline, 60 * 1000);
  });
};

window.closeOnlineOverlay = function () {
  _stopOnline();
  closeOverlay('onlineOverlay');
};

window.handleSettings = function () {
  if (!S.isAdmin) { toast('Admin access required'); return; }
  S.settingsTab = 'officers';
  renderSettingsList();
  openOverlay('settingsModal');
};

window.closeSettings = function () {
  closeOverlay('settingsModal');
};

window.setSettingsTab = function (tab) { 
  S.settingsTab = tab; 
  renderSettingsList(); 
};

window.toggleExpand = function (id) {
  const el = document.getElementById('li-' + id);
  if (el) el.classList.toggle('expanded');
  const hasExpanded = !!document.querySelector('.loan-item.expanded');
  document.querySelectorAll('.sec-collapse-btn').forEach(btn => {
    btn.style.display = hasExpanded ? '' : 'none';
  });
};

window.collapseAll = function () {
  document.querySelectorAll('.loan-item.expanded').forEach(el => el.classList.remove('expanded'));
  document.querySelectorAll('.sec-collapse-btn').forEach(btn => { btn.style.display = 'none'; });
};
