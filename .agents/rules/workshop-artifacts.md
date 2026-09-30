# This repo is a workshop artifact — some "stray-looking" files are intentional

This project doubles as course material (see root `README.md`). A few
things that might look like cleanup candidates to an agent are not:

## `render.yaml` service name

```yaml
services:
  - type: web
    name: foodme-lilituni
```

`README.md` Step 1 has every student fork the repo and rename this from
the template's placeholder to their own identifier — this has already been
done here (`foodme-lilituni`, per git history). Don't revert it to a
generic/example name, and don't rename it again without being asked — the
Render service, its URL, and the monitoring setup in
`render-monitoring.yaml` are all keyed off this exact name.

## The numbered `.patch` files at the repo root

```
01-introduce-bug-FM-BUG-07.patch
02-fix-bug-FM-BUG-07.patch
```

These are `git format-patch` outputs documenting a deliberately-seeded bug
exercise (ticket `FM-BUG-07`, a one-off cart-decrement threshold bug in
`apps/web/src/hooks/useCart.ts`) and its fix. The bug and fix are **already
applied** in this repo's actual git history (see commits `3d4cd91` and
`baa65e8`) — these files are a standalone, readable record of that
exercise, not pending changes to apply. Don't `git apply` them, don't
delete them as "loose files," and don't treat them as uncommitted work
needing to be staged or cleaned up.

## README step numbering and manual instructions

`README.md` is written as a sequential, manual walkthrough for students
(GitHub fork → GlitchTip → Render → Grafana → verification). Don't
"streamline" it into a different structure, automate away its manual
steps, or renumber sections without being asked — the numbering is
referenced by students following along, not just internal structure.

## Rule

Treat `render.yaml`'s current service name, the root-level `.patch`
files, and `README.md`'s step-by-step structure as intentional course
material. Don't modify, delete, or "clean up" any of them unless
specifically asked to.
