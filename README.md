# Pharm36 Backend

Node.js + Express 5 + MongoDB (Mongoose) REST API for the Pharm36 mobile app (Pharmacist app, Buyer app) and the
future PCN/VCN admin portal. Every endpoint is derived from what the screens in the Expo app currently fake with
`src/data/mockData.js`.

## Quick start

```bash
cd pharm36-backend
npm install
cp .env.example .env            # or .env.local; .env.local takes precedence when both exist
# Set JWT_SECRET to a unique random value and configure MONGODB_URI
docker compose up -d            # optional: local MongoDB   (or use a MongoDB Atlas URI)
npm run seed:demo               # optional: the same demo data the app shows today
npm run seed:admin              # optional: council admin account from ADMIN_* in .env
npm run dev                     # http://localhost:4000/health
npm test                        # unit + HTTP tests (no DB needed)
MONGODB_TEST_URI=mongodb://127.0.0.1:27017/pharm36_test npm test    # + full end-to-end suite
```

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
| Admin portal | `GET /api/admin/stats`, `GET /api/admin/professionals`, `PATCH /api/admin/professionals/:id/verification`, `GET /api/admin/professionals/:id/batches`, `GET`/`PATCH /api/admin/reports` |

Errors are always `{ "error": "message", "details"?: ... }`. Validation errors list `details: [{field, message}]`;
restricted categories return `403` with `details.code = "CATEGORY_RESTRICTED"`.

Add-batch body (matches the form; numbers may be strings):
```json
{ "drugName": "Amoxicillin 500mg", "category": "prescription", "batchCode": "5012345678901",
  "manufactureDate": "2025-02-10", "expiryDate": "2026-10-05", "price": "85", "quantity": "240", "reminder": "3 months",
  "manufacturer": "Emzor Pharmaceuticals", "strength": "500mg", "form": "Capsule" }
```
`manufacturer`, `strength`, `form` are optional but are what the Buyer's drug-details screen displays, so consider
adding those fields to the Add Batch form.

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
  models/        User, Batch, SaleRecord, Listing, MarketplaceOrder, Notification, Report, DrugCheck
  routes/        auth, me, professional (dashboard/batches/sales/marketplace), public, admin, meta
  controllers/   one per route group
  middleware/    auth (JWT, roles, active check), validate (zod), rateLimit, errorHandler
  services/      serializers, sales, notify (Expo push)
  jobs/          expiryScan.js (daily cron)
scripts/         seed-admin, seed-demo, run-expiry-scan
test/            unit, http (no DB), integration (needs MongoDB)
```
