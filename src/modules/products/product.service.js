import slugify from "slugify";

import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";

import { clearCacheByPattern } from "../../utils/cache.js";

const generateSlug = (name) => {
  return slugify(name, {
    lower: true,
    strict: true,
  });
};

const getVendorForProductCreation = async (user, payload) => {
  if (user.role === "VENDOR") {
    const vendor = await prisma.vendor.findUnique({
      where: {
        userId: user.id,
      },
    });

    if (!vendor) {
      throw new AppError(
        "Vendor profile is required to create products.",
        403,
        "VENDOR_PROFILE_REQUIRED",
      );
    }

    if (vendor.status !== "APPROVED") {
      throw new AppError(
        "Your vendor profile must be approved before creating products.",
        403,
        "VENDOR_NOT_APPROVED",
      );
    }

    return vendor;
  }

  if (user.role === "ADMIN") {
    if (!payload.vendorId) {
      throw new AppError(
        "Vendor ID is required when admin creates a product.",
        400,
        "VENDOR_ID_REQUIRED",
      );
    }

    const vendor = await prisma.vendor.findUnique({
      where: {
        id: payload.vendorId,
      },
    });

    if (!vendor) {
      throw new AppError(
        "Vendor profile not found.",
        404,
        "VENDOR_PROFILE_NOT_FOUND",
      );
    }

    if (vendor.status !== "APPROVED") {
      throw new AppError(
        "Selected vendor must be approved before products can be created.",
        403,
        "VENDOR_NOT_APPROVED",
      );
    }

    return vendor;
  }

  throw new AppError(
    "Only vendors or admins can create products.",
    403,
    "FORBIDDEN",
  );
};

const createProduct = async (user, payload) => {
  const vendor = await getVendorForProductCreation(user, payload);

  const category = await prisma.category.findUnique({
    where: {
      id: payload.categoryId,
    },
  });

  if (!category) {
    throw new AppError("Category not found.", 404, "CATEGORY_NOT_FOUND");
  }

  const slug = generateSlug(payload.name);

  const existingProduct = await prisma.product.findUnique({
    where: {
      slug,
    },
  });

  if (existingProduct) {
    throw new AppError(
      "Product with this name already exists.",
      409,
      "PRODUCT_ALREADY_EXISTS",
    );
  }

  const product = await prisma.product.create({
    data: {
      vendorId: vendor.id,
      categoryId: payload.categoryId,
      name: payload.name,
      slug,
      description: payload.description,
      price: payload.price,
      stock: payload.stock,
      status: payload.status || "DRAFT",
    },
    include: {
      vendor: {
        select: {
          id: true,
          storeName: true,
          status: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  await clearCacheByPattern("products:*");
  await clearCacheByPattern("product:*");

  return product;
};

const getProducts = async () => {
  return prisma.product.findMany({
    where: {
      status: "ACTIVE",
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      vendor: {
        select: {
          id: true,
          storeName: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });
};

const getProductById = async (productId) => {
  const product = await prisma.product.findUnique({
    where: {
      id: productId,
    },
    include: {
      vendor: {
        select: {
          id: true,
          storeName: true,
          status: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!product) {
    throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
  }

  return product;
};

const getMyProducts = async (user) => {
  const vendor = await prisma.vendor.findUnique({
    where: {
      userId: user.id,
    },
  });

  if (!vendor) {
    throw new AppError(
      "Vendor profile not found.",
      404,
      "VENDOR_PROFILE_NOT_FOUND",
    );
  }

  return prisma.product.findMany({
    where: {
      vendorId: vendor.id,
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });
};

const updateProduct = async (user, productId, payload) => {
  const product = await prisma.product.findUnique({
    where: {
      id: productId,
    },
  });

  if (!product) {
    throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
  }

  if (user.role === "VENDOR") {
    const vendor = await prisma.vendor.findUnique({
      where: {
        userId: user.id,
      },
    });

    if (!vendor || product.vendorId !== vendor.id) {
      throw new AppError(
        "You are not allowed to update this product.",
        403,
        "FORBIDDEN",
      );
    }
  }

  if (user.role !== "VENDOR" && user.role !== "ADMIN") {
    throw new AppError(
      "You are not allowed to update this product.",
      403,
      "FORBIDDEN",
    );
  }

  if (payload.categoryId) {
    const category = await prisma.category.findUnique({
      where: {
        id: payload.categoryId,
      },
    });

    if (!category) {
      throw new AppError("Category not found.", 404, "CATEGORY_NOT_FOUND");
    }
  }

  let slug = product.slug;

  if (payload.name) {
    slug = generateSlug(payload.name);

    const existingProduct = await prisma.product.findFirst({
      where: {
        slug,
        NOT: {
          id: productId,
        },
      },
    });

    if (existingProduct) {
      throw new AppError(
        "Product with this name already exists.",
        409,
        "PRODUCT_ALREADY_EXISTS",
      );
    }
  }

  const updatedProduct = await prisma.product.update({
    where: {
      id: productId,
    },
    data: {
      categoryId: payload.categoryId ?? product.categoryId,
      name: payload.name ?? product.name,
      slug,
      description: payload.description ?? product.description,
      price: payload.price ?? product.price,
      stock: payload.stock ?? product.stock,
      status: payload.status ?? product.status,
    },
    include: {
      vendor: {
        select: {
          id: true,
          storeName: true,
          status: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  await clearCacheByPattern("products:*");
  await clearCacheByPattern("product:*");

  return updatedProduct;
};

const deleteProduct = async (user, productId) => {
  const product = await prisma.product.findUnique({
    where: {
      id: productId,
    },
  });

  if (!product) {
    throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
  }

  if (user.role === "VENDOR") {
    const vendor = await prisma.vendor.findUnique({
      where: {
        userId: user.id,
      },
    });

    if (!vendor || product.vendorId !== vendor.id) {
      throw new AppError(
        "You are not allowed to delete this product.",
        403,
        "FORBIDDEN",
      );
    }
  }

  if (user.role !== "VENDOR" && user.role !== "ADMIN") {
    throw new AppError(
      "You are not allowed to delete this product.",
      403,
      "FORBIDDEN",
    );
  }

  await prisma.product.delete({
    where: {
      id: productId,
    },
  });

  await clearCacheByPattern("products:*");
  await clearCacheByPattern("product:*");
};

export const productService = {
  createProduct,
  getProducts,
  getProductById,
  getMyProducts,
  updateProduct,
  deleteProduct,
};
