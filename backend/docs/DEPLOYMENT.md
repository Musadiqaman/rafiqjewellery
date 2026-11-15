# Deployment and Database Setup — 2.2.1

## Local Windows setup

The backend supports standalone MongoDB. Keep the existing MongoDB Windows service running on port 27017. No replica configuration or second MongoDB process is required. Keep your existing storage.dbPath and database files.

When upgrading, copy the previous backend/.env into the new backend folder before starting. Keep its ENCRYPTION_KEY and database name so existing evidence remains readable. Never replace a real installation's encryption key with a newly generated key.

From the extracted project folder, open two terminals:

```powershell
cd backend
npm install
npm run dev
```

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Node.js must satisfy both package.json engine requirements (22.12 or later). There is no root npm install, setup command or Docker requirement.

On the first development start only, the backend creates a missing .env with unique secrets and this database URI:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/rafiq_ledger
```

An existing .env is loaded without being overwritten. The old generated local development URI ending in `rafiq_ledger?replicaSet=rs0` is also accepted on standalone MongoDB; this compatibility adjustment is in memory only. Remote and production replica-set settings are preserved. Restart the backend after editing .env.

Use SETUP_KEY from backend/.env for first-administrator registration. Later visits show login. The first administrator is protected from demotion/deactivation. Additional accounts can be managed in Settings.

The API listens on port 4000 after connecting. Local standalone startup ensures model indexes and performs one bounded recovery pass. `/api/health` returns 200 when connected. Records are stored in the MongoDB `purchases` collection, accounts in `users`, and encrypted evidence in `evidence.files` / `evidence.chunks` with metadata in `media`. Open Compass using the same URI to inspect the database. Your MongoDB service's storage.dbPath controls where MongoDB stores its files; the app does not change it.

### If startup fails

Version 2.2.1 fixes the Audit custom `_id` index warning and MongoDB code 197 seen with 2.2.0. Upgrade the backend code and keep the same .env. Alternatively, remove `audit.index({ _id: -1 });` from backend/models/Audit.js and restart. MongoDB already provides the `_id` index; no database reset or index deletion is required.

- Check the MongoDB Windows service is running and MONGODB_URI has the correct host, port and database name. The API does not start MongoDB itself.
- If port 4000 is occupied, stop the duplicate backend process. Use either npm run dev or nodemon server.js, not both.
- If configuration validation fails, correct the named field in backend/.env. ENCRYPTION_KEY must be the original 64-character hexadecimal key when restoring saved evidence.
- If Sharp fails to load, run `npm install --include=optional --os=win32 --cpu=x64 sharp@0.35.5` inside backend, then `npm run doctor`. Do not copy node_modules across operating systems.

## Standalone saving and recovery

The app does not require multi-document transactions. A bill is first persisted as a pending draft, then its evidence is reserved. A single atomic purchase update commits the complete record. Only committed records, and existing records from previous versions, appear in searches, totals, receipts and exports. A unique submission key makes retries resume the same draft rather than create another bill. Evidence cannot belong to two committed bills. Receipt numbers are unique but may have gaps after interrupted or competing submissions.

Creation/void/delete audit events are stored with the purchase and projected idempotently into searchable audit history. Initial-admin setup also persists the winning administrator before completing related documents. Startup attempts recovery of up to 100 pending records per pass. Use `npm run repair` to drain a larger backlog. This is recoverable single-document persistence, not a cross-collection transaction; a process interruption may leave temporary pending work.

Official background: https://www.mongodb.com/docs/manual/core/write-operations-atomicity/

## Vercel — two independent projects

1. Create a backend project with **Root Directory = backend**, Framework Preset **Other**. backend/vercel.json routes API requests to api/index.js. Install command: `npm ci --include=optional`. Its configured build command automatically runs `npm run db:indexes` during each backend deployment; no separate manual index command is needed. Choose a supported Node runtime satisfying package.json.
2. Configure an externally reachable MongoDB database, for example Atlas. Your Windows localhost address cannot be used from Vercel. Set backend environment variables: NODE_ENV=production, MONGODB_URI, APP_ORIGIN=https://your-frontend-domain, RP_ID=your-frontend-domain, SESSION_SECRET, ENCRYPTION_KEY, SETUP_KEY and TRUST_PROXY=1. Use the existing encryption key when migrating real records. Production starts never generate secrets automatically.
3. Deploy the backend and check its `/api/health` endpoint.
4. Create a frontend project with **Root Directory = frontend**, Framework Preset **Vite**. Replace `https://YOUR-BACKEND.vercel.app` in frontend/vercel.json with the real backend URL. Install command: `npm ci --include=optional`; build: `npm run build`; output: `dist`.
5. Use one canonical frontend domain. APP_ORIGIN must be its exact HTTPS origin without a trailing slash; RP_ID is just its hostname. Redirect aliases. The frontend rewrite keeps API requests on the frontend origin. Normal authentication uses a signed Bearer token stored in browser localStorage for 365 days. The API checks the account's active state and authVersion on every request, so password changes, role changes and deactivation invalidate old tokens. Passkey login still uses a short-lived challenge cookie. If deployment protection blocks the backend proxy, configure authorized proxy access; a sign-in HTML response is not an API response.
6. Deploy the frontend. Existing browser sessions from the cookie-based version are not migrated, so each user must sign in once to create the new localStorage token. Create the administrator if this is a new installation, save a synthetic purchase, reload it and confirm persistence in Compass. Do not set VITE_REVIEW_ONLY for the real deployment.

