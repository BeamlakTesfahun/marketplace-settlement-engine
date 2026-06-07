import { prisma } from "../../src/config/prisma.js";
import { orderService } from "../../src/modules/orders/order.service.js";

describe("Order checkout workflow", () => {
  beforeEach(async () => {
    await prisma.cartItem.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.vendor.deleteMany();
    await prisma.user.deleteMany();
  });

  it("creates an order from cart, decrements stock, and clears cart", async () => {
    const customer = await prisma.user.create({
      data: {
        fullName: "Customer User",
        email: "customer-workflow@test.com",
        password: "hashed-password",
        role: "CUSTOMER",
      },
    });

    const vendorUser = await prisma.user.create({
      data: {
        fullName: "Vendor User",
        email: "vendor-workflow@test.com",
        password: "hashed-password",
        role: "VENDOR",
      },
    });

    const vendor = await prisma.vendor.create({
      data: {
        userId: vendorUser.id,
        storeName: "Workflow Store",
        status: "APPROVED",
      },
    });

    const category = await prisma.category.create({
      data: {
        name: "Workflow Category",
        slug: "workflow-category",
      },
    });

    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId: category.id,
        name: "Workflow Product",
        slug: "workflow-product",
        price: 25,
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
        quantity: 3,
      },
    });

    const result = await orderService.checkout(customer);

    expect(result.orderId).toBeTruthy();
    expect(result.checkoutUrl).toBeTruthy();

    const order = await prisma.order.findUnique({
      where: {
        id: result.orderId,
      },
      include: {
        items: true,
      },
    });

    expect(order).toBeTruthy();
    expect(order.paymentStatus).toBe("PENDING");
    expect(order.status).toBe("PENDING");
    expect(Number(order.totalAmount)).toBe(75);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(3);
    expect(Number(order.items[0].price)).toBe(25);

    const updatedProduct = await prisma.product.findUnique({
      where: {
        id: product.id,
      },
    });

    expect(updatedProduct.stock).toBe(7);

    const cartItems = await prisma.cartItem.findMany({
      where: {
        cartId: cart.id,
      },
    });

    expect(cartItems).toHaveLength(0);
  });
});
