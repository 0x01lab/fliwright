FROM node:26-bookworm-slim AS build

WORKDIR /workspace
COPY . .
RUN npm install --global "$(node -p 'require("./package.json").packageManager')" \
    && pnpm --filter @fliwright/cloud... install --frozen-lockfile \
    && pnpm cloud:deploy /cloud-release

FROM node:26-bookworm-slim AS runtime

ENV NODE_ENV=production \
    FLIWRIGHT_CLOUD_CONFIG=/etc/fliwright-cloud/server.json

WORKDIR /app
COPY --from=build /cloud-release/ ./
RUN install -d -m 0700 -o node -g node /var/lib/fliwright-cloud

USER node
EXPOSE 4780
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD ["node", "/app/fliwright-cloud", "health"]

ENTRYPOINT ["node", "/app/fliwright-cloud"]
CMD ["server"]
