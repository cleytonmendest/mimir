#!/usr/bin/env bash
# Aplica (ou atualiza) a proteção da branch principal a partir de .github/rulesets/main.json.
#
#   scripts/apply-branch-protection.sh solo   só você mexendo: CI obrigatório, sem exigir aprovação
#   scripts/apply-branch-protection.sh team   mais gente: CI + 1 aprovação de code owner (CODEOWNERS)
#
# Precisa do gh autenticado com permissão de admin no repositório e do jq.
# DRY_RUN=1 só imprime o JSON que seria enviado.
set -euo pipefail

mode="${1:-}"
if [[ "$mode" != "solo" && "$mode" != "team" ]]; then
  echo "uso: $0 solo|team" >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
file="$root/.github/rulesets/main.json"

if [[ "$mode" == "solo" ]]; then
  payload="$(jq '(.rules[] | select(.type == "pull_request") | .parameters) |= (
      .required_approving_review_count = 0
      | .require_code_owner_review = false
      | .require_last_push_approval = false
    )' "$file")"
else
  payload="$(jq '.' "$file")"
fi

if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "$payload"
  exit 0
fi

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
name="$(jq -r '.name' "$file")"
existing="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")"

if [[ -n "$existing" ]]; then
  echo "$payload" | gh api --method PUT "repos/$repo/rulesets/$existing" --input - >/dev/null
  echo "Proteção atualizada em $repo (modo $mode)."
else
  echo "$payload" | gh api --method POST "repos/$repo/rulesets" --input - >/dev/null
  echo "Proteção criada em $repo (modo $mode)."
fi
