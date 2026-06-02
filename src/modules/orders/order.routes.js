import express from 'express';

import { orderController } from './order.controller.js';
import { protect } from '../../middlewares/authMiddleware.js';
import { authorizeRoles } from '../../middlewares/roleMiddleware.js';
import { checkoutRateLimiter } from '../../middlewares/rateLimiter.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { orderIdParamSchema } from './order.validation.js';

import { checkoutSchema } from './order.validation.js';

const router = express.Router();

router.use(protect);

router.post(
    '/checkout',
    checkoutRateLimiter,
    authorizeRoles('CUSTOMER'),
    validateRequest(checkoutSchema),
    orderController.checkout,
);

router.get(
    '/my-orders',
    authorizeRoles('CUSTOMER'),
    orderController.getMyOrders,
);

router.get(
    '/vendor-orders',
    authorizeRoles('VENDOR'),
    orderController.getVendorOrders,
);

router.get('/:orderId', orderController.getOrderById);

router.patch(
    '/:orderId/cancel',
    authorizeRoles('CUSTOMER'),
    validateRequest(orderIdParamSchema),
    orderController.cancelOrder,
);

router.get(
    '/:orderId/status-history',
    validateRequest(orderIdParamSchema),
    orderController.getOrderStatusHistory,
);

export default router;
