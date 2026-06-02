import { z } from 'zod';

export const createCouponSchema = z.object({
    body: z.object({
        code: z.string().trim().min(3),
        type: z.enum(['FIXED', 'PERCENTAGE']),
        value: z.number().positive(),
        expiresAt: z.string().datetime().optional(),
        usageLimit: z.number().int().positive().optional(),
        perUserLimit: z.number().int().positive().optional(),
        vendorId: z.string().optional(),
    }),
    params: z.object({}),
    query: z.object({}),
});

export const couponIdParamSchema = z.object({
    body: z.object({}),
    params: z.object({
        couponId: z.string().min(1),
    }),
    query: z.object({}),
});
