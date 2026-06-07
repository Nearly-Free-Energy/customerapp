#!/usr/bin/env bash
set -euo pipefail

# Scheduled billing generation wrapper.
# Runs daily via LaunchAgent but only acts on the 1st of each month.
# Automatically computes start_date (1st of previous month) and end_date (1st of today).
# Reads env vars from .env in the repo root.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_HOST_DIR="$(cd "${REPO_ROOT}/.." && pwd)/Sezibwa Rentals/Customer_data"
DEFAULT_STATE_DIR="${HOME}/Library/Application Support/nfe-billing-generate"
RUN_DATE="$(date '+%Y-%m-%d')"
RUN_TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"
DAY_OF_MONTH="$(date '+%-d')"

mkdir -p "${DEFAULT_STATE_DIR}/runs"
RUN_LOG_PATH="${DEFAULT_STATE_DIR}/runs/billing-generate-$(date '+%Y%m%d-%H%M%S').log"
touch "${RUN_LOG_PATH}"

log() {
  local level="$1"
  shift
  printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${level}" "$*" | tee -a "${RUN_LOG_PATH}"
}

fail_reason=""
lock_dir=""
lock_acquired="false"

send_notification_email() {
  local status="$1"
  local subject="$2"
  local body="$3"

  if [[ -z "${USAGE_IMPORT_ALERT_EMAIL_TO:-}" ]]; then
    log "WARN" "Skipping ${status} alert because USAGE_IMPORT_ALERT_EMAIL_TO is not configured."
    return 0
  fi

  if [[ -z "${USAGE_IMPORT_SMTP_HOST:-}" || -z "${USAGE_IMPORT_SMTP_PORT:-}" || -z "${USAGE_IMPORT_SMTP_USER:-}" || -z "${USAGE_IMPORT_SMTP_PASSWORD:-}" || -z "${USAGE_IMPORT_SMTP_FROM:-}" ]]; then
    log "WARN" "Skipping ${status} alert because SMTP settings are incomplete."
    return 0
  fi

  if ALERT_EMAIL_SUBJECT="${subject}" ALERT_EMAIL_BODY="${body}" node "${REPO_ROOT}/scripts/send-smtp-email.js"; then
    log "INFO" "Sent ${status} alert email to ${USAGE_IMPORT_ALERT_EMAIL_TO}."
  else
    log "ERROR" "Failed to send ${status} alert email."
  fi
}

send_failure_alert() {
  local subject="NFE billing generation failed on $(hostname) at ${RUN_TIMESTAMP}"
  local body
  body="$(cat <<EOF
The scheduled billing generation failed.

Timestamp:  ${RUN_TIMESTAMP}
Start date: ${START_DATE:-unknown}
End date:   ${END_DATE:-unknown}
Reason:     ${fail_reason:-unknown failure}
Run log:    ${RUN_LOG_PATH}

Recent log output:
$(tail -n 40 "${RUN_LOG_PATH}" 2>/dev/null || true)
EOF
)"
  send_notification_email "failure" "${subject}" "${body}"
}

send_success_alert() {
  local subject="NFE billing generation succeeded on $(hostname) at ${RUN_TIMESTAMP}"
  local body
  body="$(cat <<EOF
The scheduled billing generation completed successfully.

Timestamp:  ${RUN_TIMESTAMP}
Start date: ${START_DATE}
End date:   ${END_DATE}
Run log:    ${RUN_LOG_PATH}

Check the billing period in MBE:
https://metering-billing-engine.vercel.app
EOF
)"
  send_notification_email "success" "${subject}" "${body}"
}

cleanup() {
  local exit_code=$?

  if [[ "${lock_acquired}" == "true" && -n "${lock_dir}" && -d "${lock_dir}" ]]; then
    rm -rf "${lock_dir}"
  fi

  if [[ ${exit_code} -ne 0 ]]; then
    log "ERROR" "Scheduled billing generation failed: ${fail_reason:-unknown failure} (exit ${exit_code})"
    send_failure_alert
  fi

  exit "${exit_code}"
}

