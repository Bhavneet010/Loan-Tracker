# Nirnay Loan Tracker PWA

A static Progressive Web App for tracking loan applications across Pending, Sanctioned, Returned, and SME Renewal workflows with Firebase Firestore sync.

## Features

- Officer and Admin modes with configurable officers, branches, branch ownership, and Admin PIN.
- Realtime Firestore sync for loan changes and notifications.
- Fresh loan tracking across Pending, Sanctioned, and Returned states.
- SME CC renewal dashboard with Done, Due Soon, Overdue, and All account views.
- Performance dashboard loaded on demand so the main tracking view stays lightweight.
- Installable PWA shell with local app assets cached for offline launch.
- Firestore offline persistence when supported by the browser.

## Local Testing

This app has no build step. Serve the repository root with any static server, then open the local URL in a browser.

```bash
python -m http.server 4173
```

Recommended lightweight test data volume: up to 50 representative loan records across officers, branches, categories, statuses, and renewal states.

## Deployment

You can deploy the repository root to any static host, including GitHub Pages, Netlify, or Firebase Hosting. Required runtime files include `index.html`, `manifest.json`, `sw.js`, `css/styles.css`, `js/`, and the icon files.

## Admin And Settings

The default Admin PIN and officer/branch defaults are defined in `js/state.js`, then persisted in the Firestore `settings/config` document after first launch. Use the in-app Admin Settings screen for normal changes.

## Firestore Notes

The app uses the Firebase project configured in `js/config.js`. For real usage, avoid open test-mode rules and protect reads/writes with Firebase Auth and role-aware Firestore rules.

## File Structure

```text
.
├── index.html
├── manifest.json
├── sw.js
├── css/styles.css
├── js/
│   ├── app.js
│   ├── config.js
│   ├── db.js
│   ├── derived.js
│   ├── notifications.js
│   ├── performance.js
│   └── ui-*.js
├── data/
└── icon-192.png / icon-512.png
```
