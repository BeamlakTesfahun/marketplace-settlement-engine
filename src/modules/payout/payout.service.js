import { prisma } from '../../config/prisma.js';

const PLATFORM_FEE_PERCENTAGE = 10;

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
};
