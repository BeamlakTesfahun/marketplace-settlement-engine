import express from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import vendorRoutes from '../modules/vendors/vendor.routes.js';
import categoryRoutes from '../modules/categories/category.routes.js';
import productRoutes from '../modules/products/product.routes.js';
import cartRoutes from '../modules/cart/cart.routes.js';
import orderRoutes from '../modules/orders/order.routes.js';
import refundRoutes from '../modules/refunds/refund.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';

import couponRoutes from '../modules/coupons/coupon.routes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/vendors', vendorRoutes);
router.use('/categories', categoryRoutes);
router.use('/products', productRoutes);
router.use('/cart', cartRoutes);
router.use('/orders', orderRoutes);
router.use('/refunds', refundRoutes);
router.use('/audit-logs', auditRoutes);

router.use('/coupons', couponRoutes);

export default router;
