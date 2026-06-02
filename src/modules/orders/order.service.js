import { prisma } from '../../config/prisma.js';
import { stripe } from '../../config/stripe.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { createAuditLog } from '../audit/audit.service.js';

import { createOrderStatusHistory } from './orderStatusHistory.service.js';

const getReservationExpiry = () => {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 30);

    return expiresAt;
};

const restoreOrderStock = async (tx, orderItems) => {
    for (const item of orderItems) {
        await tx.product.update({
            where: {
                id: item.productId,
            },
            data: {
                stock: {
                    increment: item.quantity,
                },
                status: 'ACTIVE',
            },
        });
    }
};

const calculateDiscountAmount = (coupon, subtotalAmount) => {
    if (!coupon) {
        return 0;
    }

    if (coupon.type === 'FIXED') {
        return Math.min(Number(coupon.value), subtotalAmount);
    }

    if (coupon.type === 'PERCENTAGE') {
        return Math.min(
            (subtotalAmount * Number(coupon.value)) / 100,
            subtotalAmount,
        );
    }

    return 0;
};

const validateCouponForCheckout = async ({ couponCode, userId, cartItems }) => {
    if (!couponCode) {
        return null;
    }

    const coupon = await prisma.coupon.findUnique({
        where: {
            code: couponCode.toUpperCase(),
        },
    });

    if (!coupon) {
        throw new AppError('Coupon not found.', 404, 'COUPON_NOT_FOUND');
    }

    if (coupon.status !== 'ACTIVE') {
        throw new AppError('Coupon is not active.', 400, 'COUPON_NOT_ACTIVE');
    }

    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
        throw new AppError('Coupon has expired.', 400, 'COUPON_EXPIRED');
    }

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
        throw new AppError(
            'Coupon usage limit reached.',
            400,
            'COUPON_USAGE_LIMIT_REACHED',
        );
    }

    if (coupon.perUserLimit) {
        const userUsageCount = await prisma.couponUsage.count({
            where: {
                couponId: coupon.id,
                userId,
            },
        });

        if (userUsageCount >= coupon.perUserLimit) {
            throw new AppError(
                'You have already used this coupon the maximum allowed number of times.',
                400,
                'COUPON_USER_LIMIT_REACHED',
            );
        }
    }

    if (coupon.vendorId) {
        const hasVendorProduct = cartItems.some(
            (item) => item.product.vendorId === coupon.vendorId,
        );

        if (!hasVendorProduct) {
            throw new AppError(
                'Coupon is not valid for products in this cart.',
                400,
                'COUPON_VENDOR_NOT_APPLICABLE',
            );
        }
    }

    return coupon;
};

