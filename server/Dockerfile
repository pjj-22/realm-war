FROM node:20-alpine AS production

RUN addgroup -S realmwar && adduser -S realmwar -G realmwar

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/uploads && chown -R realmwar:realmwar /app

USER realmwar:realmwar

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/api/health || exit 1

CMD ["node", "index.js"]
