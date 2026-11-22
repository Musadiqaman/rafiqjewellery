# Verification — 2.2.1 with Authentication and Performance Follow-up

## Follow-up validation in this archive

- All backend JavaScript and MJS files passed `node --check`.
- All 12 frontend JavaScript and JSX files parsed successfully with the installed TypeScript JSX parser.
- Dependency installation timed out in this environment. Therefore the updated automated test suites and production build have **not** been run for this follow-up. No Vercel deployment or real MongoDB verification is claimed.

## Previous release checks

- Version 2.2.1 removes the invalid Audit `_id` index declaration. The regression test failed against 2.2.0 and passes after the fix. All model index definitions are checked for this invalid override. Startup errors now identify the failing model and distinguish index/recovery errors from connection failures.

- Backend `npm test`: 42 pass, 1 database integration case skipped without MONGODB_URI_TEST. This includes config generation/non-overwrite, native image decoding, validation, query/security and seven failure-injection/concurrency tests for standalone persistence.
- The previous release's failure-injection tests use datastore doubles. They cover simultaneous draft finalization, an interrupted commit, unavailable evidence, audit projection failure/replay, interrupted initial-admin setup, primary-admin protection and version-based session invalidation. The new 365-day token test is included in this follow-up but has not been executed here. These tests do not replace tests against a real MongoDB server.
- Frontend `npm test`: 18 pass. `npm run build`: real-API production build and service worker succeed after the page split. Static assets are cached; API responses and customer records are not cached.
- Backend and frontend have independent package.json/lockfiles. No root npm workspace, backend/src, frontend/features, TypeScript or Docker is required. Backend modules and frontend page imports use their own application's folders.
- Sharp remains pinned to 0.35.5; native encode/decode tests pass on linux-x64. The user's previous Windows doctor output confirms this Sharp version loaded from backend/node_modules on win32-x64. The new application code has not been run on that Windows computer here.

## Database integration limitation

`npm run test:db` starts an isolated **standalone** MongoDB instance. The updated suite is designed to cover setup races, signed Bearer authentication, role checks, encrypted evidence, submission retries, server timestamps, immutable snapshots, name/CNIC/phone search, pagination, combined dashboard summary/first-page results, voids, reasoned soft deletion, interrupted-save recovery, failed-draft visibility, evidence retention and account-version token revocation. It has not been run for this follow-up because dependency installation timed out.

MongoDB startup in this editing environment failed with `open: Operation not permitted`. Therefore the real database integration suite is **not verified here**. Run it on a computer that permits MongoDB to start. Alternatively, set MONGODB_URI_TEST to a dedicated test server and run `npm test`; the suite uses a separate randomly named database and removes it afterward. Do not use a production database server for tests.

Vercel and Oracle configurations are included, but have not been deployed to the user's accounts. The private hosted UI is a review build; it is not a hosted MongoDB API. No new physical-device or printer verification is claimed for this refactor.

## Target checks

1. Keep the intended MongoDB service running. Copy the existing backend/.env when upgrading, then run backend and frontend independently with npm install / npm run dev. Confirm API connection and the database name in Settings.
2. For a new installation, check first-admin registration with SETUP_KEY. Confirm registration closes and login works after refresh. Confirm the primary administrator cannot be disabled/demoted.
3. Using a synthetic identity, save 1.5 tola at Rs 260,000: expected amount **Rs 390,000.00**, weight **17.495706 g**. Leave name/phone blank and add a test signature. Confirm server timestamp, Mongo document, persistence after refresh and CNIC lookup.
4. Save another record using grams. Check Today / All dates / Custom filters, totals, CSV and infinite pagination. Void a record; confirm the record is retained and active totals exclude it.
5. Retry the same submission after an interrupted connection. Confirm only one bill exists. Run repair and confirm pending writes/audit projections are completed or safely marked failed, without showing incomplete bills in totals.
6. Edit the affidavit and confirm old receipts retain their original wording. Verify A4 / 80 mm / 58 mm printing and PNG output with long text and evidence images.
7. Confirm Admin/Cashier restrictions, cashier-owned receipts and activity only, blocked password/passkey changes for cashiers, invalidation of changed users' access tokens, admin passkey enrollment/login, physical scanner bridge if installed, camera permissions and image quality.
8. Check iPhone Safari and Android installation over HTTPS. Short viewports and onscreen keyboards may require natural scrolling to keep controls accessible.

The application does not claim identity verification from a camera photo, fabricate fingerprint images or successful saves, or store purchases in localStorage/sample arrays.
