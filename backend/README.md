# Rafiq Ledger Backend — 2.2.1

JavaScript, Express and MongoDB. Standalone MongoDB, replica sets and Atlas are supported. No Docker, TypeScript, root workspace or replica-set setup is required for local use.

## Start

From the project folder:

```powershell
cd backend
npm install
npm run dev
```

Keep your MongoDB Windows service running. The API connects to it; it does not start or reconfigure a separate MongoDB process. On the first development start, a missing `.env` is created with unique keys and this URI:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/rafiq_ledger
```

An existing `.env` is preserved and loaded automatically. When upgrading, copy your old backend/.env to this folder before starting, keeping its ENCRYPTION_KEY and database name. The original generated local development URI with `?replicaSet=rs0` is accepted on standalone MongoDB automatically; production and remote replica-set settings are preserved.

The API listens on port 4000 after connecting. Start the frontend in its own terminal and open http://localhost:5173. For first-admin registration, use SETUP_KEY from your local backend/.env. After that, the app shows login. The first administrator remains protected from deactivation/demotion so concurrent account changes cannot remove all administrator access.

`npm start` runs without watching. `nodemon server.js` also works. Restart the backend after editing `.env`. Keep just one backend process on port 4000.

## Folders

| Path | Responsibility |
| --- | --- |
| `server.js` | Load configuration, connect and listen |
| `app.js` | Express middleware, routes and error responses |
| `config/db.js` | Reusable MongoDB connection with optional index provisioning and recovery |
| `config/env.js`, `config/environment.js` | Environment loading, validation and secure first setup |
| `routes/` | Endpoint paths and permissions |
| `controllers/` | Request handlers |
| `models/` | One model per file: User, Purchase, Media, Settings, Audit, Challenge, RateBucket and others |
| `services/` | Purchase saving, encrypted images, recovery, audit and search |
| `middlewares/` | Bearer-token authentication, origin checks and targeted rate limits |
| `validators/` | Input validation, weight calculations and permissions |
| `utils/` | HTTP errors and hashing helpers |
| `api/index.js` | Vercel adapter |
| `tests/`, `scripts/`, `docs/` | Checks, maintenance and deployment instructions |

## Storage and recovery

Records live in `rafiq_ledger.purchases`. Encrypted images live in `evidence.files` and `evidence.chunks`, with metadata in `media`. Accounts, settings and audit history have their own MongoDB collections. Purchase records are never stored in localStorage. The browser stores a signed access token and its expiry timestamp in localStorage; the token expires 365 days after login. The API verifies its signature and checks the account's current active state and authVersion on each request. Password changes, role changes and account deactivation invalidate older tokens. Because localStorage is readable by JavaScript, a successful XSS attack could steal the token; keep dependencies updated and do not add untrusted scripts. Connect Compass with the same URI to see your database.

Purchase drafts and evidence claims are persisted before a single document update makes a bill visible. Incomplete/failed drafts are excluded from records, exports and dashboard totals. Retrying the same submission resumes the same draft. Standalone server startup recovers up to 100 interrupted writes per pass; `npm run repair` drains larger backlogs. Vercel's request handler deliberately skips startup index creation and recovery to keep cold starts short. The backend Vercel build command runs `npm run db:indexes` automatically during deployment, so no separate manual index command is needed. The broad API limit is enforced in memory per warm instance, while sensitive actions retain database-backed targeted limits. Run `npm run repair` only after interrupted deployments or when pending writes need draining. Creation/void/delete audit events are saved inside the purchase and projected idempotently into audit history. Initial-admin setup also persists its winning identity before completing dependent records.

This supports standalone MongoDB without claiming cross-collection transactions. A process interruption can temporarily leave pending work. Receipt numbers remain unique but may have gaps after failed/racing submissions. Back up MongoDB and the original ENCRYPTION_KEY; both are needed to restore encrypted evidence.

## Checks

- `npm test`: unit, image, access and failure-injection tests; the real database case skips without MONGODB_URI_TEST.
- `npm run test:db`: downloads/starts an isolated standalone MongoDB test instance and runs API integration checks.
- `npm run doctor`: real Sharp encode/decode and resolved module location.
- `npm run repair`: resume pending writes and audit projections.
- `npm run clean:uploads`: remove expired unattached evidence while retaining committed evidence.
- `npm run db:indexes`: ensure indexes exist.
- `npm run setup`: optional manual environment generation; normal development start already handles a missing .env.

Sharp is pinned to 0.35.5 with Windows optional dependencies in the lockfile. If its native binary cannot load, run `npm install --include=optional --os=win32 --cpu=x64 sharp@0.35.5` inside backend, then `npm run doctor`. Do not copy node_modules between operating systems.

For deployment read [DEPLOYMENT.md](docs/DEPLOYMENT.md). Read [VERIFICATION.md](docs/VERIFICATION.md) for completed checks and remaining target-device/database verification.