The backend caches its connection in each warm instance with a pool limit of 15. Vercel cold starts only establish/reuse the MongoDB connection. They do not create indexes, run write recovery or write a global rate-limit bucket for every API request. The broad API limit uses an in-memory per-instance counter; sensitive actions retain targeted database-backed rate limits. Indexes are provisioned automatically by the backend Vercel build command on every deployment, so no separate `npm run db:indexes` step is required. Keep `MONGODB_URI` configured for the backend project and ensure the MongoDB network access rules allow the Vercel build to connect. Run `npm run repair` only after interrupted deployments or when pending writes/audit projections need recovery. Keep all backend secrets in the backend project only. The 365-day localStorage token is accessible to JavaScript, so this is less resistant to XSS than the previous HttpOnly session cookie. Logout clears the current browser's token; a copied token remains valid until expiry or an account authVersion change because there is no per-device server-side session/denylist. Keep the frontend free of untrusted scripts and review dependencies.

Uploads are limited to 3 MB per image. Encrypted images are stored in MongoDB GridFS, not a temporary server filesystem. CSV export is capped at 10,000 records per query. The configurations are included; deployment and end-to-end verification in your Vercel account are still required.

Official documentation: https://vercel.com/docs/functions/limitations and https://vercel.com/docs/rewrites

## Oracle Cloud VM

Install a supported Node version and provide a running MongoDB database. Standalone MongoDB is supported; protect database access and keep it private. Install the backend independently:

```sh
cd /opt/rafiq-ledger/backend
npm ci --include=optional
npm run setup
npm run doctor
```

Here setup is an optional convenience to generate a new .env before editing its production values. Skip it when migrating an existing .env. Set NODE_ENV=production, APP_ORIGIN=https://shop.example.com, RP_ID=shop.example.com, TRUST_PROXY=1 and the correct database URI and secrets.

Build the frontend separately:

```sh
cd /opt/rafiq-ledger/frontend
npm ci --include=optional
npm run build
```

Express serves the API. Serve frontend/dist and proxy API requests over HTTPS, for example with Caddy:

```text
shop.example.com {
  handle /api/* {
    reverse_proxy 127.0.0.1:4000
  }
  handle {
    root * /opt/rafiq-ledger/frontend/dist
    try_files {path} /index.html
    file_server
  }
}
```

Keep port 4000 private behind the proxy. Give the web server read access to frontend/dist and run Node under a dedicated service account. Example systemd service:

```ini
[Unit]
Description=Rafiq Jewellery API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=rafiq
WorkingDirectory=/opt/rafiq-ledger/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/rafiq-ledger/backend/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

backend/.env is loaded automatically. Restrict it to the service account (permissions 600). MongoDB must be running before the API starts.

## Maintenance

- Back up the entire MongoDB database, including GridFS collections. Back up ENCRYPTION_KEY separately and test restoring both.
- Run `npm run clean:uploads` daily with the backend environment to remove expired, unattached evidence. Evidence belonging to committed bills is retained, including voided and soft-deleted bills.
- Run `npm run repair` after an interrupted deployment or to drain pending audit/bill work. Do not manually delete pending documents or their attachments.
- Changing ENCRYPTION_KEY requires a deliberate re-encryption migration. Changing SESSION_SECRET invalidates access tokens and cursor signatures. Changing the application domain affects cookies and passkeys.
- Settings → Shop shows the database name and storage type to administrators. Startup logs do not print database credentials.
- Follow docs/VERIFICATION.md for target-account, printer, scanner and iPhone/Android checks.