const checkout = async (user, payload = {}) => {
    if (user.role !== 'CUSTOMER') {
        throw new AppError(
            'Only customers can place orders.',
            403,
            'FORBIDDEN',
        );
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
                            vendor: true,
                        },
                    },
                },
            },
        },
    });

    if (!cart || cart.items.length === 0) {
        throw new AppError('Cart is empty.', 400, 'EMPTY_CART');
    }

    for (const item of cart.items) {
        if (item.product.status !== 'ACTIVE') {
            throw new AppError(
                `${item.product.name} is not available for purchase.`,
                400,
                'PRODUCT_NOT_AVAILABLE',
            );
        }

        if (item.product.stock < item.quantity) {
            throw new AppError(
                `Insufficient stock for ${item.product.name}.`,
                400,
                'INSUFFICIENT_STOCK',
            );
        }
    }

    const subtotalAmount = cart.items.reduce((sum, item) => {
        return sum + Number(item.product.price) * item.quantity;
    }, 0);

    const coupon = await validateCouponForCheckout({
        couponCode: payload.couponCode,
        userId: user.id,
        cartItems: cart.items,
    });

    const discountAmount = calculateDiscountAmount(coupon, subtotalAmount);
    const totalAmount = subtotalAmount - discountAmount;

    const order = await prisma.$transaction(async (tx) => {
        const createdOrder = await tx.order.create({
            data: {
                userId: user.id,
                subtotalAmount,
                discountAmount,
                totalAmount,
                couponCode: coupon?.code ?? null,
                status: 'PENDING',
                paymentStatus: 'PENDING',
                items: {
                    create: cart.items.map((item) => ({
                        productId: item.productId,
                        vendorId: item.product.vendorId,
                        quantity: item.quantity,
                        price: item.product.price,
                    })),
                },
                inventoryReservations: {
                    create: cart.items.map((item) => ({
                        productId: item.productId,
                        quantity: item.quantity,
                        status: 'ACTIVE',
                        expiresAt: getReservationExpiry(),
                    })),
                },
            },
            include: {
                items: {
                    include: {
                        product: true,
                    },
                },
                inventoryReservations: true,
            },
        });

        if (coupon) {
            await tx.couponUsage.create({
                data: {
                    couponId: coupon.id,
                    userId: user.id,
                    orderId: createdOrder.id,
                    discountAmount,
                },
            });

            await tx.coupon.update({
                where: {
                    id: coupon.id,
                },
                data: {
                    usedCount: {
                        increment: 1,
                    },
                },
            });
        }

        for (const item of cart.items) {
            const updatedStock = item.product.stock - item.quantity;

            await tx.product.update({
                where: {
                    id: item.productId,
                },
                data: {
                    stock: {
                        decrement: item.quantity,
                    },
                    status:
                        updatedStock === 0
                            ? 'OUT_OF_STOCK'
                            : item.product.status,
                },
            });
        }

        await tx.cartItem.deleteMany({
            where: {
                cartId: cart.id,
            },
        });

        return createdOrder;
    });

    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: user.email,
        line_items: order.items.map((item) => ({
            price_data: {
                currency: 'usd',
                product_data: {
                    name: item.product.name,
                },
                unit_amount: Math.round(Number(item.price) * 100),
            },
            quantity: item.quantity,
        })),
        discounts: coupon
            ? [
                  {
                      coupon: undefined,
                  },
              ]
            : undefined,
        success_url: `${env.clientUrl}/payment-success?orderId=${order.id}`,
        cancel_url: `${env.clientUrl}/payment-cancel?orderId=${order.id}`,
        metadata: {
            orderId: order.id,
            userId: user.id,
            couponCode: coupon?.code ?? '',
            discountAmount: String(discountAmount),
        },
    });

    await prisma.order.update({
        where: {
            id: order.id,
        },
        data: {
            stripeCheckoutSessionId: session.id,
        },
    });

    await createAuditLog({
        userId: user.id,
        action: 'ORDER_CHECKOUT_CREATED',
        entityType: 'ORDER',
        entityId: order.id,
        metadata: {
            subtotalAmount: Number(order.subtotalAmount),
            discountAmount: Number(order.discountAmount),
            totalAmount: Number(order.totalAmount),
            couponCode: order.couponCode,
            stripeCheckoutSessionId: session.id,
            reservedItems: order.inventoryReservations.map((reservation) => ({
                productId: reservation.productId,
                quantity: reservation.quantity,
            })),
        },
    });

    await createOrderStatusHistory({
        orderId: order.id,
        actorId: user.id,
        fromStatus: null,
        toStatus: 'PENDING',
        reason: 'Customer started checkout',
        metadata: {
            subtotalAmount: Number(order.subtotalAmount),
            discountAmount: Number(order.discountAmount),
            totalAmount: Number(order.totalAmount),
            couponCode: order.couponCode,
            stripeCheckoutSessionId: session.id,
        },
    });

    return {
        orderId: order.id,
        checkoutUrl: session.url,
        subtotalAmount,
        discountAmount,
        totalAmount,
        couponCode: coupon?.code ?? null,
    };
};

const getMyOrders = async (user) => {
    if (user.role !== 'CUSTOMER') {
        throw new AppError(
            'Only customers can view their orders.',
            403,
            'FORBIDDEN',
        );
    }

    return prisma.order.findMany({
        where: {
            userId: user.id,
        },
        include: {
            items: {
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            price: true,
                        },
                    },
                    vendor: {
                        select: {
                            id: true,
                            storeName: true,
                        },
                    },
                },
            },
            inventoryReservations: true,
            couponUsages: true,
        },
        orderBy: {
            createdAt: 'desc',
        },
    });
};

const getOrderById = async (user, orderId) => {
    const order = await prisma.order.findUnique({
        where: {
            id: orderId,
        },
        include: {
            user: {
                select: {
                    id: true,
                    fullName: true,
                    email: true,
                },
            },
            items: {
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            price: true,
                        },
                    },
                    vendor: {
                        select: {
                            id: true,
                            storeName: true,
                            userId: true,
                        },
                    },
                },
            },
            inventoryReservations: true,
            couponUsages: {
                include: {
                    coupon: true,
                },
            },
        },
    });

    if (!order) {
        throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    if (user.role === 'CUSTOMER' && order.userId !== user.id) {
        throw new AppError(
            'You are not allowed to access this order.',
            403,
            'FORBIDDEN',
        );
    }

    if (user.role === 'VENDOR') {
        const vendor = await prisma.vendor.findUnique({
            where: {
                userId: user.id,
            },
        });

        const hasVendorItem = order.items.some(
            (item) => item.vendorId === vendor?.id,
        );

        if (!hasVendorItem) {
            throw new AppError(
                'You are not allowed to access this order.',
                403,
                'FORBIDDEN',
            );
        }
    }

    return order;
};

