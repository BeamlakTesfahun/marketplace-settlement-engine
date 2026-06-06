import { jest } from '@jest/globals';

const mockConstructEvent = jest.fn();
const mockAddOrderConfirmationEmailJob = jest.fn();

jest.unstable_mockModule('../../src/config/stripe.js', () => ({
    stripe: {
        webhooks: {
            constructEvent: mockConstructEvent,
        },
    },
}));

jest.unstable_mockModule('../../src/jobs/producers/email.producer.js', () => ({
    addOrderConfirmationEmailJob: mockAddOrderConfirmationEmailJob,
    addRefundRequestedEmailJob: jest.fn(),
    addRefundApprovedEmailJob: jest.fn(),
    addRefundRejectedEmailJob: jest.fn(),
    addPayoutPaidEmailJob: jest.fn(),
    addPayoutFailedEmailJob: jest.fn(),
    addDisputeOpenedEmailJob: jest.fn(),
    addDisputeVendorRespondedEmailJob: jest.fn(),
}));

const request = (await import('supertest')).default;
const { default: app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/prisma.js');

describe('Stripe webhook API route', () => {
    beforeEach(async () => {
        jest.clearAllMocks();

        await prisma.webhookEvent.deleteMany();
        await prisma.orderItem.deleteMany();
        await prisma.order.deleteMany();
        await prisma.product.deleteMany();
        await prisma.category.deleteMany();
        await prisma.vendor.deleteMany();
        await prisma.user.deleteMany();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('marks order paid, stores webhook event, and queues confirmation email through the real route', async () => {
        const user = await prisma.user.create({
            data: {
                fullName: 'Webhook Route User',
                email: 'webhook-route@test.com',
                password: 'hashed-password',
                role: 'CUSTOMER',
            },
        });

        const order = await prisma.order.create({
            data: {
                userId: user.id,
                totalAmount: 120,
                status: 'PENDING',
                paymentStatus: 'PENDING',
            },
        });

        const stripeEvent = {
            id: 'evt_route_real_001',
            type: 'checkout.session.completed',
            data: {
                object: {
                    metadata: {
                        orderId: order.id,
                    },
                    payment_intent: 'pi_route_real_001',
                },
            },
        };

        mockConstructEvent.mockReturnValue(stripeEvent);

        const response = await request(app)
            .post('/api/v1/webhooks/stripe')
            .set('stripe-signature', 'test_signature')
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(stripeEvent));

        expect(response.status).toBe(200);
        expect(response.body.received).toBe(true);
        expect(response.body.processed).toBe(true);
        expect(response.body.duplicate).toBe(false);

        expect(mockConstructEvent).toHaveBeenCalledTimes(1);

        const updatedOrder = await prisma.order.findUnique({
            where: {
                id: order.id,
            },
        });

        expect(updatedOrder.paymentStatus).toBe('PAID');
        expect(updatedOrder.status).toBe('CONFIRMED');
        expect(updatedOrder.stripePaymentIntentId).toBe('pi_route_real_001');
        expect(updatedOrder.paidAt).toBeTruthy();

        const webhookEvents = await prisma.webhookEvent.findMany({
            where: {
                stripeEventId: stripeEvent.id,
            },
        });

        expect(webhookEvents).toHaveLength(1);
        expect(webhookEvents[0].processed).toBe(true);

        expect(mockAddOrderConfirmationEmailJob).toHaveBeenCalledTimes(1);
        expect(mockAddOrderConfirmationEmailJob).toHaveBeenCalledWith({
            to: user.email,
            customerName: user.fullName,
            orderId: order.id,
            totalAmount: 120,
        });
    });

    it('does not process duplicate Stripe webhook events through the real route', async () => {
        const user = await prisma.user.create({
            data: {
                fullName: 'Duplicate Route User',
                email: 'duplicate-route@test.com',
                password: 'hashed-password',
                role: 'CUSTOMER',
            },
        });

        const order = await prisma.order.create({
            data: {
                userId: user.id,
                totalAmount: 80,
                status: 'PENDING',
                paymentStatus: 'PENDING',
            },
        });

        const stripeEvent = {
            id: 'evt_route_duplicate_001',
            type: 'checkout.session.completed',
            data: {
                object: {
                    metadata: {
                        orderId: order.id,
                    },
                    payment_intent: 'pi_route_duplicate_001',
                },
            },
        };

        mockConstructEvent.mockReturnValue(stripeEvent);

        const firstResponse = await request(app)
            .post('/api/v1/webhooks/stripe')
            .set('stripe-signature', 'test_signature')
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(stripeEvent));

        const secondResponse = await request(app)
            .post('/api/v1/webhooks/stripe')
            .set('stripe-signature', 'test_signature')
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(stripeEvent));

        expect(firstResponse.status).toBe(200);
        expect(secondResponse.status).toBe(200);

        expect(firstResponse.body.processed).toBe(true);
        expect(secondResponse.body.duplicate).toBe(true);
        expect(secondResponse.body.processed).toBe(false);

        const webhookEvents = await prisma.webhookEvent.findMany({
            where: {
                stripeEventId: stripeEvent.id,
            },
        });

        expect(webhookEvents).toHaveLength(1);
        expect(mockAddOrderConfirmationEmailJob).toHaveBeenCalledTimes(1);

        const updatedOrder = await prisma.order.findUnique({
            where: {
                id: order.id,
            },
        });

        expect(updatedOrder.paymentStatus).toBe('PAID');

        expect(updatedOrder.status).toBe('CONFIRMED');
    });

    it('returns an error when Stripe signature verification fails', async () => {
        mockConstructEvent.mockImplementation(() => {
            throw new Error('Invalid Stripe signature');
        });

        const response = await request(app)
            .post('/api/v1/webhooks/stripe')
            .set('stripe-signature', 'bad_signature')
            .set('Content-Type', 'application/json')
            .send(
                JSON.stringify({
                    id: 'evt_bad_signature',
                }),
            );

        expect(response.status).toBe(500);

        expect(response.body.success).toBe(false);
    });
});
