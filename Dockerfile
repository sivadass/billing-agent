# Match playwright package major.minor; bump when upgrading playwright in package.json.
FROM mcr.microsoft.com/playwright:v1.52.0-jammy AS build

WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/price-monitor/package.json ./packages/price-monitor/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci

COPY tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
# Web SPA is hosted separately (Vercel); do not build it in the worker image.
RUN npm run build:server

FROM mcr.microsoft.com/playwright:v1.52.0-jammy

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/price-monitor/package.json ./packages/price-monitor/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev

COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/price-monitor/dist ./packages/price-monitor/dist
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY jobs.coolify.json ./jobs.json

# Embedded API listens on HTTP_PORT (default 8080).
EXPOSE 8080

# Chromium in Docker needs no-sandbox (set in jobs.coolify.json).
CMD ["node", "apps/worker/dist/cli.js", "daemon"]
