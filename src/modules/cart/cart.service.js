import { prisma } from "../../config/prisma.js";
import { AppError } from "../../utils/AppError.js";

const getOrCreateCart = async (userId) => {
  let cart = await prisma.cart.findUnique({
    where: {
      userId,
    },
  });

  if (!cart) {
    cart = await prisma.cart.create({
      data: {
        userId,
      },
    });
  }

  return cart;
};

const addItemToCart = async (user, payload) => {
  if (user.role !== "CUSTOMER") {
    throw new AppError(
      "Only customers can add items to cart.",
      403,
      "FORBIDDEN",
    );
  }

  const product = await prisma.product.findUnique({
    where: {
      id: payload.productId,
    },
  });

  if (!product) {
    throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
  }

  if (product.status !== "ACTIVE") {
    throw new AppError(
      "Product is not available for purchase.",
      400,
      "PRODUCT_NOT_AVAILABLE",
    );
  }

  if (product.stock < payload.quantity) {
    throw new AppError(
      "Insufficient product stock.",
      400,
      "INSUFFICIENT_STOCK",
    );
  }

  const cart = await getOrCreateCart(user.id);

  const existingItem = await prisma.cartItem.findUnique({
    where: {
      cartId_productId: {
        cartId: cart.id,
        productId: product.id,
      },
    },
  });

  if (existingItem) {
    const newQuantity = existingItem.quantity + payload.quantity;

    if (product.stock < newQuantity) {
      throw new AppError(
        "Insufficient product stock.",
        400,
        "INSUFFICIENT_STOCK",
      );
    }

    return prisma.cartItem.update({
      where: {
        id: existingItem.id,
      },
      data: {
        quantity: newQuantity,
      },
      include: {
        product: true,
      },
    });
  }

  return prisma.cartItem.create({
    data: {
      cartId: cart.id,
      productId: product.id,
      quantity: payload.quantity,
    },
    include: {
      product: true,
    },
  });
};

const getMyCart = async (user) => {
  if (user.role !== "CUSTOMER") {
    throw new AppError("Only customers can view cart.", 403, "FORBIDDEN");
  }

  const cart = await prisma.cart.findUnique({
    where: {
      userId: user.id,
    },
    include: {
      items: {
        include: {
          product: {
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
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!cart) {
    return {
      items: [],
      totalItems: 0,
      totalAmount: 0,
    };
  }

  const totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);

  const totalAmount = cart.items.reduce((sum, item) => {
    return sum + Number(item.product.price) * item.quantity;
  }, 0);

  return {
    id: cart.id,
    items: cart.items,
    totalItems,
    totalAmount,
  };
};

const updateCartItem = async (user, cartItemId, payload) => {
  if (user.role !== "CUSTOMER") {
    throw new AppError("Only customers can update cart.", 403, "FORBIDDEN");
  }

  const cartItem = await prisma.cartItem.findUnique({
    where: {
      id: cartItemId,
    },
    include: {
      cart: true,
      product: true,
    },
  });

  if (!cartItem) {
    throw new AppError("Cart item not found.", 404, "CART_ITEM_NOT_FOUND");
  }

  if (cartItem.cart.userId !== user.id) {
    throw new AppError(
      "You are not allowed to update this cart item.",
      403,
      "FORBIDDEN",
    );
  }

  if (cartItem.product.stock < payload.quantity) {
    throw new AppError(
      "Insufficient product stock.",
      400,
      "INSUFFICIENT_STOCK",
    );
  }

  return prisma.cartItem.update({
    where: {
      id: cartItemId,
    },
    data: {
      quantity: payload.quantity,
    },
    include: {
      product: true,
    },
  });
};

const removeCartItem = async (user, cartItemId) => {
  if (user.role !== "CUSTOMER") {
    throw new AppError(
      "Only customers can remove cart items.",
      403,
      "FORBIDDEN",
    );
  }

  const cartItem = await prisma.cartItem.findUnique({
    where: {
      id: cartItemId,
    },
    include: {
      cart: true,
    },
  });

  if (!cartItem) {
    throw new AppError("Cart item not found.", 404, "CART_ITEM_NOT_FOUND");
  }

  if (cartItem.cart.userId !== user.id) {
    throw new AppError(
      "You are not allowed to remove this cart item.",
      403,
      "FORBIDDEN",
    );
  }

  await prisma.cartItem.delete({
    where: {
      id: cartItemId,
    },
  });
};

const clearMyCart = async (user) => {
  if (user.role !== "CUSTOMER") {
    throw new AppError("Only customers can clear cart.", 403, "FORBIDDEN");
  }

  const cart = await prisma.cart.findUnique({
    where: {
      userId: user.id,
    },
  });

  if (!cart) {
    return;
  }

  await prisma.cartItem.deleteMany({
    where: {
      cartId: cart.id,
    },
  });
};

export const cartService = {
  addItemToCart,
  getMyCart,
  updateCartItem,
  removeCartItem,
  clearMyCart,
};
