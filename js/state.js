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
  appMode: 'tasks',
  filter: { category: 'All', officer: 'All', today: false },
  sort: { field: 'date', dir: 'desc' },
  renewalTab: 'done',
  renewalFilter: { officer: 'All', branch: 'All', completion: 'All', status: 'All', today: false },
  renewalSort: { field: 'daysFromSanction', dir: 'desc' },
  renewalShowNpa: false,
  renewalOfficersExpanded: false,
  renewalView: 'calendar',
  calendarState: null,
  calendarOpenDay: null,
  calendarBarExpanded: false,
  taskView: 'overview',
  taskCategory: null,
  taskOfficer: null,
  taskCriticalExpanded: {},
  taskCriticalSort: {},
  openPop: null,
  loans: [],
  loanMap: new Map(),
  notifications: [],
  renewalTargets: {},
  officerPhotos: {},
  officerAvailability: [],
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
  },
  bankHolidays: []
};

export function setNotifReady(val) { notifReady = val; }
export function setPIN(val) { PIN = val; }

function timeoutAfter(ms) {
  return new Promise(resolve => setTimeout(() => resolve(null), ms));
}

function applySettings(d) {
  if (d.officers?.length) S.officers = d.officers;
  if (d.branches?.length) S.branches = d.branches;
  if (d.branchOfficers) S.branchOfficers = { ...S.branchOfficers, ...d.branchOfficers };
  if (d.renewalTargets) S.renewalTargets = d.renewalTargets;
  if (d.officerPhotos) S.officerPhotos = d.officerPhotos;
  if (Array.isArray(d.officerAvailability)) S.officerAvailability = d.officerAvailability;
  if (Array.isArray(d.bankHolidays)) S.bankHolidays = d.bankHolidays;
  if (d.adminPin) PIN = d.adminPin;
}

export async function loadSettings() {
  try {
    const configRef = doc(db, 'settings', 'config');
    const fetchPromise = getDoc(configRef).catch(e => { console.error(e); return null; });
    const snap = await Promise.race([fetchPromise, timeoutAfter(1500)]);
    if (!snap) {
      console.warn('[Settings] Using defaults while Firestore settings are unavailable.');
      // Settings arrived after the timeout — apply them and re-render when they do arrive
      fetchPromise.then(lateSnap => {
        if (lateSnap?.exists()) {
          applySettings(lateSnap.data());
          window.scheduleRender?.();
        }
      });
      return;
    }
    if (snap.exists()) {
      applySettings(snap.data());
    } else {
      setDoc(configRef, {
        officers: S.officers,
        branches: S.branches,
        branchOfficers: S.branchOfficers,
        renewalTargets: S.renewalTargets,
        officerPhotos: S.officerPhotos,
        officerAvailability: S.officerAvailability,
        adminPin: PIN
      }).catch(e => console.error('Error creating default settings:', e));
    }
  } catch (e) { console.error(e); }
}

export async function saveSettings() {
  try {
    await setDoc(doc(db, 'settings', 'config'), {
      officers: S.officers,
      branches: S.branches,
      branchOfficers: S.branchOfficers,
      renewalTargets: S.renewalTargets,
      officerPhotos: S.officerPhotos,
      officerAvailability: S.officerAvailability,
      bankHolidays: S.bankHolidays,
      adminPin: PIN
    });
  } catch (e) { console.error('Error saving settings:', e); }
}
