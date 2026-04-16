"""
Smoke UI test: mechanically verify each page loads, renders key elements,
and has no console errors. Uses Playwright (not MCP agents).

Usage:
    uv run python tests/e2e/smoke_ui.py [--port 8000] [--pages home,conversation]

Exit codes:
    0 = all tests passed
    1 = one or more tests failed

Writes results to autoresearch/ui-test-results.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

from playwright.sync_api import sync_playwright, Page, ConsoleMessage

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
RESULTS_FILE = PROJECT_ROOT / "autoresearch" / "ui-test-results.json"

# Page definitions: path + required elements (text or selector)
PAGE_CHECKS: dict[str, dict] = {
    "home": {
        "path": "/",
        "required_texts": ["English Practice"],
        "required_selectors": ["nav", "a[href='/conversation']", "a[href='/vocabulary']"],
    },
    "conversation": {
        "path": "/conversation",
        "required_texts": [],
        "required_selectors": ["button"],
    },
    "pronunciation": {
        "path": "/pronunciation",
        "required_texts": [],
        "required_selectors": ["button"],
    },
    "listening": {
        "path": "/listening",
        "required_texts": [],
        "required_selectors": ["button"],
    },
    "vocabulary": {
        "path": "/vocabulary",
        "required_texts": [],
        "required_selectors": ["button"],
    },
    "dashboard": {
        "path": "/dashboard",
        "required_texts": [],
        "required_selectors": [],
    },
}


@dataclass
class TestResult:
    page: str
    status: str  # PASS / FAIL
    checks_passed: int = 0
    checks_failed: int = 0
    console_errors: list[str] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)
    screenshot: str = ""
    duration_ms: int = 0


def test_page(page: Page, base_url: str, page_name: str, checks: dict) -> TestResult:
    result = TestResult(page=page_name, status="PASS")
    start = time.time()
    console_errors: list[str] = []

    def on_console(msg: ConsoleMessage) -> None:
        if msg.type == "error":
            console_errors.append(msg.text[:200])

    page.on("console", on_console)

    try:
        url = f"{base_url}{checks['path']}"
        response = page.goto(url, wait_until="networkidle", timeout=15000)

        # Check HTTP status
        if response and response.status >= 400:
            result.issues.append(f"HTTP {response.status} on {url}")
            result.checks_failed += 1
        else:
            result.checks_passed += 1

        # Wait for content to render
        page.wait_for_timeout(1000)

        # Check required text content
        for text in checks.get("required_texts", []):
            try:
                locator = page.locator(f"text={text}")
                if locator.count() > 0:
                    result.checks_passed += 1
                else:
                    result.issues.append(f"Text '{text}' not found on {page_name}")
                    result.checks_failed += 1
            except Exception as e:
                result.issues.append(f"Text check '{text}' error: {str(e)[:100]}")
                result.checks_failed += 1

        # Check required selectors
        for sel in checks.get("required_selectors", []):
            try:
                locator = page.locator(sel)
                if locator.count() > 0:
                    result.checks_passed += 1
                else:
                    result.issues.append(f"Selector '{sel}' not found on {page_name}")
                    result.checks_failed += 1
            except Exception as e:
                result.issues.append(f"Selector check '{sel}' error: {str(e)[:100]}")
                result.checks_failed += 1

        # Check no critical console errors (ignore common benign ones)
        benign_patterns = ["favicon", "manifest", "service-worker", "hot-update"]
        critical_errors = [
            e for e in console_errors
            if not any(p in e.lower() for p in benign_patterns)
        ]
        if critical_errors:
            result.issues.extend([f"Console error: {e}" for e in critical_errors[:3]])
            result.checks_failed += len(critical_errors)
        else:
            result.checks_passed += 1

        # Take screenshot
        screenshot_dir = PROJECT_ROOT / "autoresearch" / "screenshots"
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        screenshot_path = screenshot_dir / f"{page_name}.png"
        page.screenshot(path=str(screenshot_path), full_page=True)
        result.screenshot = str(screenshot_path.relative_to(PROJECT_ROOT))

    except Exception as e:
        result.issues.append(f"Page load failed: {str(e)[:200]}")
        result.checks_failed += 1

    page.remove_listener("console", on_console)
    result.console_errors = console_errors
    result.duration_ms = int((time.time() - start) * 1000)

    if result.checks_failed > 0:
        result.status = "FAIL"

    return result


def run_tests(port: int, pages: list[str] | None = None) -> dict:
    base_url = f"http://localhost:{port}"
    pages_to_test = pages or list(PAGE_CHECKS.keys())
    results: list[TestResult] = []
    overall_pass = True

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()

        for page_name in pages_to_test:
            if page_name not in PAGE_CHECKS:
                print(f"  SKIP unknown page: {page_name}")
                continue

            checks = PAGE_CHECKS[page_name]
            result = test_page(page, base_url, page_name, checks)
            results.append(result)

            status_icon = "✅" if result.status == "PASS" else "❌"
            print(f"  {status_icon} {page_name}: {result.checks_passed} passed, {result.checks_failed} failed ({result.duration_ms}ms)")
            for issue in result.issues:
                print(f"      ⚠ {issue}")

            if result.status == "FAIL":
                overall_pass = False

        browser.close()

    output = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "port": port,
        "overall": "PASS" if overall_pass else "FAIL",
        "pages_tested": len(results),
        "pages_passed": sum(1 for r in results if r.status == "PASS"),
        "pages_failed": sum(1 for r in results if r.status == "FAIL"),
        "results": [asdict(r) for r in results],
    }

    # Write results
    RESULTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(RESULTS_FILE, "w") as f:
        json.dump(output, f, indent=2)

    return output


def main():
    parser = argparse.ArgumentParser(description="Smoke UI test with Playwright")
    parser.add_argument("--port", type=int, default=8000, help="Server port")
    parser.add_argument("--pages", type=str, default=None, help="Comma-separated page names to test")
    args = parser.parse_args()

    pages = args.pages.split(",") if args.pages else None

    print(f"🎭 Smoke UI Test (port {args.port})")
    print(f"   Testing: {', '.join(pages or PAGE_CHECKS.keys())}")
    print()

    output = run_tests(args.port, pages)

    print()
    if output["overall"] == "PASS":
        print(f"✅ SMOKE UI PASS ({output['pages_passed']}/{output['pages_tested']} pages)")
    else:
        print(f"❌ SMOKE UI FAIL ({output['pages_failed']}/{output['pages_tested']} pages failed)")

    print(f"   Results: {RESULTS_FILE.relative_to(PROJECT_ROOT)}")
    sys.exit(0 if output["overall"] == "PASS" else 1)


if __name__ == "__main__":
    main()
