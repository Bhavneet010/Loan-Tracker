import { S, PIN, saveSettings } from "./state.js";
import { renderSettingsList } from "./ui-settings.js";
import { toast, initials, officerColor } from "./utils.js";
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

/* ── DOUBLE-TAP → PHOTO OVERLAY ── */
(function initAvatarTripleTap() {
  const av = document.getElementById('userAv');
  if (!av) return;
  let count = 0, timer = null;
  av.addEventListener('click', e => {
    count++;
    clearTimeout(timer);
    timer = setTimeout(() => { count = 0; }, 600);
    if (count >= 2) {
      count = 0;
      clearTimeout(timer);
      if (!S.isAdmin && S.user) {
        e.stopPropagation();
        window.closeUserMenu?.();
        window.openPhotoOverlay();
      }
    }
  });
})();

window.toggleDark = function () {
  S.dark = !S.dark;
  document.body.classList.toggle('dark', S.dark);
  localStorage.setItem('lpDark', S.dark ? '1' : '0');
  updateThemeColor();
};

function updateThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', S.dark ? '#15142C' : '#7c3aed');
}

window.toggleUserMenu = function () {
  const menu = document.getElementById('userMenu');
  if (menu.style.display === 'none') {
    menu.innerHTML = `
      ${S.isAdmin ? `<button class="udrop-item" onclick="closeUserMenu();handleSettings()">&#9881; Settings</button>` : ''}
      <button class="udrop-item" onclick="closeUserMenu();toggleDark()">${S.dark ? '&#9728; Light theme' : '&#127769; Dark theme'}</button>
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
  await import("./performance.js");
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
  closeOverlay('userModal', () => { requestNotifPermission(); window.render(); });
};

window.promptAdmin = async function () {
  closeOverlay('userModal', async () => {
    const bioBtn = document.getElementById('biometricBtn');
    if (bioBtn) {
      const registered = isBiometricRegistered();
      const available = registered && await isBiometricAvailable();
      bioBtn.style.display = available ? 'flex' : 'none';
    }
    openOverlay('pinModal');
    setTimeout(() => document.getElementById('pinInput').focus(), 260);
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
    if (e.name !== 'NotAllowedError') toast('Biometric failed &mdash; use PIN instead');
  } finally {
    if (bioBtn) { bioBtn.disabled = false; bioBtn.classList.remove('bio-btn--loading'); }
  }
};

function _grantAdminAccess() {
  S.user = 'Admin'; S.isAdmin = true;
  S.filter = { category: 'All', officer: 'All' };
  localStorage.setItem('lpUser', 'Admin'); localStorage.setItem('lpAdmin', 'true');
  const av = document.getElementById('userAv');
  av.textContent = '&#128274;'; av.style.background = ''; av.style.color = '';
  requestNotifPermission();
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
