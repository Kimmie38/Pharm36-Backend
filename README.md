# Pharm36 Backend

Node.js + Express 5 + MongoDB (Mongoose) REST API for the Pharm36 Expo mobile apps and the separate web admin dashboard. The backend is the source of truth for account, inventory, marketplace, drug-label and anonymous AI-history data.

## Quick start

```bash
cd backend
npm install
[ -f .env.local ] || cp .env.example .env.local  # set a strong JWT_SECRET and MONGODB_URI
docker compose up -d            # optional: local MongoDB for ordinary development
npm run seed:demo               # optional: the same demo data the app shows today
npm run seed:admin              # optional: create the admin from ADMIN_* in .env.local
npm run dev                     # http://localhost:4000/health
npm test                        # unit + HTTP tests (no DB needed)
MONGODB_TEST_URI=mongodb://127.0.0.1:27017/pharm36_test npm test    # + full end-to-end suite
```

The multi-collection account-deletion cascade requires a transaction-capable MongoDB replica set or sharded deployment; a standalone local MongoDB is not sufficient. Use a local replica-set configuration or MongoDB Atlas to exercise transactional deletion. The API fails closed without partial record deletion when transactions are unavailable.

## Admin provisioning

The backend loads ignored `.env.local` first and then `.env`; environment variables supplied by the process/host take precedence. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_COUNCIL` in `.env.local` for local use, or in the hosting provider's protected environment settings. Use a unique, strong password. Real credentials must not be placed in `.env.example` or committed.

`npm run seed:admin` is an explicit one-time operation; it is never run at API startup. It creates a new admin only when the configured email is unused, and hashes the password with the existing password helper. If the email already belongs to an admin, the default command makes no changes. If it belongs to a professional or other non-admin account, the command refuses to elevate it. For an existing admin, use `npm run seed:admin -- --reset-password` to deliberately change its password (this increments `tokenVersion`, invalidating existing sessions), and/or `npm run seed:admin -- --set-council` to deliberately change its scope. These flags never create or elevate an account. `ADMIN_COUNCIL` must be set explicitly to `PCN`, `VCN`, or `ALL`; `ALL` grants access across councils.

For a live deployment, set the credentials in the host's protected environment and run the seed command once against the intended database only after confirming the email, database target, and council scope. This build does not run the seed command or modify a live database.

Demo login after `seed:demo`: `adaeze.okonkwo@pharm36.app` / `Demo12345`.
Try scanning `5012345678901` or `5019988771234` in the Buyer app.

## Data model

| Collection | Purpose |
|---|---|
| `users` | Professionals (`pharmacist` / `veterinary`) and council admins. Holds claimed `sections`, council-confirmed `verifiedSections`, `pcnStatus` (`active`/`revoked`) and an internal `verificationStatus`. |
| `batches` | Inventory. One *active* record per (owner, batchCode). State: `active` / `sold` / `disposed`. Expiry **status is computed**, never stored, so it can't go stale. |
| `salesrecords` | Every sale (direct or marketplace). Drives the dashboard "sales level" per drug. |
| `listings` | Marketplace: `offer` (sell a batch) and `request` (post a request). |
| `marketplaceorders` | Audit trail of marketplace purchases. |
| `notifications` | Expiry alerts (1 month, 2 weeks, expired, + custom early reminder). |
| `reports` | Consumer "Report a problem with this drug". |
| `drugchecks` | Anonymous scan/search log (auto-deleted after 180 days). |
| `druginfos` | Cached official-label records, generated summaries and reviewed human overrides. Global/shared data; administrative review requires `ALL` scope. |
| `aisettings` | One global AI configuration record: requested enablement, summary/Q&A model names, per-IP rate limits and updater reference. It never stores the provider key. |
| `aiinteractions` | Anonymous public Q&A history: drug key/name, redacted question/answer, response status, model, `createdAt` and `expiresAt`. A TTL index expires entries 90 days after creation. No account, email, phone, IP or user-agent fields are stored. |
| `admininvariants` | Internal singleton revision record used to serialize last-`ALL`-admin deletion and council-scope changes inside MongoDB transactions. |

## API (all JSON, `Authorization: Bearer <token>` unless marked public)

| Screen / feature | Endpoint |
|---|---|
| Register (pharmacist / vet, sections) | `POST /api/auth/register` |
| Login (phone **or** email) | `POST /api/auth/login` |
| Forgot password | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` |
| Dropdown data: states, sections, categories, reminders | `GET /api/meta` (public) |
| Profile | `GET /api/me`, `PATCH /api/me`, `POST /api/me/change-password`, `PUT /api/me/push-token` |
| Home dashboard (counts, expiring banner, sales levels) | `GET /api/dashboard` |
| Inventory (search/filter) | `GET /api/batches?search=&status=&category=&state=&page=&limit=` |
| Add batch | `POST /api/batches` |
| Batch detail / edit | `GET /api/batches/:id`, `PATCH /api/batches/:id` |
| Expiry Alerts tab | `GET /api/batches/expiring` |
| Mark Sold / Dispose | `POST /api/batches/:id/sell`, `POST /api/batches/:id/dispose` |
| Sales summary | `GET /api/sales?days=30` |
| Marketplace: browse / my listings | `GET /api/marketplace/listings?type=offer\|request&mine=&search=` |
| Create listing / post a request | `POST /api/marketplace/listings`, `POST /api/marketplace/requests` |
| Edit / cancel listing | `PATCH` / `DELETE /api/marketplace/listings/:id` |
| Buy batch | `POST /api/marketplace/listings/:id/buy` |
| Order history | `GET /api/marketplace/orders?role=buyer\|seller` |
| Notifications | `GET /api/me/notifications`, `PATCH /api/me/notifications/:id/read`, `POST /api/me/notifications/read-all` |
| **Buyer app** scan result (public) | `GET /api/public/drugs/verify?batchCode=` |
| **Buyer app** search by name (public) | `GET /api/public/drugs/search?q=` |
| **Buyer app** report a problem (public) | `POST /api/public/reports` |
| **Buyer app** drug info: uses, adult/child dosage, side effects, warnings (public) | `GET /api/public/drugs/info?batchCode=` or `?name=` |
| **Buyer app** "ask about this drug" (public) | `POST /api/public/drugs/ask` `{batchCode\|name, question}` |
| Admin: user directory/detail | `GET /api/admin/users`, `GET/PATCH/DELETE /api/admin/users/:id`, `GET /api/admin/users/:id/delete-preview`, `POST /api/admin/users/:id/revoke-sessions` |
| Admin: inventory/listings | `GET /api/admin/inventory`, `PATCH/DELETE /api/admin/inventory/:id`; `GET /api/admin/listings`, `PATCH/DELETE /api/admin/listings/:id` |
| Admin: sales, orders, scans | `GET /api/admin/sales`, `DELETE /api/admin/sales/:id`; `GET /api/admin/orders`, `DELETE /api/admin/orders/:id`; `GET /api/admin/scans`, `DELETE /api/admin/scans/:id` |
| Admin: reports and metrics | `GET /api/admin/stats`, `GET /api/admin/reports`, `PATCH/DELETE /api/admin/reports/:id` |
| Admin: professionals | `GET /api/admin/professionals`, `GET /api/admin/professionals/:id`, `PATCH /api/admin/professionals/:id/verification`, `GET /api/admin/professionals/:id/batches` |
| Admin: global drug-label review | `GET /api/admin/drug-info`, `GET/PATCH/DELETE /api/admin/drug-info/:id`, `POST /api/admin/drug-info/:id/refresh` |
| Admin: anonymous AI history and settings | `GET /api/admin/ai-history`, `DELETE /api/admin/ai-history/:id`; `GET/PATCH /api/admin/ai-settings` |

