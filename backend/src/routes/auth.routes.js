import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', auth.register);
router.post('/login', auth.login);
router.post('/admin/login', auth.adminLogin);
router.get('/me', optionalAuth, auth.me);

export default router;
