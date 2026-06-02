import { jest } from '@jest/globals';

const mockStripeCheckoutCreate = jest.fn();

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
    stripe: {
        checkout: {
            sessions: {
                create: mockStripeCheckoutCreate,
            },
        },
    },
}));

const { prisma } = await import('../../src/config/prisma.js');
const { orderService } =
    await import('../../src/modules/orders/order.service.js');

describe('Coupon checkout workflow', () => {
    let customer;
    let vendor;
    let product;
    let cart;

    beforeEach(async () => {
        jest.clearAllMocks();

        mockStripeCheckoutCreate.mockResolvedValue({
            id: 'cs_coupon_test',
            url: 'https://checkout.stripe.com/coupon-test',
        });

        await prisma.couponUsage.deleteMany();
        await prisma.coupon.deleteMany();
        await prisma.auditLog.deleteMany();
        await prisma.orderStatusHistory.deleteMany();
        await prisma.inventoryReservation.deleteMany();
        await prisma.orderItem.deleteMany();
        await prisma.order.deleteMany();
        await prisma.cartItem.deleteMany();
        await prisma.cart.deleteMany();
        await prisma.product.deleteMany();
        await prisma.category.deleteMany();
        await prisma.vendor.deleteMany();
        await prisma.user.deleteMany();

        customer = await prisma.user.create({
            data: {
                fullName: 'Coupon Customer',
                email: 'coupon-checkout@test.com',
                password: 'hashed-password',
                role: 'CUSTOMER',
            },
        });

        const vendorUser = await prisma.user.create({
            data: {
                fullName: 'Coupon Vendor',
                email: 'coupon-vendor@test.com',
                password: 'hashed-password',
                role: 'VENDOR',
            },
        });

        vendor = await prisma.vendor.create({
            data: {
                userId: vendorUser.id,
                storeName: 'Coupon Store',
                status: 'APPROVED',
            },
        });

        const category = await prisma.category.create({
            data: {
                name: 'Coupon Category',
                slug: 'coupon-category',
            },
        });

        product = await prisma.product.create({
            data: {
                vendorId: vendor.id,
                categoryId: category.id,
                name: 'Coupon Product',
                slug: 'coupon-product',
                price: 100,
                stock: 10,
                status: 'ACTIVE',
            },
        });

        cart = await prisma.cart.create({
            data: {
                userId: customer.id,
            },
        });

        await prisma.cartItem.create({
            data: {
                cartId: cart.id,
                productId: product.id,
                quantity: 2,
            },
        });
    });

    it('applies percentage coupon during checkout', async () => {
        const coupon = await prisma.coupon.create({
            data: {
                code: 'SAVE10',
                type: 'PERCENTAGE',
                value: 10,
                status: 'ACTIVE',
                usageLimit: 10,
                perUserLimit: 1,
            },
        });

        const result = await orderService.checkout(customer, {
            couponCode: 'SAVE10',
        });

        expect(result.subtotalAmount).toBe(200);
        expect(result.discountAmount).toBe(20);
        expect(result.totalAmount).toBe(180);
        expect(result.couponCode).toBe('SAVE10');

        const order = await prisma.order.findUnique({
            where: {
                id: result.orderId,
            },
        });

        expect(Number(order.subtotalAmount)).toBe(200);
        expect(Number(order.discountAmount)).toBe(20);
        expect(Number(order.totalAmount)).toBe(180);
        expect(order.couponCode).toBe('SAVE10');

        const usage = await prisma.couponUsage.findFirst({
            where: {
                couponId: coupon.id,
                orderId: order.id,
                userId: customer.id,
            },
        });

        expect(usage).toBeTruthy();
        expect(Number(usage.discountAmount)).toBe(20);

        const updatedCoupon = await prisma.coupon.findUnique({
            where: {
                id: coupon.id,
            },
        });

        expect(updatedCoupon.usedCount).toBe(1);
    });

    it('applies fixed coupon without exceeding subtotal', async () => {
        await prisma.coupon.create({
            data: {
                code: 'BIGSAVE',
                type: 'FIXED',
                value: 500,
                status: 'ACTIVE',
            },
        });

        const result = await orderService.checkout(customer, {
            couponCode: 'BIGSAVE',
        });

        expect(result.subtotalAmount).toBe(200);
        expect(result.discountAmount).toBe(200);
        expect(result.totalAmount).toBe(0);
    });

    it('rejects expired coupon', async () => {
        await prisma.coupon.create({
            data: {
                code: 'OLD10',
                type: 'PERCENTAGE',
                value: 10,
                status: 'ACTIVE',
                expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
        });

        await expect(
            orderService.checkout(customer, {
                couponCode: 'OLD10',
            }),
        ).rejects.toThrow('Coupon has expired.');
    });

    it('rejects inactive coupon', async () => {
        await prisma.coupon.create({
            data: {
                code: 'INACTIVE10',
                type: 'PERCENTAGE',
                value: 10,
                status: 'INACTIVE',
            },
        });

        await expect(
            orderService.checkout(customer, {
                couponCode: 'INACTIVE10',
            }),
        ).rejects.toThrow('Coupon is not active.');
    });

    it('rejects coupon when usage limit is reached', async () => {
        await prisma.coupon.create({
            data: {
                code: 'LIMIT10',
                type: 'PERCENTAGE',
                value: 10,
                status: 'ACTIVE',
                usageLimit: 1,
                usedCount: 1,
            },
        });

        await expect(
            orderService.checkout(customer, {
                couponCode: 'LIMIT10',
            }),
        ).rejects.toThrow('Coupon usage limit reached.');
    });

    it('rejects coupon when per-user limit is reached', async () => {
        const coupon = await prisma.coupon.create({
            data: {
                code: 'ONCE10',
                type: 'PERCENTAGE',
                value: 10,
                status: 'ACTIVE',
                perUserLimit: 1,
            },
        });

        const existingOrder = await prisma.order.create({
            data: {
                userId: customer.id,
                subtotalAmount: 100,
                discountAmount: 10,
                totalAmount: 90,
                status: 'CONFIRMED',
                paymentStatus: 'PAID',
            },
        });

        await prisma.couponUsage.create({
            data: {
                couponId: coupon.id,
                userId: customer.id,
                orderId: existingOrder.id,
                discountAmount: 10,
            },
        });

        await expect(
            orderService.checkout(customer, {
                couponCode: 'ONCE10',
            }),
        ).rejects.toThrow(
            'You have already used this coupon the maximum allowed number of times.',
        );
    });

    it('rejects vendor-specific coupon when cart has no product from that vendor', async () => {
        const otherVendorUser = await prisma.user.create({
            data: {
                fullName: 'Other Vendor',
                email: 'other-vendor@test.com',
                password: 'hashed-password',
                role: 'VENDOR',
            },
        });

        const otherVendor = await prisma.vendor.create({
            data: {
                userId: otherVendorUser.id,
                storeName: 'Other Store',
                status: 'APPROVED',
            },
        });

        await prisma.coupon.create({
            data: {
                code: 'VENDOR10',
                type: 'PERCENTAGE',
                value: 10,
                status: 'ACTIVE',
                vendorId: otherVendor.id,
            },
        });

        await expect(
            orderService.checkout(customer, {
                couponCode: 'VENDOR10',
            }),
        ).rejects.toThrow('Coupon is not valid for products in this cart.');
    });
});
