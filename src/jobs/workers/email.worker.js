import 'dotenv/config';
import nodemailer from 'nodemailer';
import { createEmailWorker } from './createEmailWorker.js';

const queueName = process.env.EMAIL_QUEUE_NAME || 'email-queue';

const connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
    },
});

const getEmailContent = ({
    type,
    vendorName,
    customerName,
    orderId,
    totalAmount,
    payoutAmount,
    reason,
}) => {
    if (type === 'order-confirmation-email') {
        return {
            subject: 'Your order has been confirmed',
            html: `
                <h2>Order Confirmed</h2>
                <p>Hello ${customerName},</p>
                <p>Your order <strong>${orderId}</strong> has been confirmed.</p>
                <p>Total: <strong>$${totalAmount}</strong></p>
            `,
        };
    }

    if (type === 'refund-requested-email') {
        return {
            subject: 'Your refund request was received',
            html: `
                <h2>Refund Request Received</h2>
                <p>Hello ${customerName},</p>
                <p>Your refund request for order <strong>${orderId}</strong> has been received.</p>
                <p>Reason: <strong>${reason}</strong></p>
            `,
        };
    }

    if (type === 'refund-approved-email') {
        return {
            subject: 'Your refund has been approved',
            html: `
                <h2>Refund Approved</h2>
                <p>Hello ${customerName},</p>
                <p>Your refund for order <strong>${orderId}</strong> has been approved and processed.</p>
                <p>Refund Amount: <strong>$${totalAmount}</strong></p>
            `,
        };
    }

    if (type === 'refund-rejected-email') {
        return {
            subject: 'Your refund request was rejected',
            html: `
                <h2>Refund Request Rejected</h2>
                <p>Hello ${customerName},</p>
                <p>Your refund request for order <strong>${orderId}</strong> was rejected.</p>
            `,
        };
    }

    if (type === 'payout-paid-email') {
        return {
            subject: 'Your vendor payout has been processed',
            html: `
            <h2>Payout Processed</h2>
            <p>Hello ${vendorName},</p>
            <p>Your payout for order <strong>${orderId}</strong> has been processed.</p>
            <p>Payout Amount: <strong>$${payoutAmount}</strong></p>
        `,
        };
    }

    if (type === 'payout-failed-email') {
        return {
            subject: 'Your vendor payout failed',
            html: `
            <h2>Payout Failed</h2>
            <p>Hello ${vendorName},</p>
            <p>Your payout for order <strong>${orderId}</strong> failed.</p>
            <p>Reason: <strong>${reason}</strong></p>
        `,
        };
    }

    return {
        subject: 'Marketplace Notification',
        html: `<p>Hello ${customerName}, you have a marketplace notification.</p>`,
    };
};

const sendEmail = async (payload) => {
    const { to } = payload;
    const content = getEmailContent(payload);

    const info = await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to,
        subject: content.subject,
        html: content.html,
    });

    console.log('Email sent:', info.messageId);
};

const worker = createEmailWorker({
    queueName,
    connection,
    sendEmail,
});

worker.on('completed', (job) => {
    console.log(`Email job completed: ${job.id}`);
});

worker.on('failed', (job, error) => {
    console.error(`Email job failed: ${job?.id}`, error.message);
});

worker.on('error', (error) => {
    console.error('Worker error:', error);
});
