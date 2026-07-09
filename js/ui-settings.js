import { initPushNotifications } from "./push-notifications.js";
import { S, saveSettings } from "./state.js";
import { esc, toast, initials, officerColor, timeAgo, branchCode } from "./utils.js";
import { isBiometricAvailable, isBiometricRegistered, registerBiometric, removeBiometric } from "./biometric.js";
import { AVAILABILITY_TYPES, availabilityLabel, normalizeAvailability } from "./officer-availability.js";

/* ── PRESENCE TAB STATE ── */
let _presenceUnsub = null;
let _presenceRefreshTimer = null;

function _stopPresence() {
  if (_presenceUnsub) { _presenceUnsub(); _presenceUnsub = null; }
  if (_presenceRefreshTimer) { clearInterval(_presenceRefreshTimer); _presenceRefreshTimer = null; }
}

/* ── SETTINGS UI ── */
export function renderSettingsList() {
  _stopPresence();
  document.querySelectorAll('.settings-tabs .stab').forEach(b => {
    b.classList.toggle('active', b.dataset.stab === S.settingsTab);
  });
  const el = document.getElementById('settingsContent');
  if (!el) return;
  
  if (S.settingsTab === 'officers') {
    el.innerHTML = `<div style="max-height:320px;overflow-y:auto;margin-bottom:8px;">
        ${S.officers.map((o, i) => {
          const photo = S.officerPhotos?.[o];
          const avatar = photo
            ? `<img src="${photo}" style="width:36px;height:36px;border-radius:10px;object-fit:cover;flex-shrink:0;" alt="${esc(o)}">`
            : `<span class="officer-av-initials" style="background:${officerColorInline(o)}">${esc(initials(o))}</span>`;
          return `<div class="setting-item" style="gap:10px;align-items:center;">
            ${avatar}
            <span style="flex:1;font-weight:600;">${esc(o)}</span>
            <input type="file" id="photoInput_${i}" accept="image/*" style="display:none;" onchange="handleOfficerPhotoUpload(event,${i})">
            <button class="btn-sm-ghost" onclick="document.getElementById('photoInput_${i}').click()" title="${photo ? 'Change photo' : 'Upload photo'}">&#128247;</button>
            ${photo ? `<button class="btn-sm-ghost" onclick="removeOfficerPhoto(${i})" title="Remove photo" style="color:#EF4444;">&#215;</button>` : ''}
            <button class="btn-sm-danger" onclick="removeOfficer(${i})">Remove</button>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:8px;"><input type="text" id="newOfficer" placeholder="Add officer name" style="flex:1;"><button type="button" class="btn btn-primary-full" style="flex:none;padding:10px 16px;font-size:14px;border-radius:12px;" onclick="addOfficer()">Add</button></div>`;
  } else if (S.settingsTab === 'branches') {
    el.innerHTML = `<div style="max-height:280px;overflow-y:auto;margin-bottom:8px;">
        ${S.branches.map((b, i) => {
          const code = b.split(':')[0].trim();
          const assigned = S.branchOfficers[code] || '';
          const options = `<option value="">Unassigned</option>` + S.officers.map(o => `<option value="${esc(o)}" ${assigned === o ? 'selected' : ''}>${esc(o)}</option>`).join('');
          return `<div class="setting-item" style="display:flex;align-items:center;gap:8px;padding:8px 12px;">
            <span style="font-size:13px;flex:1;min-width:120px;">${esc(b)}</span>
            <select class="input-light" style="flex:1;padding:6px;border-radius:6px;font-size:12px;" onchange="setBranchOfficer('${code}', this.value)">${options}</select>
            <button class="btn-sm-danger" onclick="removeBranch(${i})">X</button>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:8px;"><input type="text" id="newBranch" placeholder="e.g. 1234 : BRANCH" style="flex:1;"><button type="button" class="btn btn-primary-full" style="flex:none;padding:10px 16px;font-size:14px;border-radius:12px;" onclick="addBranch()">Add</button></div>`;
  } else if (S.settingsTab === 'targets') {
    const month = currentMonthKey();
    const label = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const targets = S.renewalTargets?.[month] || {};
    el.innerHTML = `<div style="padding:4px 2px 12px;font-size:13px;color:#7B7A9A;line-height:1.45;">Set renewal completion targets for ${esc(label)}. Missing targets count as 0.</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
        ${S.officers.map((officer, i) => `<div class="setting-item" style="gap:10px;">
          <span style="flex:1;">${esc(officer)}</span>
          <input type="number" id="target_${i}" min="0" step="1" value="${Number(targets[officer]) || 0}" style="width:92px;padding:8px 10px;border-radius:9px;border:1px solid rgba(107,95,191,0.2);background:rgba(255,255,255,0.75);font-weight:800;text-align:right;">
        </div>`).join('')}
      </div>
      <button type="button" class="btn btn-primary-full" style="width:100%;padding:13px;border-radius:13px;" onclick="saveRenewalTargets()">Save Targets</button>`;
  } else if (S.settingsTab === 'availability') {
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    const todayStr = today.toISOString().slice(0, 10);
    const records = (S.officerAvailability || [])
      .map(normalizeAvailability)
      .filter(Boolean)
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.officer.localeCompare(b.officer));
    el.innerHTML = `<div style="padding:4px 2px 12px;font-size:13px;color:#7B7A9A;line-height:1.45;">Mark officer-specific leave or deputation days. These do not change bank working-day calculations; they only show officer availability on weekly performance.</div>
      <div class="availability-form">
        <select id="availabilityOfficer">
          ${S.officers.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
        <select id="availabilityType">
          ${Object.entries(AVAILABILITY_TYPES).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('')}
        </select>
        <input type="date" id="availabilityStart" value="${todayStr}">
        <input type="date" id="availabilityEnd" value="${todayStr}">
        <input type="text" id="availabilityLabel" placeholder="Optional note">
        <button type="button" class="btn btn-primary-full" onclick="addOfficerAvailability()">Add</button>
      </div>
      <div class="availability-list">
        ${records.length ? records.map(item => {
          const typeLabel = AVAILABILITY_TYPES[item.type] || 'Unavailable';
          const dateText = item.startDate === item.endDate ? item.startDate : `${item.startDate} to ${item.endDate}`;
          return `<div class="availability-item">
            <div class="availability-main">
              <strong>${esc(item.officer)}</strong>
              <span>${esc(typeLabel)} · ${esc(dateText)}${item.label ? ` · ${esc(item.label)}` : ''}</span>
            </div>
            <button class="btn-sm-danger" data-id="${esc(item.id)}" onclick="removeOfficerAvailability(this.dataset.id)">Remove</button>
          </div>`;
        }).join('') : '<div class="setting-item"><span>No officer availability marked yet.</span></div>'}
      </div>`;
  } else if (S.settingsTab === 'adminid') {
    el.innerHTML = `<div class="form-group"><label>New PIN (6 digits)</label><input type="password" id="newPin" class="pin-input" maxlength="6" inputmode="numeric"></div>
      <div class="form-group"><label>Confirm New PIN</label><input type="password" id="confirmPin" class="pin-input" maxlength="6" inputmode="numeric"></div>
      <button type="button" class="btn btn-primary-full" style="width:100%;padding:13px;border-radius:13px;" onclick="changePassword()">Change PIN</button>
      <div id="biometricSettingsSection" style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(107,95,191,0.15);">
        <div style="font-size:13px;color:#7B7A9A;margin-bottom:12px;line-height:1.5;">Use device fingerprint or face unlock instead of PIN when logging in as Admin.</div>
        <div id="biometricSettingsStatus"></div>
      </div>`;
    _renderBiometricSettings();
  } else if (S.settingsTab === 'import') {
    el.innerHTML = `<div style="padding:4px 2px 12px;font-size:13px;color:#7B7A9A;">Bulk-import data from the data/ folder.</div>
      <button type="button" id="clearRenewalsBtn" class="btn btn-primary-full" style="width:100%;margin-bottom:10px;background:linear-gradient(135deg,#EF4444,#B91C1C);" onclick="clearAllSmeRenewals()">&#128465; Clear All SME Renewals</button>
      <button type="button" id="wipeFreshBtn" class="btn btn-primary-full" style="width:100%;margin-bottom:10px;background:linear-gradient(135deg,#DC2626,#991B1B);" onclick="wipeSanctionedFreshLoans()">&#128465; Wipe All Sanctioned Fresh</button>
      <button type="button" id="importSanctionedBtn" class="btn btn-primary-full" style="width:100%;margin-bottom:10px;background:linear-gradient(135deg,#10B981,#047857);" onclick="importMonthlySanctioned()">&#128229; Import April 2026 sanctioned</button>
      <button type="button" id="importReturnsBtn" class="btn btn-primary-full" style="width:100%;margin-bottom:10px;background:linear-gradient(135deg,#F59E0B,#B45309);" onclick="importMonthlyReturns()">&#128229; Import April 2026 returns</button>
      <input type="file" id="csvFileInput" style="display:none;" onchange="handleCsvUpload(event)">
      <button type="button" id="importCsvBtn" class="btn btn-primary-full" style="width:100%;background:linear-gradient(135deg,#3B82F6,#2563EB);" onclick="triggerCsvUpload()">&#128229; Upload CSV</button>`;
  } else if (S.settingsTab === 'userstatus') {
    el.innerHTML = `
      <div style="padding:4px 2px 10px;font-size:13px;color:#7B7A9A;line-height:1.45;">Who is currently active in the app. Presence updates every 2 minutes.</div>
      <div id="presenceList"><div class="skeleton-wrap"><div class="skeleton-row"><div class="skel-circle"></div><div class="skel-bar skel-bar--md"></div><div class="skel-bar skel-bar--lg skel-bar--right"></div></div><div class="skeleton-row"><div class="skel-circle"></div><div class="skel-bar skel-bar--md"></div><div class="skel-bar skel-bar--lg skel-bar--right"></div></div><div class="skeleton-row"><div class="skel-circle"></div><div class="skel-bar skel-bar--md"></div><div class="skel-bar skel-bar--lg skel-bar--right"></div></div></div></div>`;
    import("./presence.js").then(m => {
      let latestData = {};
      function renderPresence() {
        const listEl = document.getElementById('presenceList');
        if (!listEl) { _stopPresence(); return; }
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
      _presenceUnsub = m.subscribePresence(data => { latestData = data; renderPresence(); });
      _presenceRefreshTimer = setInterval(renderPresence, 60 * 1000);
    });
  }
}

