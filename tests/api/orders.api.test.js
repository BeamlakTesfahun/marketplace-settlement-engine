import request from "supertest";
import { jest } from "@jest/globals";

jest.unstable_mockModule("../../src/config/stripe.js", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id: "cs_test_mock",
          url: "https://checkout.stripe.com/mock-session",
        }),
      },
    },
  },
}));

const { default: app } = await import("../../src/app.js");

import { prisma } from "../../src/config/prisma.js";
import { generateToken } from "../../src/utils/generateToken.js";

describe("Orders API", () => {
  let customer;
  let vendor;
  let category;
  let product;
  let token;

  beforeEach(async () => {
    await prisma.cartItem.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.vendor.deleteMany();
    await prisma.user.deleteMany();

    customer = await prisma.user.create({
      data: {
        fullName: "Customer User",
        email: "customer-api@test.com",
        password: "hashed-password",
        role: "CUSTOMER",
      },
    });

    const vendorUser = await prisma.user.create({
      data: {
        fullName: "Vendor User",
        email: "vendor-api@test.com",
        password: "hashed-password",
        role: "VENDOR",
      },
    });

    vendor = await prisma.vendor.create({
      data: {
        userId: vendorUser.id,
        storeName: "API Store",
        status: "APPROVED",
      },
    });

    category = await prisma.category.create({
      data: {
        name: "API Category",
        slug: "api-category",
      },
    });

    product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId: category.id,
        name: "API Product",
        slug: "api-product",
        price: 50,
        stock: 10,
        status: "ACTIVE",
      },
    });

    const cart = await prisma.cart.create({
      data: {
        userId: customer.id,
      },
    });

    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        quantity: 2,
      },
    });

    token = generateToken(customer.id);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects unauthenticated checkout requests", async () => {
    const response = await request(app).post("/api/v1/orders/checkout");

    expect(response.status).toBe(401);
  });

  it("creates an order successfully from cart", async () => {
    const response = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${token}`);

    // console.log(response.body);
    expect(response.status).toBe(201);

    expect(response.body.success).toBe(true);

    expect(response.body.data.orderId).toBeTruthy();
    expect(response.body.data.checkoutUrl).toBeTruthy();

    const order = await prisma.order.findUnique({
      where: {
        id: response.body.data.orderId,
      },
      include: {
        items: true,
      },
    });

    expect(order).toBeTruthy();
    expect(order.items).toHaveLength(1);
    expect(Number(order.totalAmount)).toBe(100);

    const updatedProduct = await prisma.product.findUnique({
      where: {
        id: product.id,
      },
    });

    expect(updatedProduct.stock).toBe(8);

    const cartItems = await prisma.cartItem.findMany({
      where: {
        cart: {
          userId: customer.id,
        },
      },
    });
    expect(cartItems).toHaveLength(0);
  });

  it("rejects checkout when cart is empty", async () => {
    await prisma.cartItem.deleteMany();

    const response = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${token}`);

    // console.log(response.body);
    expect(response.status).toBe(400);

    expect(response.body.success).toBe(false);
  });
});
