# Nirnay Loan Tracker PWA

Nirnay is a browser-native Progressive Web App for tracking fresh loan applications, SME renewals, officer tasks, and performance reporting with Firebase Firestore synchronization.

## Features

- Officer and Admin views with configurable officers, branches, ownership, targets, and availability.
- Fresh loan tracking across Pending, Sanctioned, and Returned states.
- SME renewal tracking with calendar, due-soon, overdue, completed, and not-possible views.
- Task, notification, month-end snapshot, spreadsheet, PDF, and image-report workflows.
- Stable lazy loading for performance, spreadsheet, and month-end reporting code.
- Installable application shell cached for offline launch after a successful online load.
- Firestore offline persistence when supported by the browser.

## Local Development

The app has no build step and no runtime package dependencies.

```powershell
node dev-server.js
```

Open `http://127.0.0.1:4175`.

## Verification

Run the dependency-free regression and static-integrity suite:

```powershell
npm test
```

Check all application modules for JavaScript syntax errors:

```powershell
$syntaxFailed = $false; Get-ChildItem js -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { $syntaxFailed = $true } }; if ($syntaxFailed) { exit 1 }
```

## Project Structure

```text
.
├── index.html                 Application shell and shared overlays
├── manifest.json              PWA metadata
├── sw.js                      Offline shell and background messaging worker
├── dev-server.js              Local static HTTP server
├── css/                       Feature and theme stylesheets
├── js/                        Browser ES modules
│   ├── app.js                 Application startup and subscriptions
│   ├── state.js               In-memory state and persisted settings
│   ├── db.js                  Firestore loan subscription and writes
│   ├── ui-*.js                Rendering, forms, navigation, and UI actions
│   ├── performance*.js        Performance views and report generation
│   ├── month-end.js           Monthly snapshot and cleanup tools
│   └── lazy-actions.js        Deferred report/export entry points
├── data/                      Preserved recovery snapshots
└── tests/                     Node behavior and runtime-asset tests
```

## Firebase and Security

Firebase project configuration is defined in `js/config.js`. The client configuration values are public identifiers; production protection must come from Firebase Authentication, server-enforced Firestore rules, and App Check.

The current Admin mode is client-managed and must not be treated as a security boundary. A separate security migration is required before exposing sensitive production data to untrusted users.

The cached application shell can launch offline, but uncached Firebase operations and first-time report-library downloads still require network access.
