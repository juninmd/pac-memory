FROM node:26-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:26-slim

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apt-get update && apt-get install -y sqlite3 git python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prompts ./prompts

EXPOSE 3000

ENV NODE_ENV=production
ENV DB_PATH=/app/data/pac-memory.db
ENV HOST=0.0.0.0

CMD ["node", "dist/cli/index.js", "start"]
