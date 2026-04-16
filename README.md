# Loan Progress PWA

A Progressive Web App for tracking loan applications across Pending → Sanctioned → Returned states, with real-time sync via Firebase.

## Features

- ✅ **3 user roles**: Anchal, Nikita, Ritika (editable via Admin) + separate Admin
- ✅ **Real-time sync**: All users see updates instantly (via Firebase Firestore)
- ✅ **Pending tab** with sub-tabs: Agriculture / SME / Education / All
- ✅ **Sanction flow**: One tap sanctions a loan, auto-fills today's date
- ✅ **Returned tab**: Stays until manually moved back to pending
- ✅ **Daily Report**: Today / This Month / Pending summary by officer × category
- ✅ **Admin-only delete**: Protected by PIN (147258)
- ✅ **Admin settings**: Add/remove officers and branches anytime
- ✅ **Installable**: Add to home screen on phone, works like a native app
- ✅ **Offline-capable**: App loads offline (data syncs when online)

## Admin PIN
**147258** — keep this safe. You can change it by editing `index.html` (search for `ADMIN_PIN`).

---

## How to Deploy (Pick ONE option)

### 🟢 Option 1: Netlify Drop (Easiest, 30 seconds, FREE)

1. Go to https://app.netlify.com/drop
2. Sign up with Google (free)
3. Drag the **entire `loan-progress` folder** (not zipped) onto the page
4. Done — you get a URL like `https://loan-progress-abc123.netlify.app`
5. Share the URL with Anchal, Nikita, Ritika
6. On phone: open the URL in Chrome → tap menu → "Install app" / "Add to Home screen"

### 🟢 Option 2: GitHub Pages (FREE)

1. Create a free GitHub account if you don't have one
2. Create a new public repo, e.g., `loan-progress`
3. Upload all files (`index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`)
4. Go to repo Settings → Pages → Source: `main` branch / root → Save
5. Your app is live at `https://<your-username>.github.io/loan-progress/`

### 🟢 Option 3: Firebase Hosting (Same Firebase account, FREE)

In your Firebase console → Build → Hosting → Get started. Follow the CLI instructions to deploy the folder.

---

## How to Install on Phone

1. Open the deployed URL in **Chrome** (Android) or **Safari** (iOS)
2. **Android**: Tap menu (⋮) → "Install app" or "Add to Home screen"
3. **iOS**: Tap Share button → "Add to Home Screen"
4. App icon appears on home screen — tap to launch like any app

## How to Use

1. First launch → pick your name from the list (or tap Admin + enter PIN)
2. Tap the **+** button (bottom right) to add a new loan
3. In the **Pending** tab: tap **✓ Sanction** to move a loan to Sanctioned, or **↩ Return** to mark as returned
4. All changes sync instantly to other users' devices
5. **Daily Report** tab shows the full performance tracker summary

## Admin Features (after PIN unlock)

- Delete any loan entry (regular users cannot)
- Tap **⚙️ Admin Settings** in Daily Report tab to:
  - Add/remove processing officers
  - Add/remove branches

## Firebase Firestore Rules

Make sure Firestore is in "test mode" or has these rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

## File Structure

```
loan-progress/
├── index.html       (main app)
├── manifest.json    (PWA manifest)
├── sw.js           (service worker for offline)
├── icon-192.png    (app icon)
├── icon-512.png    (app icon, large)
└── README.md       (this file)
```

## Need to change something?

- **Admin PIN**: Edit `index.html`, find `const ADMIN_PIN = "147258"`, change the number
- **Default officers**: Edit `index.html`, find `officers: ['Anchal', 'Nikita', 'Ritika']`
- **Default branches**: Edit `index.html`, find `branches: [...]`

All data lives in Firebase — you can view/edit raw data anytime at:
https://console.firebase.google.com/project/loan-tracker-4af27/firestore
