#!/bin/sh
set -eu

# Existing installations must retain their app keys, enabled flags, and credential mappings.
scripts/replace-placeholder.sh "$BUILT_NEXT_PUBLIC_WEBAPP_URL" "$NEXT_PUBLIC_WEBAPP_URL"
if [ -n "${DATABASE_HOST:-}" ]; then
  scripts/wait-for-it.sh "$DATABASE_HOST" -- echo "database is up"
fi
npx prisma migrate deploy --schema /calcom/packages/prisma/schema.prisma
exec yarn start
