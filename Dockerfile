FROM node:22.12.0-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

COPY . .

ENV DATABASE_URL="postgresql://user:password@localhost:5432/marketplace?schema=public"

RUN npx prisma generate

EXPOSE 4444

CMD ["npm", "start"]