import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { productService } from "./product.service.js";

const createProduct = asyncHandler(async (req, res) => {
  const result = await productService.createProduct(
    req.user,
    req.validatedData.body,
  );

  return sendResponse(res, 201, "Product created successfully.", result);
});

const getProducts = asyncHandler(async (req, res) => {
  const result = await productService.getProducts();

  return sendResponse(res, 200, "Products fetched successfully.", result);
});

const getProductById = asyncHandler(async (req, res) => {
  const result = await productService.getProductById(req.params.productId);

  return sendResponse(res, 200, "Product fetched successfully.", result);
});

const getMyProducts = asyncHandler(async (req, res) => {
  const result = await productService.getMyProducts(req.user);

  return sendResponse(res, 200, "My products fetched successfully.", result);
});

const updateProduct = asyncHandler(async (req, res) => {
  const result = await productService.updateProduct(
    req.user,
    req.params.productId,
    req.validatedData.body,
  );

  return sendResponse(res, 200, "Product updated successfully.", result);
});

const deleteProduct = asyncHandler(async (req, res) => {
  await productService.deleteProduct(req.user, req.params.productId);

  return sendResponse(res, 200, "Product deleted successfully.");
});

export const productController = {
  createProduct,
  getProducts,
  getProductById,
  getMyProducts,
  updateProduct,
  deleteProduct,
};
