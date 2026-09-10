#  Darwin cadence operator — the population's heartbeat.
#
#  This image runs scripts/cadence.ts as a long-lived Node.js process.
#  It pushes prices, triggers think/commit/settle, and manages seasons.
#  The process is stateless: all state lives on-chain. Kill it, restart it,
#  move it — the population resumes from wherever the contracts say it is.
#
#  Secrets (PRIVATE_KEY, LLM_AGENT_ID, etc.) are injected at runtime via
#  environment variables from the hosting platform's dashboard — never
#  baked into the image.
#
#  Build:  docker build -t darwin-cadence .
#  Test:   docker run darwin-cadence npx tsx scripts/cadence.ts --self-test
#  Run:    docker run --env-file .env darwin-cadence

FROM node:20-slim AS base

# ── Metadata ──────────────────────────────────────────────────────────────────
LABEL maintainer="darwin"
LABEL description="24/7 cadence operator for the Darwin population on Somnia"

WORKDIR /app

# ── Dependencies ──────────────────────────────────────────────────────────────
# Copy lock file first for layer caching — deps change far less often than code.
COPY package.json package-lock.json ./

# Production deps only. tsx is in devDependencies so we install everything,
# but we don't need hardhat or the frontend toolchain.
# --ignore-scripts avoids native rebuilds for packages that don't need them.
RUN npm ci --ignore-scripts

# ── Application code ──────────────────────────────────────────────────────────
# Only what cadence.ts and its lib/ imports actually touch at runtime.
COPY tsconfig.json ./
COPY scripts/ scripts/

# The deploy manifest — addresses, chain id, ABI references. The cadence reads
# these on startup via manifest() in scripts/lib/darwin.ts.
COPY contracts/deployments/ contracts/deployments/

# ── Runtime ───────────────────────────────────────────────────────────────────
# No port exposed: this is a background worker, not an HTTP server.
# The process exits on its own only with --once or --windows N.

# Default: unbounded loop, which is the whole point of deploying this.
# Override with --windows N for bounded runs, or --self-test for CI.
CMD ["npx", "tsx", "scripts/cadence-server.ts"]
