import { Router } from 'express';
import * as pkg from '../controllers/package.controller.js';
import { optionalAuth } from '../middleware/auth.js';
import { unlockLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Content routes. Note: senders do NOT need an account (optional auth only).
router.post('/', optionalAuth, pkg.upload.single('file'), pkg.create);

// Recipient-facing routes (no auth; the token is the credential).
router.get('/:token/metadata', pkg.metadata);
router.post('/:token/open', unlockLimiter, pkg.open);
router.get('/:token/download', pkg.download);

// Revoke an active package (creator, or admin via the admin route).
router.post('/:token/revoke', optionalAuth, pkg.revoke);

export default router;
