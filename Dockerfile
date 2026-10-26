# Builds the browser game and serves it as static files. There is no backend yet (see issue #2).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The commit being built (the .git folder stays out of the image); the game shows its first 7 characters.
ARG SOURCE_COMMIT=local
RUN SOURCE_COMMIT=$SOURCE_COMMIT npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/web /usr/share/nginx/html
EXPOSE 80
