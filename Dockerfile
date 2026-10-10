# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    TAIGA_CORE=/opt/taiga/taiga-core-linux-amd64
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data && chown node:node /data
# The version file is optional: the glob copies it when the core's build left one.
COPY --from=core taiga-core-linux-amd64 taiga-core.versio[n] /opt/taiga/
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
USER node
EXPOSE 8787
VOLUME /data
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/server/index.js"]
