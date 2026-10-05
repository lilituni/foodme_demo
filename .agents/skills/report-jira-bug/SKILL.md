---
name: report-jira-bug
description: Create (or update) a Jira bug report using ISTQB-standard defect-report structure, in the KAN ("QA Testing") project. Use when asked to file a bug, report a defect, create a Jira ticket for a bug, or turn a failing test / known issue into a tracked ticket.
---

# Report a Jira bug

Produces an ISTQB-structured defect report as a Jira issue. Requires the
Atlassian/Jira MCP connector to be connected in this session - if Jira
tools aren't available, say so and stop rather than improvising a
different way to "create" the ticket.

## Step 0 — Resolve the site and project once

Call `getAccessibleAtlassianResources` (or equivalent) once per session,
cache the `cloudId` it returns, and reuse it for every call below -
don't re-resolve it per issue. Target project: **KAN** (display name "QA
Testing"). This project has no dedicated "Bug" issue type - use **Task**
(the only non-subtask, non-Epic/Story type available), and distinguish
bug reports from other tasks via the `bug` label (Step 3).

## Step 1 — Gather the defect information (ISTQB structure)

Before writing anything, make sure you actually have each of these - ask
the user for whatever's missing rather than inventing it:

- **What's being tested** (test item/environment): which app, which
  deployment (local Docker stack, Render, etc.), browser/OS if relevant,
  commit or version if known.
- **Steps to reproduce**: precise, numbered, minimal.
- **Expected result** vs **actual result** - stated separately, not
  blended into one paragraph.
- **Evidence**: a failing test's name and file (e.g.
  `OrderControllerTest::deliveryPrice_subtotalEqualsFreeThreshold_isFree`),
  a source location (e.g. `OrderService.java` line + the `FM-BUG-*`
  comment it's tagged with), logs, or a screenshot reference.
- **Scope/impact**: who or what is actually affected (e.g. "all delivery
  orders where subtotal exactly equals the free-delivery threshold are
  overcharged" - concrete, not "this seems bad").
- **Severity** (technical impact - how badly the system breaks):
  Critical / High / Medium / Low.
- **Priority** (business urgency - how soon it should be fixed): maps to
  Jira's native `priority` field (Highest/High/Medium/Low/Lowest). This
  is a *different axis from severity* - a low-severity cosmetic bug on
  the homepage can still be high-priority before a launch, and a
  high-severity bug in a rarely-used admin tool can be low-priority.
  Don't default one from the other without thinking about it.

## Step 2 — Check for an existing ticket first (avoid duplicates)

Search before creating:

```
project = KAN AND summary ~ "<the bug's COMPLETE identifying reference, e.g. FM-BUG-03>"
```

**Use the complete reference, never a prefix or fragment.** Verified
directly against this site: `summary ~ "FM-BUG-0"` (a prefix shared by
FM-BUG-01/03/05) matched **zero** tickets, even though all three exist -
Jira's `~` text search requires a reasonably complete token, it does not
do prefix/partial matching. It *is* case-insensitive (`"fm-bug-03"` found
`FM-BUG-03` fine). The dangerous failure mode here isn't over-matching
the wrong ticket - it's under-matching and silently creating a duplicate
because the search used a shortened or reformatted reference. Always
search with the exact reference as it would appear in a summary.

If a matching ticket already exists:
- **Add a comment** to it with today's occurrence (what you observed,
  any new evidence) - do NOT edit/overwrite its existing fields.
- Report back the existing ticket's key; don't create a second one.

If nothing matches, proceed to Step 3.

**Why comment instead of edit when a ticket already exists:** editing a
ticket's fields is a read-modify-write on shared state - two runs
touching the same ticket's fields at once can silently lose one of the
writes. Adding a comment is append-only; concurrent comments from
multiple runs never collide or overwrite each other. Default to the
safer operation; only use `editJiraIssue` (e.g. to change status/priority
on an explicit instruction) when the user specifically asks for a field
changed, never as the default path for "this bug happened again."

**Verified, not just theorized:** tested directly against this Jira site
- created 3 real tickets (KAN-5/6/7) for FM-BUG-03/01/05, then fired 3
genuinely simultaneous `addOrEditJiraIssueComment` calls at the same
ticket (KAN-5) in one batch, plus 3 more sequential repeat-occurrence
comments across all three tickets. Result: all comments landed with
distinct IDs, zero lost writes, zero duplicate tickets created across 6
total repeat-occurrence attempts. The comment-not-edit design holds up
under real concurrent writes, not just in theory.

## Step 3 — Create the ticket

Issue type **Task**, in project **KAN**. Structure the description with
clear ISTQB-labeled sections (use Jira's own formatting - headings or
bold labels per section, not a single unstructured paragraph):

```
**Environment:** <test item + environment>

**Steps to reproduce:**
1. ...
2. ...

**Expected result:** ...

**Actual result:** ...

**Evidence:** <failing test name/file, source location, logs>

**Scope/impact:** ...
```

- `summary`: concise, includes the bug's identifying reference if one
  exists (e.g. `FM-BUG-03: Free delivery threshold excludes exact match`).
- `priority`: set from what was gathered in Step 1.
- `labels`: always include `bug`, plus a severity label
  (`severity-critical` / `severity-high` / `severity-medium` /
  `severity-low`).

## Step 4 — Report back

State the ticket key and a link (`<site-url>/browse/<KEY>`), or, if an
existing ticket was found instead, state that key and confirm a comment
was added rather than a new ticket created.

## A note on repetition/concurrency testing

If this skill is run multiple times - especially as **parallel**
independent runs, not sequential ones - against the *same* bug
reference, Step 2's dedup check plus Step 2's comment-not-edit default
are what's actually being stress-tested: do all runs correctly find the
existing ticket instead of creating duplicates, and does concurrent
commenting ever still lose data. Sequential repeated runs mostly test
something else - whether the generated ISTQB structure stays complete
and consistent across runs, not concurrency. Don't conflate the two kinds
of repetition when reporting what N runs found.
