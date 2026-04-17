FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prompts ./prompts

EXPOSE 3000

ENV NODE_ENV=production
ENV DB_PATH=/app/data/pac-memory.db

CMD ["node", "dist/cli/index.js", "serve"]
