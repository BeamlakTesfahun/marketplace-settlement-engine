import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { createAuditLog } from "../audit/audit.service.js";

import {
  addPayoutPaidEmailJob,
  addPayoutFailedEmailJob,
  addPayoutReversalEmailJob,
} from "../../jobs/producers/email.producer.js";
import { OPEN_DISPUTE_STATUSES } from "../disputes/dispute.service.js";

const PLATFORM_FEE_PERCENTAGE = 10;
const PAYOUT_HOLD_REASON_PAYMENT = "PAYMENT_CAPTURED";
const DISPUTE_WINDOW_DAYS = 7;

const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const isPayoutPayable = (status) => status === "AVAILABLE";

const isPayoutFailurable = (status) =>
  status === "ON_HOLD" || status === "AVAILABLE";

const resolveRetryStatus = (payout) => {
  const isEligibleForAvailable =
    payout.availableAt && payout.availableAt <= new Date();

  return isEligibleForAvailable ? "AVAILABLE" : "ON_HOLD";
};

const getAllPayouts = async (user) => {
  if (user.role !== "ADMIN") {
    throw new AppError("Only admins can view payouts.", 403, "FORBIDDEN");
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
      createdAt: "desc",
    },
  });
};

const markPayoutAsPaid = async (user, payoutId) => {
  if (user.role !== "ADMIN") {
    throw new AppError(
      "Only admins can mark payouts as paid.",
      403,
      "FORBIDDEN",
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
      order: {
        include: {
          disputes: {
            where: {
              status: {
                in: OPEN_DISPUTE_STATUSES,
              },
            },
          },
        },
      },
    },
  });

  if (!payout) {
    throw new AppError("Payout not found.", 404, "PAYOUT_NOT_FOUND");
  }

  if (payout.status === "ON_HOLD") {
    throw new AppError(
      "Payout is on hold and cannot be paid yet.",
      400,
      "PAYOUT_ON_HOLD",
    );
  }

  if (!isPayoutPayable(payout.status)) {
    throw new AppError(
      "Only available payouts can be marked as paid.",
      400,
      "PAYOUT_NOT_PAYABLE",
    );
  }

  if (payout.order.disputes.length > 0) {
    const hasOpenVendorDispute = payout.order.disputes.some(
      (dispute) => dispute.vendorId === payout.vendorId,
    );

    if (hasOpenVendorDispute) {
      throw new AppError(
        "Payout cannot be paid while the order has an open dispute.",
        400,
        "PAYOUT_BLOCKED_BY_DISPUTE",
      );
    }
  }

  const updatedPayout = await prisma.vendorPayout.update({
    where: {
      id: payoutId,
    },
    data: {
      status: "PAID",
      paidAt: new Date(),
    },
  });

  await createAuditLog({
    userId: user.id,
    action: "PAYOUT_MARKED_PAID",
    entityType: "VENDOR_PAYOUT",
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

  await createLedgerEntry({
    vendorId: payout.vendorId,
    type: "PAYOUT_PAID",
    amount: Number(payout.payoutAmount),
    referenceType: "VENDOR_PAYOUT",
    referenceId: payout.id,
    reason: "PAYOUT_MARKED_PAID",
  });

  return updatedPayout;
};

const markPayoutAsFailed = async (user, payoutId, reason) => {
  if (user.role !== "ADMIN") {
    throw new AppError(
      "Only admins can mark payouts as failed.",
      403,
      "FORBIDDEN",
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
    throw new AppError("Payout not found.", 404, "PAYOUT_NOT_FOUND");
  }

  if (!isPayoutFailurable(payout.status)) {
    throw new AppError(
      "Only on-hold or available payouts can be marked as failed.",
      400,
      "PAYOUT_NOT_FAILABLE",
    );
  }

  const updatedPayout = await prisma.vendorPayout.update({
    where: {
      id: payoutId,
    },
    data: {
      status: "FAILED",
      failureReason: reason,
    },
  });

  await createAuditLog({
    userId: user.id,
    action: "PAYOUT_MARKED_FAILED",
    entityType: "VENDOR_PAYOUT",
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
        status: "ON_HOLD",
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
      status: "ON_HOLD",
    },
    data: {
      availableAt,
    },
  });

  return tx.vendorPayout.findMany({
    where: {
      orderId,
      status: "ON_HOLD",
    },
  });
};

const releaseEligiblePayouts = async (now = new Date()) => {
  const candidatePayouts = await prisma.vendorPayout.findMany({
    where: {
      status: "ON_HOLD",
      availableAt: {
        lte: now,
      },
    },
    include: {
      order: {
        include: {
          disputes: {
            where: {
              status: {
                in: OPEN_DISPUTE_STATUSES,
              },
            },
          },
        },
      },
    },
  });

  const eligiblePayouts = candidatePayouts.filter((payout) => {
    return !payout.order.disputes.some(
      (dispute) => dispute.vendorId === payout.vendorId,
    );
  });

  if (eligiblePayouts.length === 0) {
    return [];
  }

  const releasedPayoutIds = [];

  for (const payout of eligiblePayouts) {
    const result = await prisma.vendorPayout.updateMany({
      where: {
        id: payout.id,
        status: "ON_HOLD",
        order: {
          disputes: {
            none: {
              vendorId: payout.vendorId,
              status: {
                in: OPEN_DISPUTE_STATUSES,
              },
            },
          },
        },
      },
      data: {
        status: "AVAILABLE",
      },
    });

    if (result.count > 0) {
      releasedPayoutIds.push(payout.id);
    }
  }

  if (releasedPayoutIds.length === 0) {
    return [];
  }

  const releasedPayouts = await prisma.vendorPayout.findMany({
    where: {
      id: {
        in: releasedPayoutIds,
      },
      status: "AVAILABLE",
    },
  });

  for (const payout of releasedPayouts) {
    await createAuditLog({
      action: "PAYOUT_RELEASED",
      entityType: "VENDOR_PAYOUT",
      entityId: payout.id,
      metadata: {
        orderId: payout.orderId,
        vendorId: payout.vendorId,
        availableAt: payout.availableAt,
        releasedAt: now,
      },
    });
  }

  return releasedPayouts;
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
      createdAt: "desc",
    },
  });
};

