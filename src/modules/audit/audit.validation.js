import { z } from 'zod';

export const getAuditLogsSchema = z.object({
    body: z.object({}),
    params: z.object({}),
    query: z.object({
        page: z.string().optional(),
        limit: z.string().optional(),
        action: z.string().optional(),
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        userId: z.string().optional(),
    }),
});

export const auditLogIdParamSchema = z.object({
    body: z.object({}),
    params: z.object({
        auditLogId: z.string().min(1, 'Audit log ID is required'),
    }),
    query: z.object({}),
});
