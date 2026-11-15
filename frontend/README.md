# Rafiq Ledger Frontend — 2.2.1

Independent React + Vite application in plain JavaScript.

## Start

From the project folder, in a separate terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the independently running backend on port 4000. There is no root package.json, npm workspace or cross-folder import dependency. To change the development backend, set BACKEND_URL in frontend/.env. Keep the backend APP_ORIGIN and RP_ID aligned with the browser origin.

## Folders

| Path | Page or responsibility |
| --- | --- |
| `src/pages/dashboard/Dashboard.jsx` | Search, date filters, totals and infinite record list |
| `src/pages/new-entry/NewEntry.jsx` | Purchase entry, identity, weight, images and signature |
| `src/pages/settings/Settings.jsx` | Shop settings, affidavit, team, security and activity |
| `src/pages/auth/Auth.jsx` | First administrator, login and passkeys |
| `src/pages/records/RecordView.jsx` | Record details, receipts and printing |
| `src/components/` | Reusable controls, camera and signature canvas |
| `src/lib/` | API calls, formatting and local validation |
| `public/` | Fonts, icons, manifest and offline screen |

`npm run build` creates frontend/dist and the service worker. `npm test` runs validation and weight tests. The normal build uses the real API; record saving requires a connected backend and MongoDB. The service worker caches static assets only.

## Vercel

Create two projects from the same source: backend with Root Directory `backend`, frontend with Root Directory `frontend`. Configure the backend environment and deploy it first. Replace YOUR-BACKEND.vercel.app in frontend/vercel.json with that backend deployment's public API hostname, then deploy the frontend with build command `npm run build`, output directory `dist`.

The rewrite keeps API requests on the frontend origin. Normal login uses a signed Bearer token stored in localStorage for 365 days. Passkey login uses a short-lived challenge cookie. Set backend APP_ORIGIN to the exact frontend HTTPS origin and RP_ID to its hostname. The long-lived localStorage token is readable by JavaScript, so protect the frontend against XSS and do not add untrusted scripts. Never put backend secrets in frontend variables. Full Vercel and Oracle instructions are in backend/docs/DEPLOYMENT.md in the source archive.
