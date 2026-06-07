#!/bin/bash
# Start lyra-core-api with pnpm store in NODE_PATH for transitive dep resolution
export NODE_PATH=/opt/lyra-platform/node_modules/.pnpm/node_modules
cd /opt/lyra-platform/services/lyra-core-api
exec node dist/main.js
