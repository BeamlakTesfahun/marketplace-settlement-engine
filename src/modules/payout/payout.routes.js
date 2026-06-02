import express from 'express';

import { protect } from '../../middlewares/authMiddleware.js';
import { authorizeRoles } from '../../middlewares/roleMiddleware.js';
import { validateRequest } from '../../middlewares/validateRequest.js';

import { payoutController } from './payout.controller.js';

import { payoutIdParamSchema, failPayoutSchema } from './payout.validation.js';

const router = express.Router();

router.use(protect);

router.get('/me', authorizeRoles('VENDOR'), payoutController.getMyPayouts);

router.get('/', authorizeRoles('ADMIN'), payoutController.getAllPayouts);

router.patch(
    '/:payoutId/pay',
    authorizeRoles('ADMIN'),
    validateRequest(payoutIdParamSchema),
    payoutController.markPayoutAsPaid,
);

router.patch(
    '/:payoutId/fail',
    authorizeRoles('ADMIN'),
    validateRequest(failPayoutSchema),
    payoutController.markPayoutAsFailed,
);

router.patch(
    '/:payoutId/retry',
    authorizeRoles('ADMIN'),
    validateRequest(payoutIdParamSchema),
    payoutController.retryFailedPayout,
);

export default router;
