import express from 'express';

import { protect } from '../../middlewares/authMiddleware.js';
import { authorizeRoles } from '../../middlewares/roleMiddleware.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { disputeController } from './dispute.controller.js';
import {
    openDisputeSchema,
    respondToDisputeSchema,
} from './dispute.validation.js';

const router = express.Router();

router.use(protect);

router.post(
    '/:orderId/open',
    authorizeRoles('CUSTOMER'),
    validateRequest(openDisputeSchema),
    disputeController.openDispute,
);

router.patch(
    '/:orderId/respond',
    authorizeRoles('VENDOR'),
    validateRequest(respondToDisputeSchema),
    disputeController.respondToDispute,
);

export default router;
