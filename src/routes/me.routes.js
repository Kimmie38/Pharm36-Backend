const router = require('express').Router();
const validate = require('../middleware/validate');
const { authenticate, requireRole, requireActive } = require('../middleware/auth');
const c = require('../controllers/me.controller');
const { z, objectId, phone, email, password, state, reminder, pagination } = require('../utils/schemas');

const update = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  storeName: z.string().trim().max(120).optional(),
  phone: phone.optional(),
  email: email.optional(),
  location: z.string().trim().min(3).max(200).optional(),
  state: state.optional(),
  licenseNo: z.string().trim().max(60).optional(),
  sections: z.array(z.string()).optional(),
  settings: z.object({ defaultReminder: reminder.optional(), pushEnabled: z.boolean().optional() }).optional(),
});
const changePw = z.object({ currentPassword: z.string().min(1), newPassword: password });
const pushToken = z.object({ token: z.string().min(10).max(200) });
const notifList = z.object({ unread: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'), ...pagination });

router.use(authenticate);
router.get('/', c.getMe);
router.patch('/', requireActive, validate({ body: update }), c.updateMe);
router.post('/change-password', requireActive, validate({ body: changePw }), c.changePassword);
router.put('/push-token', requireActive, validate({ body: pushToken }), c.setPushToken);

router.get('/notifications', requireRole('professional'), validate({ query: notifList }), c.listNotifications);
router.post('/notifications/read-all', requireRole('professional'), requireActive, c.markAllRead);
router.patch('/notifications/:id/read', requireRole('professional'), requireActive, validate({ params: z.object({ id: objectId }) }), c.markRead);

module.exports = router;
