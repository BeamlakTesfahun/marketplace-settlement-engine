import { jest } from '@jest/globals';

const mockAddOrderConfirmationEmailJob = jest.fn();
const mockAddPayoutPaidEmailJob = jest.fn();

jest.unstable_mockModule('../../src/jobs/producers/email.producer.js', () => ({
    addOrderConfirmationEmailJob: mockAddOrderConfirmationEmailJob,
    addRefundRequestedEmailJob: jest.fn(),
    addRefundApprovedEmailJob: jest.fn(),
    addRefundRejectedEmailJob: jest.fn(),
    addPayoutPaidEmailJob: mockAddPayoutPaidEmailJob,
    addPayoutFailedEmailJob: jest.fn(),
}));

const { prisma } = await import('../../src/config/prisma.js');
const { processStripeEvent } =
    await import('../../src/modules/webhook/webhook.service.js');
const { orderService } = await import('../../src/modules/orders/order.service.js');
const { payoutService } = await import('../../src/modules/payouts/payout.service.js');

describe('Settlement delivery and payout release', () => {
    let customer;
    let admin;
    let vendorUser;
    let vendor;
    let order;

    beforeEach(async () => {
        jest.clearAllMocks();

        await prisma.auditLog.deleteMany();
        await prisma.vendorPayout.deleteMany();
        await prisma.webhookEvent.deleteMany();
        await prisma.orderItem.deleteMany();
        await prisma.order.deleteMany();
        await prisma.product.deleteMany();
        await prisma.category.deleteMany();
        await prisma.vendor.deleteMany();
        await prisma.user.deleteMany();

        customer = await prisma.user.create({
            data: {
                fullName: 'Delivery Customer',
                email: 'delivery-customer@test.com',
                password: 'hashed-password',
                role: 'CUSTOMER',
            },
        });

        admin = await prisma.user.create({
            data: {
                fullName: 'Delivery Admin',
                email: 'delivery-admin@test.com',
                password: 'hashed-password',
                role: 'ADMIN',
            },
        });

        vendorUser = await prisma.user.create({
            data: {
                fullName: 'Delivery Vendor',
                email: 'delivery-vendor@test.com',
                password: 'hashed-password',
                role: 'VENDOR',
            },
        });

        vendor = await prisma.vendor.create({
            data: {
                userId: vendorUser.id,
                storeName: 'Delivery Store',
                status: 'APPROVED',
            },
        });

        const category = await prisma.category.create({
            data: {
                name: 'Delivery Category',
                slug: 'delivery-category',
            },
        });

        const product = await prisma.product.create({
            data: {
                vendorId: vendor.id,
                categoryId: category.id,
                name: 'Delivery Product',
                slug: 'delivery-product',
                price: 50,
                stock: 10,
                status: 'ACTIVE',
            },
        });

        order = await prisma.order.create({
            data: {
                userId: customer.id,
                totalAmount: 100,
                status: 'PENDING',
                paymentStatus: 'PENDING',
                items: {
                    create: {
                        productId: product.id,
                        vendorId: vendor.id,
                        quantity: 2,
                        price: 50,
                    },
                },
            },
        });

        await processStripeEvent({
            id: 'evt_delivery_release_001',
            type: 'checkout.session.completed',
            data: {
                object: {
                    metadata: { orderId: order.id },
                    payment_intent: 'pi_delivery_release_001',
                },
            },
        });

        order = await prisma.order.findUnique({ where: { id: order.id } });
    });

    it('creates ON_HOLD payout when payment is confirmed', async () => {
        const payouts = await prisma.vendorPayout.findMany({
            where: { orderId: order.id },
        });

        expect(order.paymentStatus).toBe('PAID');
        expect(order.status).toBe('CONFIRMED');
        expect(payouts).toHaveLength(1);
        expect(payouts[0].status).toBe('ON_HOLD');
        expect(payouts[0].availableAt).toBeNull();
    });

    it('sets availableAt when order is marked delivered', async () => {
        const deliveredOrder = await orderService.markOrderAsDelivered(
            vendorUser,
            order.id,
        );

        const payout = await prisma.vendorPayout.findFirst({
            where: { orderId: order.id },
        });

        expect(deliveredOrder.status).toBe('DELIVERED');
        expect(deliveredOrder.deliveredAt).toBeTruthy();
        expect(payout.status).toBe('ON_HOLD');
        expect(payout.availableAt).toBeTruthy();
        expect(payout.availableAt.getTime()).toBeGreaterThan(
            deliveredOrder.deliveredAt.getTime(),
        );
    });

    it('does not release payout before availableAt', async () => {
        await orderService.markOrderAsDelivered(vendorUser, order.id);

        const released = await payoutService.releaseEligiblePayouts(new Date());

        const payout = await prisma.vendorPayout.findFirst({
            where: { orderId: order.id },
        });

        expect(released).toHaveLength(0);
        expect(payout.status).toBe('ON_HOLD');
    });

    it('releases payout to AVAILABLE after availableAt', async () => {
        await orderService.markOrderAsDelivered(vendorUser, order.id);

        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 1);

        await prisma.vendorPayout.updateMany({
            where: { orderId: order.id },
            data: { availableAt: pastDate },
        });

        const released = await payoutService.releaseEligiblePayouts(new Date());

        const payout = await prisma.vendorPayout.findFirst({
            where: { orderId: order.id },
        });

        expect(released).toHaveLength(1);
        expect(payout.status).toBe('AVAILABLE');
    });

    it('allows admin to mark AVAILABLE payout as paid', async () => {
        await orderService.markOrderAsDelivered(vendorUser, order.id);

        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 1);

        await prisma.vendorPayout.updateMany({
            where: { orderId: order.id },
            data: { availableAt: pastDate },
        });

        await payoutService.releaseEligiblePayouts(new Date());

        const payout = await prisma.vendorPayout.findFirst({
            where: { orderId: order.id },
        });

        const paidPayout = await payoutService.markPayoutAsPaid(admin, payout.id);

        expect(paidPayout.status).toBe('PAID');
        expect(paidPayout.paidAt).toBeTruthy();
        expect(mockAddPayoutPaidEmailJob).toHaveBeenCalledTimes(1);
    });
});
