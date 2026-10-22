# The dashboard as a service of pie-api-main/docker-compose.yml: `next start`,
# reachable only inside the compose network, behind the API's Caddy, which
# serves it over HTTPS on port 3000 (pie-api-main/Caddyfile).
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The API's address is compiled into the build (NEXT_PUBLIC_*): PIE_API_URL
# in pie-api-main/.env. Rebuild after changing it.
ARG NEXT_PUBLIC_API_URL
RUN test -n "$NEXT_PUBLIC_API_URL" || { echo "PIE_API_URL is not set in pie-api-main/.env" >&2; exit 1; }
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npx next build && npm prune --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app ./
# The dashboard's own requests to the API trust the deployment's CA, mounted
# here by the compose file.
ENV NODE_EXTRA_CA_CERTS=/certs/ca.crt
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
