import { jest } from '@jest/globals';
import request from 'supertest';

const mockAddPayoutPaidEmailJob = jest.fn();
const mockAddPayoutFailedEmailJob = jest.fn();

jest.unstable_mockModule('../../src/jobs/producers/email.producer.js', () => ({
    addOrderConfirmationEmailJob: jest.fn(),
    addRefundRequestedEmailJob: jest.fn(),
    addRefundApprovedEmailJob: jest.fn(),
    addRefundRejectedEmailJob: jest.fn(),
    addPayoutPaidEmailJob: mockAddPayoutPaidEmailJob,
    addPayoutFailedEmailJob: mockAddPayoutFailedEmailJob,
}));

const { default: app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/prisma.js');
const { generateToken } = await import('../../src/utils/generateToken.js');

describe('Payout API', () => {
    let admin;
    let vendorUser;
    let customer;
    let vendor;
    let order;
    let payout;
    let adminToken;
    let vendorToken;
    let customerToken;

    beforeEach(async () => {
        jest.clearAllMocks();

        await prisma.auditLog.deleteMany();
        await prisma.vendorPayout.deleteMany();
        await prisma.orderItem.deleteMany();
        await prisma.order.deleteMany();
        await prisma.product.deleteMany();
        await prisma.category.deleteMany();
        await prisma.vendor.deleteMany();
        await prisma.user.deleteMany();

        admin = await prisma.user.create({
            data: {
                fullName: 'Payout Admin',
                email: 'payout-admin@test.com',
                password: 'hashed-password',
                role: 'ADMIN',
            },
        });

        vendorUser = await prisma.user.create({
            data: {
                fullName: 'Payout Vendor',
                email: 'payout-vendor@test.com',
                password: 'hashed-password',
                role: 'VENDOR',
            },
        });

        customer = await prisma.user.create({
            data: {
                fullName: 'Payout Customer',
                email: 'payout-customer@test.com',
                password: 'hashed-password',
                role: 'CUSTOMER',
            },
        });

        vendor = await prisma.vendor.create({
            data: {
                userId: vendorUser.id,
                storeName: 'Payout Store',
                status: 'APPROVED',
            },
        });

        const category = await prisma.category.create({
            data: {
                name: 'Payout Category',
                slug: 'payout-category',
            },
        });

        const product = await prisma.product.create({
            data: {
                vendorId: vendor.id,
                categoryId: category.id,
                name: 'Payout Product',
                slug: 'payout-product',
                price: 100,
                stock: 5,
                status: 'ACTIVE',
            },
        });

        order = await prisma.order.create({
            data: {
                userId: customer.id,
                subtotalAmount: 100,
                discountAmount: 0,
                totalAmount: 100,
                status: 'CONFIRMED',
                paymentStatus: 'PAID',
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

        payout = await prisma.vendorPayout.create({
            data: {
                vendorId: vendor.id,
                orderId: order.id,
                grossAmount: 100,
                platformFee: 10,
                payoutAmount: 90,
                status: 'ON_HOLD',
                holdReason: 'PAYMENT_CAPTURED',
            },
        });

        adminToken = generateToken(admin.id);
        vendorToken = generateToken(vendorUser.id);
        customerToken = generateToken(customer.id);
    });

    it('allows vendor to view own payouts', async () => {
        const response = await request(app)
            .get('/api/v1/payouts/me')
            .set('Authorization', `Bearer ${vendorToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].id).toBe(payout.id);
    });

    it('allows admin to view all payouts', async () => {
        const response = await request(app)
            .get('/api/v1/payouts')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveLength(1);
    });

    it('rejects marking an on-hold payout as paid', async () => {
        const response = await request(app)
            .patch(`/api/v1/payouts/${payout.id}/pay`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(mockAddPayoutPaidEmailJob).not.toHaveBeenCalled();
    });

    it('allows admin to mark payout as paid when available and queues email', async () => {
        await prisma.vendorPayout.update({
            where: { id: payout.id },
            data: { status: 'AVAILABLE' },
        });

        const response = await request(app)
            .patch(`/api/v1/payouts/${payout.id}/pay`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.status).toBe('PAID');
        expect(response.body.data.paidAt).toBeTruthy();

        expect(mockAddPayoutPaidEmailJob).toHaveBeenCalledTimes(1);
        expect(mockAddPayoutPaidEmailJob).toHaveBeenCalledWith({
            to: vendorUser.email,
            vendorName: vendor.storeName,
            payoutId: payout.id,
            orderId: order.id,
            payoutAmount: 90,
        });
    });

    it('allows admin to mark payout as failed and queues email', async () => {
        const response = await request(app)
            .patch(`/api/v1/payouts/${payout.id}/fail`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                reason: 'Bank transfer failed',
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.status).toBe('FAILED');
        expect(response.body.data.failureReason).toBe('Bank transfer failed');

        expect(mockAddPayoutFailedEmailJob).toHaveBeenCalledTimes(1);
    });

    it('rejects non-admin from processing payouts', async () => {
        const response = await request(app)
            .patch(`/api/v1/payouts/${payout.id}/pay`)
            .set('Authorization', `Bearer ${customerToken}`);

        expect(response.status).toBe(403);
        expect(response.body.success).toBe(false);
    });

    it('allows admin to retry a failed payout', async () => {
        await prisma.vendorPayout.update({
            where: {
                id: payout.id,
            },
            data: {
                status: 'FAILED',
                failureReason: 'Bank transfer failed',
            },
        });

        const response = await request(app)
            .patch(`/api/v1/payouts/${payout.id}/retry`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.status).toBe('ON_HOLD');
        expect(response.body.data.failureReason).toBeNull();
    });

    it('rejects retry when payout is not failed', async () => {
        await prisma.vendorPayout.update({
            where: { id: payout.id },
            data: { status: 'ON_HOLD' },
        });

        const response = await request(app)
            .patch(`/api/v1/payouts/${payout.id}/retry`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
    });
});
