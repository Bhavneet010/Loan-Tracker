import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getFirestore,collection,doc,setDoc,updateDoc,deleteDoc,
  onSnapshot,query,orderBy,getDoc,getDocs
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
  tab:'pending', settingsTab:'officers', search:'', dark:false,
  appMode:'fresh',
  filter:{ category:'All', officer:'All' },
  sort:{ field:'date', dir:'desc' },
  renewalTab:'done',
  renewalFilter:{ officer:'All', branch:'All' },
  renewalSort:{ field:'daysFromSanction', dir:'desc' },
  openPop:null,
  loans:[], notifications:[],
  officers:['Anchal','Nikita','Ritika'],
  branches:[
    '686 : NAHAN','1680 : ADB PAONTA SAHIB','1755 : PAONTA SAHIB',
    '2413 : MAJRA','3399 : RAJBAN','4589 : SME TARUWALA',
    '4590 : KALA AMB','6784 : DHAULA KUAN','7459 : KAFOTA',
    '8117 : RAJPUR','50536 : BHAGANI','50569 : TIMBI','63982 : SHILLAI'
  ],
  branchOfficers: {
    '2413': 'Ritika', '6784': 'Ritika', '1755': 'Ritika', '4590': 'Ritika',
    '3399': 'Anchal', '4589': 'Anchal', '7459': 'Anchal', '50569': 'Anchal', '63982': 'Anchal',
    '1680': 'Nikita', '686': 'Nikita', '8117': 'Nikita', '50536': 'Nikita'
  }
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

const OFFICER_PALETTE = [
  {bg:'linear-gradient(135deg,#7B6FD4,#5A4EAF)'},
  {bg:'linear-gradient(135deg,#10B981,#047857)'},
  {bg:'linear-gradient(135deg,#F59E0B,#B45309)'},
  {bg:'linear-gradient(135deg,#EC4899,#BE185D)'},
  {bg:'linear-gradient(135deg,#0EA5E9,#0369A1)'},
  {bg:'linear-gradient(135deg,#8B5CF6,#5B21B6)'}
];
const officerColor = n => {
  const s=String(n||''); let h=0;
  for(let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i)) >>> 0;
  return OFFICER_PALETTE[h % OFFICER_PALETTE.length];
};

function toast(msg) {
  document.querySelectorAll('.toast').forEach(e=>e.remove());
  const t=document.createElement('div'); t.className='toast'; t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(),2600);
}

const daysPending = d => !d ? 0 : Math.floor((Date.now()-new Date(d).getTime())/86400000);

function isFreshCC(loan) {
  // 1. Explicit flag check (Strongest)
  if (loan.isFreshCC === true) return true;
  if (loan.isFreshCC === false) return false;
  
  // 2. ID Prefix check (Firewall)
  if (loan.id && String(loan.id).startsWith('import_sme_csv_')) return false;
  
  // 3. Source check (Fallback)
  const isImported = loan.source && String(loan.source).includes('import');
  return !isImported;
}

function computeRenewalStatus(loan) {
  if (!loan.sanctionDate && !loan.limitExpiryDate) return null;
  const now = Date.now();
  let msDue, msStart;

  if (loan.renewalDueDate) {
    msDue = new Date(loan.renewalDueDate).getTime();
    msStart = msDue - 365*86400000;
  } else if (loan.limitExpiryDate) {
    msDue = new Date(loan.limitExpiryDate).getTime();
    msStart = msDue - 365*86400000;
  } else if (loan.sanctionDate) {
    msStart = new Date(loan.sanctionDate).getTime();
    msDue = msStart + 365*86400000;
  } else {
    return null;
  }

  if (isNaN(msDue) || isNaN(msStart)) return null;

  const daysSinceSanction = Math.floor((now - msStart) / 86400000);
  const msNpa = msDue + 181*86400000;
  
  const dueDateStr = new Date(msDue).toISOString().slice(0,10);
  const npaDateStr = new Date(msNpa).toISOString().slice(0,10);
  
  const daysToDue = Math.floor((msDue - now) / 86400000);
  
  let status, daysUntilDue=0, daysOverdue=0, daysUntilNpa=0;
  
  if (daysToDue > 30) {
    status = 'active';
    daysUntilDue = daysToDue;
    daysUntilNpa = daysToDue + 181;
  } else if (daysToDue >= 0) {
    status = 'due-soon';
    daysUntilDue = daysToDue;
    daysUntilNpa = daysToDue + 181;
  } else if (daysToDue > -181) {
    status = 'pending-renewal';
    daysOverdue = -daysToDue;
    daysUntilNpa = 181 + daysToDue;
  } else {
    status = 'npa';
    daysOverdue = -daysToDue;
  }
  return { status, daysSinceSanction, daysUntilDue, daysOverdue, daysUntilNpa, dueDateStr, npaDateStr };
}

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

window.setAppMode = function(v){
  S.appMode=v; S.openPop=null;
  localStorage.setItem('lpMode',v);
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b.id==='modeBtn-'+v));
  document.getElementById('mainTabs').style.display=v==='fresh'?'':'none';
  render();
};

/* ── FIREBASE SETTINGS ── */
async function loadSettings() {
  try {
    const snap=await getDoc(doc(db,'settings','config'));
    if(snap.exists()){
      const d=snap.data();
      if(d.officers?.length) S.officers=d.officers;
      if(d.branches?.length) S.branches=d.branches;
      if(d.branchOfficers) S.branchOfficers={...S.branchOfficers, ...d.branchOfficers};
      if(d.adminPin) PIN=d.adminPin;
    } else {
      await setDoc(doc(db,'settings','config'),{officers:S.officers,branches:S.branches,branchOfficers:S.branchOfficers,adminPin:PIN});
    }
  } catch(e){console.error(e);}
}
async function saveSettings() {
  try { await setDoc(doc(db,'settings','config'),{officers:S.officers,branches:S.branches,branchOfficers:S.branchOfficers,adminPin:PIN}); }
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

/* ── BULK RETURN IMPORT ── */
function slugifyId(s){
  return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40);
}
async function importReturnsFromUrl(url){
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok) throw new Error('Failed to load '+url);
  const payload=await res.json();
  const period=payload.period||'unknown';
  const defaultDate=payload.returnedDate||todayStr();
  const entries=Array.isArray(payload.entries)?payload.entries:[];
  let added=0, skipped=0;
  for(const e of entries){
    const returnedDate=e.returnedDate||defaultDate;
    const receiveDate=e.receiveDate||returnedDate;
    const id=`import_returns_${period}_${slugifyId(e.customerName)}`.replace(/-/g,'');
    const existing=await getDoc(doc(db,'loans',id));
    if(existing.exists()){ skipped++; continue; }
    await setDoc(doc(db,'loans',id),{
      allocatedTo:e.allocatedTo,
      category:e.category,
      branch:e.branch,
      customerName:(e.customerName||'').toUpperCase(),
      amount:parseFloat(e.amount)||0,
      receiveDate, returnedDate,
      remarks:e.remarks||'',
      status:'returned',
      createdAt:new Date().toISOString(),
      createdBy:S.user||'import',
      source:`import:returns:${period}`,
      ...ts()
    });
    added++;
  }
  return {added, skipped, total:entries.length, label:payload.label||period};
}
window.importMonthlyReturns = async function(){
  if(!S.isAdmin){ toast('Admin only'); return; }
  const url='data/returns-2026-04.json';
  if(!confirm('Import April 2026 returns into Firestore? Existing entries (matched by customer) will be skipped.')) return;
  const btn=document.getElementById('importReturnsBtn');
  if(btn){ btn.disabled=true; btn.textContent='Importing…'; }
  try {
    const r=await importReturnsFromUrl(url);
    toast(`${r.label}: ${r.added} added, ${r.skipped} skipped`);
  } catch(e){ console.error(e); toast('Import failed'); }
  finally { if(btn){ btn.disabled=false; btn.textContent='📥 Import April 2026 returns'; } }
};