Errors are always `{ "error": "message", "details"?: ... }`. Validation errors list `details: [{field, message}]`;
restricted categories return `403` with `details.code = "CATEGORY_RESTRICTED"`.

All `/api/admin/*` routes require an administrator JWT. Professional-linked records are filtered to the signed-in admin's PCN/VCN council unless the admin has `council: "ALL"`. Cross-council statistics, anonymous reports and scan logs, the shared drug-label cache, AI history, global AI settings, and permanent deletion require `ALL` scope. Inventory category edits use the same verified-section rule as normal batch creation. Unrecognized administrator council scopes fail closed.

## Admin deletions and AI oversight schemas

Account deletion requires `confirmIdentity` to exactly match the account's registered email, or its registered phone when the account has no email. The signed-in admin, the last `ALL` admin, and out-of-scope accounts cannot be deleted. A deletion transaction removes the account's batches, their linked listings, orders where the account is buyer or seller, owned sale records and notifications, then the user; reviewer references on reports, drug-label records and AI settings are cleared. Anonymous reports, scans, drug-label cache records and Q&A history are not inferred to belong to a user and are managed separately.

Every permanent removal uses the typed `confirmation: "DELETE"` value (account deletion uses the exact identity value instead) and MongoDB transactions. A deletion-in-progress gate blocks concurrent account writes. The `admininvariants` singleton serializes ALL-admin deletion and council-scope changes; the last ALL admin is rechecked inside the same transaction so concurrent changes cannot remove the final global administrator. If transaction support is unavailable, the backend returns `503` without deleting linked records.

