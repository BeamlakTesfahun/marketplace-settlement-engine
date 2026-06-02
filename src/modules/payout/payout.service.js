import { prisma } from '../../config/prisma.js';

const PLATFORM_FEE_PERCENTAGE = 10;

import { AppError } from '../../utils/AppError.js';
import { createAuditLog } from '../audit/audit.service.js';

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
    });

    if (!payout) {
        throw new AppError('Payout not found.', 404, 'PAYOUT_NOT_FOUND');
    }

    if (payout.status !== 'PENDING') {
        throw new AppError(
            'Only pending payouts can be marked as paid.',
            400,
            'PAYOUT_NOT_PENDING',
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
    });

    if (!payout) {
        throw new AppError('Payout not found.', 404, 'PAYOUT_NOT_FOUND');
    }

    if (payout.status !== 'PENDING') {
        throw new AppError(
            'Only pending payouts can be marked as failed.',
            400,
            'PAYOUT_NOT_PENDING',
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

    for (const [vendorId, grossAmount] of vendorTotals.entries()) {
        const platformFee = (grossAmount * PLATFORM_FEE_PERCENTAGE) / 100;

        const payoutAmount = grossAmount - platformFee;

        await tx.vendorPayout.create({
            data: {
                vendorId,
                orderId: order.id,
                grossAmount,
                platformFee,
                payoutAmount,
                status: 'PENDING',
            },
        });
    }
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

export const payoutService = {
    createPayoutsForOrder,
    getVendorPayouts,
    getAllPayouts,
    markPayoutAsPaid,
    markPayoutAsFailed,
};
