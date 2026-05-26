#!/bin/sh
set -e

PRISMA_BIN="./node_modules/.bin/prisma"
RETRIES="${PRISMA_MIGRATE_RETRIES:-30}"
DELAY_SECONDS="${PRISMA_MIGRATE_DELAY_SECONDS:-5}"

if [ ! -x "$PRISMA_BIN" ]; then
  echo "Prisma CLI not found at $PRISMA_BIN"
  exit 1
fi

attempt=1

while [ "$attempt" -le "$RETRIES" ]; do
  echo "Running Prisma migrations (attempt $attempt/$RETRIES)..."

  if "$PRISMA_BIN" migrate deploy; then
    echo "Prisma migrations applied successfully."
    break
  fi

  if [ "$attempt" -eq "$RETRIES" ]; then
    echo "Unable to apply Prisma migrations after $RETRIES attempts."
    exit 1
  fi

  echo "Prisma migration failed. Retrying in ${DELAY_SECONDS}s..."
  sleep "$DELAY_SECONDS"
  attempt=$((attempt + 1))
done

exec "$@"