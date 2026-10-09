<!-- test-review-verdict: {pass|fail} -->
## 🧪 Test review (ISTQB)

**Test verdict:** ✅ Adequately tested | ⚠️ Gaps to close | ❌ Insufficiently tested
**Test object:** <one line: what production behaviour changed>
**Test basis:** <diff only | PR acceptance criteria | Jira KEY>

### 1. Coverage of test conditions
| # | Test condition (from the test basis) | Technique | Level | Status | Covered by |
|---|---|---|---|---|---|
| TC1 | <e.g. rating below range is refused> | BVA | Integration | ✅ / ⚠️ / ❌ | `File.java::testName` or — |

**Condition coverage:** X of Y covered (Z partial)

### 2. Test-case quality findings
| Severity | Category | Where | Problem → fix |
|---|---|---|---|
| Major | Weak test oracle | `path:line` | <what could pass while broken> → <assertion to add> |

(Categories: weak test oracle · missing negative test · missing boundary · test dependency / non-determinism · wrong test level · hidden failure · maintainability. Write "No findings." if none.)

### 3. Missing test cases (to add)
1. **[Level · Technique]** Given <precondition>, when <action>, then <expected result>.

### 4. Test levels & non-functional coverage
- Component: <adequate / gaps>
- Integration: <adequate / gaps>
- System (e2e): <adequate / gaps>
- Non-functional (accessibility, responsiveness, performance): <tested / untested>

### 5. Residual risk
<1-3 sentences: what could still break in production given the current tests, and which item above reduces it most.>
