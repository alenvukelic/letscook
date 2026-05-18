#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_CONFIG_PATH="${INSTALL_CONFIG_PATH:-$SCRIPT_DIR/install.config}"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/_lib.sh"

main() {
  require_root

  if [[ "$USE_GIT_DEPLOY" != "yes" ]]; then
    log "GitHub deploy mode is disabled; skipping auto-deploy setup"
    exit 0
  fi

  ensure_user "$DEPLOY_USER"
  if [[ "$CLONE_METHOD" == "ssh" ]]; then
    ensure_deploy_key
    print_public_key_instructions

    if prompt_yes_no "Press y after you added the deploy key to GitHub and want to test SSH now" "yes"; then
      test_github_ssh || true
    fi
  else
    log "Clone method is HTTPS; repository deploy key is not required for this public-repo flow"
  fi

  setup_auto_deploy_sudoers

  cat <<EOF

Auto-deploy helper setup completed.

Deploy user: $DEPLOY_USER
SSH key:     $DEPLOY_KEY_PATH
Public key:  $DEPLOY_KEY_PUB_PATH

EOF
}

main "$@"
