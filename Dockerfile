# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for NuvaLyf
#
# Targets:
#   runner (default) - the Next.js server, standalone output only
#   tools            - DB tooling: roles, migrations, security policies, first Super Admin
#   worker           - background jobs: appointment reminders, WhatsApp broadcasts

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# 1. Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# 2. Database tooling (used by the compose "setup" service)
FROM base AS tools
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY db ./db
COPY scripts ./scripts
USER node
CMD ["node_modules/.bin/tsx", "scripts/db/bootstrap.ts"]

# 2b. Background worker (compose "worker" service). Runs the TypeScript
# sources directly; "react-server" lets server-only modules load outside Next.
FROM base AS worker
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY lib ./lib
COPY features ./features
COPY worker ./worker
ENV NODE_ENV=production
USER node
CMD ["node_modules/.bin/tsx", "--conditions=react-server", "worker/index.ts"]

# 3. Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 4. Production runtime
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
