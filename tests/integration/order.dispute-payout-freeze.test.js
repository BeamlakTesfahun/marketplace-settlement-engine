import { jest } from '@jest/globals';
import request from 'supertest';

const mockAddDisputeOpenedEmailJob = jest.fn();
const mockAddDisputeVendorRespondedEmailJob = jest.fn();
const mockAddPayoutPaidEmailJob = jest.fn();
const mockAddDisputeResolvedEmailJob = jest.fn();

jest.unstable_mockModule('../../src/jobs/producers/email.producer.js', () => ({
    addOrderConfirmationEmailJob: jest.fn(),
    addRefundRequestedEmailJob: jest.fn(),
    addRefundApprovedEmailJob: jest.fn(),
    addRefundRejectedEmailJob: jest.fn(),
    addPayoutPaidEmailJob: mockAddPayoutPaidEmailJob,
    addPayoutFailedEmailJob: jest.fn(),
    addDisputeOpenedEmailJob: mockAddDisputeOpenedEmailJob,
    addDisputeVendorRespondedEmailJob: mockAddDisputeVendorRespondedEmailJob,
    addDisputeResolvedEmailJob: mockAddDisputeResolvedEmailJob,
}));

const { default: app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/prisma.js');
const { generateToken } = await import('../../src/utils/generateToken.js');
const { payoutService } =
    await import('../../src/modules/payouts/payout.service.js');

describe('Order disputes freeze vendor payouts', () => {
    let customer;
    let otherCustomer;
    let admin;
    let vendorUser;
    let otherVendorUser;
    let vendor;
    let otherVendor;
    let order;
    let payout;
    let customerToken;
    let otherCustomerToken;
    let adminToken;
    let vendorToken;
    let otherVendorToken;

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
                fullName: 'Dispute Customer',
                email: 'dispute-customer@test.com',
                password: 'hashed-password',
                role: 'CUSTOMER',
            },
        });

        otherCustomer = await prisma.user.create({
            data: {
                fullName: 'Other Dispute Customer',
                email: 'other-dispute-customer@test.com',
                password: 'hashed-password',
                role: 'CUSTOMER',
            },
        });

        admin = await prisma.user.create({
            data: {
                fullName: 'Dispute Admin',
                email: 'dispute-admin@test.com',
                password: 'hashed-password',
                role: 'ADMIN',
            },
        });

        vendorUser = await prisma.user.create({
            data: {
                fullName: 'Dispute Vendor',
                email: 'dispute-vendor@test.com',
                password: 'hashed-password',
                role: 'VENDOR',
            },
        });

        otherVendorUser = await prisma.user.create({
            data: {
                fullName: 'Other Dispute Vendor',
                email: 'other-dispute-vendor@test.com',
                password: 'hashed-password',
                role: 'VENDOR',
            },
        });

        vendor = await prisma.vendor.create({
            data: {
                userId: vendorUser.id,
                storeName: 'Dispute Store',
                status: 'APPROVED',
            },
        });

        otherVendor = await prisma.vendor.create({
            data: {
                userId: otherVendorUser.id,
                storeName: 'Other Dispute Store',
                status: 'APPROVED',
            },
        });

        const category = await prisma.category.create({
            data: {
                name: 'Dispute Category',
                slug: 'dispute-category',
            },
        });

        const product = await prisma.product.create({
            data: {
                vendorId: vendor.id,
                categoryId: category.id,
                name: 'Dispute Product',
                slug: 'dispute-product',
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
        otherCustomerToken = generateToken(otherCustomer.id);
        adminToken = generateToken(admin.id);
        vendorToken = generateToken(vendorUser.id);
        otherVendorToken = generateToken(otherVendorUser.id);
    });

    it('opens a dispute and keeps an eligible payout frozen', async () => {
        const response = await request(app)
            .post(`/api/v1/disputes/${order.id}/open`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({
                vendorId: vendor.id,
                reason: 'Item arrived damaged',
            });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.data.status).toBe('OPEN');
        expect(response.body.data.orderId).toBe(order.id);

        const released = await payoutService.releaseEligiblePayouts(new Date());

        const frozenPayout = await prisma.vendorPayout.findUnique({
            where: {
                id: payout.id,
            },
        });

        expect(released).toHaveLength(0);
        expect(frozenPayout.status).toBe('ON_HOLD');
        expect(mockAddDisputeOpenedEmailJob).toHaveBeenCalledTimes(1);

        const auditLog = await prisma.auditLog.findFirst({
            where: {
                action: 'ORDER_DISPUTE_OPENED',
                entityId: response.body.data.id,
            },
        });

        expect(auditLog).toBeTruthy();
    });

    it('blocks duplicate disputes for the same order', async () => {
        await request(app)
            .post(`/api/v1/disputes/${order.id}/open`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({
                vendorId: vendor.id,
                reason: 'Item arrived damaged',
            });

        const response = await request(app)
            .post(`/api/v1/disputes/${order.id}/open`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({
                vendorId: vendor.id,
                reason: 'Second dispute attempt',
            });

        const disputes = await prisma.orderDispute.findMany({
            where: {
                orderId: order.id,
            },
        });

        expect(response.status).toBe(409);
        expect(response.body.code).toBe('ORDER_DISPUTE_ALREADY_EXISTS');
        expect(disputes).toHaveLength(1);
        expect(mockAddDisputeOpenedEmailJob).toHaveBeenCalledTimes(1);
    });

    it('rejects opening a dispute after the vendor payout is available', async () => {
        await prisma.vendorPayout.update({
            where: {
                id: payout.id,
            },
            data: {
                status: 'AVAILABLE',
            },
        });

        const response = await request(app)
            .post(`/api/v1/disputes/${order.id}/open`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({
                vendorId: vendor.id,
                reason: 'Too late dispute attempt',
            });

        const disputes = await prisma.orderDispute.findMany({
            where: {
                orderId: order.id,
                vendorId: vendor.id,
            },
        });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VENDOR_PAYOUT_NOT_ON_HOLD');
        expect(disputes).toHaveLength(0);
        expect(mockAddDisputeOpenedEmailJob).not.toHaveBeenCalled();
    });

    it('rejects opening a dispute after the vendor payout is paid', async () => {
        await prisma.vendorPayout.update({
            where: {
                id: payout.id,
            },
            data: {
                status: 'PAID',
                paidAt: new Date(),
            },
        });

        const response = await request(app)
            .post(`/api/v1/disputes/${order.id}/open`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({
                vendorId: vendor.id,
                reason: 'Late paid payout dispute attempt',
            });

        const disputes = await prisma.orderDispute.findMany({
            where: {
                orderId: order.id,
                vendorId: vendor.id,
            },
        });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VENDOR_PAYOUT_NOT_ON_HOLD');
        expect(disputes).toHaveLength(0);
        expect(mockAddDisputeOpenedEmailJob).not.toHaveBeenCalled();
    });

    it('rejects dispute opening by a customer who does not own the order', async () => {
        const response = await request(app)
            .post(`/api/v1/disputes/${order.id}/open`)
            .set('Authorization', `Bearer ${otherCustomerToken}`)
            .send({
                vendorId: vendor.id,
                reason: 'Trying to dispute another customer order',
            });

        const disputes = await prisma.orderDispute.findMany({
            where: {
                orderId: order.id,
            },
        });

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('FORBIDDEN');
        expect(disputes).toHaveLength(0);
        expect(mockAddDisputeOpenedEmailJob).not.toHaveBeenCalled();
    });

    it('lets the order vendor respond and marks the dispute vendor responded', async () => {
        const opened = await request(app)
            .post(`/api/v1/disputes/${order.id}/open`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({
                vendorId: vendor.id,
                reason: 'Missing accessory in the box',
            });

        const response = await request(app)
            .patch(`/api/v1/disputes/${order.id}/respond`)
            .set('Authorization', `Bearer ${vendorToken}`)
            .send({
                response: 'We confirmed the accessory was packed separately.',
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.status).toBe('VENDOR_RESPONDED');
        expect(response.body.data.vendorResponse).toBe(
            'We confirmed the accessory was packed separately.',
        );
        expect(response.body.data.vendorRespondedById).toBe(vendorUser.id);
        expect(response.body.data.vendorRespondedAt).toBeTruthy();
        expect(response.body.data.underReviewAt).toBeNull();
        expect(mockAddDisputeVendorRespondedEmailJob).toHaveBeenCalledTimes(1);

        const auditLog = await prisma.auditLog.findFirst({
            where: {
                action: 'ORDER_DISPUTE_VENDOR_RESPONDED',
                entityId: opened.body.data.id,
            },
        });

        expect(auditLog).toBeTruthy();
    });

    it('rejects response from a vendor not involved in the dispute', async () => {
        await request(app)
            .post(`/api/v1/disputes/${order.id}/open`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({
                vendorId: vendor.id,
                reason: 'Vendor-specific dispute',
            });

        const response = await request(app)
            .patch(`/api/v1/disputes/${order.id}/respond`)
            .set('Authorization', `Bearer ${otherVendorToken}`)
            .send({
                response: 'This vendor should not be allowed to respond.',
            });

        const dispute = await prisma.orderDispute.findUnique({
            where: {
                orderId_vendorId: {
                    orderId: order.id,
                    vendorId: vendor.id,
                },
            },
        });

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('FORBIDDEN');
        expect(dispute.status).toBe('OPEN');
        expect(dispute.vendorRespondedById).toBeNull();
        expect(mockAddDisputeVendorRespondedEmailJob).not.toHaveBeenCalled();
    });

    it('blocks payout release while a dispute has a vendor response', async () => {
        await request(app)
            .post(`/api/v1/disputes/${order.id}/open`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({
                vendorId: vendor.id,
                reason: 'Package was incomplete',
            });

        await request(app)
            .patch(`/api/v1/disputes/${order.id}/respond`)
            .set('Authorization', `Bearer ${vendorToken}`)
            .send({
                response: 'We are reviewing the packing record.',
            });

        const released = await payoutService.releaseEligiblePayouts(new Date());

        const blockedPayout = await prisma.vendorPayout.findUnique({
            where: {
                id: payout.id,
            },
        });

        expect(released).toHaveLength(0);
        expect(blockedPayout.status).toBe('ON_HOLD');
    });

    it('blocks paying an available payout while a dispute is open', async () => {
        await request(app)
            .post(`/api/v1/disputes/${order.id}/open`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({
                vendorId: vendor.id,
                reason: 'Product was not as described',
            });

        await prisma.vendorPayout.update({
            where: {
                id: payout.id,
            },
            data: {
                status: 'AVAILABLE',
            },
        });

        const response = await request(app)
            .patch(`/api/v1/payouts/${payout.id}/pay`)
            .set('Authorization', `Bearer ${adminToken}`);

        const blockedPayout = await prisma.vendorPayout.findUnique({
            where: {
                id: payout.id,
            },
        });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('PAYOUT_BLOCKED_BY_DISPUTE');
        expect(blockedPayout.status).toBe('AVAILABLE');
        expect(mockAddPayoutPaidEmailJob).not.toHaveBeenCalled();
    });
});
