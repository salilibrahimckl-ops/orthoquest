#!/bin/bash
# Safely publishes one batch while other writer sessions push at the same time.
#   bash bulk_push.sh /tmp/bulk/batch-03.json w07
# Keep batch files OUTSIDE the repo. Resets to origin/main, adds the batch, commits and pushes; retries on races.
set -u
B="$1"; T="$2"; cd "$(dirname "$0")/../.."
for i in $(seq 1 12); do
  git fetch -q origin main && git reset -q --hard origin/main || { sleep 5; continue; }
  OUT=$(node orthoss-prep/tools/bulk_add.js "$B" "$T") || { echo "$OUT"; exit 1; }
  N=$(echo "$OUT" | sed -n 's/^added \([0-9]*\).*/\1/p')
  [ "${N:-0}" = "0" ] && { echo "$OUT"; echo "nothing to add"; exit 0; }
  git add orthoss-prep/my-questions.json
  git commit -qm "Bulk questions ($T): $N added [skip ci]

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || exit 1
  if git push -q origin HEAD:main 2>/dev/null; then echo "$OUT"; echo "PUSHED $N"; exit 0; fi
  sleep $((RANDOM % 8 + 3))
done
echo "FAILED to push after 12 tries"; exit 1
