import { z } from "zod";

export const createVendorProfileSchema = z.object({
  body: z.object({
    storeName: z
      .string()
      .trim()
      .min(2, "Store name must be at least 2 characters"),

    description: z
      .string()
      .trim()
      .max(500, "Description must be at most 500 characters")
      .optional(),
  }),

  params: z.object({}),
  query: z.object({}),
});

export const updateVendorStatusSchema = z.object({
  body: z.object({
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  }),

  params: z.object({
    vendorId: z.string(),
  }),

  query: z.object({}),
});
