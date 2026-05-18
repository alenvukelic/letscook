#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

main() {
  if [[ ${EUID:-0} -eq 0 ]]; then
    bash "$SCRIPT_DIR/_auto-update.sh"
  else
    sudo bash "$SCRIPT_DIR/_auto-update.sh"
  fi
}

main "$@"
