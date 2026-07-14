# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 构建 Fastify 后端。
FROM node:22-bookworm-slim AS server-build

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server ./
RUN npm run build && npm prune --omit=dev

# 运行镜像：Fastify API + 前端静态文件。
FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
ENV HOST=0.0.0.0
ENV PORT=3000
ENV WEB_DIST_DIR=/app/web/dist
ENV UPLOAD_DIR=/data/uploads

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tzdata \
    && ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime \
    && echo "$TZ" > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY --from=server-build /app/server/package*.json ./
COPY --from=server-build /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/drizzle ./drizzle
COPY --from=web-build /app/web/dist /app/web/dist

EXPOSE 3000

CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/index.js"]
