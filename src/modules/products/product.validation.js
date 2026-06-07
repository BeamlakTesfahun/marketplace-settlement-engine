import { z } from "zod";

export const createProductSchema = z.object({
  body: z.object({
    vendorId: z.string().optional(),

    categoryId: z.string().min(1, "Category ID is required"),

    name: z
      .string()
      .trim()
      .min(2, "Product name must be at least 2 characters"),

    description: z.string().trim().max(1000).optional(),

    price: z.coerce.number().positive("Price must be greater than 0"),

    stock: z.coerce
      .number()
      .int("Stock must be an integer")
      .min(0, "Stock cannot be negative"),

    status: z
      .enum(["DRAFT", "ACTIVE", "INACTIVE", "OUT_OF_STOCK", "ARCHIVED"])
      .optional(),

    vendorId: z.string().optional(),
  }),

  params: z.object({}),
  query: z.object({}),
});

export const updateProductSchema = z.object({
  body: z.object({
    categoryId: z.string().optional(),

    name: z.string().trim().min(2).optional(),

    description: z.string().trim().max(1000).optional(),

    price: z.coerce.number().positive().optional(),

    stock: z.coerce.number().int().min(0).optional(),

    status: z
      .enum(["DRAFT", "ACTIVE", "INACTIVE", "OUT_OF_STOCK", "ARCHIVED"])
      .optional(),
  }),

  params: z.object({
    productId: z.string(),
  }),

  query: z.object({}),
});
