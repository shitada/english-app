#!/usr/bin/env python3
"""Parse report.sh raw output and produce formatted Japanese markdown report."""
import json
import re
import sys
from datetime import datetime


def parse_sections(lines: list[str]) -> dict[str, list[str]]:
    """Split raw output into named sections."""
    sections: dict[str, list[str]] = {}
    current = "_header"
    sections[current] = []
    for line in lines:
        m = re.match(r"^=== (.+?) ===$", line)
        if m:
            current = m.group(1)
            sections[current] = []
        else:
            sections.setdefault(current, []).append(line)
    return sections


def format_category(cat: str) -> str:
    if cat == "feature":
        return "**feature**"
    if cat == "perf":
        return "*perf*"
    return cat


def format_verdict(v: str) -> str:
    return "✅" if v in ("keep", "kept") else "❌"


def format_files(csv: str) -> str:
    if not csv or csv == "—":
        return "—"
    files = [f.strip() for f in csv.split(",") if f.strip()]
    return ", ".join(f"[{f}]({f})" for f in files[:5])


def format_duration(total_str: str) -> str:
    m = re.search(r"total=(\d+)s", total_str)
    if m:
        secs = int(m.group(1))
        if secs >= 60:
            return f"{secs // 60}m{secs % 60:02d}s"
        return f"{secs}s"
    return total_str


def format_iter_table(lines: list[str]) -> str:
    rows = []
    for line in lines:
        if not line.startswith("ITER|"):
            continue
        parts = line.split("|")
        if len(parts) < 11:
            continue
        # Fields: ITER|iter|cat|score|verdict|desc|commit|diff|filecount|files_csv|timing|tests
        iter_num = parts[1]
        cat = format_category(parts[2])
        score = parts[3]
        verdict = format_verdict(parts[4])
        desc = parts[5].strip()
        # Remove Co-authored-by noise
        desc = re.sub(r"\s*—?\s*Co-authored-by:.*$", "", desc)
        if len(desc) > 80:
            desc = desc[:77] + "…"
        files_csv = parts[9] if len(parts) > 9 else ""
        files_fmt = format_files(files_csv)
        duration_raw = parts[10] if len(parts) > 10 else ""
        duration = format_duration(duration_raw)
        rows.append(f"| {iter_num} | {cat} | {score} | {verdict} | {desc} | {files_fmt} | {duration} |")

    if not rows:
        return "*イテレーション詳細なし*\n"

    header = "| iter | カテゴリ | スコア | 採否 | 説明 | 修正箇所 | 所要時間 |\n"
    header += "|------|---------|--------|------|------|---------|----------|\n"
    return header + "\n".join(rows) + "\n"


def format_summary(lines: list[str]) -> str:
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith("Total iterations:"):
            out.append(f"- **合計**: {line.split(':', 1)[1].strip()} イテレーション")
        elif line.startswith("Kept:"):
            out.append(f"- **採用/棄却**: {line}")
        elif line.startswith("Features:"):
            val = line
            pct_m = re.search(r"\((\d+)%\)", val)
            warn = ""
            if pct_m and int(pct_m.group(1)) < 20:
                warn = " ⚠️ Feature比率低下"
            out.append(f"- **Feature比率**: {val}{warn}")
        elif line.startswith("Scores:"):
            out.append(f"- **スコア**: {line.split(':', 1)[1].strip()}")
        elif line.startswith("Tests:"):
            out.append(f"- **テスト数**: {line.split(':', 1)[1].strip()}")
    return "\n".join(out) + "\n" if out else "*サマリーなし*\n"


def format_premium(lines: list[str]) -> str:
    for line in lines:
        m = re.search(r"(\d+)", line)
        if m:
            return f"**{m.group(1)}** リクエスト\n"
    return "*不明*\n"


def format_agent_rates(lines: list[str]) -> str:
    skip_rows = []
    rate_rows = []
    all4_line = ""

    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith("AGENT_SKIP|"):
            parts = line.split("|")
            if len(parts) >= 3:
                skip_rows.append(f"| {parts[1]} | {parts[2]} |")
        elif "called" in line and "skipped" in line:
            rate_rows.append(f"- {line}")
        elif line.startswith("All 4 agents"):
            all4_line = f"- **{line}**"

    out = []
    if rate_rows:
        out.append("### 呼出し率\n")
        out.extend(rate_rows)
        if all4_line:
            out.append(all4_line)
        out.append("")
        # Check for warnings
        for r in rate_rows:
            m = re.search(r"— (\d+)%", r)
            if m and int(m.group(1)) < 80:
                agent = r.split(":")[0].lstrip("- ")
                out.append(f"> ⚠️ **{agent}** のスキップ率が20%超")
        out.append("")

    if skip_rows:
        out.append("### スキップ詳細\n")
        out.append("| iter | スキップ状況 |")
        out.append("|------|-------------|")
        out.extend(skip_rows)
        out.append("")

    return "\n".join(out) if out else "*エージェント情報なし*\n"


