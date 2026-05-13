#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_HOST_DIR="$(cd "${REPO_ROOT}/.." && pwd)/Sezibwa Rentals/Customer_data"
DEFAULT_STATE_DIR="${HOME}/Library/Application Support/nfe-usage-import"
RUN_DATE="$(date '+%Y-%m-%d')"
RUN_TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"

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
  local subject="NFE usage import failed on $(hostname) at ${RUN_TIMESTAMP}"
  local body
  body="$(cat <<EOF
The scheduled usage import failed.

Timestamp: ${RUN_TIMESTAMP}
Host import path: ${USAGE_IMPORT_HOST_DIR:-unset}
Reason: ${fail_reason:-unknown failure}
Run log: ${RUN_LOG_PATH}

Recent log output:
$(tail -n 40 "${RUN_LOG_PATH}" 2>/dev/null || true)
EOF
)"

  send_notification_email "failure" "${subject}" "${body}"
}

send_success_alert() {
  local subject="NFE usage import succeeded on $(hostname) at ${RUN_TIMESTAMP}"
  local body
  body="$(cat <<EOF
The scheduled usage import completed successfully.

Timestamp: ${RUN_TIMESTAMP}
Host import path: ${USAGE_IMPORT_HOST_DIR:-unset}
Allowed meters: ${USAGE_IMPORT_ALLOWED_METERS:-unset}
Run log: ${RUN_LOG_PATH}
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
    log "ERROR" "Scheduled usage import failed: ${fail_reason:-unknown failure} (exit ${exit_code})"
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
export USAGE_IMPORT_REPROCESS_DAYS="${USAGE_IMPORT_REPROCESS_DAYS:-3}"
export USAGE_IMPORT_FORCE_FULL_SYNC="${USAGE_IMPORT_FORCE_FULL_SYNC:-false}"
export USAGE_IMPORT_ALLOWED_METERS="${USAGE_IMPORT_ALLOWED_METERS:-100,2,3,6,9,10}"
export USAGE_IMPORT_SYNC_STABILITY_MINUTES="${USAGE_IMPORT_SYNC_STABILITY_MINUTES:-15}"
export USAGE_IMPORT_STATE_DIR="${USAGE_IMPORT_STATE_DIR:-${DEFAULT_STATE_DIR}}"
export USAGE_IMPORT_ALERT_EMAIL_TO="${USAGE_IMPORT_ALERT_EMAIL_TO:-aaron.tushabe@nearlyfreeenergy.com}"

mkdir -p "${USAGE_IMPORT_STATE_DIR}/runs"
RUN_LOG_PATH="${USAGE_IMPORT_STATE_DIR}/runs/usage-import-$(date '+%Y%m%d-%H%M%S').log"
touch "${RUN_LOG_PATH}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail_reason="Missing required environment variable ${name}."
    return 1
  fi
}

collect_matching_files() {
  local root_dir="$1"
  local matching_files=()
  local meter_id=""

  IFS=',' read -r -a meters <<< "${USAGE_IMPORT_ALLOWED_METERS}"
  for meter_id in "${meters[@]}"; do
    meter_id="$(echo "${meter_id}" | xargs)"
    [[ -z "${meter_id}" ]] && continue
    while IFS= read -r file_path; do
      matching_files+=("${file_path}")
    done < <(find "${root_dir}" -type f \( -name "meter_${meter_id}_*.csv" -o -name "meter_$(printf '%03d' "${meter_id}")_*.csv" \) | sort)
  done

  printf '%s\n' "${matching_files[@]}"
}

latest_file_age_minutes() {
  local latest_epoch=0
  local current_epoch
  current_epoch="$(date '+%s')"

  while IFS= read -r file_path; do
    [[ -z "${file_path}" ]] && continue
    local modified_epoch
    modified_epoch="$(stat -f '%m' "${file_path}")"
    if (( modified_epoch > latest_epoch )); then
      latest_epoch="${modified_epoch}"
    fi
  done

  if (( latest_epoch == 0 )); then
    echo "-1"
    return 0
  fi

  echo $(( (current_epoch - latest_epoch) / 60 ))
}

already_succeeded_today() {
  local success_marker="${USAGE_IMPORT_STATE_DIR}/last-success-date.txt"
  [[ -f "${success_marker}" && "$(cat "${success_marker}")" == "${RUN_DATE}" ]]
}

record_success_today() {
  printf '%s\n' "${RUN_DATE}" > "${USAGE_IMPORT_STATE_DIR}/last-success-date.txt"
}

require_env "SUPABASE_URL"
require_env "SUPABASE_SERVICE_ROLE_KEY"
require_env "USAGE_IMPORT_HOST_DIR"

if [[ ! -d "${USAGE_IMPORT_HOST_DIR}" ]]; then
  fail_reason="Import directory does not exist: ${USAGE_IMPORT_HOST_DIR}"
  exit 1
fi

if [[ ! -r "${USAGE_IMPORT_HOST_DIR}" ]]; then
  fail_reason="Import directory is not readable: ${USAGE_IMPORT_HOST_DIR}"
  exit 1
fi

lock_dir="${USAGE_IMPORT_STATE_DIR}/import.lock"
if mkdir "${lock_dir}" 2>/dev/null; then
  lock_acquired="true"
else
  fail_reason="Another usage import run is already in progress."
  exit 1
fi

log "INFO" "Starting scheduled usage import from ${USAGE_IMPORT_HOST_DIR}"

if already_succeeded_today; then
  log "INFO" "Skipping scheduled usage import because a successful run already completed today."
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  fail_reason="Docker is not ready. Start Docker Desktop before the scheduled run."
  exit 1
fi

matching_files="$(collect_matching_files "${USAGE_IMPORT_HOST_DIR}")"
if [[ -z "${matching_files}" ]]; then
  fail_reason="No eligible CSV files found for allowed meters ${USAGE_IMPORT_ALLOWED_METERS} under ${USAGE_IMPORT_HOST_DIR}."
  exit 1
fi

latest_age_minutes="$(printf '%s\n' "${matching_files}" | latest_file_age_minutes)"
if [[ "${latest_age_minutes}" == "-1" ]]; then
  fail_reason="Unable to determine file ages for eligible CSV files."
  exit 1
fi

if (( latest_age_minutes < USAGE_IMPORT_SYNC_STABILITY_MINUTES )); then
  fail_reason="Newest eligible CSV file is only ${latest_age_minutes} minutes old. Waiting for at least ${USAGE_IMPORT_SYNC_STABILITY_MINUTES} minutes of sync stability."
  exit 1
fi

if ! "${REPO_ROOT}/scripts/run-usage-import-docker.sh" 2>&1 | tee -a "${RUN_LOG_PATH}"; then
  fail_reason="Docker importer exited with a non-zero status."
  exit 1
fi

record_success_today
log "INFO" "Scheduled usage import finished successfully."
send_success_alert
