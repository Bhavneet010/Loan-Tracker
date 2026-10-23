import { 
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy 
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./config.js";
import { S, notifReady, setNotifReady } from "./state.js";
import { scheduleRender } from "./ui-render.js";
import { notifyLoanChange } from "./notifications.js";
import { effectiveOfficer } from "./derived.js";
import { createShared,updateShared,watchShared } from './agri-link.js';
import { mergeSharedLoans,toNirnayLoan,sharedEditBase,assertLinkageResolved } from './agri-link-model.js';

const firebaseLoans=new Map();
let sharedRows=[];
let sharedWatcher;
let sharedResolved=false;
export const assertLoanResolved=loan=>assertLinkageResolved(loan,sharedResolved);
function publishLoans(){
 S.loans=mergeSharedLoans(Array.from(firebaseLoans.values()),sharedRows);
 S.loanMap=new Map(S.loans.map(loan=>[loan.id,loan]));
 scheduleRender();
}
function acceptShared(row){sharedWatcher?.invalidate();const index=sharedRows.findIndex(item=>item.id===row.id);if(index<0)sharedRows.push(row);else sharedRows[index]=row;publishLoans();return toNirnayLoan(row);}

export const newId = () => 'loan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
export const ts = () => ({ updatedAt: new Date().toISOString(), updatedBy: S.user });

export async function createLoan(data) { 
  if(data.category==='Agriculture'){
    if(data.status&&data.status!=='pending')throw new Error('Only fresh pending Agriculture applications enter the shared workspace.');
    const requestId=S.agriCreateRequestId||(S.agriCreateRequestId=crypto.randomUUID());
    const row=await createShared(data,requestId);return acceptShared(row).id;
  }
  const id = newId(); 
  await setDoc(doc(db, 'loans', id), {
    status: 'pending',
    ...data,
    createdAt: new Date().toISOString(),
    createdBy: S.user,
    ...ts()
  });
  return id; 
}

export async function updateLoan(id, data, snapshot) {
  const existing=sharedEditBase(S.loanMap.get(id),snapshot);
  assertLinkageResolved(existing,sharedResolved);
  if(existing?._sharedId){const updated=acceptShared(await updateShared(existing,data));return updated;}
  await updateDoc(doc(db, 'loans', id), { ...data, ...ts() }); 
}

export async function removeLoan(id) { 
  const existing=S.loanMap.get(id);
  assertLinkageResolved(existing,sharedResolved);
  if(existing?._sharedId){acceptShared(await updateShared(existing,{}, {archived:true}));return;}
  await deleteDoc(doc(db, 'loans', id)); 
}
export async function restoreLoan(snapshot){
 assertLinkageResolved(snapshot,sharedResolved);
 if(snapshot._sharedId){const raw=sharedRows.find(row=>row.id===snapshot._sharedId);if(!raw)throw new Error('Shared application is unavailable. Refresh and try again.');acceptShared(await updateShared(toNirnayLoan(raw),{}, {archived:false}));return;}
 await setDoc(doc(db,'loans',snapshot.id),snapshot);
}

export function subscribeLoans() {
  sharedWatcher?.stop();
  sharedWatcher=watchShared(rows=>{
    const prior=new Map(sharedRows.map(row=>[row.id,row]));
    const first=sharedRows.length===0;
    sharedRows=rows;sharedResolved=true;publishLoans();
    if(!first&&notifReady&&S.user&&Notification.permission==='granted')for(const row of rows){const old=prior.get(row.id);if(old&&(old.version!==row.version||old.nirnay?.version!==row.nirnay?.version)){const loan=toNirnayLoan(row);if(S.isAdmin||effectiveOfficer(loan)===S.user)notifyLoanChange(loan);}}
    document.getElementById('agriSyncMessage')?.remove();
  },error=>{
    let notice=document.getElementById('agriSyncMessage');if(!notice){notice=document.createElement('div');notice.id='agriSyncMessage';notice.setAttribute('role','status');notice.style.cssText='padding:10px 16px;background:#fff3cd;color:#654d00;font-size:13px';document.body.prepend(notice);}notice.textContent='Shared Agriculture updates unavailable. '+error.message;
  });
  onSnapshot(query(collection(db, 'loans'), orderBy('receiveDate', 'desc')), snap => {
    console.log('[DB] Snapshot received:', snap.size, 'loans');
    if (notifReady && S.user && Notification.permission === 'granted') {
      snap.docChanges().forEach(change => {
        if (change.type === 'modified') {
          const loan = { id: change.doc.id, ...change.doc.data() };
          if (S.isAdmin || effectiveOfficer(loan) === S.user) notifyLoanChange(loan);
        }
      });
    }
    setNotifReady(true);
    snap.docChanges().forEach(change => {
      if (change.type === 'removed') firebaseLoans.delete(change.doc.id);
      else firebaseLoans.set(change.doc.id, { id: change.doc.id, ...change.doc.data() });
    });
    publishLoans();
    const syncDot = document.getElementById('syncDot');
    if (syncDot) syncDot.classList.remove('off');
    scheduleRender();
  }, err => {
    const syncDot = document.getElementById('syncDot');
    if (syncDot) syncDot.classList.add('off');
    console.error('Snapshot error:', err);
  });
}