def format_e2e(lines: list[str]) -> str:
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if "SMOKE_UI_PASS" in line:
            out.append(f"- ✅ {line}")
        elif "SMOKE_UI_FAIL" in line:
            out.append(f"- ❌ {line}")
        elif "SMOKE_UI:" in line:
            out.append(f"- {line}")
        elif line.startswith("E2E_FILE|"):
            out.append(f"- E2E結果: {line.split('|', 1)[1]}")
    return "\n".join(out) + "\n" if out else "*E2Eテストログなし*\n"


def format_audit(lines: list[str]) -> str:
    raw = "\n".join(lines).strip()
    if not raw or raw == "No audit-report.json found":
        return "*監査レポートなし*\n"
    try:
        findings = json.loads(raw)
    except json.JSONDecodeError:
        return f"```\n{raw}\n```\n"

    if not findings:
        return "✅ 問題なし\n"

    # Sort by severity
    sev_order = {"error": 0, "warning": 1, "info": 2}
    findings.sort(key=lambda f: sev_order.get(f.get("severity", "info"), 9))

    rows = []
    for f in findings:
        sev = f.get("severity", "?")
        icon = "🔴" if sev == "error" else "🟡" if sev == "warning" else "ℹ️"
        check = f.get("check", "?")
        iters = f.get("iterations", "").strip()
        root = f.get("root_cause", "?")
        conf = f.get("confidence", "?")
        rows.append(f"| {icon} {sev} | {check} | {iters} | {root} | {conf} |")

    header = "| 重大度 | チェック | 対象iter | 根本原因 | 確信度 |\n"
    header += "|--------|---------|---------|---------|--------|\n"
    return header + "\n".join(rows) + "\n"


def format_most_changed(lines: list[str]) -> str:
    rows = []
    for line in lines:
        if not line.startswith("FILE|"):
            continue
        parts = line.split("|")
        if len(parts) >= 3:
            count = parts[1]
            filepath = parts[2]
            rows.append(f"| {count} | [{filepath}]({filepath}) |")

    if not rows:
        return "*変更ファイル情報なし*\n"

    header = "| 変更回数 | ファイル |\n"
    header += "|---------|----------|\n"
    return header + "\n".join(rows[:10]) + "\n"


def format_backlog(lines: list[str]) -> str:
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith("Completed:"):
            out.append(f"- {line}")
        elif line.startswith("- [ ]") or line.startswith("- [x]"):
            out.append(line)
        elif line == "--- Remaining items ---":
            out.append("\n**残りタスク:**")
    return "\n".join(out) + "\n" if out else "*バックログ情報なし*\n"


def main():
    raw = sys.stdin.read()
    lines = raw.splitlines()
    sections = parse_sections(lines)

    # Extract range from header
    range_line = ""
    for line in sections.get("_header", []) + sections.get("AUTORESEARCH REPORT", []):
        if line.startswith("Range:"):
            range_line = line.replace("Range: ", "")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    print(f"# 📊 Autoresearch レポート（{range_line}）")
    print(f"\n生成日時: {now}\n")
    print("---\n")

    print("## イテレーション詳細\n")
    print(format_iter_table(sections.get("ITERATION DETAILS", [])))

    print("\n## サマリー統計\n")
    print(format_summary(sections.get("SUMMARY", [])))

    print("\n## Premium リクエスト数\n")
    print(format_premium(sections.get("PREMIUM REQUESTS", [])))

    print("\n## エージェント呼出し状況\n")
    agent_lines = sections.get("AGENT INVOCATIONS", []) + sections.get("AGENT CALL RATES", [])
    print(format_agent_rates(agent_lines))

    print("\n## E2E テスト\n")
    print(format_e2e(sections.get("E2E SMOKE UI", [])))

    print("\n## 監査所見\n")
    print(format_audit(sections.get("AUDIT FINDINGS", [])))

    print("\n## 最頻変更ファイル\n")
    print(format_most_changed(sections.get("MOST CHANGED FILES", [])))

    print("\n## バックログ状況\n")
    print(format_backlog(sections.get("BACKLOG STATUS", [])))


if __name__ == "__main__":
    main()
