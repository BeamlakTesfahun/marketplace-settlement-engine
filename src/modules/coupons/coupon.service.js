import { prisma } from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const createCoupon = async (user, payload) => {
    if (user.role !== 'ADMIN') {
        throw new AppError('Only admins can create coupons.', 403, 'FORBIDDEN');
    }

    const existingCoupon = await prisma.coupon.findUnique({
        where: {
            code: payload.code.toUpperCase(),
        },
    });

    if (existingCoupon) {
        throw new AppError(
            'Coupon code already exists.',
            409,
            'COUPON_ALREADY_EXISTS',
        );
    }

    return prisma.coupon.create({
        data: {
            ...payload,
            code: payload.code.toUpperCase(),
            expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
        },
    });
};

const getCoupons = async (user) => {
    if (user.role !== 'ADMIN') {
        throw new AppError('Only admins can view coupons.', 403, 'FORBIDDEN');
    }

    return prisma.coupon.findMany({
        include: {
            vendor: {
                select: {
                    id: true,
                    storeName: true,
                },
            },
        },
        orderBy: {
            createdAt: 'desc',
        },
    });
};

const deactivateCoupon = async (user, couponId) => {
    if (user.role !== 'ADMIN') {
        throw new AppError(
            'Only admins can deactivate coupons.',
            403,
            'FORBIDDEN',
        );
    }

    const coupon = await prisma.coupon.findUnique({
        where: {
            id: couponId,
        },
    });

    if (!coupon) {
        throw new AppError('Coupon not found.', 404, 'COUPON_NOT_FOUND');
    }

    return prisma.coupon.update({
        where: {
            id: couponId,
        },
        data: {
            status: 'INACTIVE',
        },
    });
};

export const couponService = {
    createCoupon,
    getCoupons,
    deactivateCoupon,
};
