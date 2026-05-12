import { doc, setDoc, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./config.js";
import { S } from "./state.js";

let _heartbeatInterval = null;
let _visibilityHandler = null;

function _ping() {
  if (!S.user) return;
  setDoc(doc(db, 'presence', S.user), {
    lastSeen: new Date().toISOString(),
    isMobile: /Mobi|Android/i.test(navigator.userAgent)
  }, { merge: true }).catch(() => {});
}

export function initPresence() {
  if (!S.user) return;
  _ping();
  if (_heartbeatInterval) clearInterval(_heartbeatInterval);
  _heartbeatInterval = setInterval(() => {
    if (document.visibilityState !== 'hidden') _ping();
  }, 2 * 60 * 1000);
  if (_visibilityHandler) document.removeEventListener('visibilitychange', _visibilityHandler);
  _visibilityHandler = () => { if (document.visibilityState === 'visible') _ping(); };
  document.addEventListener('visibilitychange', _visibilityHandler);
}

export function subscribePresence(onUpdate) {
  const data = {};
  const unsub = onSnapshot(collection(db, 'presence'), snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'removed') delete data[change.doc.id];
      else data[change.doc.id] = change.doc.data();
    });
    onUpdate({ ...data });
  }, () => {});
  return unsub;
}

export function isOnline(isoString) {
  if (!isoString) return false;
  return Date.now() - new Date(isoString).getTime() < 5 * 60 * 1000;
}
