FROM node:24-alpine AS source
WORKDIR /build
COPY package.json ./
COPY server.mjs ./
COPY Dockerfile compose.yaml ./
COPY src ./src
COPY public ./public

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3240 DATA_DIR=/app/data
COPY --from=source --chown=node:node /build ./
USER node
EXPOSE 3240
CMD ["node","server.mjs"]
