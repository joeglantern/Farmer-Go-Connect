# syntax=docker/dockerfile:1.7
#
# One Dockerfile for every backend image:
#   docker build -f infra/Dockerfile --target api     -t farmgo-api .
#   docker build -f infra/Dockerfile --target worker  -t farmgo-worker .
#   docker build -f infra/Dockerfile --target migrate -t farmgo-migrate .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /repo

# ── Install dependencies (cached until a manifest or the lockfile changes) ──
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/core/package.json packages/core/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts

# ── Build both apps ──
FROM deps AS build
COPY . .
RUN pnpm --filter @farmgo/db exec prisma generate \
 && pnpm --filter @farmgo/api build \
 && pnpm --filter @farmgo/worker build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @farmgo/api deploy --prod --legacy /out/api \
 && pnpm --filter @farmgo/worker deploy --prod --legacy /out/worker \
 && cp -r apps/api/dist /out/api/dist \
 && cp -r apps/worker/dist /out/worker/dist

# ── Runtime images ──
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# Pick up Debian security fixes released since the base image was built.
RUN apt-get update && apt-get upgrade -y  && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]

FROM runtime AS api
COPY --from=build --chown=node:node /out/api ./
ENV SERVICE_NAME=farmgo-api API_PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/server.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker ./
ENV SERVICE_NAME=farmgo-worker WORKER_PORT=4001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4001').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]

# One-off: apply database migrations before a new API version starts.
FROM deps AS migrate
# Install scripts were skipped above; fetch Prisma's schema engine for `migrate deploy`.
RUN pnpm rebuild prisma @prisma/engines
COPY packages/db packages/db
COPY packages/config packages/config
WORKDIR /repo/packages/db
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]
