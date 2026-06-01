import express from 'express';

import { protect } from '../../middlewares/authMiddleware.js';
import { authorizeRoles } from '../../middlewares/roleMiddleware.js';
import { validateRequest } from '../../middlewares/validateRequest.js';

import { auditController } from './audit.controller.js';

import {
    getAuditLogsSchema,
    auditLogIdParamSchema,
} from './audit.validation.js';

const router = express.Router();

router.use(protect);
router.use(authorizeRoles('ADMIN'));

router.get(
    '/',
    validateRequest(getAuditLogsSchema),
    auditController.getAuditLogs,
);

router.get(
    '/:auditLogId',
    validateRequest(auditLogIdParamSchema),
    auditController.getAuditLogById,
);

export default router;
