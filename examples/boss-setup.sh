#!/usr/bin/env bash
# Preview Orc Boss onboarding with explicit role choices.
# Replace the example model identifiers or provide BOSS_* environment values.
# This script is preview-only unless BOSS_SETUP_APPLY=1 is set.
set -euo pipefail

: "${BOSS_HANDLE_PREFIX:=boss}"
: "${BOSS_MANAGER_MODEL:=provider/manager-model}"
: "${BOSS_MANAGER_EFFORT:=high}"
: "${BOSS_WORKER_MODEL:=provider/worker-model}"
: "${BOSS_WORKER_EFFORT:=high}"
: "${BOSS_SCOUT_MODEL:=provider/scout-model}"
: "${BOSS_SCOUT_EFFORT:=medium}"
: "${BOSS_ADVERSARY_MODEL:=provider/adversary-model}"
: "${BOSS_ADVERSARY_EFFORT:=max}"

mode=--plan
if [[ "${BOSS_SETUP_APPLY:-0}" == 1 ]]; then
  mode=--apply
fi

agent-intercom-boss-setup "$mode" \
  --handle-prefix "$BOSS_HANDLE_PREFIX" \
  --manager-model "$BOSS_MANAGER_MODEL" --manager-effort "$BOSS_MANAGER_EFFORT" \
  --worker-model "$BOSS_WORKER_MODEL" --worker-effort "$BOSS_WORKER_EFFORT" \
  --scout-model "$BOSS_SCOUT_MODEL" --scout-effort "$BOSS_SCOUT_EFFORT" \
  --adversary-model "$BOSS_ADVERSARY_MODEL" --adversary-effort "$BOSS_ADVERSARY_EFFORT"
