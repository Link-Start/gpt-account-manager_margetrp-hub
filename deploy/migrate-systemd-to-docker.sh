#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OLD_APP_DIR="${OLD_APP_DIR:-/opt/ctgptm-mail-assistant}"
OLD_ENV_FILE="${OLD_ENV_FILE:-/etc/ctgptm-mail-assistant.env}"
DOCKER_APP_DIR="${DOCKER_APP_DIR:-/opt/gpt-account-manager}"
SERVICE_NAME="${SERVICE_NAME:-ctgptm-mail-assistant}"
PUBLIC_PORT="${PUBLIC_PORT:-8765}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo bash deploy/migrate-systemd-to-docker.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Engine and Docker Compose plugin first."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is not available. Install docker compose first."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is not installed. Install curl first."
  exit 1
fi

if [[ ! -f "${SOURCE_DIR}/docker-compose.yml" ]]; then
  echo "docker-compose.yml not found in ${SOURCE_DIR}"
  exit 1
fi

if [[ ! -f "${OLD_ENV_FILE}" ]]; then
  echo "Old env file not found: ${OLD_ENV_FILE}"
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"

echo "== Backup old deployment =="
if [[ -d "${OLD_APP_DIR}" ]]; then
  cp -a "${OLD_APP_DIR}" "${OLD_APP_DIR}.bak.${STAMP}"
  echo "Backup: ${OLD_APP_DIR}.bak.${STAMP}"
fi
cp -a "${OLD_ENV_FILE}" "${OLD_ENV_FILE}.bak.${STAMP}"
echo "Backup: ${OLD_ENV_FILE}.bak.${STAMP}"

echo "== Prepare Docker app directory =="
mkdir -p "${DOCKER_APP_DIR}"
tar \
  --exclude='.git' \
  --exclude='.cache' \
  --exclude='.ssh' \
  --exclude='data' \
  --exclude='node_modules' \
  --exclude='output' \
  --exclude='release' \
  --exclude='extensions' \
  --exclude='__pycache__' \
  -C "${SOURCE_DIR}" -cf - . | tar -C "${DOCKER_APP_DIR}" -xf -

mkdir -p "${DOCKER_APP_DIR}/data" "${DOCKER_APP_DIR}/.cache"
if [[ -d "${OLD_APP_DIR}/data" ]]; then
  cp -a "${OLD_APP_DIR}/data/." "${DOCKER_APP_DIR}/data/"
fi

cp -a "${OLD_ENV_FILE}" "${DOCKER_APP_DIR}/.env"
grep -q '^MAIL_PICKUP_ADMIN_TOKEN=' "${DOCKER_APP_DIR}/.env" || {
  echo "MAIL_PICKUP_ADMIN_TOKEN is missing in ${DOCKER_APP_DIR}/.env"
  exit 1
}
grep -q '^MAIL_PICKUP_LOGIN_STRATEGY=' "${DOCKER_APP_DIR}/.env" || echo 'MAIL_PICKUP_LOGIN_STRATEGY=protocol' >> "${DOCKER_APP_DIR}/.env"

echo "== Build Docker image =="
cd "${DOCKER_APP_DIR}"
docker compose build

echo "== Switch traffic to Docker =="
if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
  systemctl stop "${SERVICE_NAME}" || true
fi

if ! docker compose up -d; then
  echo "Docker start failed. Rolling back to old systemd service."
  docker compose logs --tail 80 || true
  if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
    systemctl start "${SERVICE_NAME}" || true
  fi
  exit 1
fi

echo "== Health check =="
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PUBLIC_PORT}/" >/dev/null; then
    echo "Docker deployment is healthy."
    if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
      systemctl disable "${SERVICE_NAME}" >/dev/null 2>&1 || true
    fi
    echo
    echo "Done. Docker app dir: ${DOCKER_APP_DIR}"
    echo "Rollback if needed:"
    echo "  cd ${DOCKER_APP_DIR} && docker compose down"
    echo "  sudo systemctl enable --now ${SERVICE_NAME}"
    exit 0
  fi
  sleep 1
done

echo "Docker health check failed. Rolling back to old systemd service."
docker compose logs --tail 120 || true
docker compose down || true
if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
  systemctl start "${SERVICE_NAME}" || true
fi
exit 1
