# Match playwright package major.minor; bump when upgrading playwright in package.json.
FROM mcr.microsoft.com/playwright:v1.52.0-jammy AS build

WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.52.0-jammy

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY jobs.coolify.json ./jobs.json

# Chromium in Docker needs no-sandbox (set in jobs.coolify.json).
CMD ["node", "dist/cli.js", "daemon", "--config", "jobs.json"]
