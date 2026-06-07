import { z } from "zod";

export const createCategorySchema = z.object({
  body: z.object({
    name: z
      .string()
      .trim()
      .min(2, "Category name must be at least 2 characters"),
    description: z.string().trim().max(500).optional(),
  }),

  params: z.object({}),
  query: z.object({}),
});

export const updateCategorySchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).optional(),
    description: z.string().trim().max(500).optional(),
  }),

  params: z.object({
    categoryId: z.string(),
  }),

  query: z.object({}),
});
