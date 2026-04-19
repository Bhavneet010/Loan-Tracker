import { S, saveSettings } from "./state.js";
import { esc, toast } from "./utils.js";
import { render } from "./ui-render.js";

/* ── SETTINGS UI ── */
export function renderSettingsList() {
  document.querySelectorAll('.settings-tabs .stab').forEach(b => {
    b.classList.toggle('active', b.dataset.stab === S.settingsTab);
  });
  const el = document.getElementById('settingsContent');
  if (!el) return;
  
  if (S.settingsTab === 'officers') {
    el.innerHTML = `<div style="max-height:280px;overflow-y:auto;margin-bottom:8px;">
        ${S.officers.map((o, i) => `<div class="setting-item"><span>${esc(o)}</span><button class="btn-sm-danger" onclick="removeOfficer(${i})">Remove</button></div>`).join('')}
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
  } else if (S.settingsTab === 'adminid') {
    el.innerHTML = `<div class="form-group"><label>New PIN (6 digits)</label><input type="password" id="newPin" class="pin-input" maxlength="6" inputmode="numeric"></div>
      <div class="form-group"><label>Confirm New PIN</label><input type="password" id="confirmPin" class="pin-input" maxlength="6" inputmode="numeric"></div>
      <button type="button" class="btn btn-primary-full" style="width:100%;padding:13px;border-radius:13px;" onclick="changePassword()">Change PIN</button>`;
  } else if (S.settingsTab === 'import') {
    el.innerHTML = `<div style="padding:4px 2px 12px;font-size:13px;color:#7B7A9A;">Bulk-import data from the data/ folder.</div>
      <button type="button" id="clearRenewalsBtn" class="btn btn-primary-full" style="width:100%;margin-bottom:10px;background:linear-gradient(135deg,#EF4444,#B91C1C);" onclick="clearAllSmeRenewals()">🗑️ Clear All SME Renewals</button>
      <button type="button" id="wipeFreshBtn" class="btn btn-primary-full" style="width:100%;margin-bottom:10px;background:linear-gradient(135deg,#DC2626,#991B1B);" onclick="wipeSanctionedFreshLoans()">🗑️ Wipe All Sanctioned Fresh</button>
      <input type="file" id="csvFileInput" style="display:none;" onchange="handleCsvUpload(event)">
      <button type="button" id="importCsvBtn" class="btn btn-primary-full" style="width:100%;background:linear-gradient(135deg,#3B82F6,#2563EB);" onclick="triggerCsvUpload()">📥 Upload CSV</button>`;
  }
}

/* ── SETTINGS ACTIONS ── */
window.addOfficer = async function() {
  const v = document.getElementById('newOfficer').value.trim();
  if (!v) return; if (S.officers.includes(v)) { toast('Already exists'); return; }
  S.officers.push(v); await saveSettings();
  document.getElementById('newOfficer').value = ''; renderSettingsList(); render(); toast('Officer added');
};
window.removeOfficer = async function(i) {
  if (!confirm(`Remove ${S.officers[i]}?`)) return;
  S.officers.splice(i, 1); await saveSettings(); renderSettingsList(); render();
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
  S.branchOfficers[code] = off; await saveSettings(); toast('Assigned officer ✓');
};
window.changePassword = async function() {
  const np = document.getElementById('newPin').value.trim();
  const cp = document.getElementById('confirmPin').value.trim();
  if (!/^\d{6}$/.test(np)) { toast('PIN must be 6 digits'); return; }
  if (np !== cp) { toast('PINs do not match'); return; }
  import("./state.js").then(module => {
    module.setPIN(np); module.saveSettings();
    document.getElementById('newPin').value = ''; document.getElementById('confirmPin').value = '';
    toast('Admin PIN changed ✓');
  });
};
