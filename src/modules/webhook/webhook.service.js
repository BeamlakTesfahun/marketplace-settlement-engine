import { prisma } from '../../config/prisma.js';
import { addOrderConfirmationEmailJob } from '../../jobs/producers/email.producer.js';
import { createAuditLog } from '../audit/audit.service.js';

const confirmInventoryReservations = async (tx, orderId) => {
    await tx.inventoryReservation.updateMany({
        where: {
            orderId,
            status: 'ACTIVE',
        },
        data: {
            status: 'CONFIRMED',
        },
    });
};

const releaseInventoryReservations = async (tx, order) => {
    const activeReservations = order.inventoryReservations.filter(
        (reservation) => reservation.status === 'ACTIVE',
    );

    for (const reservation of activeReservations) {
        await tx.product.update({
            where: {
                id: reservation.productId,
            },
            data: {
                stock: {
                    increment: reservation.quantity,
                },
                status: 'ACTIVE',
            },
        });
    }

    await tx.inventoryReservation.updateMany({
        where: {
            orderId: order.id,
            status: 'ACTIVE',
        },
        data: {
            status: 'EXPIRED',
        },
    });

    return activeReservations;
};

const handleCheckoutCompleted = async (event) => {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;

    if (!orderId) {
        return null;
    }

    const order = await prisma.order.findUnique({
        where: {
            id: orderId,
        },
        include: {
            user: {
                select: {
                    fullName: true,
                    email: true,
                },
            },
            inventoryReservations: true,
        },
    });

    if (!order) {
        return null;
    }

    if (order.paymentStatus === 'PAID') {
        return null;
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
        const paidOrder = await tx.order.update({
            where: {
                id: orderId,
            },
            data: {
                paymentStatus: 'PAID',
                status: 'CONFIRMED',
                stripePaymentIntentId:
                    typeof session.payment_intent === 'string'
                        ? session.payment_intent
                        : session.payment_intent?.id,
                paidAt: new Date(),
            },
            include: {
                user: {
                    select: {
                        fullName: true,
                        email: true,
                    },
                },
                inventoryReservations: true,
            },
        });

        await confirmInventoryReservations(tx, orderId);

        return paidOrder;
    });

    await createAuditLog({
        action: 'PAYMENT_CONFIRMED',
        entityType: 'ORDER',
        entityId: updatedOrder.id,
        metadata: {
            stripeEventId: event.id,
            stripePaymentIntentId: updatedOrder.stripePaymentIntentId,
            totalAmount: Number(updatedOrder.totalAmount),
        },
    });

    await createAuditLog({
        action: 'INVENTORY_CONFIRMED',
        entityType: 'ORDER',
        entityId: updatedOrder.id,
        metadata: {
            stripeEventId: event.id,
            reservations: order.inventoryReservations.map((reservation) => ({
                productId: reservation.productId,
                quantity: reservation.quantity,
                previousStatus: reservation.status,
            })),
        },
    });

    await addOrderConfirmationEmailJob({
        to: updatedOrder.user.email,
        customerName: updatedOrder.user.fullName,
        orderId: updatedOrder.id,
        totalAmount: Number(updatedOrder.totalAmount),
    });

    return updatedOrder;
};

const handleCheckoutExpired = async (event) => {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;

    if (!orderId) {
        return null;
    }

    const order = await prisma.order.findUnique({
        where: {
            id: orderId,
        },
        include: {
            inventoryReservations: true,
        },
    });

    if (!order) {
        return null;
    }

    if (order.status !== 'PENDING' || order.paymentStatus !== 'PENDING') {
        return null;
    }

    const releasedReservations = await prisma.$transaction(async (tx) => {
        const activeReservations = await releaseInventoryReservations(
            tx,
            order,
        );

        await tx.order.update({
            where: {
                id: orderId,
            },
            data: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
            },
        });

        return activeReservations;
    });

    await createAuditLog({
        action: 'CHECKOUT_EXPIRED',
        entityType: 'ORDER',
        entityId: order.id,
        metadata: {
            stripeEventId: event.id,
        },
    });

    await createAuditLog({
        action: 'INVENTORY_RELEASED',
        entityType: 'ORDER',
        entityId: order.id,
        metadata: {
            stripeEventId: event.id,
            releasedReservations: releasedReservations.map((reservation) => ({
                productId: reservation.productId,
                quantity: reservation.quantity,
            })),
        },
    });

    return order;
};

export const processStripeEvent = async (event) => {
    const existingEvent = await prisma.webhookEvent.findUnique({
        where: {
            stripeEventId: event.id,
        },
    });

    if (existingEvent?.processed) {
        return {
            received: true,
            duplicate: true,
            processed: false,
        };
    }

    if (event.type === 'checkout.session.completed') {
        await handleCheckoutCompleted(event);
    }

    if (event.type === 'checkout.session.expired') {
        await handleCheckoutExpired(event);
    }

    await prisma.webhookEvent.upsert({
        where: {
            stripeEventId: event.id,
        },
        update: {
            type: event.type,
            processed: true,
        },
        create: {
            stripeEventId: event.id,
            type: event.type,
            processed: true,
        },
    });

    await createAuditLog({
        action: 'STRIPE_WEBHOOK_PROCESSED',
        entityType: 'STRIPE_EVENT',
        entityId: event.id,
        metadata: {
            eventType: event.type,
        },
    });

    return {
        received: true,
        duplicate: false,
        processed: true,
    };
};
