import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";

export const createAuditLog = async ({
  userId = null,
  action,
  entityType,
  entityId = null,
  metadata = null,
}) => {
  return prisma.auditLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId,
      metadata,
    },
  });
};

const getAuditLogs = async (query) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 20;
  const skip = (page - 1) * limit;

  const where = {
    ...(query.action && { action: query.action }),
    ...(query.entityType && { entityType: query.entityType }),
    ...(query.entityId && { entityId: query.entityId }),
    ...(query.userId && { userId: query.userId }),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    data: logs,
  };
};

const getAuditLogById = async (auditLogId) => {
  const log = await prisma.auditLog.findUnique({
    where: {
      id: auditLogId,
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
        },
      },
    },
  });

  if (!log) {
    throw new AppError("Audit log not found.", 404, "AUDIT_LOG_NOT_FOUND");
  }

  return log;
};

export const auditService = {
  createAuditLog,
  getAuditLogs,
  getAuditLogById,
};
