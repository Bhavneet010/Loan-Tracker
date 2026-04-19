import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./config.js";

export let PIN = "147258";
export let notifReady = false;

export const S = {
  user: null,
  isAdmin: false,
  tab: 'pending',
  settingsTab: 'officers',
  search: '',
  dark: false,
  appMode: 'fresh',
  filter: { category: 'All', officer: 'All' },
  sort: { field: 'date', dir: 'desc' },
  renewalTab: 'done',
  renewalFilter: { officer: 'All', branch: 'All' },
  renewalSort: { field: 'daysFromSanction', dir: 'desc' },
  openPop: null,
  loans: [],
  notifications: [],
  officers: ['Anchal', 'Nikita', 'Ritika'],
  branches: [
    '686 : NAHAN', '1680 : ADB PAONTA SAHIB', '1755 : PAONTA SAHIB',
    '2413 : MAJRA', '3399 : RAJBAN', '4589 : SME TARUWALA',
    '4590 : KALA AMB', '6784 : DHAULA KUAN', '7459 : KAFOTA',
    '8117 : RAJPUR', '50536 : BHAGANI', '50569 : TIMBI', '63982 : SHILLAI'
  ],
  branchOfficers: {
    '2413': 'Ritika', '6784': 'Ritika', '1755': 'Ritika', '4590': 'Ritika',
    '3399': 'Anchal', '4589': 'Anchal', '7459': 'Anchal', '50569': 'Anchal', '63982': 'Anchal',
    '1680': 'Nikita', '686': 'Nikita', '8117': 'Nikita', '50536': 'Nikita'
  }
};

export function setNotifReady(val) { notifReady = val; }
export function setPIN(val) { PIN = val; }

export async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'config'));
    if (snap.exists()) {
      const d = snap.data();
      if (d.officers?.length) S.officers = d.officers;
      if (d.branches?.length) S.branches = d.branches;
      if (d.branchOfficers) S.branchOfficers = { ...S.branchOfficers, ...d.branchOfficers };
      if (d.adminPin) PIN = d.adminPin;
    } else {
      await setDoc(doc(db, 'settings', 'config'), { 
        officers: S.officers, 
        branches: S.branches, 
        branchOfficers: S.branchOfficers, 
        adminPin: PIN 
      });
    }
  } catch (e) { console.error(e); }
}

export async function saveSettings() {
  try { 
    await setDoc(doc(db, 'settings', 'config'), { 
      officers: S.officers, 
      branches: S.branches, 
      branchOfficers: S.branchOfficers, 
      adminPin: PIN 
    }); 
  } catch (e) { console.error('Error saving settings:', e); }
}
