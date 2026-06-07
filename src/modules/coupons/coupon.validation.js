import { z } from "zod";

export const createCouponSchema = z.object({
  body: z.object({
    code: z.string().trim().min(3),
    type: z.enum(["FIXED", "PERCENTAGE"]),
    value: z.number().positive(),
    expiresAt: z.string().datetime().optional(),
    usageLimit: z.number().int().positive().optional(),
    perUserLimit: z.number().int().positive().optional(),
    vendorId: z.string().optional(),
  }),
  params: z.object({}),
  query: z.object({}),
});

export const updateCouponSchema = z.object({
  body: z.object({
    code: z.string().trim().min(3).optional(),
    type: z.enum(["FIXED", "PERCENTAGE"]).optional(),
    value: z.number().positive().optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "EXPIRED"]).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    usageLimit: z.number().int().positive().nullable().optional(),
    perUserLimit: z.number().int().positive().nullable().optional(),
    vendorId: z.string().nullable().optional(),
  }),
  params: z.object({
    couponId: z.string().min(1),
  }),
  query: z.object({}),
});

export const couponIdParamSchema = z.object({
  body: z.object({}),
  params: z.object({
    couponId: z.string().min(1),
  }),
  query: z.object({}),
});
