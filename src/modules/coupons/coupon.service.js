import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";

const createCoupon = async (user, payload) => {
  if (user.role !== "ADMIN") {
    throw new AppError("Only admins can create coupons.", 403, "FORBIDDEN");
  }

  const existingCoupon = await prisma.coupon.findUnique({
    where: {
      code: payload.code.toUpperCase(),
    },
  });

  if (existingCoupon) {
    throw new AppError(
      "Coupon code already exists.",
      409,
      "COUPON_ALREADY_EXISTS",
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
  if (user.role !== "ADMIN") {
    throw new AppError("Only admins can view coupons.", 403, "FORBIDDEN");
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
      createdAt: "desc",
    },
  });
};

const deactivateCoupon = async (user, couponId) => {
  if (user.role !== "ADMIN") {
    throw new AppError("Only admins can deactivate coupons.", 403, "FORBIDDEN");
  }

  const coupon = await prisma.coupon.findUnique({
    where: {
      id: couponId,
    },
  });

  if (!coupon) {
    throw new AppError("Coupon not found.", 404, "COUPON_NOT_FOUND");
  }

  return prisma.coupon.update({
    where: {
      id: couponId,
    },
    data: {
      status: "INACTIVE",
    },
  });
};

const getCouponById = async (user, couponId) => {
  if (user.role !== "ADMIN") {
    throw new AppError("Only admins can view coupons.", 403, "FORBIDDEN");
  }

  const coupon = await prisma.coupon.findUnique({
    where: {
      id: couponId,
    },
    include: {
      vendor: {
        select: {
          id: true,
          storeName: true,
        },
      },
      usages: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          order: {
            select: {
              id: true,
              totalAmount: true,
              status: true,
              paymentStatus: true,
            },
          },
        },
      },
    },
  });

  if (!coupon) {
    throw new AppError("Coupon not found.", 404, "COUPON_NOT_FOUND");
  }

  return coupon;
};

const updateCoupon = async (user, couponId, payload) => {
  if (user.role !== "ADMIN") {
    throw new AppError("Only admins can update coupons.", 403, "FORBIDDEN");
  }

  const coupon = await prisma.coupon.findUnique({
    where: {
      id: couponId,
    },
  });

  if (!coupon) {
    throw new AppError("Coupon not found.", 404, "COUPON_NOT_FOUND");
  }

  if (payload.code) {
    const existingCoupon = await prisma.coupon.findUnique({
      where: {
        code: payload.code.toUpperCase(),
      },
    });

    if (existingCoupon && existingCoupon.id !== couponId) {
      throw new AppError(
        "Coupon code already exists.",
        409,
        "COUPON_ALREADY_EXISTS",
      );
    }
  }

  return prisma.coupon.update({
    where: {
      id: couponId,
    },
    data: {
      ...(payload.code && { code: payload.code.toUpperCase() }),
      ...(payload.type && { type: payload.type }),
      ...(payload.value !== undefined && { value: payload.value }),
      ...(payload.status && { status: payload.status }),
      ...(payload.expiresAt !== undefined && {
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
      }),
      ...(payload.usageLimit !== undefined && {
        usageLimit: payload.usageLimit,
      }),
      ...(payload.perUserLimit !== undefined && {
        perUserLimit: payload.perUserLimit,
      }),
      ...(payload.vendorId !== undefined && {
        vendorId: payload.vendorId,
      }),
    },
  });
};

export const couponService = {
  createCoupon,
  getCoupons,
  deactivateCoupon,
  getCouponById,
  updateCoupon,
};
