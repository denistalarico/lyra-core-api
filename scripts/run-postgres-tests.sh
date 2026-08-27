#!/usr/bin/env bash
#
# The only supported way to run the PostgreSQL-backed specs.
#
# Never source the production .env for these tests. On 2026-08-26 the command
#
#   set -a; . ./.env; set +a; INBOX_PG_INTEGRATION=true jest
#
# ran the gated suite against lyra_agency — production — and its `TRUNCATE`
# cleanups destroyed the Inbox channels, the LeadFlow agents and automations,
# and the Agency contacts and CRM opportunities. This script exists so nobody
# has to assemble that command by hand again.
#
# Usage:
#   pnpm test:postgres                       # every gated spec
#   pnpm test:postgres src/modules/inbox     # a subset, args go to jest

set -Eeuo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${POSTGRES_TEST_ENV_FILE:-.env.test}"

if [ ! -f "$ENV_FILE" ]; then
  cat >&2 <<EOF
ERRO: $ENV_FILE não encontrado.

Copie o modelo e ajuste as credenciais locais:

  cp .env.test.example $ENV_FILE

$ENV_FILE é ignorado pelo git e precisa apontar para um banco descartável
(nome terminando em _test ou _dev). Nunca aponte para lyra_agency.
EOF
  exit 1
fi

# Drop anything the caller may have exported before sourcing the test file —
# including a production .env sourced in this shell a moment ago. If .env.test
# does not set these, they stay unset and the guard refuses on "missing"
# instead of silently inheriting production.
unset AGENCY_DB_NAME DB_NAME

set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

export INBOX_PG_INTEGRATION=true

echo "PostgreSQL integration tests"
echo "  env      : $ENV_FILE"
echo "  agency db: ${AGENCY_DB_NAME:-<não definido>}"
echo "  core db  : ${DB_NAME:-<não definido>}"
echo

# The guard in src/testing/jest-global-setup.ts runs before any spec is loaded
# and aborts if either database above is not disposable.
exec ./node_modules/.bin/jest --runInBand "$@"
