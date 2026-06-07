import { jest } from '@jest/globals';

const mockStripeRefundCreate = jest.fn();
const mockAddRefundRequestedEmailJob = jest.fn();
const mockAddRefundApprovedEmailJob = jest.fn();
const mockAddRefundRejectedEmailJob = jest.fn();

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
    stripe: {
        refunds: {
            create: mockStripeRefundCreate,
        },
    },
}));

jest.unstable_mockModule('../../src/jobs/producers/email.producer.js', () => ({
    addOrderConfirmationEmailJob: jest.fn(),
    addRefundRequestedEmailJob: mockAddRefundRequestedEmailJob,
    addRefundApprovedEmailJob: mockAddRefundApprovedEmailJob,
    addRefundRejectedEmailJob: mockAddRefundRejectedEmailJob,
    addPayoutPaidEmailJob: jest.fn(),
    addPayoutFailedEmailJob: jest.fn(),
    addPayoutReversalEmailJob: jest.fn(),
    addDisputeOpenedEmailJob: jest.fn(),
    addDisputeVendorRespondedEmailJob: jest.fn(),
    addDisputeResolvedEmailJob: jest.fn(),
}));

const { prisma } = await import('../../src/config/prisma.js');
const { refundService } =
    await import('../../src/modules/refunds/refund.service.js');

describe('Refund workflow', () => {
    let customer;
    let admin;
    let vendor;
    let product;
    let order;

    beforeEach(async () => {
        jest.clearAllMocks();

        mockStripeRefundCreate.mockResolvedValue({
            id: 're_test_001',
        });

        await prisma.webhookEvent.deleteMany();
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
                fullName: 'Refund Customer',
                email: 'refund-customer@test.com',
                password: 'hashed-password',
                role: 'CUSTOMER',
            },
        });

        admin = await prisma.user.create({
            data: {
                fullName: 'Refund Admin',
                email: 'refund-admin@test.com',
                password: 'hashed-password',
                role: 'ADMIN',
            },
        });

        const vendorUser = await prisma.user.create({
            data: {
                fullName: 'Refund Vendor',
                email: 'refund-vendor@test.com',
                password: 'hashed-password',
                role: 'VENDOR',
            },
        });

        vendor = await prisma.vendor.create({
            data: {
                userId: vendorUser.id,
                storeName: 'Refund Store',
                status: 'APPROVED',
            },
        });

        const category = await prisma.category.create({
            data: {
                name: 'Refund Category',
                slug: 'refund-category',
            },
        });

        product = await prisma.product.create({
            data: {
                vendorId: vendor.id,
                categoryId: category.id,
                name: 'Refund Product',
                slug: 'refund-product',
                price: 50,
                stock: 5,
                status: 'ACTIVE',
            },
        });

        order = await prisma.order.create({
            data: {
                userId: customer.id,
                totalAmount: 100,
                status: 'CONFIRMED',
                paymentStatus: 'PAID',
                stripePaymentIntentId: 'pi_refund_test_001',
                paidAt: new Date(),
                items: {
                    create: {
                        productId: product.id,
                        vendorId: vendor.id,
                        quantity: 2,
                        price: 50,
                    },
                },
            },
            include: {
                items: true,
            },
        });
    });

    it('allows a customer to request a refund and queues a refund requested email', async () => {
        const result = await refundService.requestRefund(customer, order.id, {
            reason: 'CUSTOMER_REQUEST',
        });

        expect(result.refundStatus).toBe('REQUESTED');
        expect(result.refundReason).toBe('CUSTOMER_REQUEST');
        expect(result.refundRequestedAt).toBeTruthy();
        expect(result.refundRequestedById).toBe(customer.id);

        expect(mockAddRefundRequestedEmailJob).toHaveBeenCalledTimes(1);
        expect(mockAddRefundRequestedEmailJob).toHaveBeenCalledWith({
            to: customer.email,
            customerName: customer.fullName,
            orderId: order.id,
            reason: 'CUSTOMER_REQUEST',
            totalAmount: 100,
        });
    });

    it('prevents duplicate refund requests for the same order', async () => {
        await refundService.requestRefund(customer, order.id, {
            reason: 'CUSTOMER_REQUEST',
        });

        await expect(
            refundService.requestRefund(customer, order.id, {
                reason: 'CUSTOMER_REQUEST',
            }),
        ).rejects.toThrow(
            'Refund has already been requested or processed for this order.',
        );

        expect(mockAddRefundRequestedEmailJob).toHaveBeenCalledTimes(1);
    });

    it('approves refund, calls Stripe, restores stock, and queues approval email', async () => {
        await refundService.requestRefund(customer, order.id, {
            reason: 'CUSTOMER_REQUEST',
        });

        const result = await refundService.approveRefund(admin, order.id);

        expect(mockStripeRefundCreate).toHaveBeenCalledTimes(1);
        expect(mockStripeRefundCreate).toHaveBeenCalledWith({
            payment_intent: 'pi_refund_test_001',
        });

        expect(result.status).toBe('CANCELLED');
        expect(result.paymentStatus).toBe('REFUNDED');
        expect(result.refundStatus).toBe('REFUNDED');
        expect(result.stripeRefundId).toBe('re_test_001');
        expect(result.refundProcessedAt).toBeTruthy();
        expect(result.cancelledAt).toBeTruthy();

        const updatedProduct = await prisma.product.findUnique({
            where: {
                id: product.id,
            },
        });

        expect(updatedProduct.stock).toBe(7);

        expect(mockAddRefundApprovedEmailJob).toHaveBeenCalledTimes(1);
        expect(mockAddRefundApprovedEmailJob).toHaveBeenCalledWith({
            to: customer.email,
            customerName: customer.fullName,
            orderId: order.id,
            totalAmount: 100,
        });
    });

    it('prevents approving the same refund twice and does not restore stock twice', async () => {
        await refundService.requestRefund(customer, order.id, {
            reason: 'CUSTOMER_REQUEST',
        });

        await refundService.approveRefund(admin, order.id);

        await expect(
            refundService.approveRefund(admin, order.id),
        ).rejects.toThrow('Only requested refunds can be approved.');

        const updatedProduct = await prisma.product.findUnique({
            where: {
                id: product.id,
            },
        });

        expect(updatedProduct.stock).toBe(7);
        expect(mockStripeRefundCreate).toHaveBeenCalledTimes(1);
        expect(mockAddRefundApprovedEmailJob).toHaveBeenCalledTimes(1);
    });

    it('rejects refund and queues rejection email without restoring stock', async () => {
        await refundService.requestRefund(customer, order.id, {
            reason: 'DAMAGED_ITEM',
        });

        const result = await refundService.rejectRefund(admin, order.id);

        expect(result.refundStatus).toBe('REJECTED');
        expect(result.refundProcessedAt).toBeTruthy();

        const updatedProduct = await prisma.product.findUnique({
            where: {
                id: product.id,
            },
        });

        expect(updatedProduct.stock).toBe(5);

        expect(mockAddRefundRejectedEmailJob).toHaveBeenCalledTimes(1);
        expect(mockAddRefundRejectedEmailJob).toHaveBeenCalledWith({
            to: customer.email,
            customerName: customer.fullName,
            orderId: order.id,
            totalAmount: 100,
        });
    });
});
