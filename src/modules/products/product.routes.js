import express from "express";

import { productController } from "./product.controller.js";

import { protect } from "../../middlewares/authMiddleware.js";
import { authorizeRoles } from "../../middlewares/roleMiddleware.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import { cacheMiddleware } from "../../middlewares/cacheMiddleware.js";

import {
  createProductSchema,
  updateProductSchema,
} from "./product.validation.js";

const router = express.Router();

router.get("/", cacheMiddleware("product", 300), productController.getProducts);

router.post(
  "/",
  protect,
  authorizeRoles("VENDOR", "ADMIN"),
  validateRequest(createProductSchema),
  productController.createProduct,
);

router.get(
  "/my-products",
  protect,
  authorizeRoles("VENDOR", "ADMIN"),
  cacheMiddleware("product", 300),
  productController.getMyProducts,
);

router.get(
  "/:productId",
  cacheMiddleware("product", 300),
  productController.getProductById,
);

router.patch(
  "/:productId",
  protect,
  authorizeRoles("VENDOR", "ADMIN"),
  validateRequest(updateProductSchema),
  productController.updateProduct,
);

router.delete(
  "/:productId",
  protect,
  authorizeRoles("VENDOR", "ADMIN"),
  productController.deleteProduct,
);

export default router;
