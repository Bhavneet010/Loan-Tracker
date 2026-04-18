import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getFirestore,collection,doc,setDoc,updateDoc,deleteDoc,
  onSnapshot,query,orderBy,getDoc
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const FB = {
  apiKey:"AIzaSyDY0AMy0eZI_74nJSoy46uHqgKvh9NkKw8",
  authDomain:"loan-tracker-4af27.firebaseapp.com",
  projectId:"loan-tracker-4af27",
  storageBucket:"loan-tracker-4af27.firebasestorage.app",
  messagingSenderId:"700827916451",
  appId:"1:700827916451:web:d872bf2905d234bdb60716"
};
let PIN = "147258";
let notifReady = false;
const app = initializeApp(FB);
const db  = getFirestore(app);

/* ── STATE ── */
const S = {
  user:null, isAdmin:false,
  tab:'pending', sub:'All', settingsTab:'officers', search:'', myLoansOnly:false, dark:false,
  loans:[], notifications:[],
  officers:['Anchal','Nikita','Ritika'],
  branches:[
    '686 : NAHAN','1680 : ADB PAONTA SAHIB','1755 : PAONTA SAHIB',
    '2413 : MAJRA','3399 : RAJBAN','4589 : SME TARUWALA',
    '4590 : KALA AMB','6784 : DHAULA KUAN','7459 : KAFOTA',
    '8117 : RAJPUR','50536 : BHAGANI','50569 : TIMBI','63982 : SHILLAI'
  ]
};

/* ── UTILS ── */
const todayStr = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const fmtDate  = s => { if(!s) return ''; const [y,m,d]=s.split('-'); return `${d}.${m}.${y}`; };
const fmtShortDate = s => { if(!s) return ''; const [,m,d]=s.split('-'); return `${parseInt(d)} ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[parseInt(m)-1]}`; };
const branchCode = s => (s||'').split(' ')[0] || '';
const shortCat   = s => ({'Agriculture':'Agri','Education':'Edu'}[s]||s);
const fmtAmt   = v => (parseFloat(v)||0).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2});
const esc      = s => s==null?'':String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = n => (n||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
const catCls   = c => ({Agriculture:'agri',SME:'sme',Education:'edu'}[c]||'');

function toast(msg) {
  document.querySelectorAll('.toast').forEach(e=>e.remove());
  const t=document.createElement('div'); t.className='toast'; t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(),2600);
}

const daysPending = d => !d ? 0 : Math.floor((Date.now()-new Date(d).getTime())/86400000);

async function requestNotifPermission(){
  if('Notification' in window && Notification.permission==='default')
    await Notification.requestPermission();
}
function notifyLoanChange(loan){
  if(Notification.permission!=='granted') return;
  if(!document.hidden && document.hasFocus()) return;
  const labels={pending:'Pending',sanctioned:'✓ Sanctioned',returned:'↩ Returned'};
  const title=`${labels[loan.status]||loan.status} — ${loan.customerName}`;
  const body=`₹${fmtAmt(loan.amount)}L · ${loan.allocatedTo}`;
  try{ new Notification(title,{body,icon:'/icon-192.png',tag:loan.id,renotify:true}); }catch(e){}
}
function showUndoToast(msg, undoFn){
  document.querySelectorAll('.toast').forEach(e=>e.remove());
  const t=document.createElement('div'); t.className='toast toast-undo';
  const sp=document.createElement('span'); sp.textContent=msg;
  const btn=document.createElement('button'); btn.className='undo-btn'; btn.textContent='Undo';
  btn.onclick=async()=>{ clearTimeout(t._timer); t.remove(); await undoFn(); };
  t.appendChild(sp); t.appendChild(btn);
  document.body.appendChild(t);
  t._timer=setTimeout(()=>t.remove(),4500);
}
window.toggleDark = function(){
  S.dark=!S.dark;
  document.body.classList.toggle('dark',S.dark);
  localStorage.setItem('lpDark',S.dark?'1':'0');
};
window.toggleUserMenu = function(){
  const menu=document.getElementById('userMenu');
  if(menu.style.display==='none'){
    menu.innerHTML=`
      ${S.isAdmin?`<button class="udrop-item" onclick="closeUserMenu();handleSettings()">⚙️ Settings</button>`:''}
      <button class="udrop-item" onclick="closeUserMenu();toggleDark()">${S.dark?'☀️ Light theme':'🌙 Dark theme'}</button>
      <button class="udrop-item" onclick="closeUserMenu();showUserSelect()">👤 Change officer</button>`;
    menu.style.display='block';
    setTimeout(()=>document.addEventListener('click',_closeMenuOutside,{once:true}),0);
  } else { menu.style.display='none'; }
};
window.closeUserMenu = ()=>{ document.getElementById('userMenu').style.display='none'; };
function _closeMenuOutside(e){
  const menu=document.getElementById('userMenu');
  if(menu&&!menu.contains(e.target)) menu.style.display='none';
}
window.showNotifOverlay = function(){
  document.getElementById('notifOverlay').style.display='flex';
  renderNotifOverlay();
  markNotifsRead();
};
window.closeNotifOverlay = ()=>{ document.getElementById('notifOverlay').style.display='none'; };

window.showPerfOverlay = function(){
  document.getElementById('perfOverlay').style.display='block';
  document.body.style.overflow='hidden';
  renderDaily(document.getElementById('perfOverlayContent'));
};
window.closePerfOverlay = function(){
  currentCharts.forEach(ch=>ch.destroy());
  currentCharts=[];
  document.getElementById('perfOverlay').style.display='none';
  document.body.style.overflow='';
};
window.clearNotifications = async function(){
  const toHide=visibleNotifs();
  for(const n of toHide)
    updateDoc(doc(db,'notifications',n.id),{clearedBy:[...(n.clearedBy||[]),S.user]}).catch(()=>{});
  closeNotifOverlay();
  toast('Notifications cleared');
};
window.handleSearch = v=>{ S.search=v.toLowerCase().trim(); render(); };
window.toggleMyLoans = function(){ S.myLoansOnly=!S.myLoansOnly; render(); };

