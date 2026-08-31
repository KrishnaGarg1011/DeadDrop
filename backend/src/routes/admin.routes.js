import { Router } from 'express';
import * as admin from '../controllers/admin.controller.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

// Admin-only; every route requires a valid admin JWT.
router.use(requireAdmin);

router.get('/stats', admin.stats);
router.get('/packages', admin.packages);
router.get('/packages/:id', admin.packageDetail);
router.post('/packages/:token/revoke', admin.revoke);
router.get('/users', admin.users);
router.get('/failed-attempts', admin.failedAttempts);
router.get('/audit-logs', admin.auditLogs);

export default router;