/* ── CSV UPLOADER ── */
window.triggerCsvUpload = function(){
  if(!S.isAdmin){toast('Admin only');return;}
  const f = document.getElementById('csvFileInput');
  if(f) { f.value=''; f.click(); }
};

window.handleCsvUpload = function(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async function(ev){
    try {
      const text = ev.target.result;
      const rows = text.split('\n').filter(Boolean);
      if(rows.length < 2) { toast('Empty CSV'); return; }
      
      const header = rows[0].split(',').map(c=>c.toUpperCase().trim());
      let added=0, skipped=0;
      const btn = document.getElementById('importCsvBtn');
      if(btn) { btn.disabled=true; btn.textContent='Importing...'; }
      
      
      for(let i=1; i<rows.length; i++){
        let cols = [];
        let cur = '', inQuote = false;
        for(let j=0; j<rows[i].length; j++) {
          const c=rows[i][j];
          if(c==='"' && rows[i][j+1]==='"') { cur+='"'; j++; }
          else if(c==='"') inQuote=!inQuote;
          else if(c===',' && !inQuote) { cols.push(cur); cur=''; }
          else cur+=c;
        }
        cols.push(cur);
        cols = cols.map(c=>c.trim());
        
        let obj = { allocatedTo: '' };
        
        // Date parsing helper
        const parseDate = (dStr) => {
          if(!dStr) return '';
          let s = dStr.trim();
          if(s.match(/^\d{2}-\d{2}-\d{4}$/)) {
             const p = s.split('-'); return `${p[2]}-${p[1]}-${p[0]}`;
          } else if(s.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
             const p = s.split('/'); return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
          }
          return s; // Fallback
        };

        header.forEach((h, idx)=> {
           const val = cols[idx] || '';
           if(h === 'HOME BRANCH') obj.branch = val;
           else if(h === 'AC NUMBER') obj.acNumber = val;
           else if(h === 'CUSTOMER NAME') obj.customerName = val;
           else if(h === 'LIMIT') obj.amount = Number(((parseFloat(val.replace(/[^0-9.]/g,''))||0)/100000).toFixed(2));
           else if(h === 'LMT EXPY DT') obj.limitExpiryDate = parseDate(val);
           else if(h === 'RENEWAL DATE') obj.renewalDueDate = parseDate(val);
        });
        
        if(!obj.customerName) continue;
        
        // Assign officer based on branch dynamically from settings
        if(obj.branch && S.branchOfficers && S.branchOfficers[obj.branch]) {
            obj.allocatedTo = S.branchOfficers[obj.branch];
        }
        
        // Determine a base date for standard logic compatibility
        const baseDate = obj.limitExpiryDate || obj.renewalDueDate || '';
        
        const id=('import_sme_csv_'+slugifyId(obj.customerName)).replace(/-/g,'');
        const existing=await getDoc(doc(db,'loans',id));
        if(existing.exists()){skipped++;continue;}
        await setDoc(doc(db,'loans',id),{
          allocatedTo:obj.allocatedTo||'',
          category:'SME', branch:obj.branch||'',
          acNumber:obj.acNumber||'',
          customerName:obj.customerName.toUpperCase(),
          amount:obj.amount||0,
          limitExpiryDate:obj.limitExpiryDate||'',
          renewalDueDate:obj.renewalDueDate||'',
          receiveDate:baseDate,
          sanctionDate:baseDate,
          remarks:'',
          status:'sanctioned',
          isFreshCC: false, // FIREWALL: Explicitly marked as NOT a fresh loan
          isImported: true,
          createdAt:new Date().toISOString(),createdBy:S.user||'import',
          source:'import:sme_renewal:csv',...ts()
        });
        added++;
      }
      toast(`CSV Import: ${added} added, ${skipped} skipped`);
      if(btn) { btn.disabled=false; btn.textContent='📥 Upload CSV (CC Accounts)'; }
    } catch(err) {
      console.error(err); toast('Error parsing CSV');
      const btn = document.getElementById('importCsvBtn');
      if(btn) { btn.disabled=false; btn.textContent='📥 Upload CSV (CC Accounts)'; }
    }
  };
  reader.readAsText(file);
};

async function importPendingFromUrl(url){
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok) throw new Error('Failed to load '+url);
  const payload=await res.json();
  const period=payload.period||'unknown';
  const defaultCategory=payload.defaultCategory||'SME';
  const entries=Array.isArray(payload.entries)?payload.entries:[];
  let added=0, skipped=0;
  for(const e of entries){
    const id=`import_pending_${period}_${slugifyId(e.customerName)}`.replace(/-/g,'');
    const existing=await getDoc(doc(db,'loans',id));
    if(existing.exists()){ skipped++; continue; }
    await setDoc(doc(db,'loans',id),{
      allocatedTo:e.allocatedTo,
      category:e.category||defaultCategory,
      branch:e.branch,
      customerName:(e.customerName||'').toUpperCase(),
      amount:parseFloat(e.amount)||0,
      receiveDate:e.receiveDate,
      remarks:e.remarks||'',
      status:'pending',
      createdAt:new Date().toISOString(),
      createdBy:S.user||'import',
      source:`import:pending:${period}`,
      ...ts()
    });
    added++;
  }
  return {added, skipped, total:entries.length, label:payload.label||period};
}
window.importMonthlyPending = async function(){
  if(!S.isAdmin){ toast('Admin only'); return; }
  const url='data/pending-2026-04.json';
  if(!confirm('Import April 2026 pending SME loans into Firestore? Existing entries (matched by customer) will be skipped.')) return;
  const btn=document.getElementById('importPendingBtn');
  if(btn){ btn.disabled=true; btn.textContent='Importing…'; }
  try {
    const r=await importPendingFromUrl(url);
    toast(`${r.label}: ${r.added} added, ${r.skipped} skipped`);
  } catch(e){ console.error(e); toast('Import failed'); }
  finally { if(btn){ btn.disabled=false; btn.textContent='📥 Import April 2026 pending (SME)'; } }
};

/* ── SANCTIONED IMPORT ── */
async function importSanctionedFromUrl(url){
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok) throw new Error('Failed to load '+url);
  const payload=await res.json();
  const period=payload.period||'unknown';
  const entries=Array.isArray(payload.entries)?payload.entries:[];
  let added=0, skipped=0;
  for(const e of entries){
    const id=`import_sanctioned_${period}_${slugifyId(e.customerName)}`.replace(/-/g,'');
    const existing=await getDoc(doc(db,'loans',id));
    if(existing.exists()){ skipped++; continue; }
    await setDoc(doc(db,'loans',id),{
      allocatedTo:e.allocatedTo,
      category:e.category||'Agriculture',
      branch:e.branch,
      customerName:(e.customerName||'').toUpperCase(),
      amount:parseFloat(e.amount)||0,
      receiveDate:e.receiveDate||'',
      sanctionDate:e.sanctionDate||'',
      remarks:e.remarks||'',
      status:'sanctioned',
      isFreshCC:true,
      manuallyCreated:false,
      createdAt:new Date().toISOString(),
      createdBy:S.user||'import',
      source:`import:sanctioned:${period}`,
      ...ts()
    });
    added++;
  }
  return {added, skipped, total:entries.length, label:payload.label||period};
}
window.importMonthlySanctioned = async function(){
  if(!S.isAdmin){ toast('Admin only'); return; }
  const url='data/sanctioned-2026-04.json';
  if(!confirm('Import April 2026 sanctioned loans into Firestore? Existing entries (matched by customer) will be skipped.')) return;
  const btn=document.getElementById('importSanctionedBtn');
  if(btn){ btn.disabled=true; btn.textContent='Importing…'; }
  try {
    const r=await importSanctionedFromUrl(url);
    toast(`${r.label}: ${r.added} added, ${r.skipped} skipped`);
  } catch(e){ console.error(e); toast('Import failed'); }
  finally { if(btn){ btn.disabled=false; btn.textContent='📥 Import April 2026 sanctioned'; } }
};

