import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { categoryService } from "./category.service.js";

const createCategory = asyncHandler(async (req, res) => {
  const result = await categoryService.createCategory(req.validatedData.body);

  return sendResponse(res, 201, "Category created successfully.", result);
});

const getCategories = asyncHandler(async (req, res) => {
  const result = await categoryService.getCategories();

  return sendResponse(res, 200, "Categories fetched successfully.", result);
});

const getCategoryById = asyncHandler(async (req, res) => {
  const result = await categoryService.getCategoryById(req.params.categoryId);

  return sendResponse(res, 200, "Category fetched successfully.", result);
});

const updateCategory = asyncHandler(async (req, res) => {
  const result = await categoryService.updateCategory(
    req.params.categoryId,
    req.validatedData.body,
  );

  return sendResponse(res, 200, "Category updated successfully.", result);
});

const deleteCategory = asyncHandler(async (req, res) => {
  await categoryService.deleteCategory(req.params.categoryId);

  return sendResponse(res, 200, "Category deleted successfully.");
});

export const categoryController = {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
};
