import express from "express";

import { categoryController } from "./category.controller.js";

import { protect } from "../../middlewares/authMiddleware.js";
import { authorizeRoles } from "../../middlewares/roleMiddleware.js";

import { validateRequest } from "../../middlewares/validateRequest.js";
import { cacheMiddleware } from "../../middlewares/cacheMiddleware.js";

import {
  createCategorySchema,
  updateCategorySchema,
} from "./category.validation.js";

const router = express.Router();

router.post(
  "/",
  protect,
  authorizeRoles("ADMIN"),
  validateRequest(createCategorySchema),
  categoryController.createCategory,
);

router.get(
  "/",
  cacheMiddleware("category", 300),
  categoryController.getCategories,
);

router.get(
  "/:categoryId",
  cacheMiddleware("category", 300),
  categoryController.getCategoryById,
);

router.patch(
  "/:categoryId",
  protect,
  authorizeRoles("ADMIN"),
  validateRequest(updateCategorySchema),
  categoryController.updateCategory,
);

router.delete(
  "/:categoryId",
  protect,
  authorizeRoles("ADMIN"),
  categoryController.deleteCategory,
);

export default router;
