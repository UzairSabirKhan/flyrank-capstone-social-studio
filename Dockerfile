FROM node:22-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate
ENV DATABASE_URL=

USER node