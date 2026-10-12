---
name: test-case-design
description: Step 03 (+ 04) of the functional-testing workflow (/test-case-design <T>) - write the test cases into runs/<T>/spec.yaml from the approved plan, have the read-only case-judge subagent check them, fix its FAILs (at most 2 rounds), then get the human's approval in chat. ISTQB test design + review.
---

# Step 03: Test cases (and step 04: case judge)

Argument: `T`. Run dir `R = agentic-workflows/functional-testing/runs/<T>/`.
You write `test_cases` in `R/spec.yaml`, the judge's verdicts in
`R/verdicts/04-NN.json`, and the `cases` entry of `R/gates.yaml` after the human
approves. Never change `acs`, `out_of_scope`, `notes` or `questions`.

## Gate

`R/gates.yaml` has `plan.approved: true`. Otherwise:
`STATUS: BLOCKED: step 02 is not approved; run /test-planning <T>`.

If `test_cases` is already filled in, don't rewrite it: go to "Judge" if
`R/verdicts/` has no verdict newer than the cases, otherwise to "Human review".

## Write the cases

Set `R/status` to `▶03 · writing cases`. Read `R/spec.yaml`, `R/plan.md` and the
doc in `sources.doc`. Write **one case per planned case** in the plan's
"Approach per AC" table, with the plan's test data and expected money table.

```yaml
test_cases:
  - id: KAN-11-TC-01             # <T>-TC-nn, two digits, in plan order
    title: "SAVE10 above its minimum with delivery: discount from the subtotal only"
    covers: [AC-1, AC-2]         # ACs this case verifies
    settles: [Q-1, Q-4]          # answered questions its expected values rely on ([] if none)
    level: UI                    # UI | API, as in the plan
    technique: equivalence partitioning   # as in the plan
    preconditions:
      - "Signed in as the run's test customer on http://localhost:3000"
      - "Cart empty, no promo code applied"
    data: "B-3050: 1 × Mushroom soup (1,950) + 1 × Quiche with vegetables (1,100) = 3,050 AMD"
    steps:
      - "Open http://localhost:3000/chef/17"
      - "Add 1 × Mushroom soup and 1 × Quiche with vegetables to the cart"
      - "Go to checkout, choose Delivery"
      - "Type SAVE10 in the Promo code field and press Apply"
    expected:
      - "A discount line shows SAVE10 and 305 AMD"
      - "Total shows 3,245 AMD (3,050 − 305 + 500 delivery)"
    expected_source: [AC-2, Q-1] # where every expected fact comes from
    status: draft
```

Rules (the case judge checks them; the human reviews them):

- **`expected` comes from the sources, never from the app.** Only facts that follow from `expected_source` (ACs, answered questions, notes), the plan's test data and arithmetic. Messages are the AC's text with placeholders filled in. Don't add UI wording, colours, positions or toasts the sources don't state.
- Every expected value that depends on an answer lists that `Q-n` in `settles` and `expected_source`.
- Concrete data in every step: URL, chef, dish names, quantities, delivery method, the exact code typed. Never "a valid code" or "some items".
- One input partition per case. Nothing from `out_of_scope` or the plan's "Not tested" table.
- Every AC is covered by at least one case; every planned case exists.
- `expected` is a list of separately checkable facts (one per line), so step 05 can mark each one.
- `level: API` cases describe the HTTP request and the response facts instead of UI steps.
- `status: draft`. Don't add `execution`, `automation` or `qase_id`.

Write `spec.yaml` back whole with the Write tool (see "Writing run files" in the pipeline skill).

## Judge (step 04)

1. Set `R/status` to `▶04 · case-judge round N`.
2. Run the `case-judge` subagent (Agent tool, `subagent_type: case-judge`) with the prompt `Judge the test cases of <T>`.
3. Save its final fenced JSON block **word for word** to `R/verdicts/04-NN.json` (`NN` = next free number: `01`, `02`, …). Don't edit, summarise or re-judge it.
4. On the verdict:
   - `pass` → "Human review".
   - `fail` → fix the cases (below) and run the judge again. At most **2** fix rounds; if it still fails, go to "Human review" with the remaining FAILs shown.
   - `unsure` → "Human review" with the UNSURE checks shown.
   - `blocked` → fix nothing, don't re-run. "Human review" with the judge's `obstacles` shown.

### Fixing a judge FAIL

Fix exactly what each FAIL's `reason` and quotes name; don't touch cases or
fields that passed. These FAILs are **not yours to fix** - they belong to an
earlier step, so leave them for the human (see "Feedback loops" in the
pipeline skill):

- **J1** (an AC misquoted) - `acs` belong to step 01; only re-opening it can re-copy them.
- **J2** (a gap with no question) - only re-opening step 01 can add a question.
- **J7** (the cases disagree with the approved plan) when the plan itself is wrong - only re-opening step 02 can change the plan. If the *cases* are what's wrong, fix them.

UNSURE checks are for the human, not for you.

## Human review (in chat)

Set `R/status` to `🧑04 · review N cases`. Show in chat:

- A coverage table `AC / Q | case ids`.
- One line per case: `id | title | expected (short)`.
- Every verdict file in order, and every non-PASS check: `check | item | reason`, with both quotes; and any obstacles (`what | problem | needs`).

Then ask with **AskUserQuestion**: `Approve cases` / `Request changes` / `Stop here`.
With an open J1 or J2 FAIL add `Re-open requirements (step 01)`; with an open
J7 FAIL caused by the plan, add `Re-open the plan (step 02)`.

- `Request changes`: apply the notes (same rules), run the judge again (a new verdict file), and ask again.
- `Re-open requirements` / `Re-open the plan`: change no case; follow "Re-opening a step" in the pipeline skill (gate entries removed only after the human confirms, reason recorded under `reopened:`), and end with `STATUS: NEEDS_HUMAN: re-run /requirements-gathering <T>` (or `/test-planning <T>`).
- `Approve`: add the `cases` entry to `R/gates.yaml` (keep the other entries): `{ approved: true, by: <git config user.name>, at: <UTC now from date -u>, note: "judge 04-NN <verdict>" + the human's note }`. Set every case's `status: accepted`.
- `Stop here`: end with `NEEDS_HUMAN`.

## End

- `STATUS: DONE: N cases approved (judge 04-NN <verdict>); next /test-execution <T>`
- `STATUS: NEEDS_HUMAN: <what is still open>`
- `STATUS: BLOCKED: <reason>`
