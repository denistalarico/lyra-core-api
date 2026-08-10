#!/usr/bin/env bash

set -Eeuo pipefail

# Development shares the production infrastructure containers, but uses cloned
# databases and disables every automatic/external effect known by the API.
export NODE_ENV=development
export HOST=127.0.0.1
export PORT=3200
export DB_NAME=lyra_core_dev
export AGENCY_DB_NAME=lyra_agency_dev
export CORS_ORIGINS=http://127.0.0.1:3203,http://localhost:3203

export SCHEDULES_ENABLED=false
export EMAIL_DELIVERY_MODE=disabled
export LEADFLOW_AUTOMATION_EXECUTION_ENABLED=false
export LEADFLOW_PRODUCT_TELEMETRY_ENABLED=false
export LEADFLOW_BUSINESS_MODES_SEED_ON_BOOT=false
export LEADFLOW_BRIEFING_EXTRACTION_PROVIDER_MODE=disabled
export OPERATIONS_ROOM_REALTIME_ENABLED=false

export INBOX_INGESTION_WORKER_ENABLED=false
export INBOX_MEDIA_WORKER_ENABLED=false
export INBOX_DECISION_WORKER_ENABLED=false
export INBOX_OUTBOX_RELAY_ENABLED=false
export INBOX_REALTIME_GATEWAY_ENABLED=false
export INBOX_PILOT_MODE=false
export INBOX_TRANSCRIPTION_PROVIDER_MODE=disabled
export INBOX_DECISION_PROVIDER_MODE=disabled
export INBOX_DECISION_TRIGGER_MODE=manual
export INBOX_MULTIMODAL_ENABLED=false
export INBOX_VISION_FALLBACK_ENABLED=false
export INBOX_AUTO_REPLY_ENABLED=false
export INBOX_AUTO_CRM_ENABLED=false
export INBOX_AUTO_HANDOFF_ENABLED=false
export INBOX_FOLLOW_UP_ENABLED=false

exec pnpm exec nest start --watch
