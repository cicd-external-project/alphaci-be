# =============================================================================
# cicd-workflow-be — Production Dockerfile
#
# Build context: cicd-workflow-be/ (this directory)
#
# The workflow templates live in the sibling repo cicd-workflow/.
# We clone it during the build stage so the templates are baked into the
# image. Set TEMPLATE_REPO_URL as a build arg to point at your org's fork.
# =============================================================================

# ── Stage 1: compile TypeScript + fetch templates ────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# git is needed to clone the template repo
RUN apk add --no-cache git

# Install deps first — layer is cached until package.json changes
COPY package*.json .npmrc* ./
RUN npm install

# Compile source
COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/
RUN npm run build

# Clone the workflow templates repo into the build stage
# Override TEMPLATE_REPO_URL at build time if the repo is private or forked:
#   docker build --build-arg TEMPLATE_REPO_URL=https://x-token:PAT@github.com/org/cicd-workflow.git
ARG TEMPLATE_REPO_URL=https://github.com/ImplementSprint/cicd-workflow.git
RUN git clone --depth 1 "${TEMPLATE_REPO_URL}" /tmp/cicd-workflow

# ── Stage 2: production runtime ───────────────────────────────────────────────
FROM node:22-alpine AS runner

ENV NODE_ENV=production
# Absolute path — CatalogService reads from TEMPLATE_REPO_PATH/TEMPLATE_WORKFLOW_DIR
ENV TEMPLATE_REPO_PATH=/app/templates
# TEMPLATE_WORKFLOW_DIR defaults to 'workflow-templates' in app.config.ts

WORKDIR /app

COPY package*.json .npmrc* ./

RUN apk upgrade --no-cache zlib \
  && npm install --omit=dev \
  && rm -f package-lock.json .npmrc \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nestjs

# Copy compiled application
COPY --chown=nestjs:nodejs --from=builder /app/dist ./dist

# Bake templates into the image — copied from the cloned repo in stage 1
COPY --chown=nestjs:nodejs --from=builder /tmp/cicd-workflow/workflow-templates ./templates/workflow-templates

USER nestjs

EXPOSE 3000

# start-period:20s — connect-pg-simple runs CREATE TABLE IF NOT EXISTS on boot
# which can take 8-12s on Render shared tier cold starts
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/v1/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

CMD ["node", "dist/main"]