`AIInteraction` is append-only apart from TTL cleanup and carries only `drugKey`, `drugName`, `question`, `answer`, `responseStatus` (`answered`, `emergency`, `ungrounded`, `unavailable`), `model`, `createdAt`, and `expiresAt`. Email and phone patterns are redacted before storage. No account identity, IP address, or user-agent is recorded. `expiresAt` is set to 90 days after creation and has a MongoDB TTL index; ALL-scope admins can also permanently delete an entry early. Free text can still contain sensitive health details, which the dashboard warns reviewers about.

`AISettings` is a single `scope: "global"` record for `enabled`, `summaryModel`, `askModel`, `askPerMinute`, `askPerDay`, and updater metadata. The provider key remains in the hosting provider's protected environment and is never returned or accepted through the admin API; the API returns only a `providerConfigured` boolean. Only an ALL-scope administrator can view or change the global AI controls/history. Emergency-response shortcuts, including a child ingesting adult medicine, bypass the AI call. AI summaries and Q&A expose only exact excerpts found in the relevant official-label text; unsupported nonnumeric and numeric paraphrases are discarded.

Deployment steps for the existing Render API and the optional dashboard service are in [`../RENDER_DEPLOY.md`](../RENDER_DEPLOY.md). The dashboard uses a strict same-origin server proxy, so its own public origin does not need to be added to backend CORS; keep configured mobile/Expo web origins as required.

Add-batch body (matches the form; numbers may be strings):
```json
{ "drugName": "Amoxicillin 500mg", "category": "prescription", "batchCode": "5012345678901",
  "manufactureDate": "2025-02-10", "expiryDate": "2026-10-05", "price": "85", "quantity": "240", "reminder": "3 months",
  "manufacturer": "Emzor Pharmaceuticals", "strength": "500mg", "form": "Capsule" }
```
`manufacturer`, `strength`, `form` are optional but are what the Buyer's drug-details screen displays, so consider
adding those fields to the Add Batch form.


## Drug information assistant (Buyer app)

After a scan, the app calls `GET /api/public/drugs/info?batchCode=...` (or `?name=` for typed searches) and gets only AI-selected
**verbatim excerpts verified against the relevant U.S. FDA label sections**: uses, adult and child dosage, adverse reactions,
warnings, contraindications, interactions, pregnancy/breastfeeding, overdose and storage. The complete underlying excerpts and
source link remain visible. A chat-style box can call `POST /api/public/drugs/ask` for follow-ups ("can I take it with food?");
answers are themselves verified source excerpts, or a non-confirming fallback.

**How it works**

1. The scanned batch code is matched to the registered drug name (the registry is how a barcode becomes a drug name).
2. The name is normalised to the names the FDA uses (`Paracetamol → acetaminophen`, `Salbutamol → albuterol`, `Co-trimoxazole → sulfamethoxazole + trimethoprim`…).
3. The best matching **official FDA label** is fetched from openFDA (free) and cached in MongoDB for 60 days (`DRUG_INFO_TTL_DAYS`), avoiding a refetch on each scan.
4. Claude selects relevant excerpts from the official label (`ANTHROPIC_API_KEY`); it is not allowed to create consumer-facing paraphrases.
5. **Server-side guardrails**: each generated field must be a verbatim excerpt in its matching label section; unsupported nonnumeric claims and unsupported numbers are both dropped. Dosage text and its `quote` must be the same excerpt. Nothing is ever calculated: no weight-based dose maths.
6. Follow-up answers are exact excerpts from the stored label or a non-confirming fallback. Deterministic emergency wording—including a child ingesting adult medicine—skips the AI and returns "Call 112 or go to the nearest hospital now".
7. Without an Anthropic key, or if the AI call fails or produces no valid excerpt, the endpoint still returns the real label text (`generatedBy: "label-extract"`, `structured: false`), so the feature degrades instead of breaking.

**Why not let the AI answer from its own knowledge?** For dosing, unsupported statements can endanger a child even when they contain no numbers. The server therefore exposes only text that can be found in the appropriate label section; each answer also links to its source.

**Limits you should know**

- The source is **US FDA labelling**. It is the best free, structured, official source, but Nigerian (NAFDAC-registered) leaflets can differ in strengths, indications and wording. Every response carries a disclaimer saying the pack leaflet wins.
  Drugs that are mostly Nigerian-only (local brands, herbal products) will return `available: false`.