/* ── FIREBASE SETTINGS ── */
async function loadSettings() {
  try {
    const snap=await getDoc(doc(db,'settings','config'));
    if(snap.exists()){
      const d=snap.data();
      if(d.officers?.length) S.officers=d.officers;
      if(d.branches?.length) S.branches=d.branches;
      if(d.adminPin) PIN=d.adminPin;
    } else {
      await setDoc(doc(db,'settings','config'),{officers:S.officers,branches:S.branches,adminPin:PIN});
    }
  } catch(e){console.error(e);}
}
async function saveSettings() {
  try { await setDoc(doc(db,'settings','config'),{officers:S.officers,branches:S.branches,adminPin:PIN}); }
  catch(e){ toast('Error saving'); }
}

/* ── FIREBASE LOANS ── */
function subscribeLoans() {
  onSnapshot(query(collection(db,'loans'),orderBy('receiveDate','desc')), snap => {
    if(notifReady && S.user && Notification.permission==='granted'){
      snap.docChanges().forEach(change=>{
        if(change.type==='modified'){
          const loan={id:change.doc.id,...change.doc.data()};
          if(S.isAdmin || loan.allocatedTo===S.user) notifyLoanChange(loan);
        }
      });
    }
    notifReady=true;
    S.loans=[];
    snap.forEach(d=>S.loans.push({id:d.id,...d.data()}));
    document.getElementById('syncDot').classList.remove('off');
    updateBadges(); render();
  }, err => {
    document.getElementById('syncDot').classList.add('off');
    console.error(err);
  });
}
const newId   = ()=>'loan_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
const ts      = ()=>({updatedAt:new Date().toISOString(),updatedBy:S.user});
async function createLoan(data){ const id=newId(); await setDoc(doc(db,'loans',id),{...data,status:'pending',createdAt:new Date().toISOString(),createdBy:S.user,...ts()}); return id; }
async function updateLoan(id,data){ await updateDoc(doc(db,'loans',id),{...data,...ts()}); }
async function removeLoan(id){ await deleteDoc(doc(db,'loans',id)); }

/* ── BULK SANCTION IMPORT ── */
function slugifyId(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40);
}
function sanctionDocId(period, entry){
  return `import_${period}_${slugifyId(entry.customerName)}_${entry.sanctionDate||''}`.replace(/-/g,'');
}
async function importSanctionsFromUrl(url){
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok) throw new Error('Failed to load '+url);
  const payload=await res.json();
  const period=payload.period||'unknown';
  const entries=Array.isArray(payload.entries)?payload.entries:[];
  let added=0, skipped=0;
  for(const e of entries){
    const id=sanctionDocId(period,e);
    const existing=await getDoc(doc(db,'loans',id));
    if(existing.exists()){ skipped++; continue; }
    await setDoc(doc(db,'loans',id),{
      allocatedTo:e.allocatedTo,
      category:e.category,
      branch:e.branch,
      customerName:(e.customerName||'').toUpperCase(),
      amount:parseFloat(e.amount)||0,
      receiveDate:e.receiveDate,
      sanctionDate:e.sanctionDate,
      remarks:e.remarks||'',
      status:'sanctioned',
      createdAt:new Date().toISOString(),
      createdBy:S.user||'import',
      source:`import:${period}`,
      ...ts()
    });
    added++;
  }
  return {added, skipped, total:entries.length, label:payload.label||period};
}
window.importMonthlySanctions = async function(){
  if(!S.isAdmin){ toast('Admin only'); return; }
  const url='data/sanctions-2026-04.json';
  if(!confirm('Import April 2026 sanctions into Firestore? Existing entries (matched by customer + sanction date) will be skipped.')) return;
  const btn=document.getElementById('importSanctionsBtn');
  if(btn){ btn.disabled=true; btn.textContent='Importing…'; }
  try {
    const r=await importSanctionsFromUrl(url);
    toast(`${r.label}: ${r.added} added, ${r.skipped} skipped`);
  } catch(e){ console.error(e); toast('Import failed'); }
  finally { if(btn){ btn.disabled=false; btn.textContent='📥 Import April 2026 sanctions'; } }
};

