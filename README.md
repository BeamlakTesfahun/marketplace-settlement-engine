# Multi-Vendor Marketplace API

A production-style backend API for a multi-vendor e-commerce marketplace built with Node.js, Express, Prisma, PostgreSQL, Redis, BullMQ, Stripe, and Jest.

This project includes advanced marketplace workflows such as Stripe webhooks, inventory reservations, refund processing, coupon discounts, vendor payouts, audit logging, background jobs, and integration testing.

---

## Core Features

- JWT authentication and role-based authorization
- Vendor onboarding and approval workflows
- Product, category, cart, and order management
- Stripe Checkout and webhook handling
- Webhook idempotency protection
- Inventory reservation and stock restoration
- Refund and cancellation workflows
- Coupon and discount system
- Vendor payout calculation and processing
- Audit logs and order status history
- BullMQ email queues and workers
- Bull Board queue dashboard
- Redis caching and rate limiting
- Swagger API documentation
- Jest and Supertest API/integration tests

---

## Tech Stack

- Node.js
- Express.js
- Prisma ORM
- PostgreSQL
- Redis
- BullMQ
- Nodemailer
- Stripe
- JWT
- Zod
- Jest
- Supertest
- Swagger/OpenAPI

---

## Project Structure

```text
src/
├── config/
├── middlewares/
├── modules/
│   ├── audit/
│   ├── auth/
│   ├── carts/
│   ├── categories/
│   ├── coupons/
│   ├── orders/
│   ├── payouts/
│   ├── products/
│   ├── refunds/
│   ├── vendors/
│   └── webhook/
├── jobs/
│   ├── producers/
│   ├── queues/
│   ├── schedulers/
│   └── workers/
├── routes/
└── utils/

prisma/
├── migrations/
├── seeds/
└── schema.prisma

tests/
├── api/
├── integration/
├── jobs/
└── helpers/
```

---

## Environment Variables

Create a `.env` file:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/marketplace_db"

PORT=4444
NODE_ENV=development
CLIENT_URL=http://localhost:3000

JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d

REDIS_HOST=localhost
REDIS_PORT=6379

STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

MAIL_USER=your_email@gmail.com
MAIL_PASS=your_google_app_password
MAIL_FROM=your_email@gmail.com

BULL_BOARD_USERNAME=admin
BULL_BOARD_PASSWORD=strongpassword
```

---

## Installation

```bash
git clone <repository-url>
cd multi-vendor-marketplace-api
npm install
```

---

## Database Setup

```bash
npx prisma migrate dev
npx prisma generate
npm run seed
```

Optional:

```bash
npx prisma studio
```

---

## Redis Setup

Using Docker:

```bash
docker run -d --name redis-dev -p 6379:6379 redis
```

Start later:

```bash
docker start redis-dev
```

Verify:

```bash
redis-cli ping
```

Expected:

```text
PONG
```

---

## Running the Application

Start API server:

```bash
npm run dev
```

Start email worker:

```bash
npm run worker:email
```

Start inventory cleanup worker if available:

```bash
npm run worker:inventory-cleanup
```

---

## Stripe Webhook Setup

Install and login to Stripe CLI:

```bash
stripe login
```

Forward webhooks:

```bash
stripe listen --forward-to localhost:4444/api/v1/webhooks/stripe
```

Copy the generated `whsec_...` value into:

```env
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

Restart the server after updating `.env`.

---

## API Documentation

Swagger docs are available at:

```text
http://localhost:4444/api/docs
```

---

## BullMQ Dashboard

Bull Board is available at:

```text
http://localhost:4444/admin/queues
```

This dashboard is protected using Basic Auth.

Use:

```env
BULL_BOARD_USERNAME=admin
BULL_BOARD_PASSWORD=strongpassword
```

---

## Running Tests

Run all tests:

```bash
npm test
```

Debug open handles:

```bash
npm test -- --detectOpenHandles
```

Most tests require:

- PostgreSQL running
- Redis running

Supertest imports the Express app directly, so the API server usually does not need to be running for automated tests.

---

## Main Workflows

### Checkout Flow

```text
Customer adds items to cart
→ starts checkout
→ stock is reserved
→ order is created as PENDING
→ Stripe Checkout session is created
```

### Payment Success Flow

```text
Stripe sends checkout.session.completed
→ webhook verifies signature
→ duplicate event is ignored if already processed
→ order is marked CONFIRMED and PAID
→ inventory reservation is confirmed
→ vendor payouts are generated
→ confirmation email job is queued
```

