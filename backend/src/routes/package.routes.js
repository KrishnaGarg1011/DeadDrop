import { Router } from 'express';
import * as pkg from '../controllers/package.controller.js';
import { optionalAuth, requireUser } from '../middleware/auth.js';
import { unlockLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Content routes. Note: senders do NOT need an account (optional auth only).
router.post('/', optionalAuth, pkg.upload.single('file'), pkg.create);

// Sender-facing "your drops" (authenticated). Declared before /:token routes
// so '/mine' is not captured as a token.
router.get('/mine', requireUser, pkg.mine);
router.get('/mine/:token', requireUser, pkg.mineDetail);
router.post('/mine/:token/revoke', requireUser, pkg.revoke);

// Recipient-facing routes (no auth; the token is the credential).
router.get('/:token/metadata', pkg.metadata);
router.post('/:token/open', unlockLimiter, pkg.open);
router.get('/:token/download', pkg.download);

// Revoke an active package (creator, or admin via the admin route).
router.post('/:token/revoke', optionalAuth, pkg.revoke);

export default router;
