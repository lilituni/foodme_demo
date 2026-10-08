"""Summarise a PIT mutations.xml into Markdown and enforce a score threshold.

Usage: pitest_report.py <mutations.xml> <threshold-percent> <out.md>
Writes the Markdown report and prints "score=<n>" / "passed=<true|false>"
lines suitable for $GITHUB_OUTPUT.

Mutation score follows PIT's own definition: detected mutants / all mutants
(no-coverage mutants count as not detected).
"""
import sys
import xml.etree.ElementTree as ET
from collections import Counter

xml_path, threshold, out_path = sys.argv[1], float(sys.argv[2]), sys.argv[3]

mutations = list(ET.parse(xml_path).getroot())
total = len(mutations)
status = Counter(m.get("status") for m in mutations)
detected = sum(1 for m in mutations if m.get("detected") == "true")
score = round(100.0 * detected / total, 1) if total else 100.0
passed = score >= threshold

lines = [
    "## 🧬 Mutation testing (PIT)",
    "",
    f"**Result:** {'✅ Passed' if passed else '❌ Failed'} — mutation score "
    f"**{score}%** (threshold {threshold:g}%)",
    "",
    "| Mutants | Killed | Timed out | Survived | No coverage |",
    "|---|---|---|---|---|",
    f"| {total} | {status['KILLED']} | {status['TIMED_OUT']} | "
    f"{status['SURVIVED']} | {status['NO_COVERAGE']} |",
    "",
]

# Per-class breakdown, weakest first.
per_class = {}
for m in mutations:
    cls = m.findtext("mutatedClass")
    c = per_class.setdefault(cls, [0, 0])
    c[0] += 1
    c[1] += m.get("detected") == "true"
if per_class:
    lines += ["### Per class", "| Class | Score | Detected / total |", "|---|---|---|"]
    for cls, (n, d) in sorted(per_class.items(), key=lambda kv: kv[1][1] / kv[1][0]):
        lines.append(f"| `{cls.rsplit('.', 1)[-1]}` | {round(100.0 * d / n, 1)}% | {d} / {n} |")
    lines.append("")

undetected = [m for m in mutations if m.get("detected") != "true"]
if undetected:
    lines += [
        "### Surviving / uncovered mutants",
        "Each row is a code change no test noticed — a missing or too-weak assertion.",
        "",
        "| Status | Where | Mutation |",
        "|---|---|---|",
    ]
    for m in sorted(undetected, key=lambda m: (m.findtext("sourceFile"), int(m.findtext("lineNumber"))))[:30]:
        where = f"`{m.findtext('sourceFile')}:{m.findtext('lineNumber')}` `{m.findtext('mutatedMethod')}()`"
        lines.append(f"| {m.get('status')} | {where} | {m.findtext('description')} |")
    if len(undetected) > 30:
        lines.append(f"| … | {len(undetected) - 30} more in the HTML report artifact | |")
    lines.append("")

lines.append("_Full HTML report: workflow run → Artifacts → `pitest-report`._")

with open(out_path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")

print(f"score={score}")
print(f"passed={'true' if passed else 'false'}")
