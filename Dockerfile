FROM node:20-alpine AS runtime
WORKDIR /app
ARG FYREFLOW_BUILD_VERSION=dev
ARG FYREFLOW_INSTALL_PROVIDER_CLIS=1
ARG FYREFLOW_CLAUDE_CLI_NPM_PACKAGE=@anthropic-ai/claude-code
ARG FYREFLOW_CLAUDE_CLI_NPM_VERSION=latest
ARG FYREFLOW_CODEX_CLI_NPM_PACKAGE=@openai/codex
ARG FYREFLOW_CODEX_CLI_NPM_VERSION=latest
ENV FYREFLOW_BUILD_VERSION=${FYREFLOW_BUILD_VERSION}
RUN apk add --no-cache util-linux-misc
COPY package.json package-lock.json ./
COPY scripts/patch-electron-plist.mjs ./scripts/patch-electron-plist.mjs
RUN npm ci
RUN if [ "$FYREFLOW_INSTALL_PROVIDER_CLIS" = "1" ]; then \
      npm install -g "${FYREFLOW_CLAUDE_CLI_NPM_PACKAGE}@${FYREFLOW_CLAUDE_CLI_NPM_VERSION}" "${FYREFLOW_CODEX_CLI_NPM_PACKAGE}@${FYREFLOW_CODEX_CLI_NPM_VERSION}" \
      && claude --version \
      && codex --version; \
    else \
      echo "Skipping provider CLI installation (FYREFLOW_INSTALL_PROVIDER_CLIS=${FYREFLOW_INSTALL_PROVIDER_CLIS})."; \
    fi
COPY . .
RUN mkdir -p /app/data
EXPOSE 8787
CMD ["npm", "run", "start:api"]
