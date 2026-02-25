FROM node:20-alpine AS runtime
WORKDIR /app
ARG FYREFLOW_BUILD_VERSION=dev
ENV FYREFLOW_BUILD_VERSION=${FYREFLOW_BUILD_VERSION}
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN mkdir -p /app/data
EXPOSE 8787
CMD ["npm", "run", "start:api"]
