# Build stage: compile TypeScript, then drop the development dependencies.
FROM node:24-slim AS build
# better-sqlite3 compiles its native part when no prebuilt binary matches the platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Runtime stage: production dependencies, compiled code and the seed list, run as a non-root user.
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY seed ./seed
# The database lives in /app/data; the node user (uid 1000) must be able to write there.
RUN mkdir data && chown node:node data
USER node
VOLUME /app/data
EXPOSE 3050
CMD ["node", "dist/main.js"]
