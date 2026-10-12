// Backend for the Pharm36 PCN / VCN / ALL admin web portal.
const router = require('express').Router();
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/admin.controller');
const op = require('../controllers/adminOperations.controller');
const ai = require('../controllers/adminAi.controller');
const dc = require('../controllers/adminDrugInfo.controller');
const { z, objectId, isoDate, phone, email, state, reminder, category, num, int, pagination } = require('../utils/schemas');

router.use(authenticate, requireRole('admin'));
const idParam = z.object({ id: objectId });
const search = z.string().trim().max(100).optional();
const range = { from: isoDate.optional(), to: isoDate.optional() };
const rangeCheck = (q) => !q.from || !q.to || q.from <= q.to;
const nonempty = (value) => Object.keys(value).length > 0;
const confirmedDelete = z.object({ confirmation: z.literal('DELETE') }).strict();
const confirmUserDelete = z.object({ confirmIdentity: z.string().trim().min(3).max(254) }).strict();

const listQ = z.object({
  search,
  verificationStatus: z.enum(['pending', 'verified', 'rejected']).optional(),
  pcnStatus: z.enum(['active', 'revoked']).optional(),
  state: state.optional(),
  ...pagination,
});
const verifyBody = z.object({
  verificationStatus: z.enum(['pending', 'verified', 'rejected']).optional(),
  pcnStatus: z.enum(['active', 'revoked']).optional(),
  verifiedSections: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  licenseNo: z.string().trim().max(60).optional(),
}).refine(nonempty, { message: 'Nothing to update' });
const batchesQ = z.object({ state: z.enum(['active', 'sold', 'disposed']).optional(), ...pagination });
const reportsQ = z.object({ status: z.enum(['new', 'reviewing', 'resolved', 'dismissed']).optional(), search, ...pagination });
const reportBody = z.object({ status: z.enum(['new', 'reviewing', 'resolved', 'dismissed']).optional(), adminNote: z.string().trim().max(2000).optional() })
  .refine(nonempty, { message: 'Nothing to update' });

const strs = z.array(z.string().trim().min(1).max(500)).max(20);
const stmts = z.array(z.object({ text: z.string().trim().min(1).max(500), quote: z.string().trim().max(400).optional() })).max(10);
const overrideSchema = z.object({
  summary: z.string().trim().max(400),
  uses: strs,
  dosage: z.object({ adults: z.object({ statements: stmts }), children: z.object({ statements: stmts }), otherNotes: strs }).partial(),
  sideEffects: z.object({ common: strs, serious: strs }).partial(),
  whenToSeekHelp: strs, doNotUseIf: strs, warnings: strs, interactions: strs, pregnancyBreastfeeding: strs, overdose: strs, storage: strs,
}).partial().strict();
const drugListQ = z.object({
  search,
  reviewed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  status: z.enum(['ok', 'not_found']).optional(),
  ...pagination,
});
const drugPatch = z.object({ override: overrideSchema.nullable().optional(), reviewed: z.boolean().optional() })
  .refine(nonempty, { message: 'Nothing to update' });

const usersQ = z.object({
  search,
  role: z.enum(['professional', 'admin']).optional(),
  professionalType: z.enum(['pharmacist', 'veterinary']).optional(),
  verificationStatus: z.enum(['pending', 'verified', 'rejected']).optional(),
  pcnStatus: z.enum(['active', 'revoked']).optional(),
  state: state.optional(),
  ...pagination,
});
const userPatch = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: email.optional(), phone: phone.optional(),
  storeName: z.string().trim().max(120).optional(),
  location: z.string().trim().max(200).optional(),
  state: state.optional(), licenseNo: z.string().trim().max(60).optional(),
  sections: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  verifiedSections: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  verificationStatus: z.enum(['pending', 'verified', 'rejected']).optional(),
  pcnStatus: z.enum(['active', 'revoked']).optional(),
  council: z.enum(['PCN', 'VCN', 'ALL']).optional(),
}).strict().refine(nonempty, { message: 'Nothing to update' });