function currentMonthKey() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 7);
}

window.renderSettingsList = renderSettingsList;

function refreshAvailabilityViews() {
  window.render?.();
  window.refreshWeeklyPerformanceIfVisible?.();
}

/* ── SETTINGS ACTIONS ── */
window.addOfficer = async function() {
  const v = document.getElementById('newOfficer').value.trim();
  if (!v) return; if (S.officers.includes(v)) { toast('Already exists'); return; }
  S.officers.push(v); await saveSettings();
  document.getElementById('newOfficer').value = ''; renderSettingsList(); window.render(); toast('Officer added');
};
window.removeOfficer = async function(i) {
  const name = S.officers[i];
  if (!name) return;
  if (!confirm(`Remove ${name}? Their branch assignments, targets, photo and availability will be cleared, and their loans will move to each branch's current officer.`)) return;
  S.officers.splice(i, 1);

  // Scrub every settings reference so the name stops appearing anywhere
  Object.keys(S.branchOfficers || {}).forEach(code => {
    if (S.branchOfficers[code] === name) delete S.branchOfficers[code];
  });
  Object.values(S.renewalTargets || {}).forEach(monthTargets => {
    if (monthTargets && name in monthTargets) delete monthTargets[name];
  });
  if (S.officerPhotos?.[name]) delete S.officerPhotos[name];
  S.officerAvailability = (S.officerAvailability || []).filter(item => item?.officer !== name);
  await saveSettings();

  // Hand the officer's loans to whoever now owns each branch (or Unassigned),
  // and drop any manual month overrides that still point at them.
  const affected = S.loans.filter(l => l.allocatedTo === name || l.manualOfficer === name);
  if (affected.length) {
    const { updateLoan } = await import("./db.js");
    await Promise.all(affected.map(loan => {
      const patch = {};
      if (loan.allocatedTo === name) {
        const code = branchCode(loan.branch || '').trim();
        patch.allocatedTo = (code && S.branchOfficers[code]) || '';
      }
      if (loan.manualOfficer === name) {
        patch.manualOfficer = '';
        patch.manualOfficerMonth = '';
      }
      return updateLoan(loan.id, patch);
    }));
  }

  renderSettingsList();
  window.render();
  toast(`${name} removed${affected.length ? ` · ${affected.length} loan${affected.length === 1 ? '' : 's'} reassigned` : ''}`);
};
window.addBranch = async function() {
  const v = document.getElementById('newBranch').value.trim();
  if (!v) return; if (S.branches.includes(v)) { toast('Already exists'); return; }
  S.branches.push(v); await saveSettings(); document.getElementById('newBranch').value = ''; renderSettingsList(); toast('Branch added');
};
window.removeBranch = async function(i) {
  if (!confirm(`Remove ${S.branches[i]}?`)) return;
  S.branches.splice(i, 1); await saveSettings(); renderSettingsList();
};
window.setBranchOfficer = async function(code, off) {
  S.branchOfficers[code] = off; await saveSettings(); toast('Assigned officer &#10003;');
};
/* ── OFFICER PHOTO HELPERS ── */
function officerColorInline(name) {
  return officerColor(name).bg;
}

function compressOfficerPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const SIZE = 96;
        const scale = Math.min(SIZE / img.width, SIZE / img.height, 1);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.80));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

window.handleOfficerPhotoUpload = async function(event, i) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await compressOfficerPhoto(file);
    const officer = S.officers[i];
    if (!officer) return;
    S.officerPhotos = { ...(S.officerPhotos || {}), [officer]: dataUrl };
    await saveSettings();
    renderSettingsList();
    window.render?.();
    toast('Photo updated &#10003;');
  } catch (e) {
    toast('Could not process photo');
    console.error(e);
  }
};

window.removeOfficerPhoto = async function(i) {
  const officer = S.officers[i];
  if (!officer) return;
  if (!S.officerPhotos?.[officer]) return;
  delete S.officerPhotos[officer];
  await saveSettings();
  renderSettingsList();
  window.render?.();
  toast('Photo removed');
};

window.saveRenewalTargets = async function() {
  const month = currentMonthKey();
  const targets = {};
  S.officers.forEach((officer, i) => {
    const input = document.getElementById(`target_${i}`);
    targets[officer] = Math.max(0, Math.floor(Number(input?.value) || 0));
  });
  S.renewalTargets = { ...(S.renewalTargets || {}), [month]: targets };
  await saveSettings();
  renderSettingsList();
  window.render?.();
  toast('Targets saved &#10003;');
};