/* ── NOTIFICATIONS ── */
async function createNotification(type, loan){
  const id='n_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
  await setDoc(doc(db,'notifications',id),{
    type, loanId:loan.id||'',
    customerName:loan.customerName||'', amount:loan.amount||0,
    branch:loan.branch||'', category:loan.category||'',
    allocatedTo:loan.allocatedTo||'',
    by:S.user, timestamp:new Date().toISOString(), readBy:[]
  });
}
function subscribeNotifications(){
  let firstLoad=true;
  onSnapshot(query(collection(db,'notifications'),orderBy('timestamp','desc')), snap=>{
    S.notifications=[];
    snap.forEach(d=>S.notifications.push({id:d.id,...d.data()}));
    updateNotifBadge();
    if(S.tab==='notifs') render();
    if(firstLoad && S.user && !sessionStorage.getItem('actOverlayShown')){
      sessionStorage.setItem('actOverlayShown','1');
      showActivityOverlay();
    }
    firstLoad=false;
  });
}
function visibleNotifs(){
  const base=S.isAdmin ? S.notifications : S.notifications.filter(n=>
    n.allocatedTo===S.user&&(n.type==='added'||n.type==='sanctioned'||n.type==='returned')
  );
  return base.filter(n=>!(n.clearedBy||[]).includes(S.user));
}
function renderNotifOverlay(){
  const c=document.getElementById('notifList'); if(!c) return;
  const notifs=visibleNotifs();
  if(!notifs.length){ c.innerHTML=`<div class="empty-state" style="padding:32px 20px;">🔔<br><br><b>No notifications</b><br><span style="font-size:12px;color:#7B7A9A;">Activity will appear here</span></div>`; return; }
  const typeIcon={added:'➕',sanctioned:'✓',returned:'↩',edited:'✎'};
  const typeLabel={added:'New loan added',sanctioned:'Loan sanctioned',returned:'Loan returned',edited:'Loan updated'};
  const typeCls={added:'notif-added',sanctioned:'notif-sanctioned',returned:'notif-returned',edited:'notif-edited'};
  function timeAgo(ts){
    if(!ts) return '';
    const mins=Math.floor((Date.now()-new Date(ts).getTime())/60000);
    if(mins<1) return 'just now'; if(mins<60) return `${mins}m ago`;
    const hrs=Math.floor(mins/60);
    if(hrs<24) return `${hrs}h ago`; return `${Math.floor(hrs/24)}d ago`;
  }
  c.innerHTML=notifs.map(n=>{
    const unread=!(n.readBy||[]).includes(S.user);
    return `<div class="notif-card${unread?' unread':''}">
      <div class="notif-icon ${typeCls[n.type]||''}">${typeIcon[n.type]||'•'}</div>
      <div class="notif-body">
        <div class="notif-label">${typeLabel[n.type]||n.type}</div>
        <div class="notif-name">${esc(n.customerName)} · ₹${fmtAmt(n.amount)}L</div>
        <div class="notif-meta">${esc(n.branch||'')} · ${esc(n.category||'')} · ${esc(n.allocatedTo||'')} · by ${esc(n.by||'')}</div>
      </div>
      <div class="notif-time">${timeAgo(n.timestamp)}</div>
    </div>`;
  }).join('');
}
function updateNotifBadge(){
  const el=document.getElementById('b-notifs'); if(!el||!S.user) return;
  const count=visibleNotifs().filter(n=>!(n.readBy||[]).includes(S.user)).length;
  el.textContent=count||'';
}
async function markNotifsRead(){
  const unread=visibleNotifs().filter(n=>!(n.readBy||[]).includes(S.user));
  for(const n of unread){
    updateDoc(doc(db,'notifications',n.id),{readBy:[...(n.readBy||[]),S.user]}).catch(()=>{});
  }
}
function showActivityOverlay(){
  const notifs=visibleNotifs().filter(n=>!(n.readBy||[]).includes(S.user));
  if(!notifs.length) return;
  const counts={};
  notifs.forEach(n=>{ counts[n.type]=(counts[n.type]||0)+1; });
  const icons={added:'➕',sanctioned:'✓',returned:'↩',edited:'✎'};
  const labels={added:'loan added',sanctioned:'loan sanctioned',returned:'loan returned',edited:'loan updated'};
  const lines=Object.entries(counts).map(([t,c])=>
    `<div class="ab-line"><span class="ab-icon ${t}">${icons[t]||'•'}</span><span>${c} ${labels[t]||t}${c>1?'s':''}</span></div>`
  ).join('');
  const ov=document.createElement('div');
  ov.id='activityOverlay';
  ov.innerHTML=`<div class="activity-bubble">
    <div class="ab-title">Recent Activity</div>
    <div class="ab-lines">${lines}</div>
    <div class="ab-hint">Tap anywhere to dismiss</div>
  </div>`;
  ov.onclick=()=>ov.remove();
  document.body.appendChild(ov);
}
function renderNotifications(c){
  const notifs=visibleNotifs();
  if(!notifs.length){ c.innerHTML=emptyState('🔔','No notifications yet','Activity will appear here'); return; }
  const typeIcon={added:'➕',sanctioned:'✓',returned:'↩',edited:'✎'};
  const typeLabel={added:'New loan added',sanctioned:'Loan sanctioned',returned:'Loan returned',edited:'Loan updated'};
  const typeCls={added:'notif-added',sanctioned:'notif-sanctioned',returned:'notif-returned',edited:'notif-edited'};
  function timeAgo(ts){
    if(!ts) return '';
    const mins=Math.floor((Date.now()-new Date(ts).getTime())/60000);
    if(mins<1) return 'just now';
    if(mins<60) return `${mins}m ago`;
    const hrs=Math.floor(mins/60);
    if(hrs<24) return `${hrs}h ago`;
    return `${Math.floor(hrs/24)}d ago`;
  }
  const cards=notifs.map(n=>{
    const unread=!(n.readBy||[]).includes(S.user);
    return `<div class="notif-card${unread?' unread':''}">
      <div class="notif-icon ${typeCls[n.type]||''}">${typeIcon[n.type]||'•'}</div>
      <div class="notif-body">
        <div class="notif-label">${typeLabel[n.type]||n.type}</div>
        <div class="notif-name">${esc(n.customerName)} · ₹${fmtAmt(n.amount)}L</div>
        <div class="notif-meta">${esc(n.branch||'')} · ${esc(n.category||'')} · ${esc(n.allocatedTo||'')} · by ${esc(n.by||'')}</div>
      </div>
      <div class="notif-time">${timeAgo(n.timestamp)}</div>
    </div>`;
  }).join('');
  c.innerHTML=`<div class="sec-head">
    <div class="sec-title">Notifications</div>
    <div class="sec-count">${notifs.length}</div>
  </div>${cards}`;
}

