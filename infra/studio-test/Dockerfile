FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY tools/s01/stack-check/package.json tools/s01/stack-check/package.json
COPY packages/contracts/ packages/contracts/
COPY services/api/ services/api/
COPY services/worker/package.json services/worker/package.json
COPY apps/studio-web/package.json apps/studio-web/package.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
USER node
CMD ["sh", "-c", "node services/api/src/migrate.ts && exec node services/api/src/main.ts"]
