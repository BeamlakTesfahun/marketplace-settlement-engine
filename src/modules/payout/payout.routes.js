import express from 'express';

import { protect } from '../../middlewares/authMiddleware.js';
import { authorizeRoles } from '../../middlewares/roleMiddleware.js';

import { payoutController } from './payout.controller.js';

const router = express.Router();

router.use(protect);
router.use(authorizeRoles('VENDOR'));

router.get('/me', payoutController.getMyPayouts);

export default router;