window.addOfficerAvailability = async function() {
  const officer = document.getElementById('availabilityOfficer')?.value;
  const type = document.getElementById('availabilityType')?.value || 'holiday';
  const startDate = document.getElementById('availabilityStart')?.value;
  const rawEndDate = document.getElementById('availabilityEnd')?.value;
  const label = document.getElementById('availabilityLabel')?.value.trim() || '';
  if (!officer || !startDate) {
    toast('Select officer and date');
    return;
  }
  const endDate = rawEndDate && rawEndDate >= startDate ? rawEndDate : startDate;
  const item = normalizeAvailability({
    id: `${officer}_${type}_${startDate}_${endDate}_${Date.now()}`.replace(/[^a-z0-9_-]+/gi, '_'),
    officer,
    type,
    startDate,
    endDate,
    label,
  });
  if (!item) {
    toast('Could not add availability');
    return;
  }
  S.officerAvailability = [...(S.officerAvailability || []), item];
  await saveSettings();
  renderSettingsList();
  refreshAvailabilityViews();
  toast(`${availabilityLabel(item)} marked`);
};

window.removeOfficerAvailability = async function(id) {
  S.officerAvailability = (S.officerAvailability || []).filter(item => normalizeAvailability(item)?.id !== id);
  await saveSettings();
  renderSettingsList();
  refreshAvailabilityViews();
  toast('Availability removed');
};

window.changePassword = async function() {
  const np = document.getElementById('newPin').value.trim();
  const cp = document.getElementById('confirmPin').value.trim();
  if (!/^\d{6}$/.test(np)) { toast('PIN must be 6 digits'); return; }
  if (np !== cp) { toast('PINs do not match'); return; }
  import("./state.js").then(module => {
    module.setPIN(np); module.saveSettings();
    document.getElementById('newPin').value = ''; document.getElementById('confirmPin').value = '';
    toast('Admin PIN changed &#10003;');
  });
};

async function _renderBiometricSettings() {
  const el = document.getElementById('biometricSettingsStatus');
  if (!el) return;
  const available = await isBiometricAvailable();
  if (!available) {
    el.innerHTML = `<div style="font-size:13px;color:#EF4444;padding:10px 12px;background:rgba(239,68,68,0.08);border-radius:10px;">Biometric authentication is not available on this device or browser.</div>`;
    return;
  }
  const registered = isBiometricRegistered();
  if (registered) {
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(16,185,129,0.08);border-radius:12px;margin-bottom:10px;">
        <span style="font-size:22px;">&#128274;</span>
        <div style="flex:1;"><div style="font-weight:600;font-size:14px;color:#059669;">Biometric Login Active</div><div style="font-size:12px;color:#7B7A9A;margin-top:2px;">Fingerprint / Face ID is set up for Admin login.</div></div>
      </div>
      <button type="button" class="btn btn-primary-full" style="width:100%;padding:12px;border-radius:12px;background:linear-gradient(135deg,#EF4444,#B91C1C);" onclick="disableBiometric()">Remove Biometric</button>`;
  } else {
    el.innerHTML = `
      <button type="button" class="btn btn-primary-full" style="width:100%;padding:12px;border-radius:12px;" onclick="setupBiometric()">&#128274; Set Up Biometric Login</button>`;
  }
}

window.setupBiometric = async function() {
  const btn = document.querySelector('#biometricSettingsStatus button');
  if (btn) btn.disabled = true;
  try {
    await registerBiometric();
    toast('Biometric login enabled &#10003;');
    _renderBiometricSettings();
  } catch (e) {
    if (e.name !== 'NotAllowedError') toast('Could not register biometric: ' + e.message);
    if (btn) btn.disabled = false;
  }
};

window.disableBiometric = function() {
  removeBiometric();
  toast('Biometric login removed');
  _renderBiometricSettings();
};