/* ── BADGES ── */
function updateBadges(){
  document.getElementById('b-pending').textContent    = S.loans.filter(l=>l.status==='pending').length;
  document.getElementById('b-sanctioned').textContent = S.loans.filter(l=>l.status==='sanctioned').length;
  document.getElementById('b-returned').textContent   = S.loans.filter(l=>l.status==='returned').length;
}

/* ── USER ── */
window.showUserSelect = function(){
  document.getElementById('userList').innerHTML = S.officers.map(o=>{
    const n=S.loans.filter(l=>l.status==='pending'&&l.allocatedTo===o).length;
    const badge=n?`<span class="officer-count">${n}</span>`:'';
    return `<button class="user-btn" onclick="selectUser('${esc(o)}')">
      <div class="av">${initials(o)}</div><span>${esc(o)}</span>${badge}
    </button>`;
  }).join('');
  document.getElementById('userModal').style.display='flex';
};
window.selectUser = function(name){
  S.user=name; S.isAdmin=false; S.myLoansOnly=true;
  localStorage.setItem('lpUser',name); localStorage.setItem('lpAdmin','false');
  document.getElementById('userAv').textContent=initials(name);
  document.getElementById('userModal').style.display='none';
  requestNotifPermission();
  render();
};
window.promptAdmin = function(){
  document.getElementById('userModal').style.display='none';
  document.getElementById('pinModal').style.display='flex';
  setTimeout(()=>document.getElementById('pinInput').focus(),100);
};
window.checkPin = function(){
  if(document.getElementById('pinInput').value===PIN){
    S.user='Admin'; S.isAdmin=true; S.myLoansOnly=false;
    localStorage.setItem('lpUser','Admin'); localStorage.setItem('lpAdmin','true');
    document.getElementById('userAv').textContent='🔒';
    document.getElementById('pinInput').value='';
    document.getElementById('pinModal').style.display='none';
    requestNotifPermission();
    toast('Admin mode active'); render();
  } else { toast('Incorrect PIN'); document.getElementById('pinInput').value=''; }
};
window.closePinModal = function(){ document.getElementById('pinInput').value=''; document.getElementById('pinModal').style.display='none'; };
document.getElementById('pinInput').addEventListener('keydown',e=>{ if(e.key==='Enter') window.checkPin(); });
document.getElementById('pinInput').addEventListener('input',e=>{ if(e.target.value.length===6) window.checkPin(); });

