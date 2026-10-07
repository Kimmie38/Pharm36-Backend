// Everything the Pharmacist app needs: dashboard, inventory, expiry alerts, sales, marketplace.
const router = require('express').Router();
const validate = require('../middleware/validate');
const { authenticate, requireRole, requireActive } = require('../middleware/auth');
const batch = require('../controllers/batch.controller');
const dash = require('../controllers/dashboard.controller');
const market = require('../controllers/marketplace.controller');
const { z, objectId, isoDate, num, int, reminder, category, pagination } = require('../utils/schemas');

router.use(authenticate, requireRole('professional'));

const idParam = z.object({ id: objectId });
const statusEnum = z.enum(['ok', 'expiring_1m', 'expiring_2w', 'expired']);

// ---------- dashboard & sales ----------
router.get('/dashboard', dash.dashboard);
router.get('/sales', validate({ query: z.object({ days: int(1).max(365).default(30) }) }), dash.salesSummary);

// ---------- batches (Inventory / Add batch / Batch detail / Expiry alerts) ----------
const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  category: category.optional(),
  status: statusEnum.optional(),
  state: z.enum(['active', 'sold', 'disposed']).default('active'),
  ...pagination,
});
const createBatch = z.object({
  drugName: z.string().trim().min(2, 'Enter the drug name').max(150),
  category: category.default('general'),
  batchCode: z.string().trim().min(3, 'Scan or enter the batch code').max(64),
  manufacturer: z.string().trim().max(120).optional(),
  strength: z.string().trim().max(60).optional(),
  form: z.string().trim().max(60).optional(),
  manufactureDate: isoDate.optional(),
  expiryDate: isoDate,
  // the app sends price/quantity as text from TextInputs; "price" is accepted as an alias for unitPrice
  quantity: int(1),
  unitPrice: num(0).optional(),
  price: num(0).optional(),
  reminder: reminder.optional(),
}).transform(({ price, ...rest }) => ({ ...rest, unitPrice: rest.unitPrice ?? price ?? 0 }));
const patchBatch = z.object({
  drugName: z.string().trim().min(2).max(150).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  strength: z.string().trim().max(60).optional(),
  form: z.string().trim().max(60).optional(),
  quantity: int(0).optional(),
  unitPrice: num(0).optional(),
  reminder: reminder.nullable().optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });
const sellBody = z.object({ quantity: int(1).optional(), unitPrice: num(0).optional() });
const disposeBody = z.object({ reason: z.string().trim().max(200).optional() });

router.get('/batches', validate({ query: listQuery }), batch.list);
router.get('/batches/expiring', batch.expiring); // must be before /batches/:id
router.post('/batches', requireActive, validate({ body: createBatch }), batch.create);
router.get('/batches/:id', validate({ params: idParam }), batch.getOne);
router.patch('/batches/:id', requireActive, validate({ params: idParam, body: patchBatch }), batch.update);
router.post('/batches/:id/sell', requireActive, validate({ params: idParam, body: sellBody }), batch.sell);
router.post('/batches/:id/dispose', requireActive, validate({ params: idParam, body: disposeBody }), batch.dispose);

// ---------- marketplace ----------
const browseQuery = z.object({
  type: z.enum(['offer', 'request']).default('offer'),
  search: z.string().trim().max(100).optional(),
  mine: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  status: z.enum(['open', 'fulfilled', 'cancelled']).optional(),
  ...pagination,
});
const offerBody = z.object({ batchId: objectId, quantity: int(1).optional(), unitPrice: num(0).optional(), note: z.string().trim().max(500).optional() });
const requestBody = z.object({
  drugName: z.string().trim().min(2).max(150),
  quantity: int(1),
  maxUnitPrice: num(0),
  category: category.default('general'),
  note: z.string().trim().max(500).optional(),
});
const patchListing = z.object({ quantity: int(1).optional(), unitPrice: num(0).optional(), note: z.string().trim().max(500).optional() })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });
const buyBody = z.object({ quantity: int(1).optional() });
const ordersQuery = z.object({ role: z.enum(['buyer', 'seller']).default('buyer'), ...pagination });

router.get('/marketplace/listings', validate({ query: browseQuery }), market.browse);
router.post('/marketplace/listings', requireActive, validate({ body: offerBody }), market.createOffer);
router.post('/marketplace/requests', requireActive, validate({ body: requestBody }), market.createRequest);
router.patch('/marketplace/listings/:id', requireActive, validate({ params: idParam, body: patchListing }), market.updateListing);
router.delete('/marketplace/listings/:id', requireActive, validate({ params: idParam }), market.cancelListing);
router.post('/marketplace/listings/:id/buy', requireActive, validate({ params: idParam, body: buyBody }), market.buy);
router.get('/marketplace/orders', validate({ query: ordersQuery }), market.myOrders);

module.exports = router;
