# report-jira-bug — self-test (2026-10-05)

Driven by `/goal`: exercise `report-jira-bug` for real against the live
Jira site (`https://khachatryanlilith.atlassian.net`, project `KAN` /
"QA Testing"), observe what actually happens, then update the skill from
genuine findings — same approach as `runs/regression.md`, adapted to
this skill's actual risk (concurrency/idempotency on shared external
state, not test flakiness — see the discussion that led here).

Unlike a synthetic test bug, this run used **3 real, already-verified**
bugs found earlier in this session (`FM-BUG-01`, `FM-BUG-03`, `FM-BUG-05`
in `apps/backend/.../OrderService.java`), each confirmed failing via an
actual JUnit run in a `gradle:8.6-jdk17` container before being reported.

## What was run

| Step | Action | Result |
|---|---|---|
| 1 | Dedup search for FM-BUG-03/01/05 (none should exist yet) | 0 matches each — correct |
| 2 | Create ticket for FM-BUG-03 | `KAN-5` created |
| 3 | Create ticket for FM-BUG-01 | `KAN-6` created |
| 4 | Create ticket for FM-BUG-05 | `KAN-7` created |
| 5 | Dedup search for FM-BUG-03 again | Found `KAN-5` — correct |
| 6 | Add repeat-occurrence comment to `KAN-5` | Landed (commentId 10001) |
| 7 | **3 genuinely simultaneous** comment-adds to `KAN-5` in one batch (concurrency test) | All 3 landed (commentIds 10002/10003/10004), zero collisions |
| 8 | Verify via `getJiraIssue` that all 4 comments are actually present | Confirmed: 4/4 present, 1 ticket (no duplicate created) |
| 9 | Repeat-occurrence comment to `KAN-6` (FM-BUG-01) | Landed (commentId 10005) |
| 10 | Repeat-occurrence comment to `KAN-7` (FM-BUG-05) | Landed (commentId 10006) |

Bonus checks run alongside the above (not part of the original plan, but
directly relevant once the question came up):
- `summary ~ "FM-BUG-0"` (prefix shared by 01/03/05) → **0 matches**.
  Jira's text search does not do prefix/partial matching.
- `summary ~ "fm-bug-03"` (lowercase) → matched `KAN-5` fine. Search is
  case-insensitive.

## Findings

1. **Dedup search works, but only on the complete reference.** A
   shortened/partial search string silently finds nothing rather than
   erroring — meaning the dangerous failure mode is a missed match
   (→ duplicate ticket created), not an over-broad match. Documented in
   the skill: always search with the full reference.
2. **Comment-not-edit genuinely prevents lost writes under real
   concurrency**, not just in theory. 3 truly simultaneous writes to the
   same ticket all landed with distinct comment IDs — verified by
   re-fetching the issue afterward and counting, not just trusting each
   call's own response.
3. **Zero duplicate tickets** across 3 bugs x 2 repeat-occurrence passes
   each, plus the 3-way concurrency burst on one of them (6 total
   repeat-occurrence writes, 1 ticket per bug throughout).
4. This project has no "Bug" issue type (confirmed earlier via
   `listJiraProjectIssueTypesMetadata`) — `Task` + `bug` label is the
   correct, and only available, choice. No surprise here, but worth
   re-confirming since a prior assumption not re-checked is exactly the
   kind of thing that goes stale.

## What changed in `.agents/skills/report-jira-bug/SKILL.md`

- Step 2: added the complete-reference-required finding, with the exact
  verification query and result, and an explicit warning that under- not
  over-matching is the real risk.
- Step 2: added a "verified, not just theorized" note citing this run's
  actual numbers (6 repeat-occurrence writes, 0 lost, 0 duplicates) so
  the comment-not-edit design reads as load-bearing and tested, not a
  guess.

## Real tickets created (left in place, not cleaned up)

`KAN-5`, `KAN-6`, `KAN-7` — real bug reports for real, already-verified
bugs in this codebase, so left as genuine tracked work rather than
deleted as test residue.
