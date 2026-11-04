# Dashboard image: static Vite build served by unprivileged nginx, /api proxied to the backend.
# Build context = repo root:  docker build -f deploy/docker/web.Dockerfile -t evidence-web .
FROM node:22-alpine AS build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY contracts/generated /src/contracts/generated
COPY web ./
RUN npx tsc -p . && npx vite build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/web/dist /usr/share/nginx/html
EXPOSE 8080
