#!/usr/bin/env python3
"""Claude Code PreToolUse hook (matcher: Write|Edit|MultiEdit).

Blocks adding a new `page.waitForTimeout(...)` call to an e2e test file.
Does NOT block removing one - the net change (after-count minus
before-count) has to be positive for the block to fire. This matters: a
naive "does the new text contain waitForTimeout" check would also block
the actual fix (removing the wait), which defeats the point.

Scope: any JS/TS file under apps/{web,admin}/e2e/ - specs AND shared
helpers like e2e/auth.ts, since a wait in a helper is inherited by every
spec that imports it. Other waits (waitForSelector,
waitForResponse, waitForURL, waitForLoadState) are legitimate
condition-based waits and are never touched - only the fixed
arbitrary-delay one is blocked. See .agents/rules/flaky-tests.md for why.

Exit code convention Claude Code expects from PreToolUse hooks:
  0 = allow, 2 = block (stderr is surfaced back to Claude as the reason).

Python, not Node or bash, because this machine has no local Node.js and
no jq - but does have Python 3 - and JSON parsing needs to be robust
against multi-line old_string/new_string content, which plain bash/grep
can't do reliably.
"""
import json
import os
import re
import sys

E2E_SPEC_PATTERN = re.compile(r"[\\/]e2e[\\/].*\.[cm]?[jt]sx?$", re.IGNORECASE)
WAIT_PATTERN = re.compile(r"\bwaitForTimeout\s*\(")


def count_waits(text):
    if not text:
        return 0
    return len(WAIT_PATTERN.findall(text))


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)  # malformed input isn't this hook's problem to block on

    tool_name = payload.get("tool_name")
    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path") or ""

    if tool_name not in ("Write", "Edit", "MultiEdit"):
        sys.exit(0)
    if not E2E_SPEC_PATTERN.search(file_path):
        sys.exit(0)

    before = after = 0

    if tool_name == "Write":
        existing = ""
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                existing = f.read()
        before = count_waits(existing)
        after = count_waits(tool_input.get("content"))
    elif tool_name == "Edit":
        before = count_waits(tool_input.get("old_string"))
        after = count_waits(tool_input.get("new_string"))
    elif tool_name == "MultiEdit":
        for edit in tool_input.get("edits") or []:
            before += count_waits(edit.get("old_string"))
            after += count_waits(edit.get("new_string"))

    if after > before:
        added = after - before
        print(
            f"BLOCKED: this change adds {added} new waitForTimeout() call(s) to {file_path}.\n"
            "Fixed waits make e2e tests flaky and slow (see .agents/rules/flaky-tests.md).\n"
            "Wait for the real condition instead: await expect(locator).toBeVisible(), "
            "await expect(page).toHaveURL(...), or page.waitForResponse(...).",
            file=sys.stderr,
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
