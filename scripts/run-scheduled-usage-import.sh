#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_HOST_DIR="$(cd "${REPO_ROOT}/.." && pwd)/Sezibwa Rentals/Customer_data/meter_100"

cd "${REPO_ROOT}"

set -a
source "${REPO_ROOT}/.env"
set +a

export USAGE_IMPORT_HOST_DIR="${USAGE_IMPORT_HOST_DIR:-${DEFAULT_HOST_DIR}}"
export USAGE_IMPORT_REPROCESS_DAYS="${USAGE_IMPORT_REPROCESS_DAYS:-3}"
export USAGE_IMPORT_FORCE_FULL_SYNC="${USAGE_IMPORT_FORCE_FULL_SYNC:-false}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting scheduled usage import from ${USAGE_IMPORT_HOST_DIR}"
"${REPO_ROOT}/scripts/run-usage-import-docker.sh"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Scheduled usage import finished"
