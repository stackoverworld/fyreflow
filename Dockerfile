FROM node:20-alpine AS runtime
WORKDIR /app
ARG FYREFLOW_BUILD_VERSION=dev
ENV FYREFLOW_BUILD_VERSION=${FYREFLOW_BUILD_VERSION}
COPY package.json package-lock.json ./
COPY scripts/patch-electron-plist.mjs ./scripts/patch-electron-plist.mjs
RUN npm ci
COPY . .
RUN mkdir -p /app/data
EXPOSE 8787
CMD ["npm", "run", "start:api"]