trap cleanup EXIT

cd "${REPO_ROOT}"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  source "${REPO_ROOT}/.env"
  set +a
fi

export USAGE_IMPORT_HOST_DIR="${USAGE_IMPORT_HOST_DIR:-${DEFAULT_HOST_DIR}}"
export USAGE_IMPORT_ALERT_EMAIL_TO="${USAGE_IMPORT_ALERT_EMAIL_TO:-aaron.tushabe@nearlyfreeenergy.com}"
export BILLING_SNAPSHOTS_DIR="${BILLING_SNAPSHOTS_DIR:-${USAGE_IMPORT_HOST_DIR}/billing-snapshots}"
export BILLING_METER_MAP="${BILLING_METER_MAP:-${REPO_ROOT}/config/billing-meter-map.json}"

# Only run on the 1st of the month
if [[ "${DAY_OF_MONTH}" != "1" ]]; then
  log "INFO" "Today is not the 1st of the month (day ${DAY_OF_MONTH}). Skipping billing generation."
  exit 0
fi

# Compute start_date (1st of previous month) and end_date (1st of today)
END_DATE="${RUN_DATE}"
if date --version >/dev/null 2>&1; then
  # GNU date (Linux)
  START_DATE="$(date --date='last month' '+%Y-%m-01')"
else
  # BSD date (macOS)
  START_DATE="$(date -v-1m '+%Y-%m-01')"
fi

log "INFO" "Billing period: ${START_DATE} to ${END_DATE}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail_reason="Missing required environment variable ${name}."
    return 1
  fi
}

require_env "MBE_API_URL"
require_env "MBE_API_TOKEN"
require_env "BILLING_SNAPSHOTS_DIR"

# Check both snapshot files exist before calling MBE
START_SNAPSHOT="${BILLING_SNAPSHOTS_DIR}/billing-snapshot-${START_DATE}.json"
END_SNAPSHOT="${BILLING_SNAPSHOTS_DIR}/billing-snapshot-${END_DATE}.json"

if [[ ! -f "${START_SNAPSHOT}" ]]; then
  fail_reason="Start snapshot not found: ${START_SNAPSHOT}. Run backfill_billing_snapshot.py if needed."
  exit 1
fi

if [[ ! -f "${END_SNAPSHOT}" ]]; then
  fail_reason="End snapshot not found: ${END_SNAPSHOT}. Pi may not have uploaded it yet or Nextcloud sync is pending."
  exit 1
fi

# Prevent double runs
lock_dir="${DEFAULT_STATE_DIR}/billing.lock"
if mkdir "${lock_dir}" 2>/dev/null; then
  lock_acquired="true"
else
  fail_reason="Another billing generation run is already in progress."
  exit 1
fi

# Check not already run successfully this month
SUCCESS_MARKER="${DEFAULT_STATE_DIR}/last-success-month.txt"
CURRENT_MONTH="$(date '+%Y-%m')"
if [[ -f "${SUCCESS_MARKER}" && "$(cat "${SUCCESS_MARKER}")" == "${CURRENT_MONTH}" ]]; then
  log "INFO" "Billing generation already succeeded for ${CURRENT_MONTH}. Skipping."
  exit 0
fi

log "INFO" "Starting scheduled billing generation for ${START_DATE} to ${END_DATE}"

if ! node "${REPO_ROOT}/scripts/generate-billing.js" "${START_DATE}" "${END_DATE}" 2>&1 | tee -a "${RUN_LOG_PATH}"; then
  fail_reason="generate-billing.js exited with a non-zero status."
  exit 1
fi

printf '%s\n' "${CURRENT_MONTH}" > "${SUCCESS_MARKER}"
log "INFO" "Scheduled billing generation finished successfully."
send_success_alert