const getVendorOrders = async (user) => {
    if (user.role !== 'VENDOR') {
        throw new AppError(
            'Only vendors can view vendor orders.',
            403,
            'FORBIDDEN',
        );
    }

    const vendor = await prisma.vendor.findUnique({
        where: {
            userId: user.id,
        },
    });

    if (!vendor) {
        throw new AppError(
            'Vendor profile not found.',
            404,
            'VENDOR_PROFILE_NOT_FOUND',
        );
    }

    return prisma.orderItem.findMany({
        where: {
            vendorId: vendor.id,
        },
        include: {
            order: {
                include: {
                    user: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                        },
                    },
                    couponUsages: {
                        include: {
                            coupon: true,
                        },
                    },
                },
            },
            product: {
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    price: true,
                },
            },
        },
        orderBy: {
            createdAt: 'desc',
        },
    });
};

const cancelOrder = async (user, orderId) => {
    const order = await prisma.order.findUnique({
        where: {
            id: orderId,
        },
        include: {
            items: true,
            inventoryReservations: true,
            couponUsages: true,
        },
    });

    if (!order) {
        throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    if (order.userId !== user.id) {
        throw new AppError(
            'You are not allowed to cancel this order.',
            403,
            'FORBIDDEN',
        );
    }

    if (order.status === 'CANCELLED') {
        throw new AppError(
            'Order is already cancelled.',
            409,
            'ORDER_ALREADY_CANCELLED',
        );
    }

    if (order.paymentStatus === 'PAID') {
        throw new AppError(
            'Paid orders cannot be cancelled directly. Please request a refund.',
            400,
            'REFUND_REQUIRED',
        );
    }

    if (order.status !== 'PENDING' || order.paymentStatus !== 'PENDING') {
        throw new AppError(
            'Only pending unpaid orders can be cancelled.',
            400,
            'ORDER_NOT_CANCELLABLE',
        );
    }

    const cancelledOrder = await prisma.$transaction(async (tx) => {
        await restoreOrderStock(tx, order.items);

        await tx.inventoryReservation.updateMany({
            where: {
                orderId,
                status: 'ACTIVE',
            },
            data: {
                status: 'RELEASED',
            },
        });

        if (order.couponUsages.length > 0) {
            for (const usage of order.couponUsages) {
                await tx.coupon.update({
                    where: {
                        id: usage.couponId,
                    },
                    data: {
                        usedCount: {
                            decrement: 1,
                        },
                    },
                });
            }

            await tx.couponUsage.deleteMany({
                where: {
                    orderId,
                },
            });
        }

        return tx.order.update({
            where: {
                id: orderId,
            },
            data: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
            },
            include: {
                items: true,
                inventoryReservations: true,
            },
        });
    });

    await createAuditLog({
        userId: user.id,
        action: 'ORDER_CANCELLED',
        entityType: 'ORDER',
        entityId: order.id,
        metadata: {
            restoredItems: order.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
            })),
            releasedReservations: order.inventoryReservations.map(
                (reservation) => ({
                    productId: reservation.productId,
                    quantity: reservation.quantity,
                    previousStatus: reservation.status,
                }),
            ),
            revertedCoupons: order.couponUsages.map((usage) => ({
                couponId: usage.couponId,
                discountAmount: Number(usage.discountAmount),
            })),
        },
    });

    await createOrderStatusHistory({
        orderId: order.id,
        actorId: user.id,
        fromStatus: order.status,
        toStatus: 'CANCELLED',
        reason: 'Customer cancelled unpaid order',
        metadata: {
            paymentStatus: order.paymentStatus,
            couponCode: order.couponCode,
        },
    });

    return cancelledOrder;
};

const getOrderStatusHistory = async (user, orderId) => {
    await getOrderById(user, orderId);

    return prisma.orderStatusHistory.findMany({
        where: {
            orderId,
        },
        include: {
            actor: {
                select: {
                    id: true,
                    fullName: true,
                    email: true,
                    role: true,
                },
            },
        },
        orderBy: {
            createdAt: 'asc',
        },
    });
};

export const orderService = {
    checkout,
    getMyOrders,
    getOrderById,
    getVendorOrders,
    cancelOrder,
    getOrderStatusHistory,
};
