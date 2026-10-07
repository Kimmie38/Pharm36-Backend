// Consumer ("Buyer") app — no login required.
const router = require('express').Router();
const validate = require('../middleware/validate');
const limits = require('../middleware/rateLimit');
const c = require('../controllers/public.controller');
const { z } = require('../utils/schemas');

const verifyQ = z.object({ batchCode: z.string().trim().min(3).max(64) });
const searchQ = z.object({ q: z.string().trim().min(2).max(100), limit: z.coerce.number().int().min(1).max(25).default(10) });
const reportBody = z.object({
  batchCode: z.string().trim().max(64).optional(),
  drugName: z.string().trim().max(150).optional(),
  reason: z.enum(['suspected_fake', 'expired', 'damaged_seal', 'wrong_info', 'unregistered_seller', 'other']).default('other'),
  description: z.string().trim().max(2000).optional(),
  sellerInfo: z.string().trim().max(300).optional(),
  location: z.string().trim().max(200).optional(),
  contact: z.string().trim().max(120).optional(),
}).refine((d) => d.batchCode || d.drugName, { message: 'Provide a batch code or a drug name', path: ['batchCode'] });

router.get('/drugs/verify', limits.publicLookup, validate({ query: verifyQ }), c.verify);
router.get('/drugs/search', limits.publicLookup, validate({ query: searchQ }), c.search);
router.post('/reports', limits.publicReport, validate({ body: reportBody }), c.report);

module.exports = router;
