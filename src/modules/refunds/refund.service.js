import { prisma } from '../../config/prisma.js';
import { stripe } from '../../config/stripe.js';
import { AppError } from '../../utils/AppError.js';

import {
    addRefundRequestedEmailJob,
    addRefundApprovedEmailJob,
    addRefundRejectedEmailJob,
} from '../../jobs/producers/email.producer.js';

import { createAuditLog } from '../audit/audit.service.js';

const restoreOrderStock = async (tx, orderItems) => {
    for (const item of orderItems) {
        await tx.product.update({
            where: {
                id: item.productId,
            },
            data: {
                stock: {
                    increment: item.quantity,
                },
                status: 'ACTIVE',
            },
        });
    }
};

const requestRefund = async (user, orderId, payload) => {
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
        },
    });

    if (!order) {
        throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    if (order.userId !== user.id) {
        throw new AppError(
            'You are not allowed to request refund for this order.',
            403,
            'FORBIDDEN',
        );
    }

    if (order.paymentStatus !== 'PAID') {
        throw new AppError(
            'Only paid orders can be refunded.',
            400,
            'ORDER_NOT_PAID',
        );
    }

    if (order.status === 'DELIVERED') {
        throw new AppError(
            'Delivered orders cannot be refunded through this workflow.',
            400,
            'ORDER_ALREADY_DELIVERED',
        );
    }

    if (order.refundStatus !== 'NONE') {
        throw new AppError(
            'Refund has already been requested or processed for this order.',
            409,
            'REFUND_ALREADY_EXISTS',
        );
    }

    const refundRequest = await prisma.order.update({
        where: {
            id: orderId,
        },
        data: {
            refundStatus: 'REQUESTED',
            refundReason: payload.reason,
            refundRequestedAt: new Date(),
            refundRequestedById: user.id,
        },
    });

    await createAuditLog({
        userId: user.id,
        action: 'REFUND_REQUESTED',
        entityType: 'ORDER',
        entityId: order.id,
        metadata: {
            reason: payload.reason,
            totalAmount: Number(order.totalAmount),
        },
    });

    await addRefundRequestedEmailJob({
        to: order.user.email,
        customerName: order.user.fullName,
        orderId: order.id,
        reason: payload.reason,
        totalAmount: Number(order.totalAmount),
    });

    return refundRequest;
};

const approveRefund = async (user, orderId) => {
    if (user.role !== 'ADMIN') {
        throw new AppError(
            'Only admins can approve refunds.',
            403,
            'FORBIDDEN',
        );
    }

    const order = await prisma.order.findUnique({
        where: {
            id: orderId,
        },
        include: {
            items: true,
            user: {
                select: {
                    email: true,
                    fullName: true,
                },
            },
        },
    });

    if (!order) {
        throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    if (order.refundStatus !== 'REQUESTED') {
        throw new AppError(
            'Only requested refunds can be approved.',
            400,
            'REFUND_NOT_REQUESTED',
        );
    }

    if (order.paymentStatus !== 'PAID') {
        throw new AppError(
            'Only paid orders can be refunded.',
            400,
            'ORDER_NOT_PAID',
        );
    }

    if (!order.stripePaymentIntentId) {
        throw new AppError(
            'Stripe payment intent is missing for this order.',
            400,
            'PAYMENT_INTENT_MISSING',
        );
    }

    const refund = await stripe.refunds.create({
        payment_intent: order.stripePaymentIntentId,
    });

    const refundedOrder = await prisma.$transaction(async (tx) => {
        await restoreOrderStock(tx, order.items);

        return tx.order.update({
            where: {
                id: orderId,
            },
            data: {
                status: 'CANCELLED',
                paymentStatus: 'REFUNDED',
                refundStatus: 'REFUNDED',
                stripeRefundId: refund.id,
                refundAmount: order.totalAmount,
                refundProcessedAt: new Date(),
                cancelledAt: new Date(),
            },
            include: {
                items: true,
            },
        });
    });

    await createAuditLog({
        userId: user.id,
        action: 'REFUND_APPROVED',
        entityType: 'ORDER',
        entityId: order.id,
        metadata: {
            stripeRefundId: refund.id,
            refundAmount: Number(order.totalAmount),
            restoredItems: order.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
            })),
        },
    });

    await addRefundApprovedEmailJob({
        to: order.user.email,
        customerName: order.user.fullName,
        orderId: order.id,
        totalAmount: Number(order.totalAmount),
    });

    return refundedOrder;
};

const rejectRefund = async (user, orderId) => {
    if (user.role !== 'ADMIN') {
        throw new AppError('Only admins can reject refunds.', 403, 'FORBIDDEN');
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
        },
    });

    if (!order) {
        throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    if (order.refundStatus !== 'REQUESTED') {
        throw new AppError(
            'Only requested refunds can be rejected.',
            400,
            'REFUND_NOT_REQUESTED',
        );
    }

    const rejectedOrder = await prisma.order.update({
        where: {
            id: orderId,
        },
        data: {
            refundStatus: 'REJECTED',
            refundProcessedAt: new Date(),
        },
    });

    await createAuditLog({
        userId: user.id,
        action: 'REFUND_REJECTED',
        entityType: 'ORDER',
        entityId: order.id,
        metadata: {
            totalAmount: Number(order.totalAmount),
        },
    });

    await addRefundRejectedEmailJob({
        to: order.user.email,
        customerName: order.user.fullName,
        orderId: order.id,
        totalAmount: Number(order.totalAmount),
    });

    return rejectedOrder;
};

const getMyRefundRequests = async (user) => {
    return prisma.order.findMany({
        where: {
            userId: user.id,
            refundStatus: {
                not: 'NONE',
            },
        },
        include: {
            items: {
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true,
                            price: true,
                        },
                    },
                },
            },
        },
        orderBy: {
            refundRequestedAt: 'desc',
        },
    });
};

const getAllRefundRequests = async (user) => {
    if (user.role !== 'ADMIN') {
        throw new AppError(
            'Only admins can view all refund requests.',
            403,
            'FORBIDDEN',
        );
    }

    return prisma.order.findMany({
        where: {
            refundStatus: {
                not: 'NONE',
            },
        },
        include: {
            user: {
                select: {
                    id: true,
                    fullName: true,
                    email: true,
                },
            },
            items: {
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true,
                            price: true,
                        },
                    },
                },
            },
        },
        orderBy: {
            refundRequestedAt: 'desc',
        },
    });
};

export const refundService = {
    requestRefund,
    approveRefund,
    rejectRefund,
    getMyRefundRequests,
    getAllRefundRequests,
};
