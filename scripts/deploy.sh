#!/usr/bin/env bash

set -euo pipefail

# GitHub Actions connects over a non-interactive SSH session, so Go's install
# path is not guaranteed to be present in PATH.
export PATH="/usr/local/go/bin:$PATH"

APP_DIR="${APP_DIR:-/opt/infinity.io}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
SYSTEMD_SERVICES="${SYSTEMD_SERVICES:-}"
DEPLOY_DISCORD_BOT="${DEPLOY_DISCORD_BOT:-false}"

log() {
  printf '[deploy] %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

run_npm_ci() {
  local dir="$1"
  local extra_args="${2:-}"

  log "Installing dependencies in ${dir}"
  cd "$APP_DIR/$dir"

  if [ -n "$extra_args" ]; then
    npm ci $extra_args
  else
    npm ci
  fi
}

require_command git
require_command npm
require_command go

if [ ! -d "$APP_DIR/.git" ]; then
  printf 'APP_DIR does not contain a git repository: %s\n' "$APP_DIR" >&2
  exit 1
fi

log "Updating repository in ${APP_DIR}"
cd "$APP_DIR"
git fetch --prune origin
git checkout -B "$DEPLOY_BRANCH" "origin/$DEPLOY_BRANCH"
git reset --hard "origin/$DEPLOY_BRANCH"

run_npm_ci client
log "Building client bundle"
cd "$APP_DIR/client"
npm run build

run_npm_ci auth-server --omit=dev
run_npm_ci loadbalancer --omit=dev

if [ "$DEPLOY_DISCORD_BOT" = "true" ]; then
  run_npm_ci discord-bot --omit=dev
fi

log "Building Go game server"
mkdir -p "$APP_DIR/server/bin"
cd "$APP_DIR/server"
go build -o ./bin/game-server ./main

if [ -z "$SYSTEMD_SERVICES" ]; then
  log "SYSTEMD_SERVICES is empty; skipping service restart"
  exit 0
fi

log "Restarting services: ${SYSTEMD_SERVICES}"
for service in $SYSTEMD_SERVICES; do
  sudo systemctl restart "$service"
done

log "Deployment finished successfully"
