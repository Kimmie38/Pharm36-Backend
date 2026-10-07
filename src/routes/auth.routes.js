const router = require('express').Router();
const validate = require('../middleware/validate');
const limits = require('../middleware/rateLimit');
const c = require('../controllers/auth.controller');
const { z, phone, email, password, state } = require('../utils/schemas');

const register = z.object({
  professionalType: z.enum(['pharmacist', 'veterinary']).default('pharmacist'),
  name: z.string().trim().min(2, 'Enter your full name').max(100),
  phone,
  email,
  location: z.string().trim().min(3, 'Enter your store/practice address').max(200),
  state,
  storeName: z.string().trim().max(120).optional(),
  licenseNo: z.string().trim().max(60).optional(),
  sections: z.array(z.string()).default([]),
  password,
  confirmPassword: z.string().optional(),
}).refine((d) => d.confirmPassword === undefined || d.confirmPassword === d.password, {
  message: 'Passwords do not match', path: ['confirmPassword'],
});

const login = z.object({ identifier: z.string().trim().min(3), password: z.string().min(1) });
const forgot = z.object({ identifier: z.string().trim().min(3) });
const reset = z.object({ identifier: z.string().trim().min(3), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'), password });

router.use(limits.auth);
router.post('/register', validate({ body: register }), c.register);
router.post('/login', validate({ body: login }), c.login);
router.post('/forgot-password', validate({ body: forgot }), c.forgotPassword);
router.post('/reset-password', validate({ body: reset }), c.resetPassword);

module.exports = router;