/* ── SETTINGS ── */
window.handleSettings = function(){
  if(!S.isAdmin){ toast('Admin access required'); return; }
  S.settingsTab='officers';
  renderSettingsList();
  document.getElementById('settingsModal').style.display='flex';
};
window.closeSettings = function(){ document.getElementById('settingsModal').style.display='none'; };
window.setSettingsTab = function(tab){ S.settingsTab=tab; renderSettingsList(); };
window.changePassword = async function(){
  const np=document.getElementById('newPin').value.trim();
  const cp=document.getElementById('confirmPin').value.trim();
  if(!/^\d{6}$/.test(np)){ toast('PIN must be exactly 6 digits'); return; }
  if(np!==cp){ toast('PINs do not match'); return; }
  try{
    PIN=np; await saveSettings();
    document.getElementById('newPin').value='';
    document.getElementById('confirmPin').value='';
    toast('Admin PIN changed ✓');
  } catch(e){ toast('Error saving PIN'); }
};
function renderSettingsList(){
  document.querySelectorAll('.settings-tabs .stab').forEach(b=>{
    b.classList.toggle('active', b.dataset.stab===S.settingsTab);
  });
  const el=document.getElementById('settingsContent');
  if(!el) return;
  if(S.settingsTab==='officers'){
    el.innerHTML=`
      <div style="max-height:280px;overflow-y:auto;margin-bottom:8px;">
        ${S.officers.map((o,i)=>`
          <div class="setting-item">
            <span>${esc(o)}</span>
            <button class="btn-sm-danger" onclick="removeOfficer(${i})">Remove</button>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;">
        <input type="text" id="newOfficer" placeholder="Add officer name" style="flex:1;">
        <button type="button" class="btn btn-primary-full" style="flex:none;padding:10px 16px;font-size:14px;border-radius:12px;" onclick="addOfficer()">Add</button>
      </div>`;
  } else if(S.settingsTab==='branches'){
    el.innerHTML=`
      <div style="max-height:280px;overflow-y:auto;margin-bottom:8px;">
        ${S.branches.map((b,i)=>`
          <div class="setting-item">
            <span style="font-size:13px;">${esc(b)}</span>
            <button class="btn-sm-danger" onclick="removeBranch(${i})">Remove</button>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;">
        <input type="text" id="newBranch" placeholder="e.g. 1234 : BRANCH NAME" style="flex:1;">
        <button type="button" class="btn btn-primary-full" style="flex:none;padding:10px 16px;font-size:14px;border-radius:12px;" onclick="addBranch()">Add</button>
      </div>`;
  } else if(S.settingsTab==='adminid'){
    el.innerHTML=`
      <div class="form-group">
        <label>New PIN (6 digits)</label>
        <input type="password" id="newPin" class="pin-input" maxlength="6" inputmode="numeric" placeholder="••••••">
      </div>
      <div class="form-group">
        <label>Confirm New PIN</label>
        <input type="password" id="confirmPin" class="pin-input" maxlength="6" inputmode="numeric" placeholder="••••••">
      </div>
      <button type="button" class="btn btn-primary-full" style="width:100%;padding:13px;font-size:15px;border-radius:13px;" onclick="changePassword()">Change PIN</button>`;
  } else if(S.settingsTab==='import'){
    el.innerHTML=`
      <div style="padding:4px 2px 12px;font-size:13px;color:#7B7A9A;line-height:1.5;">
        Import this month's sanctioned loans from <code>data/sanctions-2026-04.json</code>.
        Existing entries (matched by customer + sanction date) are skipped, so it's safe to re-run.
      </div>
      <button type="button" id="importSanctionsBtn" class="btn btn-primary-full" style="width:100%;padding:13px;font-size:15px;border-radius:13px;" onclick="importMonthlySanctions()">📥 Import April 2026 sanctions</button>`;
  }
}
window.addOfficer = async function(){
  const v=document.getElementById('newOfficer').value.trim();
  if(!v) return; if(S.officers.includes(v)){toast('Already exists');return;}
  S.officers.push(v); await saveSettings();
  document.getElementById('newOfficer').value='';
  renderSettingsList(); render(); toast('Officer added');
};
window.removeOfficer = async function(i){
  if(!confirm(`Remove ${S.officers[i]}?`)) return;
  S.officers.splice(i,1); await saveSettings(); renderSettingsList(); render();
};
window.addBranch = async function(){
  const v=document.getElementById('newBranch').value.trim();
  if(!v) return; if(S.branches.includes(v)){toast('Already exists');return;}
  S.branches.push(v); await saveSettings();
  document.getElementById('newBranch').value='';
  renderSettingsList(); toast('Branch added');
};
window.removeBranch = async function(i){
  if(!confirm(`Remove ${S.branches[i]}?`)) return;
  S.branches.splice(i,1); await saveSettings(); renderSettingsList();
};

/* ── FORM ── */
window.openForm = function(loan=null){
  if(!S.user){ showUserSelect(); return; }
  document.getElementById('fOfficer').innerHTML = '<option value="">Select officer</option>'+S.officers.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('');
  document.getElementById('fBranch').innerHTML  = '<option value="">Select branch</option>'+S.branches.map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join('');
  if(loan){
    document.getElementById('formTitle').textContent='Edit Loan';
    document.getElementById('loanId').value=loan.id;
    document.getElementById('fOfficer').value=loan.allocatedTo||'';
    document.getElementById('fCategory').value=loan.category||'';
    document.getElementById('fBranch').value=loan.branch||'';
    document.getElementById('fName').value=loan.customerName||'';
    document.getElementById('fAmount').value=loan.amount||'';
    document.getElementById('fReceive').value=loan.receiveDate||'';
    document.getElementById('fSanction').value=loan.sanctionDate||'';
    document.getElementById('fRemarks').value=loan.remarks||'';
    document.getElementById('fSanctionGroup').style.display=loan.status==='sanctioned'?'block':'none';
  } else {
    document.getElementById('formTitle').textContent='Add New Loan';
    document.getElementById('loanForm').reset();
    document.getElementById('loanId').value='';
    document.getElementById('fReceive').value=todayStr();
    document.getElementById('fSanctionGroup').style.display='none';
    if(S.user&&!S.isAdmin) document.getElementById('fOfficer').value=S.user;
  }
  document.getElementById('formModal').style.display='flex';
};
window.closeForm  = ()=>document.getElementById('formModal').style.display='none';
window.saveLoan   = async function(e){
  e.preventDefault();
  const id=document.getElementById('loanId').value;
  const data={
    allocatedTo:document.getElementById('fOfficer').value,
    category:document.getElementById('fCategory').value,
    branch:document.getElementById('fBranch').value,
    customerName:document.getElementById('fName').value.trim().toUpperCase(),
    amount:parseFloat(document.getElementById('fAmount').value),
    receiveDate:document.getElementById('fReceive').value,
    remarks:document.getElementById('fRemarks').value.trim()
  };
  const sd=document.getElementById('fSanction').value;
  if(sd) data.sanctionDate=sd;
  try {
    if(id){
      await updateLoan(id,data);
      createNotification('edited',{...data,id}).catch(()=>{});
      toast('Loan updated ✓');
    } else {
      const nid=await createLoan(data);
      createNotification('added',{...data,id:nid}).catch(()=>{});
      toast('Loan added ✓');
    }
    closeForm();
  } catch(err){ toast('Error saving'); console.error(err); }
};

/* ── LOAN ACTIONS ── */
window.sanctionLoan = async function(id){
  const l=S.loans.find(x=>x.id===id); if(!l) return;
  if(!confirm(`Sanction loan for ${l.customerName}?\n₹${fmtAmt(l.amount)} Lakh`)) return;
  try {
    await updateLoan(id,{status:'sanctioned',sanctionDate:todayStr()});
    createNotification('sanctioned',{...l,status:'sanctioned'}).catch(()=>{});
    toast('Sanctioned ✓');
  } catch(e){ toast('Error'); }
};
window.returnLoan = async function(id){
  const l=S.loans.find(x=>x.id===id); if(!l) return;
  const reason=prompt(`Reason for returning ${l.customerName}?`,l.remarks||'');
  if(reason===null) return;
  try {
    await updateLoan(id,{status:'returned',remarks:reason,returnedDate:todayStr()});
    createNotification('returned',{...l,status:'returned'}).catch(()=>{});
    toast('Marked as returned');
  } catch(e){ toast('Error'); }
};
window.moveToPending = async function(id){
  const l=S.loans.find(x=>x.id===id); if(!l) return;
  if(!confirm(`Move ${l.customerName} back to Pending?`)) return;
  try { await updateLoan(id,{status:'pending'}); toast('Moved to pending'); }
  catch(e){ toast('Error'); }
};
window.editLoan   = id=>{ const l=S.loans.find(x=>x.id===id); if(l) openForm(l); };
window.deleteLoan = async function(id){
  if(!S.isAdmin){toast('Admin only');return;}
  const l=S.loans.find(x=>x.id===id); if(!l) return;
  try {
    const snapshot={...l};
    await removeLoan(id);
    showUndoToast(`Deleted ${l.customerName}`, async()=>{
      await setDoc(doc(db,'loans',snapshot.id),snapshot);
      toast('Loan restored ✓');
    });
  } catch(e){ toast('Error'); }
};

/* ── TABS ── */
document.getElementById('mainTabs').addEventListener('click',e=>{
  const btn=e.target.closest('[data-tab]'); if(!btn) return;
  document.querySelectorAll('#mainTabs .tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  S.tab=btn.dataset.tab; S.sub='All'; S.search='';
  const si=document.getElementById('searchInput'); if(si) si.value='';
  if(S.tab==='notifs') markNotifsRead();
  render();
});
window.setSub = sub=>{ S.sub=sub; render(); };

/* ── RENDER HELPERS ── */
function updateHero(){
  const titles={pending:'Pending',sanctioned:'Sanctioned',returned:'Returned',daily:'Performance',notifs:'Notifications'};
  const pending   = S.loans.filter(l=>l.status==='pending');
  const sanctioned= S.loans.filter(l=>l.status==='sanctioned');
  const returned  = S.loans.filter(l=>l.status==='returned');
  const pAmt = pending.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const sAmt = sanctioned.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const rAmt = returned.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  document.getElementById('statsScroll').innerHTML=`
    <div class="stat">
      <div class="stat-l">Pending</div>
      <div class="stat-v">₹${fmtAmt(pAmt)}L</div>
      <div class="stat-s">${pending.length} loans</div>
      ${pending.length?`<div class="stat-badge">↗ Active</div>`:''}
    </div>
    <div class="stat">
      <div class="stat-l">This Month</div>
      <div class="stat-v">₹${fmtAmt(sAmt)}L</div>
      <div class="stat-s">${sanctioned.length} sanctioned</div>
      <div class="stat-badge">Month total</div>
    </div>
    <div class="stat">
      <div class="stat-l">Returned</div>
      <div class="stat-v">₹${fmtAmt(rAmt)}L</div>
      <div class="stat-s">${returned.length} items</div>
    </div>`;
}

function subtabsHtml(){
  const cats=['All','Agriculture','SME','Education'].map(t=>
    `<button class="subtab ${S.sub===t?'active':''}" onclick="setSub('${t}')">${t}</button>`
  ).join('');
  const myToggle=(S.user&&!S.isAdmin)
    ?`<button class="subtab ${S.myLoansOnly?'active':''}" onclick="toggleMyLoans()">${S.myLoansOnly?'👤 Mine':'👥 All'}</button>`
    :'';
  return cats+myToggle;
}

function loanCard(loan, actions, variant=''){
  const remarks  = loan.remarks?`<div class="lc-remarks">📝 ${esc(loan.remarks)}</div>`:'';
  const sanctTag = loan.sanctionDate?`<span class="tag date">✓ ${fmtDate(loan.sanctionDate)}</span>`:'';
  const retTag   = loan.returnedDate?`<span class="tag date">↩ ${fmtDate(loan.returnedDate)}</span>`:'';
  const days     = loan.status==='pending' ? daysPending(loan.receiveDate) : 0;
  const overdueTag = days>7 ? `<span class="tag overdue">⚠ ${days}d</span>` : '';
  const cls      = `${variant}${days>7&&loan.status==='pending'?' overdue':''}`.trim();
  return `
  <div class="loan-card ${cls}">
    <div class="lc-top">
      <div class="lc-left">
        <div class="lc-name">${esc(loan.customerName)}</div>
        <div class="lc-branch">${esc(loan.branch||'')}</div>
      </div>
      <div class="lc-amount">₹${fmtAmt(loan.amount)}<span class="u"> L</span></div>
    </div>
    <div class="lc-tags">
      <span class="tag ${catCls(loan.category)}">${esc(loan.category)}</span>
      <span class="tag officer">${esc(loan.allocatedTo)}</span>
      <span class="tag date">Recd ${fmtDate(loan.receiveDate)}</span>
      ${overdueTag}${sanctTag}${retTag}
    </div>
    ${remarks}
    <div class="lc-actions">${actions}</div>
  </div>`;
}

function emptyState(icon,msg,sub){
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-msg">${msg}</div><div class="empty-sub">${sub}</div></div>`;
}

window.toggleExpand = function(id){
  const el=document.getElementById('li-'+id);
  if(el) el.classList.toggle('expanded');
};

function compactLoanItem(loan, actions, dateStr, itemCls='', cardVariant=''){
  const overdueTag=itemCls.includes('overdue')?`<span class="tag overdue">⚠ ${daysPending(loan.receiveDate)}d</span>`:'';
  return `<div class="loan-item${itemCls?' '+itemCls:''}" id="li-${loan.id}">
    <div class="loan-row" onclick="toggleExpand('${loan.id}')">
      <div class="lr-info">
        <span class="lr-av">${initials(loan.allocatedTo)}</span>
        <span class="lr-bcode">${esc(branchCode(loan.branch))}</span>
        <span class="tag ${catCls(loan.category)} lr-cat">${esc(shortCat(loan.category))}</span>
        <span class="lr-name">${esc(loan.customerName||'')}</span>
      </div>
      <div class="lr-meta">
        ${overdueTag}
        <span class="lr-date">${dateStr}</span>
        <span class="lr-amount">₹${fmtAmt(loan.amount)}L</span>
        <span class="lr-chev">›</span>
      </div>
    </div>
    <div class="loan-detail">
      <div class="loan-collapse" onclick="toggleExpand('${loan.id}')">▲ collapse</div>
      ${loanCard(loan,actions,cardVariant)}
    </div>
  </div>`;
}

/* ── RENDER TABS ── */
function render(){
  if(!S.user){ showUserSelect(); return; }
  updateHero();
  const sw=document.getElementById('searchWrap');
  if(sw) sw.style.display=(S.tab==='notifs')?'none':'';
  const c=document.getElementById('content');
  if(S.tab==='pending')         renderPending(c);
  else if(S.tab==='sanctioned') renderSanctioned(c);
  else if(S.tab==='returned')   renderReturned(c);
  else if(S.tab==='notifs')     renderNotifications(c);
}

function renderPending(c){
  let loans=S.loans.filter(l=>l.status==='pending')
    .sort((a,b)=>(a.receiveDate||'').localeCompare(b.receiveDate||''));
  if(S.sub!=='All') loans=loans.filter(l=>l.category===S.sub);
  if(S.myLoansOnly) loans=loans.filter(l=>l.allocatedTo===S.user);
  if(S.search) loans=loans.filter(l=>(l.customerName||'').toLowerCase().includes(S.search)||(l.branch||'').toLowerCase().includes(S.search)||(l.allocatedTo||'').toLowerCase().includes(S.search));
  const total=loans.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const cards=loans.length===0
    ? emptyState('📭','No pending loans','Tap + to add a new loan')
    : loans.map(l=>{
        const days=daysPending(l.receiveDate);
        const cls=days>7?'overdue':'';
        const actions=`<button class="btn btn-sanction" onclick="sanctionLoan('${l.id}')">✓ Sanction</button>
          <button class="btn btn-return" onclick="returnLoan('${l.id}')">↩ Return</button>
          <button class="btn btn-more" onclick="editLoan('${l.id}')">✎</button>
          ${S.isAdmin?`<button class="btn btn-danger" onclick="deleteLoan('${l.id}')">🗑</button>`:''}`;
        return compactLoanItem(l,actions,fmtShortDate(l.receiveDate),cls);
      }).join('');
  c.innerHTML=`
    <div class="subtabs">${subtabsHtml()}</div>
    <div class="sec-head">
      <div class="sec-title">Pending Loans</div>
      <div class="sec-count">${loans.length} · ₹${fmtAmt(total)} L</div>
    </div>${cards}`;
}

function renderSanctioned(c){
  let loans=S.loans.filter(l=>l.status==='sanctioned')
    .sort((a,b)=>(b.sanctionDate||'').localeCompare(a.sanctionDate||''));
  if(S.sub!=='All') loans=loans.filter(l=>l.category===S.sub);
  if(S.myLoansOnly) loans=loans.filter(l=>l.allocatedTo===S.user);
  if(S.search) loans=loans.filter(l=>(l.customerName||'').toLowerCase().includes(S.search)||(l.branch||'').toLowerCase().includes(S.search)||(l.allocatedTo||'').toLowerCase().includes(S.search));
  const total=loans.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const cards=loans.length===0
    ? emptyState('🎉','No sanctioned loans yet','Sanction pending loans to see them here')
    : loans.map(l=>{
        const actions=`<button class="btn btn-return" onclick="moveToPending('${l.id}')">↩ Pending</button>
          <button class="btn btn-more" onclick="editLoan('${l.id}')">✎</button>
          ${S.isAdmin?`<button class="btn btn-danger" onclick="deleteLoan('${l.id}')">🗑</button>`:''}`;
        return compactLoanItem(l,actions,fmtShortDate(l.sanctionDate),'','sanctioned');
      }).join('');
  c.innerHTML=`
    <div class="subtabs">${subtabsHtml()}</div>
    <div class="sec-head">
      <div class="sec-title">Sanctioned Loans</div>
      <div class="sec-count">${loans.length} · ₹${fmtAmt(total)} L</div>
    </div>${cards}`;
}

function renderReturned(c){
  let loans=S.loans.filter(l=>l.status==='returned')
    .sort((a,b)=>(a.receiveDate||'').localeCompare(b.receiveDate||''));
  if(S.myLoansOnly) loans=loans.filter(l=>l.allocatedTo===S.user);
  if(S.search) loans=loans.filter(l=>(l.customerName||'').toLowerCase().includes(S.search)||(l.branch||'').toLowerCase().includes(S.search)||(l.allocatedTo||'').toLowerCase().includes(S.search));
  const total=loans.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const cards=loans.length===0
    ? emptyState('📋','No returned loans','Returned loans will appear here')
    : loans.map(l=>{
        const actions=`<button class="btn btn-sanction" onclick="sanctionLoan('${l.id}')">✓ Sanction</button>
          <button class="btn btn-return" onclick="moveToPending('${l.id}')">↩ Pending</button>
          <button class="btn btn-more" onclick="editLoan('${l.id}')">✎</button>
          ${S.isAdmin?`<button class="btn btn-danger" onclick="deleteLoan('${l.id}')">🗑</button>`:''}`;
        return compactLoanItem(l,actions,fmtShortDate(l.returnedDate),'','returned');
      }).join('');
  c.innerHTML=`
    <div class="subtabs">${subtabsHtml()}</div>
    <div class="sec-head">
      <div class="sec-title">Returned Loans</div>
      <div class="sec-count">${loans.length} · ₹${fmtAmt(total)} L</div>
    </div>${cards}`;
}

let currentCharts = [];

function renderDaily(c){
  const td=todayStr(), thisMonth=td.slice(0,7);
  const todayL  =S.loans.filter(l=>l.status==='sanctioned'&&l.sanctionDate===td);
  const monthL  =S.loans.filter(l=>l.status==='sanctioned'&&(l.sanctionDate||'').startsWith(thisMonth));
  const pendingL=S.loans.filter(l=>l.status==='pending');
  const tAmt=todayL.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const mAmt=monthL.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const pAmt=pendingL.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);

  function mkTable(loans){
    if(!loans.length) return `<div style="padding:16px;text-align:center;font-size:13px;color:#7B7A9A;">No entries</div>`;
    const cats=['Agriculture','SME','Education'];
    const grp={};
    loans.forEach(l=>{
      const o=l.allocatedTo||'?'; const cat=l.category||'Other';
      if(!grp[o]) grp[o]={};
      if(!grp[o][cat]) grp[o][cat]={n:0,a:0};
      grp[o][cat].n++; grp[o][cat].a+=parseFloat(l.amount)||0;
    });
    let rows=''; const grand={n:0,a:0};
    S.officers.forEach(off=>{
      const g=grp[off]||{}; let rt={n:0,a:0};
      let cells=cats.map(cat=>{ const v=g[cat]||{n:0,a:0}; rt.n+=v.n; rt.a+=v.a; return `<td class="r">${v.n||''}</td><td class="r">${v.n?fmtAmt(v.a):''}</td>`; }).join('');
      grand.n+=rt.n; grand.a+=rt.a;
      rows+=`<tr><td>${esc(off)}</td>${cells}<td class="r"><b>${rt.n||0}</b></td><td class="r"><b>${rt.n?fmtAmt(rt.a):'0'}</b></td></tr>`;
    });
    let totCells=cats.map(cat=>{ let cn=0,ca=0; S.officers.forEach(o=>{ const v=(grp[o]||{})[cat]||{n:0,a:0}; cn+=v.n; ca+=v.a; }); return `<td class="r">${cn||''}</td><td class="r">${cn?fmtAmt(ca):''}</td>`; }).join('');
    rows+=`<tr class="total"><td>Total</td>${totCells}<td class="r">${grand.n}</td><td class="r">${fmtAmt(grand.a)}</td></tr>`;
    return `<div style="overflow-x:auto;"><table class="rtable">
      <thead>
        <tr><th>Officer</th>${cats.map(c=>`<th class="r" colspan="2">${c}</th>`).join('')}<th class="r" colspan="2">Total</th></tr>
        <tr><th></th>${cats.map(()=>'<th class="r">Cnt</th><th class="r">Amt</th>').join('')}<th class="r">Cnt</th><th class="r">Amt</th></tr>
      </thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  c.innerHTML=`
    <div class="report-card">
      <div class="report-head"><span class="report-head-title">📊 Categories This Month</span></div>
      <div class="chart-container"><canvas id="catChart"></canvas></div>
    </div>
    <div class="report-card">
      <div class="report-head"><span class="report-head-title">🏆 Officer Activity (Lakhs)</span></div>
      <div class="chart-container"><canvas id="offChart"></canvas></div>
    </div>
    <div class="report-card">
      <div class="report-head"><span class="report-head-title">📅 Sanctioned Today — ${fmtDate(td)}</span><span class="report-head-amt">₹${fmtAmt(tAmt)} L</span></div>
      ${mkTable(todayL)}
    </div>
    <div class="report-card">
      <div class="report-head"><span class="report-head-title">📆 Sanctioned This Month</span><span class="report-head-amt">₹${fmtAmt(mAmt)} L</span></div>
      ${mkTable(monthL)}
    </div>
    <div class="report-card">
      <div class="report-head"><span class="report-head-title">⏳ Currently Pending</span><span class="report-head-amt">₹${fmtAmt(pAmt)} L</span></div>
      ${mkTable(pendingL)}
    </div>
    ${S.isAdmin?`<div style="text-align:center;margin-top:16px;">
      <button class="btn btn-cancel-full" onclick="handleSettings()" style="padding:12px 28px;font-size:14px;max-width:200px;">⚙️ Admin Settings</button>
    </div>`:''}`;

  currentCharts.forEach(ch => ch.destroy());
  currentCharts = [];

  const cats = ['Agriculture', 'SME', 'Education'];
  let catAmts = [0, 0, 0];
  let offAmts = {};
  S.officers.forEach(o => offAmts[o] = 0);
  
  monthL.forEach(l => {
     let amt = parseFloat(l.amount)||0;
     let cIdx = cats.indexOf(l.category);
     if(cIdx !== -1) catAmts[cIdx] += amt;
     if(offAmts[l.allocatedTo] !== undefined) offAmts[l.allocatedTo] += amt;
  });

  if(window.Chart && document.getElementById('catChart')) {
      const ctxCat = document.getElementById('catChart').getContext('2d');
      currentCharts.push(new Chart(ctxCat, {
        type: 'doughnut',
        data: {
          labels: cats,
          datasets: [{
            data: catAmts,
            backgroundColor: ['rgba(16,185,129,0.8)', 'rgba(107,95,191,0.8)', 'rgba(245,158,11,0.8)'],
            borderWidth: 0
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
      }));

      const ctxOff = document.getElementById('offChart').getContext('2d');
      currentCharts.push(new Chart(ctxOff, {
        type: 'bar',
        data: {
          labels: Object.keys(offAmts),
          datasets: [{
            label: 'Sanctioned (₹ Lakhs)',
            data: Object.values(offAmts),
            backgroundColor: 'rgba(107,95,191,0.8)',
            borderRadius: 6
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }
      }));
  }
}

/* ── INIT ── */
async function init(){
  await loadSettings();
  const darkPref=localStorage.getItem('lpDark');
  if(darkPref==='1'){
    S.dark=true;
    document.body.classList.add('dark');
  }
  const su=localStorage.getItem('lpUser');
  const sa=localStorage.getItem('lpAdmin')==='true';
  if(su){
    S.user=su; S.isAdmin=sa; S.myLoansOnly=!sa;
    document.getElementById('userAv').textContent=su==='Admin'?'🔒':initials(su);
  }
  subscribeLoans();
  subscribeNotifications();
  if(!S.user) showUserSelect();
}

if('serviceWorker' in navigator)
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));

init();
