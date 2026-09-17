# Production build stage
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Baked into the JS bundle at build time - Vite only reads VITE_* env vars
# present when `vite build` runs, so these must be build args, not runtime env.
ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_PUBLIC_URL
ARG VITE_CONTACT_EMAIL
ARG VITE_CHAT_ENABLED

ENV VITE_API_URL=$VITE_API_URL \
    VITE_SOCKET_URL=$VITE_SOCKET_URL \
    VITE_PUBLIC_URL=$VITE_PUBLIC_URL \
    VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL \
    VITE_CHAT_ENABLED=$VITE_CHAT_ENABLED

RUN npm run build

# Production runtime stage
FROM nginx:1.25-alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:80/health || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
