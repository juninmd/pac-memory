FROM node:24-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:24-slim

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apt-get update && apt-get install -y sqlite3 python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prompts ./prompts

RUN pnpm rebuild better-sqlite3

EXPOSE 3000

ENV NODE_ENV=production
ENV DB_PATH=/app/data/pac-memory.db
ENV HOST=0.0.0.0

CMD ["node", "dist/cli/index.js", "start"]
