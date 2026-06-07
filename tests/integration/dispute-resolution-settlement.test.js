import { jest } from '@jest/globals';
import request from 'supertest';

const mockAddDisputeOpenedEmailJob = jest.fn();
const mockAddDisputeVendorRespondedEmailJob = jest.fn();
const mockAddDisputeResolvedEmailJob = jest.fn();

jest.unstable_mockModule('../../src/jobs/producers/email.producer.js', () => ({
    addOrderConfirmationEmailJob: jest.fn(),
    addRefundRequestedEmailJob: jest.fn(),
    addRefundApprovedEmailJob: jest.fn(),
    addRefundRejectedEmailJob: jest.fn(),
    addPayoutPaidEmailJob: jest.fn(),
    addPayoutFailedEmailJob: jest.fn(),
    addPayoutReversalEmailJob: jest.fn(),
    addDisputeOpenedEmailJob: mockAddDisputeOpenedEmailJob,
    addDisputeVendorRespondedEmailJob: mockAddDisputeVendorRespondedEmailJob,
    addDisputeResolvedEmailJob: mockAddDisputeResolvedEmailJob,
}));

const { default: app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/prisma.js');
const { generateToken } = await import('../../src/utils/generateToken.js');
const { payoutService } =
    await import('../../src/modules/payouts/payout.service.js');

describe('Dispute resolution settlement', () => {
    let customer;
    let admin;
    let vendorUser;
    let vendor;
    let order;
    let payout;
    let customerToken;
    let adminToken;

    const createOpenDispute = async (reason = 'Item arrived damaged') => {
        const response = await request(app)
            .post(`/api/v1/disputes/${order.id}/open`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({
                vendorId: vendor.id,
                reason,
            });

        expect(response.status).toBe(201);
        return response.body.data;
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        await prisma.auditLog.deleteMany();
        await prisma.orderDispute.deleteMany();
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
                fullName: 'Resolution Customer',
                email: 'resolution-customer@test.com',
                password: 'hashed-password',
                role: 'CUSTOMER',
            },
        });

        admin = await prisma.user.create({
            data: {
                fullName: 'Resolution Admin',
                email: 'resolution-admin@test.com',
                password: 'hashed-password',
                role: 'ADMIN',
            },
        });

        vendorUser = await prisma.user.create({
            data: {
                fullName: 'Resolution Vendor',
                email: 'resolution-vendor@test.com',
                password: 'hashed-password',
                role: 'VENDOR',
            },
        });

        vendor = await prisma.vendor.create({
            data: {
                userId: vendorUser.id,
                storeName: 'Resolution Store',
                status: 'APPROVED',
            },
        });

        const category = await prisma.category.create({
            data: {
                name: 'Resolution Category',
                slug: 'resolution-category',
            },
        });

        const product = await prisma.product.create({
            data: {
                vendorId: vendor.id,
                categoryId: category.id,
                name: 'Resolution Product',
                slug: 'resolution-product',
                price: 100,
                stock: 10,
                status: 'ACTIVE',
            },
        });

        const deliveredAt = new Date();
        deliveredAt.setDate(deliveredAt.getDate() - 8);

        order = await prisma.order.create({
            data: {
                userId: customer.id,
                subtotalAmount: 100,
                discountAmount: 0,
                totalAmount: 100,
                status: 'DELIVERED',
                paymentStatus: 'PAID',
                paidAt: new Date(),
                deliveredAt,
                items: {
                    create: {
                        productId: product.id,
                        vendorId: vendor.id,
                        quantity: 1,
                        price: 100,
                    },
                },
            },
        });

        const availableAt = new Date();
        availableAt.setDate(availableAt.getDate() - 1);

        payout = await prisma.vendorPayout.create({
            data: {
                vendorId: vendor.id,
                orderId: order.id,
                grossAmount: 100,
                platformFee: 10,
                payoutAmount: 90,
                status: 'ON_HOLD',
                holdReason: 'PAYMENT_CAPTURED',
                availableAt,
                updatedAt: new Date(),
            },
        });

        customerToken = generateToken(customer.id);
        adminToken = generateToken(admin.id);
    });

    it('admin resolves dispute with full refund and keeps payout blocked', async () => {
        const dispute = await createOpenDispute();

        const response = await request(app)
            .patch(`/api/v1/disputes/${order.id}/vendors/${vendor.id}/resolve`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                resolution: 'REFUND',
                note: 'Customer refund approved.',
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.dispute.status).toBe('RESOLVED_REFUND');

        const updatedOrder = await prisma.order.findUnique({
            where: { id: order.id },
        });

        const updatedPayout = await prisma.vendorPayout.findUnique({
            where: { id: payout.id },
        });

        expect(Number(updatedOrder.refundAmount)).toBe(100);
        expect(updatedOrder.refundStatus).toBe('PROCESSING');
        expect(updatedOrder.refundProcessedAt).toBeTruthy();

        expect(updatedPayout.status).toBe('ON_HOLD');
        expect(updatedPayout.holdReason).toBe('DISPUTE_REFUNDED');

        const auditLog = await prisma.auditLog.findFirst({
            where: {
                action: 'ORDER_DISPUTE_RESOLVED_REFUND',
                entityId: dispute.id,
            },
        });

        expect(auditLog).toBeTruthy();
        expect(mockAddDisputeResolvedEmailJob).toHaveBeenCalledTimes(2);
        expect(mockAddDisputeResolvedEmailJob).toHaveBeenCalledWith(
            expect.objectContaining({
                recipientType: 'customer',
                resolution: 'REFUND',
            }),
        );
        expect(mockAddDisputeResolvedEmailJob).toHaveBeenCalledWith(
            expect.objectContaining({
                recipientType: 'vendor',
                resolution: 'REFUND',
            }),
        );
    });

    it('admin resolves dispute with partial refund', async () => {
        const dispute = await createOpenDispute('Partial issue');

        const response = await request(app)
            .patch(`/api/v1/disputes/${order.id}/vendors/${vendor.id}/resolve`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                resolution: 'PARTIAL_REFUND',
                refundAmount: 35,
                note: 'Partial refund approved.',
            });

        expect(response.status).toBe(200);
        expect(response.body.data.dispute.status).toBe('RESOLVED_REFUND');

        const updatedOrder = await prisma.order.findUnique({
            where: { id: order.id },
        });

        expect(Number(updatedOrder.refundAmount)).toBe(35);
        expect(updatedOrder.refundStatus).toBe('PROCESSING');

        const auditLog = await prisma.auditLog.findFirst({
            where: {
                action: 'ORDER_DISPUTE_RESOLVED_REFUND',
                entityId: dispute.id,
            },
        });

        expect(auditLog).toBeTruthy();
        expect(mockAddDisputeResolvedEmailJob).toHaveBeenCalledTimes(2);
    });

    it('admin resolves dispute with payout release and makes eligible payout available', async () => {
        const dispute = await createOpenDispute('Vendor evidence accepted');

        const response = await request(app)
            .patch(`/api/v1/disputes/${order.id}/vendors/${vendor.id}/resolve`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                resolution: 'RELEASE_PAYOUT',
                note: 'Payout released after review.',
            });

        expect(response.status).toBe(200);
        expect(response.body.data.dispute.status).toBe(
            'RESOLVED_RELEASE_PAYOUT',
        );
        expect(response.body.data.payout.status).toBe('AVAILABLE');

        const updatedPayout = await prisma.vendorPayout.findUnique({
            where: { id: payout.id },
        });

        expect(updatedPayout.status).toBe('AVAILABLE');
        expect(updatedPayout.holdReason).toBeNull();

        const auditLog = await prisma.auditLog.findFirst({
            where: {
                action: 'ORDER_DISPUTE_RESOLVED_RELEASE_PAYOUT',
                entityId: dispute.id,
            },
        });

        expect(auditLog).toBeTruthy();
        expect(mockAddDisputeResolvedEmailJob).toHaveBeenCalledTimes(2);
    });

    it('admin rejects dispute and payout can later be released if eligible', async () => {
        const dispute = await createOpenDispute('Rejected dispute');

        const response = await request(app)
            .patch(`/api/v1/disputes/${order.id}/vendors/${vendor.id}/resolve`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                resolution: 'REJECT',
                note: 'Customer claim rejected.',
            });

        expect(response.status).toBe(200);
        expect(response.body.data.dispute.status).toBe('REJECTED');

        const released = await payoutService.releaseEligiblePayouts(new Date());

        const updatedPayout = await prisma.vendorPayout.findUnique({
            where: { id: payout.id },
        });

        expect(released).toHaveLength(1);
        expect(updatedPayout.status).toBe('AVAILABLE');

        const auditLog = await prisma.auditLog.findFirst({
            where: {
                action: 'ORDER_DISPUTE_REJECTED',
                entityId: dispute.id,
            },
        });

        expect(auditLog).toBeTruthy();
        expect(mockAddDisputeResolvedEmailJob).toHaveBeenCalledTimes(2);
    });
});
