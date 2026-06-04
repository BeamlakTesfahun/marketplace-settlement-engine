import { prisma } from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { createAuditLog } from '../audit/audit.service.js';
import {
    addPayoutPaidEmailJob,
    addPayoutFailedEmailJob,
} from '../../jobs/producers/email.producer.js';

const PLATFORM_FEE_PERCENTAGE = 10;
const PAYOUT_HOLD_REASON_PAYMENT = 'PAYMENT_CAPTURED';
const DISPUTE_WINDOW_DAYS = 7;

const addDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
};

const isPayoutPayable = (status) => status === 'AVAILABLE';

const isPayoutFailurable = (status) =>
    status === 'ON_HOLD' || status === 'AVAILABLE';

const resolveRetryStatus = (payout) => {
    const isEligibleForAvailable =
        payout.availableAt && payout.availableAt <= new Date();

    return isEligibleForAvailable ? 'AVAILABLE' : 'ON_HOLD';
};

const getAllPayouts = async (user) => {
    if (user.role !== 'ADMIN') {
        throw new AppError('Only admins can view payouts.', 403, 'FORBIDDEN');
    }

    return prisma.vendorPayout.findMany({
        include: {
            vendor: {
                select: {
                    id: true,
                    storeName: true,
                },
            },
            order: true,
        },
        orderBy: {
            createdAt: 'desc',
        },
    });
};

const markPayoutAsPaid = async (user, payoutId) => {
    if (user.role !== 'ADMIN') {
        throw new AppError(
            'Only admins can mark payouts as paid.',
            403,
            'FORBIDDEN',
        );
    }

    const payout = await prisma.vendorPayout.findUnique({
        where: {
            id: payoutId,
        },
        include: {
            vendor: {
                include: {
                    user: {
                        select: {
                            email: true,
                            fullName: true,
                        },
                    },
                },
            },
        },
    });

    if (!payout) {
        throw new AppError('Payout not found.', 404, 'PAYOUT_NOT_FOUND');
    }

    if (payout.status === 'ON_HOLD') {
        throw new AppError(
            'Payout is on hold and cannot be paid yet.',
            400,
            'PAYOUT_ON_HOLD',
        );
    }

    if (!isPayoutPayable(payout.status)) {
        throw new AppError(
            'Only available payouts can be marked as paid.',
            400,
            'PAYOUT_NOT_PAYABLE',
        );
    }

    const updatedPayout = await prisma.vendorPayout.update({
        where: {
            id: payoutId,
        },
        data: {
            status: 'PAID',
            paidAt: new Date(),
        },
    });

    await createAuditLog({
        userId: user.id,
        action: 'PAYOUT_MARKED_PAID',
        entityType: 'VENDOR_PAYOUT',
        entityId: payoutId,
        metadata: {
            vendorId: payout.vendorId,
            orderId: payout.orderId,
            payoutAmount: Number(payout.payoutAmount),
        },
    });

    await addPayoutPaidEmailJob({
        to: payout.vendor.user.email,
        vendorName: payout.vendor.storeName,
        payoutId: payout.id,
        orderId: payout.orderId,
        payoutAmount: Number(payout.payoutAmount),
    });

    return updatedPayout;
};

const markPayoutAsFailed = async (user, payoutId, reason) => {
    if (user.role !== 'ADMIN') {
        throw new AppError(
            'Only admins can mark payouts as failed.',
            403,
            'FORBIDDEN',
        );
    }

    const payout = await prisma.vendorPayout.findUnique({
        where: {
            id: payoutId,
        },
        include: {
            vendor: {
                include: {
                    user: {
                        select: {
                            email: true,
                            fullName: true,
                        },
                    },
                },
            },
        },
    });

    if (!payout) {
        throw new AppError('Payout not found.', 404, 'PAYOUT_NOT_FOUND');
    }

    if (!isPayoutFailurable(payout.status)) {
        throw new AppError(
            'Only on-hold or available payouts can be marked as failed.',
            400,
            'PAYOUT_NOT_FAILABLE',
        );
    }

    const updatedPayout = await prisma.vendorPayout.update({
        where: {
            id: payoutId,
        },
        data: {
            status: 'FAILED',
            failureReason: reason,
        },
    });

    await createAuditLog({
        userId: user.id,
        action: 'PAYOUT_MARKED_FAILED',
        entityType: 'VENDOR_PAYOUT',
        entityId: payoutId,
        metadata: {
            vendorId: payout.vendorId,
            orderId: payout.orderId,
            payoutAmount: Number(payout.payoutAmount),
            failureReason: reason,
        },
    });

    await addPayoutFailedEmailJob({
        to: payout.vendor.user.email,
        vendorName: payout.vendor.storeName,
        payoutId: payout.id,
        orderId: payout.orderId,
        payoutAmount: Number(payout.payoutAmount),
        reason,
    });

    return updatedPayout;
};

