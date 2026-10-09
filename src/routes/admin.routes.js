// Backend for the future PCN / VCN admin web portal.
const router = require('express').Router();
const validate = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/admin.controller');
const dc = require('../controllers/adminDrugInfo.controller');
const { z, objectId, state, pagination } = require('../utils/schemas');

router.use(authenticate, requireRole('admin'));
const idParam = z.object({ id: objectId });

const listQ = z.object({
  search: z.string().trim().max(100).optional(),
  verificationStatus: z.enum(['pending', 'verified', 'rejected']).optional(),
  pcnStatus: z.enum(['active', 'revoked']).optional(),
  state: state.optional(),
  ...pagination,
});
const verifyBody = z.object({
  verificationStatus: z.enum(['pending', 'verified', 'rejected']).optional(),
  pcnStatus: z.enum(['active', 'revoked']).optional(),
  verifiedSections: z.array(z.string()).optional(),
  licenseNo: z.string().trim().max(60).optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });
const batchesQ = z.object({ state: z.enum(['active', 'sold', 'disposed']).optional(), ...pagination });
const reportsQ = z.object({ status: z.enum(['new', 'reviewing', 'resolved', 'dismissed']).optional(), ...pagination });
const reportBody = z.object({ status: z.enum(['new', 'reviewing', 'resolved', 'dismissed']).optional(), adminNote: z.string().trim().max(2000).optional() })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

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
  search: z.string().trim().max(100).optional(),
  reviewed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  status: z.enum(['ok', 'not_found']).optional(),
  ...pagination,
});
const drugPatch = z.object({ override: overrideSchema.nullable().optional(), reviewed: z.boolean().optional() })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

router.get('/drug-info', validate({ query: drugListQ }), dc.list);
router.get('/drug-info/:id', validate({ params: idParam }), dc.getOne);
router.patch('/drug-info/:id', validate({ params: idParam, body: drugPatch }), dc.update);
router.post('/drug-info/:id/refresh', validate({ params: idParam }), dc.refresh);

router.get('/stats', c.stats);
router.get('/professionals', validate({ query: listQ }), c.listProfessionals);
router.get('/professionals/:id', validate({ params: idParam }), c.getProfessional);
router.patch('/professionals/:id/verification', validate({ params: idParam, body: verifyBody }), c.setVerification);
router.get('/professionals/:id/batches', validate({ params: idParam, query: batchesQ }), c.listProfessionalBatches);
router.get('/reports', validate({ query: reportsQ }), c.listReports);
router.patch('/reports/:id', validate({ params: idParam, body: reportBody }), c.updateReport);

module.exports = router;
