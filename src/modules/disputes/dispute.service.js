import { prisma } from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { createAuditLog } from '../audit/audit.service.js';

import { payoutService } from '../payouts/payout.service.js';

import {
    addDisputeOpenedEmailJob,
    addDisputeVendorRespondedEmailJob,
    addDisputeResolvedEmailJob,
} from '../../jobs/producers/email.producer.js';

export const OPEN_DISPUTE_STATUSES = [
    'OPEN',
    'VENDOR_RESPONDED',
    'UNDER_REVIEW',
];

const isUniqueConstraintError = (error) => error?.code === 'P2002';

const openDispute = async (user, orderId, payload) => {
    if (user.role !== 'CUSTOMER') {
        throw new AppError(
            'Only customers can open disputes.',
            403,
            'FORBIDDEN',
        );
    }

    const order = await prisma.order.findUnique({
        where: {
            id: orderId,
        },
        include: {
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

    if (order.userId !== user.id) {
        throw new AppError(
            'You are not allowed to dispute this order.',
            403,
            'FORBIDDEN',
        );
    }

    if (order.paymentStatus !== 'PAID') {
        throw new AppError(
            'Only paid orders can be disputed.',
            400,
            'ORDER_NOT_PAID',
        );
    }

    const payout = await prisma.vendorPayout.findUnique({
        where: {
            orderId_vendorId: {
                orderId,
                vendorId: payload.vendorId,
            },
        },
    });

    if (!payout) {
        throw new AppError(
            'Vendor payout not found for this order.',
            404,
            'VENDOR_PAYOUT_NOT_FOUND',
        );
    }

    if (payout.status !== 'ON_HOLD') {
        throw new AppError(
            'Disputes can only be opened while the vendor payout is on hold.',
            400,
            'VENDOR_PAYOUT_NOT_ON_HOLD',
        );
    }

    const existingDispute = await prisma.orderDispute.findUnique({
        where: {
            orderId_vendorId: {
                orderId,
                vendorId: payload.vendorId,
            },
        },
    });

    if (existingDispute) {
        throw new AppError(
            'A dispute already exists for this order and vendor.',
            409,
            'ORDER_DISPUTE_ALREADY_EXISTS',
        );
    }

    let dispute;

    try {
        dispute = await prisma.orderDispute.create({
            data: {
                orderId,
                vendorId: payload.vendorId,
                openedById: user.id,
                reason: payload.reason,
                status: 'OPEN',
            },
        });
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            throw new AppError(
                'A dispute already exists for this order and vendor.',
                409,
                'ORDER_DISPUTE_ALREADY_EXISTS',
            );
        }

        throw error;
    }

    await createAuditLog({
        userId: user.id,
        action: 'ORDER_DISPUTE_OPENED',
        entityType: 'ORDER_DISPUTE',
        entityId: dispute.id,
        metadata: {
            orderId,
            vendorId: dispute.vendorId,
            payoutId: payout.id,
            status: dispute.status,
            reason: dispute.reason,
            totalAmount: Number(order.totalAmount),
        },
    });

    await addDisputeOpenedEmailJob({
        to: order.user.email,
        customerName: order.user.fullName,
        disputeId: dispute.id,
        orderId,
        reason: dispute.reason,
    });

    return dispute;
};

const respondToDispute = async (user, orderId, payload) => {
    if (user.role !== 'VENDOR') {
        throw new AppError(
            'Only vendors can respond to disputes.',
            403,
            'FORBIDDEN',
        );
    }

    const vendor = await prisma.vendor.findUnique({
        where: {
            userId: user.id,
        },
    });

    if (!vendor) {
        throw new AppError(
            'Vendor profile not found.',
            404,
            'VENDOR_PROFILE_NOT_FOUND',
        );
    }

    const dispute = await prisma.orderDispute.findUnique({
        where: {
            orderId_vendorId: {
                orderId,
                vendorId: vendor.id,
            },
        },
        include: {
            openedBy: {
                select: {
                    email: true,
                    fullName: true,
                },
            },
        },
    });

    if (!dispute) {
        const disputeExistsForOrder = await prisma.orderDispute.count({
            where: {
                orderId,
            },
        });

        if (disputeExistsForOrder > 0) {
            throw new AppError(
                'You are not allowed to respond to this dispute.',
                403,
                'FORBIDDEN',
            );
        }

        throw new AppError(
            'Dispute not found.',
            404,
            'ORDER_DISPUTE_NOT_FOUND',
        );
    }

    if (dispute.status !== 'OPEN') {
        throw new AppError(
            'Only open disputes can receive a vendor response.',
            400,
            'DISPUTE_NOT_OPEN',
        );
    }

    const now = new Date();

    const updatedDispute = await prisma.orderDispute.update({
        where: {
            id: dispute.id,
        },
        data: {
            status: 'VENDOR_RESPONDED',
            vendorResponse: payload.response,
            vendorRespondedById: user.id,
            vendorRespondedAt: now,
        },
    });

    await createAuditLog({
        userId: user.id,
        action: 'ORDER_DISPUTE_VENDOR_RESPONDED',
        entityType: 'ORDER_DISPUTE',
        entityId: dispute.id,
        metadata: {
            orderId,
            vendorId: vendor.id,
            previousStatus: dispute.status,
            nextStatus: updatedDispute.status,
        },
    });

    await addDisputeVendorRespondedEmailJob({
        to: dispute.openedBy.email,
        customerName: dispute.openedBy.fullName,
        disputeId: dispute.id,
        orderId,
        vendorResponse: updatedDispute.vendorResponse,
    });

    return updatedDispute;
};

const TERMINAL_DISPUTE_STATUSES = [
    'RESOLVED_REFUND',
    'RESOLVED_RELEASE_PAYOUT',
    'REJECTED',
];

const resolveDispute = async (user, orderId, vendorId, payload) => {
    if (user.role !== 'ADMIN') {
        throw new AppError(
            'Only admins can resolve disputes.',
            403,
            'FORBIDDEN',
        );
    }

    const dispute = await prisma.orderDispute.findUnique({
        where: {
            orderId_vendorId: {
                orderId,
                vendorId,
            },
        },
        include: {
            openedBy: {
                select: {
                    email: true,
                    fullName: true,
                },
            },
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
            order: true,
        },
    });

    if (!dispute) {
        throw new AppError(
            'Dispute not found.',
            404,
            'ORDER_DISPUTE_NOT_FOUND',
        );
    }

    if (TERMINAL_DISPUTE_STATUSES.includes(dispute.status)) {
        throw new AppError(
            'This dispute has already been resolved.',
            400,
            'DISPUTE_ALREADY_RESOLVED',
        );
    }

    const payout = await prisma.vendorPayout.findUnique({
        where: {
            orderId_vendorId: {
                orderId,
                vendorId,
            },
        },
    });

    if (!payout) {
        throw new AppError(
            'Vendor payout not found for this dispute.',
            404,
            'VENDOR_PAYOUT_NOT_FOUND',
        );
    }

    const payoutGrossAmount = Number(payout.grossAmount);

    if (
        payload.resolution === 'PARTIAL_REFUND' &&
        Number(payload.refundAmount) > payoutGrossAmount
    ) {
        throw new AppError(
            'Partial refund amount cannot exceed the vendor payout gross amount.',
            400,
            'REFUND_AMOUNT_EXCEEDS_VENDOR_AMOUNT',
        );
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
        if (
            payload.resolution === 'REFUND' ||
            payload.resolution === 'PARTIAL_REFUND'
        ) {
            const refundAmount =
                payload.resolution === 'REFUND'
                    ? payoutGrossAmount
                    : Number(payload.refundAmount);

            const updatedDispute = await tx.orderDispute.update({
                where: {
                    id: dispute.id,
                },
                data: {
                    status: 'RESOLVED_REFUND',
                    underReviewAt: dispute.underReviewAt ?? now,
                    resolvedAt: now,
                },
            });

            // const updatedPayout = await tx.vendorPayout.update({
            //     where: {
            //         id: payout.id,
            //     },
            //     data: {
            //         status: 'ON_HOLD',
            //         holdReason: 'DISPUTE_REFUNDED',
            //     },
            // });

            const updatedOrder = await tx.order.update({
                where: {
                    id: orderId,
                },
                data: {
                    refundStatus: 'PROCESSING',
                    refundAmount,
                    refundProcessedAt: now,
                },
            });

            const settlementReversal =
                await payoutService.applyRefundAgainstPayout(
                    {
                        orderId,
                        vendorId,
                        refundAmount,
                        reason: payload.resolution,
                        referenceType: 'ORDER_DISPUTE',
                        referenceId: dispute.id,
                        actorId: user.id,
                    },
                    tx,
                );

            await createAuditLog({
                userId: user.id,
                action: 'ORDER_DISPUTE_RESOLVED_REFUND',
                entityType: 'ORDER_DISPUTE',
                entityId: dispute.id,
                metadata: {
                    orderId,
                    vendorId,
                    payoutId: payout.id,
                    previousStatus: dispute.status,
                    nextStatus: updatedDispute.status,
                    resolution: payload.resolution,
                    refundAmount,
                    note: payload.note,
                },
            });

            return {
                dispute: updatedDispute,
                payout: updatedPayout,
                order: updatedOrder,
                settlementReversal,
            };
        }

        if (payload.resolution === 'RELEASE_PAYOUT') {
            const nextPayoutStatus =
                payout.availableAt && payout.availableAt <= now
                    ? 'AVAILABLE'
                    : 'ON_HOLD';

            const updatedDispute = await tx.orderDispute.update({
                where: {
                    id: dispute.id,
                },
                data: {
                    status: 'RESOLVED_RELEASE_PAYOUT',
                    underReviewAt: dispute.underReviewAt ?? now,
                    resolvedAt: now,
                },
            });

            const updatedPayout = await tx.vendorPayout.update({
                where: {
                    id: payout.id,
                },
                data: {
                    status: nextPayoutStatus,
                    holdReason:
                        nextPayoutStatus === 'AVAILABLE'
                            ? null
                            : 'DISPUTE_RESOLVED_RELEASE',
                },
            });

            await createAuditLog({
                userId: user.id,
                action: 'ORDER_DISPUTE_RESOLVED_RELEASE_PAYOUT',
                entityType: 'ORDER_DISPUTE',
                entityId: dispute.id,
                metadata: {
                    orderId,
                    vendorId,
                    payoutId: payout.id,
                    previousStatus: dispute.status,
                    nextStatus: updatedDispute.status,
                    previousPayoutStatus: payout.status,
                    nextPayoutStatus,
                    note: payload.note,
                },
            });

            return {
                dispute: updatedDispute,
                payout: updatedPayout,
            };
        }

        const updatedDispute = await tx.orderDispute.update({
            where: {
                id: dispute.id,
            },
            data: {
                status: 'REJECTED',
                underReviewAt: dispute.underReviewAt ?? now,
                resolvedAt: now,
            },
        });

        await createAuditLog({
            userId: user.id,
            action: 'ORDER_DISPUTE_REJECTED',
            entityType: 'ORDER_DISPUTE',
            entityId: dispute.id,
            metadata: {
                orderId,
                vendorId,
                payoutId: payout.id,
                previousStatus: dispute.status,
                nextStatus: updatedDispute.status,
                note: payload.note,
            },
        });

        return {
            dispute: updatedDispute,
            payout,
        };
    });

    await addDisputeResolvedEmailJob({
        to: dispute.openedBy.email,
        recipientType: 'customer',
        customerName: dispute.openedBy.fullName,
        disputeId: dispute.id,
        orderId,
        vendorId,
        resolution: payload.resolution,
    });

    await addDisputeResolvedEmailJob({
        to: dispute.vendor.user.email,
        recipientType: 'vendor',
        vendorName: dispute.vendor.storeName,
        disputeId: dispute.id,
        orderId,
        vendorId,
        resolution: payload.resolution,
    });

    return result;
};

export const disputeService = {
    openDispute,
    respondToDispute,
    resolveDispute,
};
