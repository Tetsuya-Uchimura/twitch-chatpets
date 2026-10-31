ARG NODE_IMAGE=node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY src/ src/
COPY scripts/ scripts/
COPY tests/ tests/
COPY tsconfig.json ./
RUN npm run check && npm test && npm run build

FROM build AS browser-test
RUN npx playwright install --with-deps chromium
ENV CI=true
CMD ["npm", "run", "test:ci-browser"]

FROM ${NODE_IMAGE} AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production APP_NETWORK_MODE=container PORT=3000
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src/server/ src/server/
COPY --chown=node:node src/shared/ src/shared/
COPY --chown=node:node scripts/healthcheck.mjs ./scripts/
COPY --from=build --chown=node:node /app/dist/public ./dist/public
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "src/server/index.js", "--production"]