/* ── SME CC RENEWAL IMPORT ── */
async function importSmeRenewalsFromUrl(url){
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok) throw new Error('Failed to load '+url);
  const payload=await res.json();
  const period=payload.period||'unknown';
  const entries=Array.isArray(payload.entries)?payload.entries:[];
  let added=0,skipped=0,errors=0;
  for(const e of entries){
    if(!e.sanctionDate){errors++;continue;}
    const id=('import_sme_renewal_'+period+'_'+slugifyId(e.customerName)).replace(/-/g,'');
    const existing=await getDoc(doc(db,'loans',id));
    if(existing.exists()){skipped++;continue;}
    await setDoc(doc(db,'loans',id),{
      allocatedTo:e.allocatedTo,category:'SME',branch:e.branch,
      customerName:(e.customerName||'').toUpperCase(),
      amount:parseFloat(e.amount)||0,
      receiveDate:e.receiveDate||e.sanctionDate,
      sanctionDate:e.sanctionDate,
      remarks:e.remarks||'',status:'sanctioned',
      createdAt:new Date().toISOString(),createdBy:S.user||'import',
      source:'import:sme_renewal:'+period,...ts()
    });
    added++;
  }
  return{added,skipped,errors,total:entries.length,label:payload.label||period};
}
window.importSmeRenewals = async function(){
  if(!S.isAdmin){toast('Admin only');return;}
  const url=prompt('Enter JSON file path (e.g. data/renewals-sme-2025.json):');
  if(!url) return;
  if(!confirm('Import SME CC historical sanctions from:\n'+url+'\n\nExisting entries will be skipped.')) return;
  const btn=document.getElementById('importSmeRenewalsBtn');
  if(btn){btn.disabled=true;btn.textContent='Importing…';}
  try{
    const r=await importSmeRenewalsFromUrl(url);
    toast(`${r.label}: ${r.added} added, ${r.skipped} skipped${r.errors?', '+r.errors+' missing sanction date':''}`);
  }catch(e){console.error(e);toast('Import failed: '+e.message);}
  finally{if(btn){btn.disabled=false;btn.textContent='📥 Import SME CC Renewals';}}
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
  const urgent = S.loans.filter(l=>{
    if(l.category!=='SME'||!l.sanctionDate||l.isTermLoan) return false;
    const rs=computeRenewalStatus(l);
    return rs && rs.status!=='active';
  }).length;
  const rnwEl=document.getElementById('b-renewals');
  if(rnwEl) rnwEl.textContent=urgent||'';
  // renewal tab badges
  const thisMonth=todayStr().slice(0,7);
  const sme=S.loans.filter(l=>l.category==='SME'&&l.sanctionDate&&!l.isTermLoan).map(l=>({...l,_rs:computeRenewalStatus(l)})).filter(l=>l._rs);
  const setB=(id,n)=>{const el=document.getElementById(id);if(el)el.textContent=n||'';};
  setB('b-rnw-done',    sme.filter(l=>(l.sanctionDate||'').startsWith(thisMonth)&&!isFreshCC(l)).length);
  setB('b-rnw-due-soon',sme.filter(l=>l._rs.status==='due-soon').length);
  setB('b-rnw-overdue', sme.filter(l=>l._rs.status==='pending-renewal'||l._rs.status==='npa').length);
  setB('b-rnw-all-cc',sme.length);
}

