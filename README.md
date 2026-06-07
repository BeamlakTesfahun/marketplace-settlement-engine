# Marketplace Settlement Engine

A settlement-focused backend API for multi-vendor commerce built with Node.js, Express, Prisma, PostgreSQL, Redis, BullMQ, Stripe, and Jest.

Unlike tutorial marketplaces that release vendor funds immediately after payment, this project models the operational work that happens between customer payment and vendor settlement: payout holds, delivery-based release, vendor-specific disputes, refund decisions, payout reversals, vendor ledger entries, audit logs, and asynchronous notifications.

---

## Why This Exists

Most marketplace tutorials release vendor funds immediately after payment succeeds.

Real commerce platforms typically introduce settlement controls between customer payment and vendor payout. Orders may be delivered late, products may arrive damaged, disputes may be opened, and refunds may be required before funds are released.

This project models those operational realities through a settlement-focused architecture.

### Key Goals

- Delayed vendor settlement
- Delivery-based payout release
- Vendor-specific dispute handling
- Refund-aware dispute resolution
- Payout reversal and vendor ledger accounting
- Auditable financial workflows

Instead of treating payment as the end of the transaction, the platform treats payment as the beginning of a settlement lifecycle that continues until funds are either released to the vendor or reversed through a dispute or refund workflow.

---

## Settlement Architecture

```text
Customer
    |
Checkout
    |
Stripe Payment
    |
Order Confirmed
    |
Vendor Payout (ON_HOLD)
    |
Order Delivered
    |
Dispute Window
    |
+-------------------+
| Customer Dispute? |
+-------------------+
    |
Admin Review
    |
+--------+---------+--------+
| Refund | Release | Reject |
+--------+---------+--------+
    |
Final Settlement
```

This system focuses on post-payment commerce operations rather than storefront functionality. The primary business workflows involve payout eligibility, dispute handling, settlement reversals, vendor ledger accounting, and auditable financial decisions.

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
- Held vendor payouts and settlement controls
- Delivery-based payout release
- Vendor-specific disputes
- Admin dispute resolution workflows
- Payout reversals and vendor ledger entries
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
|-- config/
|-- middlewares/
|-- modules/
|   |-- audit/
|   |-- auth/
|   |-- cart/
|   |-- categories/
|   |-- coupons/
|   |-- disputes/
|   |-- orders/
|   |-- payouts/
|   |-- products/
|   |-- refunds/
|   |-- vendors/
|   `-- webhook/
|-- jobs/
|   |-- producers/
|   |-- queues/
|   `-- workers/
|-- routes/
`-- utils/

prisma/
|-- migrations/
|-- seeds/
`-- schema.prisma

tests/
|-- api/
|-- integration/
|-- jobs/
`-- helpers/
```

---

## Environment Variables

Create a `.env` file from `.env.example`:

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

```bash
docker run -d --name redis-dev -p 6379:6379 redis
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

---

## Running Tests

Run all tests:

```bash
npm test
```

Run settlement and dispute tests:

```bash
npm test -- tests/integration/dispute-resolution-settlement.test.js --forceExit

npm test -- \
  tests/integration/order.dispute-payout-freeze.test.js \
  tests/integration/settlement.delivery-release.test.js \
  tests/api/payouts.api.test.js \
  --forceExit
```

---

## Settlement & Dispute Resolution Workflow

### Settlement Holds

Successful payments do not immediately create payable vendor balances.

```text
Payment Success
      |
Order Confirmed
      |
Vendor Payout Created
      |
Status = ON_HOLD
```

Payouts remain frozen until delivery and dispute conditions are satisfied.

---

### Delivery-Based Release

```text
Order Delivered
      |
availableAt Calculated
      |
Dispute Window Expires
      |
AVAILABLE Payout
```

Rules:

- Only delivered orders become settlement eligible
- Only AVAILABLE payouts may be marked PAID
- Settlement actions are audited
- Release processing is automated through settlement services

---

### Vendor-Specific Disputes

Disputes are tied to:

```text
Order + Vendor
```

This allows multi-vendor orders to be handled independently.

Example:

```text
Order #100
|-- Vendor A payout
`-- Vendor B payout
```

A dispute against Vendor A does not affect Vendor B.

#### Dispute Lifecycle

```text
OPEN
    |
VENDOR_RESPONDED
    |
UNDER_REVIEW
```

Resolution outcomes:

```text
RESOLVED_REFUND
RESOLVED_RELEASE_PAYOUT
REJECTED
```

#### Settlement Freeze Rules

Open disputes freeze settlement actions.

Blocked operations:

```text
releaseEligiblePayouts
markPayoutAsPaid
retryFailedPayout
```

while dispute status is:

```text
OPEN
VENDOR_RESPONDED
UNDER_REVIEW
```

---

### Dispute Resolution

Administrators resolve disputes using one of four outcomes:

```text
REFUND
PARTIAL_REFUND
RELEASE_PAYOUT
REJECT
```

#### Full Refund

```text
Dispute
    |
RESOLVED_REFUND
    |
Refund Recorded
    |
Payout Reversed Or Debited
```