const getMyVendorPayouts = async (user) => {
  if (user.role !== "VENDOR") {
    throw new AppError(
      "Only vendors can view their payouts.",
      403,
      "FORBIDDEN",
    );
  }

  const vendor = await prisma.vendor.findUnique({
    where: {
      userId: user.id,
    },
  });

  if (!vendor) {
    throw new AppError(
      "Vendor profile not found.",
      404,
      "VENDOR_PROFILE_NOT_FOUND",
    );
  }

  return getVendorPayouts(vendor.id);
};

const retryFailedPayout = async (user, payoutId) => {
  if (user.role !== "ADMIN") {
    throw new AppError("Only admins can retry payouts.", 403, "FORBIDDEN");
  }

  const payout = await prisma.vendorPayout.findUnique({
    where: {
      id: payoutId,
    },
  });

  if (!payout) {
    throw new AppError("Payout not found.", 404, "PAYOUT_NOT_FOUND");
  }

  if (payout.status !== "FAILED") {
    throw new AppError(
      "Only failed payouts can be retried.",
      400,
      "PAYOUT_NOT_FAILED",
    );
  }

  const openDisputeCount = await prisma.orderDispute.count({
    where: {
      orderId: payout.orderId,
      vendorId: payout.vendorId,
      status: {
        in: OPEN_DISPUTE_STATUSES,
      },
    },
  });

  const nextStatus =
    openDisputeCount > 0 ? "ON_HOLD" : resolveRetryStatus(payout);

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
    action: "PAYOUT_RETRIED",
    entityType: "VENDOR_PAYOUT",
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

const getVendorBalance = async (vendorId, db = prisma) => {
  const latestEntry = await db.vendorLedgerEntry.findFirst({
    where: {
      vendorId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return latestEntry ? Number(latestEntry.balanceAfter) : 0;
};

const createLedgerEntry = async (
  { vendorId, type, amount, referenceType, referenceId, reason },
  db = prisma,
) => {
  const currentBalance = await getVendorBalance(vendorId, db);
  const numericAmount = Number(amount);
  const balanceAfter = currentBalance + numericAmount;

  return db.vendorLedgerEntry.create({
    data: {
      vendorId,
      type,
      amount: numericAmount,
      balanceAfter,
      referenceType,
      referenceId,
      reason,
    },
  });
};

const calculateProportionalPayoutReversal = (payout, order, refundAmount) => {
  const orderTotal = Number(order.totalAmount);

  if (orderTotal <= 0) {
    return Number(payout.payoutAmount);
  }

  const ratio = Number(refundAmount) / orderTotal;
  const reversalAmount = Number(payout.payoutAmount) * ratio;

  return Math.min(
    Number(payout.payoutAmount),
    Number(reversalAmount.toFixed(2)),
  );
};

const createPayoutReversalForRefund = async (
  { payout, amount, reason },
  db = prisma,
) => {
  return db.payoutReversal.create({
    data: {
      payoutId: payout.id,
      vendorId: payout.vendorId,
      orderId: payout.orderId,
      amount,
      reason,
    },
  });
};

const applyRefundAgainstPayout = async (
  {
    orderId,
    vendorId,
    refundAmount,
    reason = "REFUND_APPROVED",
    referenceType = "ORDER",
    referenceId = orderId,
    actorId,
  },
  db = prisma,
) => {
  const payout = await db.vendorPayout.findUnique({
    where: {
      orderId_vendorId: {
        orderId,
        vendorId,
      },
    },
    include: {
      order: true,
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
    throw new AppError(
      "Vendor payout not found for refund settlement.",
      404,
      "VENDOR_PAYOUT_NOT_FOUND",
    );
  }

  const reversalAmount = calculateProportionalPayoutReversal(
    payout,
    payout.order,
    refundAmount,
  );

  if (payout.status === "PAID") {
    const reversal = await createPayoutReversalForRefund(
      {
        payout,
        amount: reversalAmount,
        reason,
      },
      db,
    );

    const ledgerEntry = await createLedgerEntry(
      {
        vendorId,
        type: "VENDOR_DEBIT",
        amount: -reversalAmount,
        referenceType: "PAYOUT_REVERSAL",
        referenceId: reversal.id,
        reason,
      },
      db,
    );

    await createAuditLog({
      userId: actorId,
      action: "PAYOUT_REVERSAL_CREATED",
      entityType: "PAYOUT_REVERSAL",
      entityId: reversal.id,
      metadata: {
        orderId,
        vendorId,
        payoutId: payout.id,
        refundAmount: Number(refundAmount),
        reversalAmount,
        previousPayoutStatus: payout.status,
        reason,
      },
    });

    await addPayoutReversalEmailJob({
      to: payout.vendor.user.email,
      vendorName: payout.vendor.storeName,
      payoutId: payout.id,
      orderId,
      vendorId,
      reversalId: reversal.id,
      referenceId,
      reversalAmount,
      reason,
    });

    return {
      payout,
      reversal,
      ledgerEntry,
      reversalAmount,
      mode: "PAID_PAYOUT_DEBITED",
    };
  }

  if (payout.status === "ON_HOLD" || payout.status === "AVAILABLE") {
    const updatedPayout = await db.vendorPayout.update({
      where: {
        id: payout.id,
      },
      data: {
        status: "REVERSED",
        holdReason: "REFUND_REVERSED",
      },
    });

    const ledgerEntry = await createLedgerEntry(
      {
        vendorId,
        type: "REFUND_REVERSAL",
        amount: -reversalAmount,
        referenceType,
        referenceId,
        reason,
      },
      db,
    );

    await createAuditLog({
      userId: actorId,
      action: "PAYOUT_REVERSED_FOR_REFUND",
      entityType: "VENDOR_PAYOUT",
      entityId: payout.id,
      metadata: {
        orderId,
        vendorId,
        payoutId: payout.id,
        refundAmount: Number(refundAmount),
        reversalAmount,
        previousPayoutStatus: payout.status,
        nextPayoutStatus: updatedPayout.status,
        reason,
      },
    });

    await addPayoutReversalEmailJob({
      to: payout.vendor.user.email,
      vendorName: payout.vendor.storeName,
      payoutId: payout.id,
      orderId,
      vendorId,
      referenceId,
      reversalAmount,
      reason,
    });

    return {
      payout: updatedPayout,
      reversal: null,
      ledgerEntry,
      reversalAmount,
      mode: "HELD_PAYOUT_REVERSED",
    };
  }

  throw new AppError(
    "Refund cannot be applied to this payout status.",
    400,
    "PAYOUT_NOT_REVERSIBLE",
  );
};
export const payoutService = {
  createPayoutsForOrder,
  markPayoutsAvailableForDeliveredOrder,
  releaseEligiblePayouts,
  getVendorPayouts,
  getMyVendorPayouts,
  getAllPayouts,
  markPayoutAsPaid,
  markPayoutAsFailed,
  retryFailedPayout,
  createLedgerEntry,
  getVendorBalance,
  createPayoutReversalForRefund,
  applyRefundAgainstPayout,
};