### Checkout Expiration Flow

```text
Stripe sends checkout.session.expired
→ active reservation is released
→ stock is restored
→ order is cancelled
→ audit log is created
```

### Refund Flow

```text
Customer requests refund
→ admin approves or rejects refund
→ approved refund calls Stripe refund API
→ order is cancelled
→ payment status becomes REFUNDED
→ stock is restored
→ refund email job is queued
→ audit log and status history are recorded
```

### Coupon Flow

```text
Admin creates coupon
→ customer submits coupon during checkout
→ system validates status, expiration, usage limit, per-user limit, and vendor rules
→ discount is applied
→ coupon usage is recorded
```

### Vendor Payout Flow

```text
Successful payment creates pending vendor payouts
→ admin marks payout as PAID or FAILED
→ vendor receives payout notification email
→ failed payouts can be retried
→ audit logs track payout actions
```

---

## Important Architecture Decisions

### Webhook Idempotency

Stripe may send the same webhook more than once.

This project prevents duplicate processing using:

- `WebhookEvent` records
- unique Stripe event IDs
- order payment status checks
- unique BullMQ job IDs

### Inventory Reservation

Stock is reserved during checkout instead of waiting for payment success.

This prevents overselling while also allowing stock restoration when:

- checkout expires
- unpaid order is cancelled
- refund is approved

### Background Jobs

Email delivery is handled asynchronously through BullMQ.

Supported email jobs include:

- order confirmation emails
- refund requested emails
- refund approved emails
- refund rejected emails
- payout paid emails
- payout failed emails

### Audit Logging

Important system actions are recorded, including:

- checkout creation
- order cancellation
- refund request
- refund approval
- refund rejection
- webhook processing
- inventory release
- payout paid
- payout failed
- payout retry

### Order Status History

Order lifecycle changes are tracked separately from audit logs.

Examples:

```text
PENDING → CONFIRMED
PENDING → CANCELLED
CONFIRMED → CANCELLED
```

Each status history record can include:

- actor
- previous status
- new status
- reason
- metadata
- timestamp

---

## Example Curl Commands

### Register

```bash
curl --request POST \
  --url http://localhost:4444/api/v1/auth/register \
  --header 'Content-Type: application/json' \
  --data '{
    "fullName": "John Doe",
    "email": "john@example.com",
    "password": "password123",
    "role": "CUSTOMER"
  }'
```

### Login

```bash
curl --request POST \
  --url http://localhost:4444/api/v1/auth/login \
  --header 'Content-Type: application/json' \
  --data '{
    "email": "john@example.com",
    "password": "password123"
  }'
```

### Checkout With Coupon

```bash
curl --request POST \
  --url http://localhost:4444/api/v1/orders/checkout \
  --header 'Authorization: Bearer CUSTOMER_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{
    "couponCode": "SAVE10"
  }'
```

### Request Refund

```bash
curl --request POST \
  --url http://localhost:4444/api/v1/refunds/ORDER_ID/request \
  --header 'Authorization: Bearer CUSTOMER_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{
    "reason": "CUSTOMER_REQUEST"
  }'
```

### Approve Refund

```bash
curl --request PATCH \
  --url http://localhost:4444/api/v1/refunds/ORDER_ID/approve \
  --header 'Authorization: Bearer ADMIN_TOKEN'
```

### View Audit Logs

```bash
curl --request GET \
  --url "http://localhost:4444/api/v1/audit-logs?page=1&limit=20&entityType=ORDER" \
  --header "Authorization: Bearer ADMIN_TOKEN"
```

### View Vendor Payouts

```bash
curl --request GET \
  --url http://localhost:4444/api/v1/payouts/me \
  --header "Authorization: Bearer VENDOR_TOKEN"
```

---

## Test Coverage Areas

- Authentication API tests
- Order API tests
- Webhook route tests
- Webhook idempotency tests
- Email worker retry tests
- Email producer tests
- Refund workflow tests
- Inventory reservation tests
- Audit log API tests
- Coupon API tests
- Payout API tests

---

## Future Improvements

- Docker Compose setup for PostgreSQL, Redis, API, and workers
- CI/CD pipeline
- More complete Swagger route documentation
- Refresh token authentication
- Product reviews
- Vendor analytics dashboard
- Scheduled payout processing
- Search indexing
- Metrics endpoint
- Centralized structured logging

---