const createPayoutsForOrder = async (tx, order) => {
    const vendorTotals = new Map();

    for (const item of order.items) {
        const amount = Number(item.price) * item.quantity;

        vendorTotals.set(
            item.vendorId,
            (vendorTotals.get(item.vendorId) || 0) + amount,
        );
    }

    const createdPayouts = [];

    for (const [vendorId, grossAmount] of vendorTotals.entries()) {
        const platformFee = (grossAmount * PLATFORM_FEE_PERCENTAGE) / 100;
        const payoutAmount = grossAmount - platformFee;

        const payout = await tx.vendorPayout.create({
            data: {
                vendorId,
                orderId: order.id,
                grossAmount,
                platformFee,
                payoutAmount,
                status: 'ON_HOLD',
                holdReason: PAYOUT_HOLD_REASON_PAYMENT,
            },
        });

        createdPayouts.push(payout);
    }

    return createdPayouts;
};

const markPayoutsAvailableForDeliveredOrder = async (
    tx,
    orderId,
    deliveredAt,
) => {
    const availableAt = addDays(deliveredAt, DISPUTE_WINDOW_DAYS);

    await tx.vendorPayout.updateMany({
        where: {
            orderId,
            status: 'ON_HOLD',
        },
        data: {
            availableAt,
        },
    });

    return tx.vendorPayout.findMany({
        where: {
            orderId,
            status: 'ON_HOLD',
        },
    });
};

const releaseEligiblePayouts = async (now = new Date()) => {
    const eligiblePayouts = await prisma.vendorPayout.findMany({
        where: {
            status: 'ON_HOLD',
            availableAt: {
                lte: now,
            },
        },
    });

    if (eligiblePayouts.length === 0) {
        return [];
    }

    const payoutIds = eligiblePayouts.map((payout) => payout.id);

    await prisma.vendorPayout.updateMany({
        where: {
            id: {
                in: payoutIds,
            },
        },
        data: {
            status: 'AVAILABLE',
        },
    });

    for (const payout of eligiblePayouts) {
        await createAuditLog({
            action: 'PAYOUT_RELEASED',
            entityType: 'VENDOR_PAYOUT',
            entityId: payout.id,
            metadata: {
                orderId: payout.orderId,
                vendorId: payout.vendorId,
                availableAt: payout.availableAt,
                releasedAt: now,
            },
        });
    }

    return prisma.vendorPayout.findMany({
        where: {
            id: {
                in: payoutIds,
            },
        },
    });
};

const getVendorPayouts = async (vendorId) => {
    return prisma.vendorPayout.findMany({
        where: {
            vendorId,
        },
        include: {
            order: true,
        },
        orderBy: {
            createdAt: 'desc',
        },
    });
};

const retryFailedPayout = async (user, payoutId) => {
    if (user.role !== 'ADMIN') {
        throw new AppError('Only admins can retry payouts.', 403, 'FORBIDDEN');
    }

    const payout = await prisma.vendorPayout.findUnique({
        where: {
            id: payoutId,
        },
    });

    if (!payout) {
        throw new AppError('Payout not found.', 404, 'PAYOUT_NOT_FOUND');
    }

    if (payout.status !== 'FAILED') {
        throw new AppError(
            'Only failed payouts can be retried.',
            400,
            'PAYOUT_NOT_FAILED',
        );
    }

    const nextStatus = resolveRetryStatus(payout);

    const updatedPayout = await prisma.vendorPayout.update({
        where: {
            id: payoutId,
        },
        data: {
            status: nextStatus,
            failureReason: null,
        },
    });

    await createAuditLog({
        userId: user.id,
        action: 'PAYOUT_RETRIED',
        entityType: 'VENDOR_PAYOUT',
        entityId: payoutId,
        metadata: {
            vendorId: payout.vendorId,
            orderId: payout.orderId,
            payoutAmount: Number(payout.payoutAmount),
            previousStatus: payout.status,
            nextStatus,
        },
    });

    return updatedPayout;
};

export const payoutService = {
    createPayoutsForOrder,
    markPayoutsAvailableForDeliveredOrder,
    releaseEligiblePayouts,
    getVendorPayouts,
    getAllPayouts,
    markPayoutAsPaid,
    markPayoutAsFailed,
    retryFailedPayout,
};
