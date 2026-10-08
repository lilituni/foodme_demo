<!-- jira-review: failed -->
## ❌ Jira {KEY} vs implementation — FAILED

**Ticket:** {KEY} · {ticket summary} · {issue type}
**Verdict:** {x} of {N} requirements and acceptance criteria are implemented; {y} deviate from the ticket and {z} are missing.

| Implemented ✅ | Needs manual check ❓ | Partial / deviates ⚠️ | Missing ❌ |
|---|---|---|---|
| {n} | {n} | {n} | {n} |

### Blocking gaps (fix before merge)
| ID | Ticket says | Code does | Fix | |
|---|---|---|---|---|
| {R8} | {exact expected behaviour / text} | {actual behaviour, `path:line`} | {concrete change} | ⚠️ / ❌ (see inline comment) |

### Requirement traceability
| ID | Requirement (short) | Status | Where / note |
|---|---|---|---|
| {R1} | {requirement} | ✅ / ⚠️ / ❌ / ❓ | `{path:line}` or what is missing |

### Needs manual verification
{Requirements that can't be proven from code alone - what to check and where. Write "None." if empty.}

### Not in the ticket (scope check)
{Behaviour beyond the ticket, and out-of-scope items implemented anyway - with keep / split out / add to ticket. Write "None." if empty.}