/* ── USER ── */
window.showUserSelect = function(){
  document.getElementById('userList').innerHTML = S.officers.map(o=>{
    const n=S.loans.filter(l=>l.status==='pending'&&l.allocatedTo===o).length;
    const badge=n?`<span class="officer-count">${n}</span>`:'';
    return `<button class="user-btn" onclick="selectUser('${esc(o)}')">
      <div class="av" style="background:${officerColor(o).bg};">${initials(o)}</div><span>${esc(o)}</span>${badge}
    </button>`;
  }).join('');
  document.getElementById('userModal').style.display='flex';
};
window.selectUser = function(name){
  S.user=name; S.isAdmin=false;
  S.filter={ category:'All', officer:'Mine' };
  localStorage.setItem('lpUser',name); localStorage.setItem('lpAdmin','false');
  const av=document.getElementById('userAv');
  av.textContent=initials(name);
  av.style.background=officerColor(name).bg;
  av.style.color='#fff';
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
    S.user='Admin'; S.isAdmin=true;
    S.filter={ category:'All', officer:'All' };
    localStorage.setItem('lpUser','Admin'); localStorage.setItem('lpAdmin','true');
    const av=document.getElementById('userAv');
    av.textContent='🔒';
    av.style.background='';
    av.style.color='';
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
        ${S.branches.map((b,i)=>{
          const code = b.split(':')[0].trim();
          const assigned = S.branchOfficers[code] || '';
          const options = `<option value="" style="color:#000;">Unassigned</option>` + S.officers.map(o=>`<option value="${esc(o)}" style="color:#000;" ${assigned===o?'selected':''}>${esc(o)}</option>`).join('');
          return `<div class="setting-item" style="display:flex;align-items:center;gap:8px;padding:8px 12px;">
            <span style="font-size:13px;flex:1;min-width:120px;">${esc(b)}</span>
            <select class="input-light" style="flex:1;padding:6px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid rgba(255,255,255,0.1);background:transparent;color:inherit;" onchange="setBranchOfficer('${code}', this.value)">
              ${options}
            </select>
            <button class="btn-sm-danger" onclick="removeBranch(${i})">X</button>
          </div>`;
        }).join('')}
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
        Bulk-import loan data from the <code>data/</code> folder. Existing entries (matched by customer) are skipped, so each import is safe to re-run.
      </div>
      <button type="button" id="clearRenewalsBtn" class="btn btn-primary-full" style="width:100%;padding:13px;font-size:15px;border-radius:13px;margin-bottom:10px;background:linear-gradient(135deg,#EF4444,#B91C1C);" onclick="clearAllSmeRenewals()">🗑️ Clear All SME Renewals Data</button>
      <button type="button" id="wipeFreshBtn" class="btn btn-primary-full" style="width:100%;padding:13px;font-size:15px;border-radius:13px;margin-bottom:10px;background:linear-gradient(135deg,#DC2626,#991B1B);" onclick="wipeSanctionedFreshLoans()">🗑️ Wipe All Sanctioned Fresh Loans</button>
      <button type="button" id="importSanctionedBtn" class="btn btn-primary-full" style="width:100%;padding:13px;font-size:15px;border-radius:13px;margin-bottom:10px;background:linear-gradient(135deg,#10B981,#047857);" onclick="importMonthlySanctioned()">📥 Import April 2026 sanctioned</button>
      <input type="file" id="csvFileInput" accept=".csv" style="display:none;" onchange="handleCsvUpload(event)">
      <button type="button" id="importCsvBtn" class="btn btn-primary-full" style="width:100%;padding:13px;font-size:15px;border-radius:13px;background:linear-gradient(135deg,#3B82F6,#2563EB);" onclick="triggerCsvUpload()">📥 Upload CSV (CC Accounts)</button>`;
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
window.clearAllSmeRenewals = async function(){
  if(!S.isAdmin){toast('Admin only');return;}
  if(!confirm('Are you absolutely sure you want to delete ALL SME CC Renewal data? This cannot be undone!')) return;
  
  try{
    const btn = document.getElementById('clearRenewalsBtn');
    if(btn) { btn.disabled=true; btn.textContent='Wiping Data...'; }
    
    // Find all loans where category is SME
    const snap = await getDocs(query(collection(db,'loans')));
    let deletedCount = 0;
    
    for(const docSnap of snap.docs){
      const data = docSnap.data();
      if(data.category === 'SME' && !isFreshCC(data)) {
        await deleteDoc(doc(db,'loans',docSnap.id));
        deletedCount++;
      }
    }
    
    toast(`Successfully wiped ${deletedCount} SME CC records!`);
  } catch(e) {
    console.error(e);
    toast('Error clearing data');
  } finally {
    const btn = document.getElementById('clearRenewalsBtn');
    if(btn) { btn.disabled=false; btn.textContent='🗑️ Clear All SME Renewals Data'; }
  }
};

window.wipeSanctionedFreshLoans = async function(){
  if(!S.isAdmin){toast('Admin only');return;}
  if(!confirm('This will PERMANENTLY delete ALL manual (Fresh) Sanctioned loans. You will have to re-enter them. Are you sure?')) return;
  
  try{
    const btn = document.getElementById('wipeFreshBtn');
    if(btn) { btn.disabled=true; btn.textContent='Wiping Fresh Data...'; }
    
    const snap = await getDocs(query(collection(db,'loans')));
    let deletedCount = 0;
    
    for(const docSnap of snap.docs){
      const data = docSnap.data();
      const id = docSnap.id;
      // We target anything that is:
      // 1. A manual/fresh loan (not imported)
      // 2. Currently in 'sanctioned' status
      if(isFreshCC({...data, id}) && data.status === 'sanctioned') {
        await deleteDoc(doc(db,'loans',id));
        deletedCount++;
      }
    }
    
    toast(`Successfully wiped ${deletedCount} fresh sanctioned records!`);
    render(); // Refresh the UI
  } catch(e) {
    console.error(e);
    toast('Error wiping data');
  } finally {
    const btn = document.getElementById('wipeFreshBtn');
    if(btn) { btn.disabled=false; btn.textContent='🗑️ Wipe All Sanctioned Fresh Loans'; }
  }
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
    const tg=document.getElementById('fTermLoanGroup');
    const tc=document.getElementById('fTermLoan');
    if(tg && tc) {
      tg.style.display=loan.category==='SME'?'flex':'none';
      tc.checked=!!loan.isTermLoan;
    }
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
    const tg=document.getElementById('fTermLoanGroup');
    const tc=document.getElementById('fTermLoan');
    if(tg && tc) { tg.style.display='none'; tc.checked=false; }
    if(S.user&&!S.isAdmin) document.getElementById('fOfficer').value=S.user;
  }
  document.getElementById('formModal').style.display='flex';
};
window.closeForm  = ()=>document.getElementById('formModal').style.display='none';
window.toggleTermLoan = function(cat){
  const el=document.getElementById('fTermLoanGroup');
  if(el) el.style.display=cat==='SME'?'flex':'none';
};
window.saveLoan   = async function(e){
  e.preventDefault();
  const id=document.getElementById('loanId').value;
  const cat=document.getElementById('fCategory').value;
  let termLoan=false;
  if(cat==='SME'){
    const tc=document.getElementById('fTermLoan');
    termLoan=tc?tc.checked:false;
  }
  
  const data={
    allocatedTo:document.getElementById('fOfficer').value,
    category:cat,
    branch:document.getElementById('fBranch').value,
    customerName:document.getElementById('fName').value.trim().toUpperCase(),
    amount:parseFloat(document.getElementById('fAmount').value),
    receiveDate:document.getElementById('fReceive').value,
    remarks:document.getElementById('fRemarks').value.trim()
  };
  
  if(cat==='SME'){
    data.isTermLoan = termLoan;
    const existing = id ? S.loans.find(x=>x.id===id) : null;
    const isImported = (existing && existing.isImported) || (id && id.startsWith('import_sme_csv_'));
    if(!termLoan && !isImported){
      data.isFreshCC = true;
      data.manuallyCreated = true;
    } else {
      data.isFreshCC = false;
      data.isImported = true;
    }
  }
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
  S.tab=btn.dataset.tab; S.search='';
  const si=document.getElementById('searchInput'); if(si) si.value='';
  if(S.tab==='notifs') markNotifsRead();
  render();
});

/* ── FILTER + SORT ── */
const SORT_LABELS={ date:'Date', amount:'Amount', officer:'Officer', category:'Category' };
function activeFilterCount(){
  let n=0;
  if(S.filter.category!=='All') n++;
  if(S.filter.officer!=='All') n++;
  return n;
}
function applyFilters(loans){
  let out=loans;
  if(S.filter.category!=='All') out=out.filter(l=>l.category===S.filter.category);
  if(S.filter.officer==='Mine' && S.user) out=out.filter(l=>l.allocatedTo===S.user);
  else if(S.filter.officer!=='All' && S.filter.officer!=='Mine') out=out.filter(l=>l.allocatedTo===S.filter.officer);
  return out;
}
function dateFieldFor(tab){
  return tab==='sanctioned'?'sanctionDate':tab==='returned'?'returnedDate':'receiveDate';
}
function applySort(loans){
  const dir = S.sort.dir==='asc'?1:-1;
  const field = S.sort.field;
  const dateKey = dateFieldFor(S.tab);
  const cmp=(a,b)=>{
    let av, bv;
    if(field==='date'){ av=a[dateKey]||''; bv=b[dateKey]||''; }
    else if(field==='amount'){ av=parseFloat(a.amount)||0; bv=parseFloat(b.amount)||0; }
    else if(field==='officer'){ av=(a.allocatedTo||'').toLowerCase(); bv=(b.allocatedTo||'').toLowerCase(); }
    else if(field==='category'){ av=a.category||''; bv=b.category||''; }
    if(av<bv) return -1*dir; if(av>bv) return 1*dir; return 0;
  };
  return [...loans].sort(cmp);
}
function filterSortBarHtml(){
  const fc=activeFilterCount();
  const sortLabel=`${SORT_LABELS[S.sort.field]||'Date'} ${S.sort.dir==='asc'?'↑':'↓'}`;
  const officerOpts=[
    {v:'All',label:'All officers'},
    ...(S.user && !S.isAdmin ? [{v:'Mine',label:'Just me'}] : []),
    ...S.officers.map(o=>({v:o,label:o}))
  ];
  const catOpts=[
    {v:'All',label:'All categories'},
    {v:'Agriculture',label:'Agriculture'},
    {v:'SME',label:'SME'},
    {v:'Education',label:'Education'}
  ];
  const sortFields=[
    {v:'date',label:`${S.tab==='sanctioned'?'Sanction':S.tab==='returned'?'Return':'Receive'} date`},
    {v:'amount',label:'Amount'},
    {v:'officer',label:'Officer'},
    {v:'category',label:'Category'}
  ];
  const radio=(name,opts,current)=>opts.map(o=>
    `<label><input type="radio" name="${name}" value="${esc(o.v)}" ${current===o.v?'checked':''} onchange="${name==='sortField'?`setSort('${o.v}',null)`:name==='sortDir'?`setSort(null,'${o.v}')`:`setFilter('${name}','${esc(o.v)}')`}">${esc(o.label)}</label>`
  ).join('');
  const filterStyle=S.openPop==='filter'?'':'display:none;';
  const sortStyle  =S.openPop==='sort'?'':'display:none;';
  return `<div class="fs-bar" onclick="event.stopPropagation();">
    <button class="fs-btn${fc?' active':''}${S.openPop==='filter'?' open':''}" onclick="event.stopPropagation();toggleFsMenu('filter')">⚲ Filter<span class="fs-badge">${fc||''}</span></button>
    <button class="fs-btn${S.openPop==='sort'?' open':''}" onclick="event.stopPropagation();toggleFsMenu('sort')">↕ Sort <span class="fs-label">${sortLabel}</span></button>
    <div class="fs-pop" id="fsFilterPop" style="${filterStyle}">
      <h4>Category</h4>${radio('category',catOpts,S.filter.category)}
      <hr>
      <h4>Officer</h4>${radio('officer',officerOpts,S.filter.officer)}
    </div>
    <div class="fs-pop fs-pop-right" id="fsSortPop" style="${sortStyle}">
      <h4>Sort by</h4>${radio('sortField',sortFields,S.sort.field)}
      <hr>
      <h4>Direction</h4>${radio('sortDir',[{v:'desc',label:'Descending'},{v:'asc',label:'Ascending'}],S.sort.dir)}
    </div>
  </div>`;
}
window.toggleFsMenu = function(which){
  S.openPop = S.openPop===which ? null : which;
  render();
};
window.setFilter = function(key,val){ S.filter[key]=val; render(); };
window.setSort = function(field,dir){
  if(field) S.sort.field=field;
  if(dir) S.sort.dir=dir;
  render();
};
document.addEventListener('click', e => {
  if(!S.openPop) return;
  if(e.target.closest && e.target.closest('.fs-bar')) return;
  S.openPop=null; render();
}, true);

/* ── RENDER HELPERS ── */
function updateHero(){
  const sc=document.getElementById('statsScroll');
  if(S.appMode==='renewals'){
    const thisMonth=todayStr().slice(0,7);
    const monthName='Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[parseInt(thisMonth.slice(5))-1];
    const sme=S.loans.filter(l=>l.category==='SME'&&l.sanctionDate&&!l.isTermLoan).map(l=>({...l,_rs:computeRenewalStatus(l)})).filter(l=>l._rs);
    const done    =sme.filter(l=>(l.sanctionDate||'').startsWith(thisMonth)&&!isFreshCC(l));
    const dueSoon =sme.filter(l=>l._rs.status==='due-soon');
    const overdue =sme.filter(l=>l._rs.status==='pending-renewal'||l._rs.status==='npa');
    const allAccounts = sme;
    const amt=arr=>arr.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
    const rnwStat=(tab,label,arr,gradCls,badge,badgeCls)=>{
      const active=S.renewalTab===tab;
      return `<div class="stat rnw-stat-card ${gradCls}${active?' stat-rnw-active':''}" onclick="setRenewalTab('${tab}')" style="cursor:pointer;">
        <div class="stat-l">${label}</div>
        <div class="stat-v">₹${fmtAmt(amt(arr))}L</div>
        <div class="stat-s">${arr.length} accounts</div>
        ${badge?`<div class="stat-badge ${badgeCls||''}">${badge}</div>`:''}
      </div>`;
    };
    sc.classList.add('rnw-grid');
    sc.innerHTML=
      rnwStat('done',    `Renewals Done ${monthName}`, done,    'rnw-grad-green',  '',                   '')+
      rnwStat('due-soon','Due Soon',                   dueSoon, 'rnw-grad-amber',  dueSoon.length?`${dueSoon.length} pending`:'','stat-badge-warn')+
      rnwStat('overdue', 'Overdue',                    overdue, 'rnw-grad-red',    overdue.length?'Action needed':'',             'stat-badge-danger')+
      rnwStat('all','All CC Accounts',               allAccounts, 'rnw-grad-darkred','','');
    return;
  }
  sc.classList.remove('rnw-grid');
  const pending   = S.loans.filter(l=>l.status==='pending' && isFreshCC(l));
  const sanctioned= S.loans.filter(l=>l.status==='sanctioned' && isFreshCC(l));
  const returned  = S.loans.filter(l=>l.status==='returned' && isFreshCC(l));
  const pAmt = pending.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const sAmt = sanctioned.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const rAmt = returned.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  sc.innerHTML=`
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

function compactLoanItem(loan, actions, itemCls='', cardVariant=''){
  const overdueTag=itemCls.includes('overdue')?`<span class="tag overdue">⚠ ${daysPending(loan.receiveDate)}d</span>`:'';
  const cls=[`cat-${catCls(loan.category)||'none'}`, `status-${loan.status||'pending'}`, itemCls].filter(Boolean).join(' ');
  return `<div class="loan-item ${cls}" id="li-${loan.id}">
    <div class="loan-row" onclick="toggleExpand('${loan.id}')">
      <div class="lr-info">
        <span class="lr-av" style="background:${officerColor(loan.allocatedTo).bg};">${initials(loan.allocatedTo)}</span>
        <span class="lr-bcode">${esc(branchCode(loan.branch))}</span>
        <span class="lr-name">${esc(loan.customerName||'')}</span>
      </div>
      <div class="lr-meta">
        ${overdueTag}
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
  if(S.appMode==='renewals'){ renderRenewals(c); return; }
  if(S.tab==='pending')         renderPending(c);
  else if(S.tab==='sanctioned') renderSanctioned(c);
  else if(S.tab==='returned')   renderReturned(c);
  else if(S.tab==='notifs')     renderNotifications(c);
}

function searchMatch(l){
  if(!S.search) return true;
  return (l.customerName||'').toLowerCase().includes(S.search)
      || (l.branch||'').toLowerCase().includes(S.search)
      || (l.allocatedTo||'').toLowerCase().includes(S.search);
}

function renderPending(c){
  let loans=applyFilters(S.loans.filter(l=>l.status==='pending'&&isFreshCC(l)&&searchMatch(l)));
  loans=applySort(loans);
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
        return compactLoanItem(l,actions,cls);
      }).join('');
  c.innerHTML=`
    ${filterSortBarHtml()}
    <div class="sec-head">
      <div class="sec-title">Pending Loans</div>
      <div class="sec-count">${loans.length} · ₹${fmtAmt(total)} L</div>
    </div>${cards}`;
}

function renderSanctioned(c){
  let loans=applyFilters(S.loans.filter(l=>l.status==='sanctioned'&&isFreshCC(l)&&searchMatch(l)));
  loans=applySort(loans);
  const total=loans.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const cards=loans.length===0
    ? emptyState('🎉','No sanctioned loans yet','Sanction pending loans to see them here')
    : loans.map(l=>{
        const actions=`<button class="btn btn-return" onclick="moveToPending('${l.id}')">↩ Pending</button>
          <button class="btn btn-more" onclick="editLoan('${l.id}')">✎</button>
          ${S.isAdmin?`<button class="btn btn-danger" onclick="deleteLoan('${l.id}')">🗑</button>`:''}`;
        return compactLoanItem(l,actions,'','sanctioned');
      }).join('');
  c.innerHTML=`
    ${filterSortBarHtml()}
    <div class="sec-head">
      <div class="sec-title">Sanctioned Loans</div>
      <div class="sec-count">${loans.length} · ₹${fmtAmt(total)} L</div>
    </div>${cards}`;
}

function renderReturned(c){
  let loans=applyFilters(S.loans.filter(l=>l.status==='returned'&&isFreshCC(l)&&searchMatch(l)));
  loans=applySort(loans);
  const total=loans.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const cards=loans.length===0
    ? emptyState('📋','No returned loans','Returned loans will appear here')
    : loans.map(l=>{
        const actions=`<button class="btn btn-sanction" onclick="sanctionLoan('${l.id}')">✓ Sanction</button>
          <button class="btn btn-return" onclick="moveToPending('${l.id}')">↩ Pending</button>
          <button class="btn btn-more" onclick="editLoan('${l.id}')">✎</button>
          ${S.isAdmin?`<button class="btn btn-danger" onclick="deleteLoan('${l.id}')">🗑</button>`:''}`;
        return compactLoanItem(l,actions,'','returned');
      }).join('');
  c.innerHTML=`
    ${filterSortBarHtml()}
    <div class="sec-head">
      <div class="sec-title">Returned Loans</div>
      <div class="sec-count">${loans.length} · ₹${fmtAmt(total)} L</div>
    </div>${cards}`;
}

/* ── RENEWALS DASHBOARD ── */
function renewalBadge(rs){
  if(!rs) return {label:'',cls:''};
  return {
    'active':          {label:'Active',                      cls:'rnw-chip-active'},
    'due-soon':        {label:`Due in ${rs.daysUntilDue}d`,  cls:'rnw-chip-due-soon'},
    'pending-renewal': {label:`${rs.daysOverdue}d overdue`,  cls:'rnw-chip-pending'},
    'npa':             {label:'NPA',                         cls:'rnw-chip-npa'},
  }[rs.status]||{label:'',cls:''};
}

function renewalKpiHtml(counts,amounts){
  const kpis=[
    {key:'active',          label:'Active',   cls:'rnw-active'},
    {key:'due-soon',        label:'Due Soon', cls:'rnw-due-soon'},
    {key:'pending-renewal', label:'Overdue',  cls:'rnw-pending'},
    {key:'npa',             label:'NPA Risk', cls:'rnw-npa'},
  ];
  return `<div class="perf-kpi-row">
    ${kpis.map(k=>`
      <div class="perf-kpi ${k.cls}" onclick="setRenewalFilter('status','${k.key}')"
           style="cursor:pointer;${S.renewalFilter.status===k.key?'box-shadow:0 0 0 2px var(--p2);':''}">
        <div class="perf-kpi-label">${k.label}</div>
        <div class="perf-kpi-value">${counts[k.key]}</div>
        <div class="perf-kpi-sub">₹${fmtAmt(amounts[k.key])}L</div>
      </div>`).join('')}
  </div>`;
}

function renewalFilterSortHtml(){
  const fc=(S.renewalFilter.officer!=='All'?1:0)+(S.renewalFilter.branch!=='All'?1:0);
  const sl={daysFromSanction:'Days',amount:'Amount',officer:'Officer',branch:'Branch'};
  const sortLabel=`${sl[S.renewalSort.field]||'Days'} ${S.renewalSort.dir==='asc'?'↑':'↓'}`;
  const officerOpts=[
    {v:'All',label:'All officers'},
    ...(S.user&&!S.isAdmin?[{v:'Mine',label:'Just me'}]:[]),
    ...S.officers.map(o=>({v:o,label:o}))
  ];
  const branchOpts=[{v:'All',label:'All branches'},...S.branches.map(b=>({v:b,label:b}))];
  const sortFields=[
    {v:'daysFromSanction',label:'Days from sanction'},{v:'amount',label:'Amount'},
    {v:'officer',label:'Officer'},{v:'branch',label:'Branch'},
  ];
  const radio=(name,opts,cur)=>opts.map(o=>`<label><input type="radio" name="rnw_${name}" value="${esc(o.v)}" ${cur===o.v?'checked':''} onchange="${name==='sortField'?`setRenewalSort('${esc(o.v)}',null)`:name==='sortDir'?`setRenewalSort(null,'${esc(o.v)}')`:`setRenewalFilter('${name}','${esc(o.v)}')`}">${esc(o.label)}</label>`).join('');
  const fs=S.openPop==='rnwFilter'?'':'display:none;';
  const ss=S.openPop==='rnwSort'?'':'display:none;';
  return `<div class="fs-bar" onclick="event.stopPropagation();">
    <button class="fs-btn${fc?' active':''}${S.openPop==='rnwFilter'?' open':''}" onclick="event.stopPropagation();toggleFsMenu('rnwFilter')">⚲ Filter<span class="fs-badge">${fc||''}</span></button>
    <button class="fs-btn${S.openPop==='rnwSort'?' open':''}" onclick="event.stopPropagation();toggleFsMenu('rnwSort')">↕ Sort <span class="fs-label">${sortLabel}</span></button>
    <div class="fs-pop" style="${fs}">
      <h4>Officer</h4>${radio('officer',officerOpts,S.renewalFilter.officer)}
      <hr><h4>Branch</h4>${radio('branch',branchOpts,S.renewalFilter.branch)}
    </div>
    <div class="fs-pop fs-pop-right" style="${ss}">
      <h4>Sort by</h4>${radio('sortField',sortFields,S.renewalSort.field)}
      <hr><h4>Direction</h4>${radio('sortDir',[{v:'desc',label:'Descending'},{v:'asc',label:'Ascending'}],S.renewalSort.dir)}
    </div>
  </div>`;
}

function applyRenewalFilters(enriched){
  let out=enriched;
  if(S.renewalFilter.officer==='Mine'&&S.user) out=out.filter(l=>l.allocatedTo===S.user);
  else if(S.renewalFilter.officer!=='All'&&S.renewalFilter.officer!=='Mine') out=out.filter(l=>l.allocatedTo===S.renewalFilter.officer);
  if(S.renewalFilter.branch!=='All') out=out.filter(l=>l.branch===S.renewalFilter.branch);
  return out;
}

function applyRenewalSort(enriched){
  const dir=S.renewalSort.dir==='asc'?1:-1;
  return [...enriched].sort((a,b)=>{
    let av,bv;
    if(S.renewalSort.field==='daysFromSanction'){av=a._rs.daysSinceSanction;bv=b._rs.daysSinceSanction;}
    else if(S.renewalSort.field==='amount'){av=parseFloat(a.amount)||0;bv=parseFloat(b.amount)||0;}
    else if(S.renewalSort.field==='officer'){av=(a.allocatedTo||'').toLowerCase();bv=(b.allocatedTo||'').toLowerCase();}
    else if(S.renewalSort.field==='branch'){av=(a.branch||'').toLowerCase();bv=(b.branch||'').toLowerCase();}
    if(av<bv)return -1*dir;if(av>bv)return 1*dir;return 0;
  });
}

function renewalItemHtml(loan,rs){
  const sm=renewalBadge(rs);
  const statusCls={active:'rnw-s-active','due-soon':'rnw-s-due-soon','pending-renewal':'rnw-s-pending',npa:'rnw-s-npa'}[rs.status]||'';
  const npaChip=rs.daysUntilNpa>0
    ?`<span class="tag rnw-chip-npa-cd">${rs.daysUntilNpa}d to NPA</span>`
    :(rs.status==='npa'?`<span class="tag rnw-chip-npa">NPA</span>`:'');
  const itemId='rnw-'+loan.id;
  return `<div class="loan-item ${statusCls}" id="li-${itemId}">
    <div class="loan-row" onclick="toggleExpand('${itemId}')">
      <div class="lr-info">
        <span class="lr-av" style="background:${officerColor(loan.allocatedTo).bg};">${initials(loan.allocatedTo)}</span>
        <span class="lr-bcode">${esc(branchCode(loan.branch))}</span>
        <span class="lr-name">${esc(loan.customerName||'')} ${loan.acNumber?`<span style="opacity:0.6;font-size:11px;margin-left:4px;">A/C: ${esc(loan.acNumber)}</span>`:''}</span>
      </div>
      <div class="lr-meta">
        <span class="tag ${sm.cls}">${sm.label}</span>
        <span class="lr-amount">₹${fmtAmt(loan.amount)}L</span>
        <span class="lr-chev">›</span>
      </div>
    </div>
    <div class="loan-detail">
      <div class="loan-collapse" onclick="toggleExpand('${itemId}')">▲ collapse</div>
      <div class="loan-card">
        <div class="lc-top">
          <div class="lc-left">
            <div class="lc-name">${esc(loan.customerName)}</div>
            <div class="lc-branch">${esc(loan.branch||'')} ${loan.acNumber?` • A/C: ${esc(loan.acNumber)}`:''}</div>
          </div>
          <div class="lc-amount">₹${fmtAmt(loan.amount)}<span class="u"> L</span></div>
        </div>
        <div class="lc-tags">
          <span class="tag sme">SME CC</span>
          <span class="tag officer">${esc(loan.allocatedTo)}</span>
          <span class="tag date">Renewal Due ${fmtDate(loan.renewalDueDate || rs.dueDateStr)}</span>
          ${loan.limitExpiryDate ? `<span class="tag date">Limit Expires ${fmtDate(loan.limitExpiryDate)}</span>` : ''}
          <span class="tag ${sm.cls}">${sm.label}</span>
          ${npaChip}
        </div>
        ${loan.remarks?`<div class="lc-remarks">📝 ${esc(loan.remarks)}</div>`:''}
        <div class="lc-actions">
          <button class="btn btn-more" onclick="editLoan('${loan.id}')">✎ Edit</button>
          ${S.isAdmin?`<button class="btn btn-danger" onclick="deleteLoan('${loan.id}')">🗑</button>`:''}
        </div>
      </div>
    </div>
  </div>`;
}

function renderRenewals(c){
  const enriched=S.loans
    .filter(l=>l.category==='SME'&&l.sanctionDate&&!l.isTermLoan)
    .map(l=>({...l,_rs:computeRenewalStatus(l)}))
    .filter(l=>l._rs);
  const tabFiltered=applyRenewalTabFilter(enriched);
  let sorted=applyRenewalSort(applyRenewalFilters(tabFiltered)).filter(searchMatch);
  const total=sorted.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const tabMeta={
    'done':     {title:'Done This Month',    empty:'♻','msg':'No SME renewals completed this month'},
    'due-soon': {title:'Due for Renewal Soon',empty:'⏰',msg:'No accounts due within 30 days'},
    'overdue':  {title:'Renewal Overdue',    empty:'⚠', msg:'No overdue renewal accounts'},
    'all':      {title:'All CC Accounts',    empty:'📋',msg:'No CC accounts found'},
  }[S.renewalTab]||{title:'SME CC Renewals',empty:'♻',msg:'No renewals found'};
  const list=sorted.length===0
    ?emptyState(tabMeta.empty,tabMeta.title,tabMeta.msg)
    :sorted.map(l=>renewalItemHtml(l,l._rs)).join('');
  c.innerHTML=`
    ${renewalFilterSortHtml()}
    <div class="sec-head">
      <div class="sec-title">${tabMeta.title}</div>
      <div class="sec-count">${sorted.length} · ₹${fmtAmt(total)} L</div>
    </div>
    ${list}`;
}

window.setRenewalFilter = function(key,val){
  S.renewalFilter[key]=S.renewalFilter[key]===val?'All':val;
  render();
};
window.setRenewalSort = function(field,dir){
  if(field) S.renewalSort.field=field;
  if(dir)   S.renewalSort.dir=dir;
  render();
};
window.setRenewalTab = function(tab){
  S.renewalTab=tab; S.openPop=null;
  document.querySelectorAll('#renewalTabs .tab').forEach(b=>b.classList.toggle('active',b.dataset.rtab===tab));
  render();
};
function applyRenewalTabFilter(enriched){
  const thisMonth=todayStr().slice(0,7);
  if(S.renewalTab==='done')      return enriched.filter(l=>(l.sanctionDate||'').startsWith(thisMonth)&&!isFreshCC(l));
  if(S.renewalTab==='due-soon')  return enriched.filter(l=>l._rs.status==='due-soon');
  if(S.renewalTab==='overdue')   return enriched.filter(l=>l._rs.status==='pending-renewal'||l._rs.status==='npa');
  if(S.renewalTab==='all')       return enriched;
  return enriched;
}

let currentCharts = [];
let perfSeg = 'month';
let perfChart = 'cats';
let perfLbPeriod = 'month';

function renderDaily(c){
  const td=todayStr(), thisMonth=td.slice(0,7);
  const todayL=S.loans.filter(l=>l.status==='sanctioned'&&l.sanctionDate===td && isFreshCC(l));
  const monthL=S.loans.filter(l=>l.status==='sanctioned'&&(l.sanctionDate||'').startsWith(thisMonth) && isFreshCC(l));
  const pendingL=S.loans.filter(l=>l.status==='pending' && isFreshCC(l));
  const tAmt=todayL.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const mAmt=monthL.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const pAmt=pendingL.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const cats=['Agriculture','SME','Education'];
  const catColors=['rgba(16,185,129,0.75)','rgba(107,95,191,0.75)','rgba(245,158,11,0.75)'];

  function buildLeaderboard(loans){
    const od={};
    S.officers.forEach(o=>od[o]={total:0,agri:0,sme:0,edu:0});
    loans.forEach(l=>{const a=parseFloat(l.amount)||0,o=l.allocatedTo;if(od[o]!==undefined){od[o].total+=a;if(l.category==='Agriculture')od[o].agri+=a;else if(l.category==='SME')od[o].sme+=a;else if(l.category==='Education')od[o].edu+=a;}});
    const sr=Object.entries(od).sort((a,b)=>b[1].total-a[1].total);
    const mx=sr.length?sr[0][1].total:1;
    const rk=['gold','silver','bronze'];
    return sr.map(([nm,d],i)=>{const p=mx>0?Math.round(d.total/mx*100):0;return`<div class="perf-lb-item"><div class="perf-lb-rank ${rk[i]||''}">${i+1}</div><div class="perf-lb-info"><div class="perf-lb-name">${esc(nm)}</div><div class="perf-lb-cats">${d.agri?`<span class="perf-lb-cat agri">Agri \u20b9${fmtAmt(d.agri)}L</span>`:''}${d.sme?`<span class="perf-lb-cat sme">SME \u20b9${fmtAmt(d.sme)}L</span>`:''}${d.edu?`<span class="perf-lb-cat edu">Edu \u20b9${fmtAmt(d.edu)}L</span>`:''}</div><div class="perf-lb-bar-wrap"><div class="perf-lb-bar" style="width:${p}%"></div></div></div><div class="perf-lb-amt">\u20b9${fmtAmt(d.total)}L</div></div>`;}).join('');
  }

  const lbHtml=buildLeaderboard(perfLbPeriod==='today'?todayL:monthL);

  function mkSummary(loans){
    if(!loans.length) return '<div style="padding:16px;text-align:center;font-size:13px;color:#7B7A9A;">No entries</div>';
    const grp={};
    loans.forEach(l=>{const o=l.allocatedTo||'?',ct=l.category||'Other';if(!grp[o])grp[o]={};if(!grp[o][ct])grp[o][ct]={n:0,a:0};grp[o][ct].n++;grp[o][ct].a+=parseFloat(l.amount)||0;});
    const grand={n:0,a:0};
    const rows=S.officers.map(off=>{
      const g=grp[off]||{};let rt={n:0,a:0};
      const ch=cats.map(cat=>{const v=g[cat]||{n:0,a:0};rt.n+=v.n;rt.a+=v.a;if(!v.n)return'';const cl=cat==='Agriculture'?'agri':cat==='SME'?'sme':'edu';const sh=cat==='Agriculture'?'Agri':cat==='Education'?'Edu':cat;return`<span class="os-cat ${cl}"><span class="os-cnt">${v.n}</span> ${sh} \u20b9${fmtAmt(v.a)}L</span>`;}).join('');
      grand.n+=rt.n;grand.a+=rt.a;
      if(!rt.n) return`<div class="os-row"><span class="os-name">${esc(off)}</span><span class="os-cats" style="color:#7B7A9A;font-size:12px;">\u2014</span><span class="os-total">\u20b90L</span></div>`;
      return`<div class="os-row"><span class="os-name">${esc(off)}</span><span class="os-cats">${ch}</span><span class="os-total">\u20b9${fmtAmt(rt.a)}L</span></div>`;
    }).join('');
    return`<div class="officer-summary">${rows}<div class="os-grand"><span>Total: ${grand.n} loans</span><span>\u20b9${fmtAmt(grand.a)} L</span></div></div>`;
  }

  const segData={today:{title:`\ud83d\udcc5 Today \u2014 ${fmtDate(td)}`,amt:tAmt,loans:todayL},month:{title:'\ud83d\udcc6 This Month',amt:mAmt,loans:monthL},pending:{title:'\u23f3 Pending',amt:pAmt,loans:pendingL}};
  const seg=segData[perfSeg];
  const isMob=window.innerWidth<=500;
  const cht=isMob?`<div style="text-align:center;margin-bottom:10px;"><div class="mini-toggle"><button class="mini-toggle-btn ${perfChart==='cats'?'active':''}" onclick="setPerfChart('cats')">Categories</button><button class="mini-toggle-btn ${perfChart==='officers'?'active':''}" onclick="setPerfChart('officers')">Officers</button></div></div>`:'';

  c.innerHTML=`
    <div class="perf-kpi-row">
      <div class="perf-kpi today"><div class="perf-kpi-label">Today</div><div class="perf-kpi-value">\u20b9${fmtAmt(tAmt)}L</div><div class="perf-kpi-sub">${todayL.length} loan${todayL.length!==1?'s':''}</div></div>
      <div class="perf-kpi month"><div class="perf-kpi-label">This Month</div><div class="perf-kpi-value">\u20b9${fmtAmt(mAmt)}L</div><div class="perf-kpi-sub">${monthL.length} sanctioned</div></div>
      <div class="perf-kpi pipeline"><div class="perf-kpi-label">Pending</div><div class="perf-kpi-value">\u20b9${fmtAmt(pAmt)}L</div><div class="perf-kpi-sub">${pendingL.length} in pipeline</div></div>
    </div>
    ${cht}
    <div class="perf-chart-grid">
      <div class="report-card ${isMob&&perfChart!=='cats'?'mob-hide':''}">
        <div class="report-head"><span class="report-head-title">\ud83d\udcca Category Breakdown</span></div>
        <div class="chart-container"><canvas id="catChart"></canvas></div>
      </div>
      <div class="report-card ${isMob&&perfChart!=='officers'?'mob-hide':''}">
        <div class="report-head"><span class="report-head-title">\ud83c\udfc6 Officers</span></div>
        <div class="chart-container"><canvas id="offChart"></canvas></div>
      </div>
    </div>
    <div class="perf-lb">
      <div class="perf-lb-header">
        <div class="perf-lb-title">\ud83e\udd47 Top Performers</div>
        <div class="mini-toggle">
          <button class="mini-toggle-btn ${perfLbPeriod==='month'?'active':''}" onclick="setPerfLbPeriod('month')">Month</button>
          <button class="mini-toggle-btn ${perfLbPeriod==='today'?'active':''}" onclick="setPerfLbPeriod('today')">Today</button>
        </div>
      </div>
      ${lbHtml||'<div style="text-align:center;padding:12px;font-size:13px;color:#7B7A9A;">No data yet</div>'}
    </div>
    <div class="perf-seg">
      <button class="perf-seg-btn ${perfSeg==='today'?'active':''}" onclick="setPerfSeg('today')">Today</button>
      <button class="perf-seg-btn ${perfSeg==='month'?'active':''}" onclick="setPerfSeg('month')">This Month</button>
      <button class="perf-seg-btn ${perfSeg==='pending'?'active':''}" onclick="setPerfSeg('pending')">Pending</button>
    </div>
    <div class="report-card">
      <div class="report-head"><span class="report-head-title">${seg.title}</span><span class="report-head-amt">\u20b9${fmtAmt(seg.amt)} L</span></div>
      ${mkSummary(seg.loans)}
    </div>
    ${S.isAdmin?'<div style="text-align:center;margin-top:16px;"><button class="btn btn-cancel-full" onclick="handleSettings()" style="padding:12px 28px;font-size:14px;max-width:200px;">\u2699\ufe0f Admin Settings</button></div>':''}`;

  currentCharts.forEach(ch=>ch.destroy());
  currentCharts=[];
  let catAmts=[0,0,0],catCnts=[0,0,0],offAmts={};
  S.officers.forEach(o=>offAmts[o]=0);
  monthL.forEach(l=>{const a=parseFloat(l.amount)||0,ci=cats.indexOf(l.category);if(ci!==-1){catAmts[ci]+=a;catCnts[ci]++;}if(offAmts[l.allocatedTo]!==undefined)offAmts[l.allocatedTo]+=a;});

  if(window.Chart){
    const ce=document.getElementById('catChart');
    if(ce) currentCharts.push(new Chart(ce.getContext('2d'),{type:'bar',data:{labels:cats.map((c,i)=>c+' ('+catCnts[i]+')'),datasets:[{data:catAmts,backgroundColor:catColors,borderRadius:5,barThickness:24}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,scales:{x:{beginAtZero:true,ticks:{font:{size:10},callback:v=>'\u20b9'+v+'L'}},y:{ticks:{font:{size:11,weight:'bold'}}}},plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' \u20b9'+fmtAmt(ctx.raw)+' Lakhs'}}}}}));
    const oe=document.getElementById('offChart');
    if(oe) currentCharts.push(new Chart(oe.getContext('2d'),{type:'bar',data:{labels:Object.keys(offAmts),datasets:[{label:'\u20b9 Lakhs',data:Object.values(offAmts),backgroundColor:'rgba(107,95,191,0.7)',borderRadius:5}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{font:{size:10}}},x:{ticks:{font:{size:10}}}},plugins:{legend:{display:false}}}}));
  }
}

window.setPerfSeg=function(v){perfSeg=v;const o=document.getElementById('perfOverlayContent');if(o&&document.getElementById('perfOverlay').style.display!=='none')renderDaily(o);};
window.setPerfChart=function(v){perfChart=v;const o=document.getElementById('perfOverlayContent');if(o&&document.getElementById('perfOverlay').style.display!=='none')renderDaily(o);};
window.setPerfLbPeriod=function(v){perfLbPeriod=v;const o=document.getElementById('perfOverlayContent');if(o&&document.getElementById('perfOverlay').style.display!=='none')renderDaily(o);};

/* ── INIT ── */
async function init(){
  await loadSettings();
  const darkPref=localStorage.getItem('lpDark');
  if(darkPref==='1'){
    S.dark=true;
    document.body.classList.add('dark');
  }
  const savedMode=localStorage.getItem('lpMode');
  if(savedMode==='renewals'){
    S.appMode='renewals';
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b.id==='modeBtn-renewals'));
    document.getElementById('mainTabs').style.display='none';
  }
  const su=localStorage.getItem('lpUser');
  const sa=localStorage.getItem('lpAdmin')==='true';
  if(su){
    S.user=su; S.isAdmin=sa;
    S.filter={ category:'All', officer:sa?'All':'Mine' };
    const av=document.getElementById('userAv');
    if(su==='Admin'){
      av.textContent='🔒';
    } else {
      av.textContent=initials(su);
      av.style.background=officerColor(su).bg;
      av.style.color='#fff';
    }
  }
  subscribeLoans();
  subscribeNotifications();
  if(!S.user) showUserSelect();
}

if('serviceWorker' in navigator)
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));

init();