const inventoryQ = z.object({ search, state: z.enum(['active', 'sold', 'disposed']).optional(), category: category.optional(), ...pagination });
const inventoryPatch = z.object({
  drugName: z.string().trim().min(1).max(150).optional(), category: category.optional(), batchCode: z.string().trim().min(1).max(100).optional(),
  manufacturer: z.string().trim().max(150).optional(), strength: z.string().trim().max(100).optional(), form: z.string().trim().max(100).optional(),
  manufactureDate: isoDate.nullable().optional(), expiryDate: isoDate.optional(), quantity: int(0).optional(), unitPrice: num(0).optional(),
  reminder: reminder.nullable().optional(), state: z.enum(['active', 'sold', 'disposed']).optional(), disposalReason: z.string().trim().max(300).optional(),
}).strict().refine(nonempty, { message: 'Nothing to update' });
const listingsQ = z.object({ search, type: z.enum(['offer', 'request']).optional(), status: z.enum(['open', 'fulfilled', 'cancelled']).optional(), ...pagination });
const listingPatch = z.object({
  status: z.enum(['open', 'fulfilled', 'cancelled']).optional(), quantity: int(0).optional(), unitPrice: num(0).optional(), note: z.string().trim().max(500).optional(),
}).strict().refine(nonempty, { message: 'Nothing to update' });
const salesQ = z.object({ search, channel: z.enum(['direct', 'marketplace']).optional(), ...range, ...pagination }).refine(rangeCheck, { message: 'from must be on or before to' });
const ordersQ = z.object({ search, ...range, ...pagination }).refine(rangeCheck, { message: 'from must be on or before to' });
const scansQ = z.object({
  search, kind: z.enum(['scan', 'search']).optional(), found: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  ...range, ...pagination,
}).refine(rangeCheck, { message: 'from must be on or before to' });
const aiHistoryQ = z.object({
  search, status: z.enum(['answered', 'emergency', 'ungrounded', 'unavailable']).optional(), ...range, ...pagination,
}).refine(rangeCheck, { message: 'from must be on or before to' });
const aiSettingsPatch = z.object({
  enabled: z.boolean().optional(),
  summaryModel: z.string().trim().regex(/^[a-zA-Z0-9_.:-]{1,120}$/).optional(),
  askModel: z.string().trim().regex(/^[a-zA-Z0-9_.:-]{1,120}$/).optional(),
  askPerMinute: z.number().int().min(1).max(60).optional(),
  askPerDay: z.number().int().min(1).max(1000).optional(),
}).strict().refine(nonempty, { message: 'Nothing to update' });

router.get('/drug-info', validate({ query: drugListQ }), dc.list);
router.get('/drug-info/:id', validate({ params: idParam }), dc.getOne);
router.patch('/drug-info/:id', validate({ params: idParam, body: drugPatch }), dc.update);
router.post('/drug-info/:id/refresh', validate({ params: idParam }), dc.refresh);
router.delete('/drug-info/:id', validate({ params: idParam, body: confirmedDelete }), op.deleteDrugInfo);

router.get('/ai-history', validate({ query: aiHistoryQ }), ai.listHistory);
router.delete('/ai-history/:id', validate({ params: idParam, body: confirmedDelete }), ai.deleteHistory);
router.get('/ai-settings', ai.getSettings);
router.patch('/ai-settings', validate({ body: aiSettingsPatch }), ai.patchSettings);

router.get('/stats', c.stats);
router.get('/users', validate({ query: usersQ }), op.listUsers);
router.get('/users/:id/delete-preview', validate({ params: idParam }), op.previewUserDelete);
router.get('/users/:id', validate({ params: idParam }), op.getUser);
router.patch('/users/:id', validate({ params: idParam, body: userPatch }), op.updateUser);
router.post('/users/:id/revoke-sessions', validate({ params: idParam }), op.revokeSessions);
router.delete('/users/:id', validate({ params: idParam, body: confirmUserDelete }), op.deleteUser);

router.get('/inventory', validate({ query: inventoryQ }), op.listInventory);
router.patch('/inventory/:id', validate({ params: idParam, body: inventoryPatch }), op.updateInventory);
router.delete('/inventory/:id', validate({ params: idParam, body: confirmedDelete }), op.deleteInventory);
router.get('/listings', validate({ query: listingsQ }), op.listListings);
router.patch('/listings/:id', validate({ params: idParam, body: listingPatch }), op.updateListing);
router.delete('/listings/:id', validate({ params: idParam, body: confirmedDelete }), op.deleteListing);
router.get('/sales', validate({ query: salesQ }), op.listSales);
router.delete('/sales/:id', validate({ params: idParam, body: confirmedDelete }), op.deleteSale);
router.get('/orders', validate({ query: ordersQ }), op.listOrders);
router.delete('/orders/:id', validate({ params: idParam, body: confirmedDelete }), op.deleteOrder);
router.get('/scans', validate({ query: scansQ }), op.listScans);
router.delete('/scans/:id', validate({ params: idParam, body: confirmedDelete }), op.deleteScan);

router.get('/professionals', validate({ query: listQ }), c.listProfessionals);
router.get('/professionals/:id', validate({ params: idParam }), c.getProfessional);
router.patch('/professionals/:id/verification', validate({ params: idParam, body: verifyBody }), c.setVerification);
router.get('/professionals/:id/batches', validate({ params: idParam, query: batchesQ }), c.listProfessionalBatches);
router.get('/reports', validate({ query: reportsQ }), c.listReports);
router.patch('/reports/:id', validate({ params: idParam, body: reportBody }), c.updateReport);
router.delete('/reports/:id', validate({ params: idParam, body: confirmedDelete }), op.deleteReport);

module.exports = router;
