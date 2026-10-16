#!/usr/bin/env bash
# Claude Code status line for the agentic workflows. Shows the progress line of the
# current run, but only in a session where the functional-testing, bug-triage or triage-pipeline
# workflow was started; every other session gets an empty line.
# The workflow skills write runs/<T>/status; this script only prints it.

input=$(cat) # session JSON from Claude Code

# transcript_path, with JSON escaping undone (Windows paths arrive as C:\\Users\\...).
transcript=$(printf '%s' "$input" | grep -o '"transcript_path" *: *"[^"]*"' | head -n 1 \
  | sed 's/.*: *"//; s/"$//; s/\\\\/\\/g')
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-$PWD}/agentic-workflows"

# Started by a slash command or by the Skill tool in this session.
# (Unescaped quotes, so text that only *mentions* the names inside a tool result doesn't count.)
for wf in feature-testing-pipeline:functional-testing bug-triage:bug-triage triage-pipeline:triage; do
  skill=${wf%%:*}; dir=${wf#*:}
  if grep -qF -e "<command-name>/$skill</command-name>" -e "\"skill\":\"$skill\"" "$transcript"; then
    status=$(ls -t "$root/$dir"/runs/*/status 2>/dev/null | head -n 1)
    if [ -n "$status" ]; then
      head -n 1 "$status"
    else
      echo "${skill} │ starting"
    fi
    exit 0
  fi
done
