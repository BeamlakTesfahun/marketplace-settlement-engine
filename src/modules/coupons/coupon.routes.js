import express from 'express';

import { protect } from '../../middlewares/authMiddleware.js';
import { authorizeRoles } from '../../middlewares/roleMiddleware.js';
import { validateRequest } from '../../middlewares/validateRequest.js';

import { couponController } from './coupon.controller.js';

import {
    createCouponSchema,
    couponIdParamSchema,
} from './coupon.validation.js';

const router = express.Router();

router.use(protect);
router.use(authorizeRoles('ADMIN'));

router.post(
    '/',
    validateRequest(createCouponSchema),
    couponController.createCoupon,
);

router.get('/', couponController.getCoupons);

router.patch(
    '/:couponId/deactivate',
    validateRequest(couponIdParamSchema),
    couponController.deactivateCoupon,
);

export default router;
