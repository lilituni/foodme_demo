---
name: select-tests
description: Selection Based Testing (/select-tests [<base>] [<head>] or /select-tests --pr <n>). Picks only the tests a change needs - rule baseline from test-map.json, then the agent traces the diff's impact and may ADD tests (never remove), then the read-only selection-judge subagent checks the selection (max 1 fix round) - and writes selection.json, the judge verdicts and selection-report.md. Used on every PR by .github/workflows/selective-tests.yml; locally it only selects, it does not run tests unless asked.
---

# Select tests for a change

You decide **which existing tests must run** for one diff, so CI can skip the
rest. A miss lets a bug reach `main`; an extra test costs a minute. So:

- **Only add.** The rules give a safe baseline; you and the judge may add tests,
  nobody removes one. Unsure -> add it.
- **Every addition has a reason** that names the changed line/symbol and the path
  to the test ("`OrderService.cancel` -> `PATCH /api/customer/orders/{n}/cancel`
  -> kan-9-cases.spec.ts").
- **The judge is independent.** It gets the selection without your reasons
  (`judge-input.json`). Don't paste your reasoning into its prompt.
- **Scripts own the file.** Change `selection.json` only through
  `select.mjs` commands - never edit it by hand.

`S=.agents/skills/select-tests/scripts`, output folder `O` (default
`.selection`, git-ignored). All commands below take `--out $O`.

## Inputs

- `/select-tests` -> `base = origin/main`, `head = HEAD`.
- `/select-tests <base> <head>` -> those refs (e.g. a past merge: `<sha>^1 <sha>^2`).
- `/select-tests --pr <n>` / CI -> the PR's base and head SHAs (CI passes them).

## Step 1 - Catalog and rule baseline

```bash
node $S/build_catalog.mjs --out $O
node $S/select.mjs rules --base <base> --head <head> --out $O
```

Read `$O/selection.json`. If `runAll` is true -> skip to Step 5 (nothing to
select; the reasons are in `runAllReasons`).

## Step 2 - Understand the diff

`git diff <base>...<head> --stat`, then the diff of every file whose
`changedFiles[].outcome` is `rule` or `unmapped` (skip `ignored`). For each
file write down the **changed behaviours** (what a user/API client now sees
differently), not just "file changed".

## Step 3 - Trace and add (the selector)

For every behaviour:

1. Trace outwards with `Grep`: backend method -> callers -> controller endpoint;
   frontend component/hook -> importers -> page route; shared API client / type /
   translation key -> the components that use **that symbol**.
2. Look the endpoints/routes up in `$O/test-catalog.json` (`endpoints`, `pages`,
   `backendClasses`, test titles), then `Grep` the test sources to confirm.
3. Add every test that would catch a break and isn't selected yet:

```bash
node $S/select.mjs add --suite junit|web|admin --id <catalog id> --source agent \
  --reason "<changed symbol> -> <caller/endpoint/page> -> <what the test checks>" --out $O
```

4. **Open traces** (`selection.json` `traces[]` with `status: open`) are shared
   files the rules can't decide (API client, types, translations). Trace the
   changed symbols, add their tests, then close the trace:

```bash
node $S/select.mjs resolve-trace --path apps/web/src/api/foodme.ts \
  --note "adds cancelOrder() - used only by cancel-order-dialog.tsx (Orders, Tracking pages)" --out $O
```

   A trace you can't follow to its end stays open: `finalize` then applies the
   rule's fallback (the whole web suite). That is the safe outcome - don't
   close a trace to save time.

Behaviours no test in the catalog reaches are **not** a selection problem -
list them in the report as untested (Step 5), don't invent tests.

## Step 4 - Judge (max 1 fix round)

```bash
node $S/select.mjs strip --out $O        # -> $O/judge-input.json (no reasons)
```

Call the **selection-judge** subagent (Agent tool, `subagent_type:
selection-judge`) with only: the paths `$O/judge-input.json`,
`$O/test-catalog.json`, the base and head SHAs. Save the final `json` block of
its answer **word for word** as `$O/judge-1.json`.

- `PASS` -> Step 5.
- `FAIL` -> `node $S/select.mjs apply-judge --verdict $O/judge-1.json --out $O`
  (adds every `missing` test; sets `runAll` if the judge asked for it), then
  `strip` again and call the judge once more -> `$O/judge-2.json`.
- Still `FAIL` after round 2 -> `apply-judge` again **and**
  `node $S/select.mjs run-all --reason "judge still FAIL after the fix round" --out $O`.
  Two disagreeing rounds mean the change is too hard to reason about - run everything.

You may disagree with a judge `missing` item, but you still add it (adding is
cheap); write your disagreement in the report instead.

## Step 5 - Finalize and report

```bash
node $S/select.mjs finalize --out $O     # open traces -> fallback
node $S/select.mjs report --out $O       # -> $O/selection-report.md
node $S/select.mjs commands --out $O     # what CI will run
```

Then append to `$O/selection-report.md` (keep the generated part as it is):

```markdown
### 🧠 Selector notes
- **Behaviours:** B1 ..., B2 ...
- **Untested behaviours:** ... (or "none")
- **Disagreements with the judge:** ... (or "none")
- **UNSURE checks for a human:** ... (or "none")
```

## Local vs CI

- **CI** (the prompt says so): stop after Step 5. The workflow posts the report
  and runs the commands.
- **Local:** show the human the report table, the selector notes and the run
  commands, e.g.

  ```bash
  cd apps/backend && ./gradlew test --tests am.foodme.backend.OrderControllerTest
  cd apps/web && npx playwright test e2e/kan-9-cases.spec.ts e2e/order-cancel.spec.ts
  ```

  and **don't run them unless asked** - the full SUT has to be up for e2e.

## Evaluating the selection (not part of a normal run)

- Offline, cheap: `node $S/benchmark.mjs` replays merged feature PRs with their
  own tests hidden and reports whether the rules would have picked them.
- Online, after merge: `ci.yml` runs the full suite on `main` and
  `evaluate.mjs` compares it with the PR's `selection.json` (misses, recall,
  skipped share, whether the judge's additions were the ones that failed).
