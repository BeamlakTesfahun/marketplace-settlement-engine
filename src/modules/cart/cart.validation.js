import { z } from "zod";

export const addCartItemSchema = z.object({
  body: z.object({
    productId: z.string().min(1, "Product ID is required"),
    quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  }),
  params: z.object({}),
  query: z.object({}),
});

export const updateCartItemSchema = z.object({
  body: z.object({
    quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  }),
  params: z.object({
    cartItemId: z.string().min(1, "Cart item ID is required"),
  }),
  query: z.object({}),
});

export const cartItemParamsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    cartItemId: z.string().min(1, "Cart item ID is required"),
  }),
  query: z.object({}),
});