Effects:

- Refund state updated
- Vendor payout settlement adjusted
- Audit log recorded
- Customer notified
- Vendor notified

---

#### Partial Refund

```text
Dispute
    |
RESOLVED_REFUND
    |
Partial Refund Recorded
    |
Proportional Payout Reversal
```

Effects:

- Partial refund amount stored
- Vendor settlement is reversed proportionally
- Settlement action is recorded in the ledger

---

#### Release Vendor Payout

```text
Dispute
    |
RESOLVED_RELEASE_PAYOUT
    |
Payout Eligible For Settlement
```

If:

```text
availableAt <= now
```

then:

```text
ON_HOLD
    |
AVAILABLE
```

and the payout may continue through normal settlement processing.

---

#### Reject Dispute

```text
Dispute
    |
REJECTED
```

Effects:

- Dispute closed
- Payout no longer blocked
- Normal payout release flow resumes

---

### Refunds After Payout Settlement

If a refund is approved before the vendor payout is paid, the payout is reversed instead of being silently left in the settlement pipeline.

```text
Refund Approved
      |
Vendor Payout REVERSED
      |
Vendor Ledger REFUND_REVERSAL
      |
Audit Log + Vendor Notification
```

If a refund is approved after the vendor payout has already been paid, the system creates a payout reversal and records a vendor debit.

```text
Refund Approved After Payout Paid
      |
PayoutReversal Created
      |
Vendor Ledger Debit
      |
Vendor Balance May Become Negative
      |
Audit Log + Vendor Notification
```

This prevents the platform from refunding the customer while leaving vendor settlement untouched.

Settlement actions remain fully auditable through payout reversal records, vendor ledger entries, audit logs, and notification history.

---

## Main Workflows

### Checkout Flow

```text
Customer adds items to cart
-> starts checkout
-> stock is reserved
-> order is created as PENDING
-> Stripe Checkout session is created
```

### Payment Success Flow

```text
Stripe sends checkout.session.completed
-> webhook verifies signature
-> duplicate event is ignored if already processed
-> order is marked CONFIRMED and PAID
-> inventory reservation is confirmed
-> vendor payouts are generated as ON_HOLD
-> confirmation email job is queued
```

### Refund Flow

```text
Customer requests refund
-> admin approves or rejects refund
-> approved refund calls Stripe refund API
-> order is cancelled
-> payment status becomes REFUNDED
-> stock is restored
-> vendor payout settlement is reversed or debited
-> refund email job is queued
-> audit log and status history are recorded
```

### Coupon Flow

```text
Admin creates coupon
-> customer submits coupon during checkout
-> system validates status, expiration, usage limits, and vendor rules
-> discount is applied
-> coupon usage is recorded
```

---

## API Documentation

Swagger docs:

```text
http://localhost:4444/api/docs
```

---

## BullMQ Dashboard

Bull Board:

```text
http://localhost:4444/admin/queues
```

Protected with:

```env
BULL_BOARD_USERNAME=admin
BULL_BOARD_PASSWORD=strongpassword
```

---

## Architecture Decisions

### Webhook Idempotency

Stripe may send the same webhook multiple times.

Protection mechanisms:

- WebhookEvent records
- Unique Stripe event IDs
- Payment status checks
- Unique BullMQ job IDs

### Inventory Reservation

Inventory is reserved during checkout instead of after payment.

This prevents overselling while still allowing stock restoration when:

- Checkout expires
- Orders are cancelled
- Refunds are approved

### Vendor Settlement Ledger

Vendor ledger entries make settlement changes explicit rather than implicit.

Ledger events include:

- `PAYOUT_PAID`
- `REFUND_REVERSAL`
- `VENDOR_DEBIT`

This allows paid payouts, held-payout reversals, and post-payout refund debits to be audited as financial movements instead of only status changes.

### Audit Logging

Important settlement actions are recorded, including:

- Order delivery
- Payout release
- Payout paid
- Payout retry
- Dispute opened
- Vendor response
- Refund resolution
- Payout release resolution
- Dispute rejection
- Payout reversed for refund
- Payout reversal created
- Vendor ledger debit

### Background Jobs

BullMQ processes email notifications asynchronously.

Supported jobs:

- Order confirmation emails
- Refund emails
- Payout emails
- Dispute opened emails
- Dispute response emails
- Dispute resolution emails
- Payout reversal emails

---

## Test Coverage Areas

- Authentication API tests
- Order API tests
- Webhook tests
- Webhook idempotency tests
- Inventory reservation tests
- Refund workflow tests
- Coupon workflow tests
- Audit log tests
- Payout settlement tests
- Delivery release tests
- Dispute payout freeze tests
- Dispute resolution settlement tests
- Payout reversal and vendor ledger tests

---

## Future Improvements

- Docker Compose setup
- CI/CD pipeline
- More complete Swagger documentation
- Refresh token authentication
- Product reviews
- Vendor analytics
- Scheduled payout processing
- Search indexing
- Metrics endpoint
- Centralized structured logging
- Vendor balance recovery workflows
- Automated settlement reconciliation