- Many OTC labels give child dosing as an age/weight table; verified excerpts may be partial, so the app should always show the full label excerpt and the `children.notice`.
- Veterinary products are not covered (`VETERINARY_NOT_SUPPORTED`).
- **Human review is explicit.** The admin endpoints list every cached drug (unreviewed first). Saving a human correction resets its review state; consumers see it only after a separate review action. Refreshing/regenerating label content preserves corrections but resets review until they are checked against the new source. Legacy cached AI paraphrases are filtered through the same exact-excerpt guard before any consumer response.
- Costs: one Claude call per *new* drug, plus one small call per question. Public question limits default to 6/minute and 40/day per IP, and an ALL-scope admin can change both limits in the global AI settings. Model names are also configurable there; provider credentials remain in host secrets.
- Language is English only for now.

## Behaviour you should know about (decisions I made)

1. **Section-gated categories use *verified* sections.** The sign-up screen says locked categories stay locked "until PCN
   confirms them", so ticking "Controlled Drugs" at sign-up does **not** unlock it; an admin must confirm it via
   `PATCH /api/admin/professionals/:id/verification`. Set `REQUIRE_SECTION_VERIFICATION=false` to unlock on self-declaration instead.
2. **Expired drugs can't be sold or listed** (`409 EXPIRED_BATCH`); they can only be disposed of. The app's Expiry screen
   currently shows "Mark Sold" on expired batches — hide that button for `status === "expired"`.
3. **Revoked professionals** can log in and read, but every write returns `403`, and their batches stop verifying for consumers.
4. **Consumer "verified" means "recorded by an active, registered professional"** — it is not laboratory authentication.
   A barcode is the same on every genuine pack, so a counterfeit pack copying a real code would match. The API flags one
   red flag it *can* detect (`inconsistentRecords`: same code registered with different expiry dates). Treat the result as
   one signal alongside the pack seal check.
5. **Expiry notifications**: a daily job (06:00 Africa/Lagos, `CRON_SCHEDULE`) creates one notification per batch per kind
   (idempotent) and sends an Expo push if the app registered a token via `PUT /api/me/push-token`. You can also run
   `npm run scan:expiry` or call it from an external scheduler (set `ENABLE_CRON=false` if you run several instances).
6. **Marketplace buy** moves stock atomically (seller's batch → buyer's inventory, merging by batch code) so concurrent buyers can't oversell.
   It does not use multi-document transactions (those need a replica set); a failed step is rolled back.
7. **Sales level** = revenue over the last 30 days: ≥ ₦8,000 high, ≥ ₦3,000 medium, else low (`SALES_LEVEL_*` env vars). This reproduces the demo tiers.
8. Passwords are bcrypt-hashed; JWTs last 7 days (`JWT_EXPIRES_IN`) and are invalidated on password change/reset. There are no refresh tokens yet.

## Not done / needs your input

- **Password-reset codes are not delivered** — `forgot-password` generates the code but you need an SMS/email provider
  (Termii, Twilio, SendGrid…) at the `TODO` in `src/controllers/auth.controller.js`. In development the code is returned as `devCode` and logged.
- **No PCN/VCN license lookup** — license numbers are stored and reviewed manually by admins. If the councils expose an API/register, plug it in at registration.
- **No image/file uploads** (e.g. license document scans).
- **Real barcode scanning, payments & payouts** (Profile menu) are out of scope here.

## Connecting the Expo app

- Base URL: a physical phone can't reach `localhost` — use your computer's LAN IP, e.g. `http://192.168.1.20:4000/api`
  (Android emulator: `http://10.0.2.2:4000/api`). Use HTTPS in production.
- Store the JWT with `expo-secure-store` and send `Authorization: Bearer <token>`.
- Replace each `mockData` import with a `fetch` to the matching endpoint above; response shapes were kept close to the mock objects
  (`id`, `drugName`, `batchCode`, `manufactureDate`, `expiryDate`, `quantity`, `unitPrice`, `status`, `daysToExpiry`, `category`;
  dashboard `salesLevels[{drugName, level, unitsSold, revenue}]`; marketplace `postedAgo`, `seller.name`).

## Project layout

```
src/
  app.js, server.js
  config/        env.js, db.js
  constants/     professions.js (sections, categories, states), permissions.js
  models/        User, Batch, SaleRecord, Listing, MarketplaceOrder, Notification, Report, DrugCheck, DrugInfo, AISettings, AIInteraction, AdminInvariant
  routes/        auth, me, professional (dashboard/batches/sales/marketplace), public, admin, meta
  controllers/   one per route group, including expanded admin operations and AI oversight
  middleware/    auth (JWT, roles, active check), validate (zod), rateLimit, errorHandler
  services/      serializers, sales, notify (Expo push), drugInfo, aiSettings, adminDeletion, adminInvariant
  jobs/          expiryScan.js (daily cron)
scripts/         seed-admin, seed-demo, run-expiry-scan
test/            unit, http (no DB), integration (needs MongoDB)
```
