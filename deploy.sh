#!/usr/bin/env bash
# Pull the latest code and (re)start the services on the server.
# Usage:  ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> git pull"
git pull

echo "==> npm install"
npm install

echo "==> build"
npm run build

echo "==> (re)start pm2"
# restart if already running, otherwise start fresh
pm2 restart ecosystem.config.js --update-env || pm2 start ecosystem.config.js
pm2 save

echo "==> done. Recent logs:"
pm2 logs --lines 20 --nostream
