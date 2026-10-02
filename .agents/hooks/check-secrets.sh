#!/usr/bin/env bash
# Claude Code PreToolUse hook (matcher: Bash).
#
# Fires before every Bash tool call. Only does real work when the command
# looks like a `git commit` — otherwise exits immediately. When it is a
# commit, scans the staged diff for patterns that look like a real secret
# (API keys, private key headers, Sentry/GlitchTip DSNs with embedded
# credentials) and blocks the commit if it finds one.
#
# Exit code convention Claude Code expects from PreToolUse hooks:
#   0 = allow, 2 = block (stderr is surfaced back to Claude as the reason).
set -eu

input="$(cat)"

case "$input" in
  *git\ commit*) ;;
  *) exit 0 ;;
esac

diff="$(git diff --cached -U0 2>/dev/null || true)"
[ -z "$diff" ] && exit 0

# Patterns that strongly suggest a real secret rather than a placeholder.
patterns='sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https://[a-f0-9]{8,}@[a-z0-9.-]*(glitchtip|ingest\.sentry\.io)[a-z0-9./]*'

# The two values already known and accepted as sandbox defaults (see git
# history / README) are deliberately not flagged - this hook is for new
# secrets, not re-litigating a known, already-documented exception.
known_ok='foodme-super-secret-signing-key-change-me|fm_internal_9c1a7e2b3d4f4a5c8e6d1b2a3c4d5e6f'

hits="$(printf '%s\n' "$diff" | grep -E "$patterns" | grep -Ev "$known_ok" || true)"

if [ -n "$hits" ]; then
  echo "Blocked: staged changes contain what looks like a real secret:" >&2
  echo "$hits" >&2
  echo "Remove it (use an env var instead) before committing." >&2
  exit 2
fi

exit 0
