#!/bin/sh
set -e

# When a Railway volume is mounted at /paperclip, it overwrites the
# directory structure created in the Dockerfile and is owned by root.
# Fix ownership so the paperclip user (uid 1001) can write to it.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /paperclip/instances/default/logs \
           /paperclip/instances/default/data/storage \
           /paperclip/instances/default/data/backups \
           /paperclip/instances/default/secrets \
           /paperclip/agents/ceo
  chown -R paperclip:paperclip /paperclip
  exec su -s /bin/sh paperclip -c 'exec node --import ./server/node_modules/tsx/dist/loader.mjs server/src/index.ts'
else
  # Already running as non-root (no volume permission issue)
  exec node --import ./server/node_modules/tsx/dist/loader.mjs server/src/index.ts
fi
