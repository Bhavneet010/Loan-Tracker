import { 
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy 
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./config.js";
import { S, notifReady, setNotifReady } from "./state.js";
import { updateBadges } from "./ui-stats.js";
import { notifyLoanChange } from "./notifications.js";

export const newId = () => 'loan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
export const ts = () => ({ updatedAt: new Date().toISOString(), updatedBy: S.user });

export async function createLoan(data) { 
  const id = newId(); 
  await setDoc(doc(db, 'loans', id), { 
    ...data, 
    status: 'pending', 
    createdAt: new Date().toISOString(), 
    createdBy: S.user, 
    ...ts() 
  }); 
  return id; 
}

export async function updateLoan(id, data) { 
  await updateDoc(doc(db, 'loans', id), { ...data, ...ts() }); 
}

export async function removeLoan(id) { 
  await deleteDoc(doc(db, 'loans', id)); 
}

export function subscribeLoans() {
  onSnapshot(query(collection(db, 'loans'), orderBy('receiveDate', 'desc')), snap => {
    console.log('[DB] Snapshot received:', snap.size, 'loans');
    if (notifReady && S.user && Notification.permission === 'granted') {
      snap.docChanges().forEach(change => {
        if (change.type === 'modified') {
          const loan = { id: change.doc.id, ...change.doc.data() };
          if (S.isAdmin || loan.allocatedTo === S.user) notifyLoanChange(loan);
        }
      });
    }
    setNotifReady(true);
    S.loans = [];
    snap.forEach(d => S.loans.push({ id: d.id, ...d.data() }));
    const syncDot = document.getElementById('syncDot');
    if (syncDot) syncDot.classList.remove('off');
    updateBadges(); 
    window.render();
  }, err => {
    const syncDot = document.getElementById('syncDot');
    if (syncDot) syncDot.classList.add('off');
    console.error('Snapshot error:', err);
  });
}
