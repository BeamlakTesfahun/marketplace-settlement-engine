import { prisma } from "../../config/prisma.js";

export const createOrderStatusHistory = async ({
  orderId,
  actorId = null,
  fromStatus = null,
  toStatus,
  reason = null,
  metadata = null,
}) => {
  return prisma.orderStatusHistory.create({
    data: {
      orderId,
      actorId,
      fromStatus,
      toStatus,
      reason,
      metadata,
    },
  });
};
