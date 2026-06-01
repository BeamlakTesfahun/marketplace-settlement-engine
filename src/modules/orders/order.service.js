import { prisma } from '../../config/prisma.js';
import { stripe } from '../../config/stripe.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { createAuditLog } from '../audit/audit.service.js';

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

const checkout = async (user) => {
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

    const totalAmount = cart.items.reduce((sum, item) => {
        return sum + Number(item.product.price) * item.quantity;
    }, 0);

    const order = await prisma.$transaction(async (tx) => {
        const createdOrder = await tx.order.create({
            data: {
                userId: user.id,
                totalAmount,
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
        success_url: `${env.clientUrl}/payment-success?orderId=${order.id}`,
        cancel_url: `${env.clientUrl}/payment-cancel?orderId=${order.id}`,
        metadata: {
            orderId: order.id,
            userId: user.id,
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
            totalAmount: Number(order.totalAmount),
            stripeCheckoutSessionId: session.id,
            reservedItems: order.inventoryReservations.map((reservation) => ({
                productId: reservation.productId,
                quantity: reservation.quantity,
            })),
        },
    });

    return {
        orderId: order.id,
        checkoutUrl: session.url,
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
        },
    });

    return cancelledOrder;
};

export const orderService = {
    checkout,
    getMyOrders,
    getOrderById,
    getVendorOrders,
    cancelOrder,
};
