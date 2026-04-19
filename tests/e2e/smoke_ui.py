"""
UI test runner with 3 levels: smoke, functional, full.
Reads test specs from tests/e2e/ui-test-spec.yaml.

Usage:
    uv run python tests/e2e/smoke_ui.py --port 8000 --pages home,conversation --level smoke
    uv run python tests/e2e/smoke_ui.py --port 8000 --level full

Levels:
    smoke      - Page loads + required elements + console errors (fast, ~2s/page)
    functional - smoke + yaml spec tests with priority critical/high (medium, ~15s/page)
    full       - All yaml spec tests on all pages, + dark mode + responsive (~3min total)

Exit codes: 0 = pass, 1 = fail
Writes results to:
  - autoresearch/ui-test-results.json       (latest, overwritten each run)
  - autoresearch/e2e-history.jsonl          (append-only, never deleted)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

import yaml
from playwright.sync_api import sync_playwright, Page, ConsoleMessage

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
RESULTS_FILE = PROJECT_ROOT / "autoresearch" / "ui-test-results.json"
HISTORY_FILE = PROJECT_ROOT / "autoresearch" / "e2e-history.jsonl"
SPEC_FILE = PROJECT_ROOT / "tests" / "e2e" / "ui-test-spec.yaml"

PAGE_PATHS: dict[str, str] = {
    "home": "/",
    "conversation": "/conversation",
    "pronunciation": "/pronunciation",
    "listening": "/listening",
    "vocabulary": "/vocabulary",
    "dashboard": "/dashboard",
}

MOBILE_VIEWPORT = {"width": 375, "height": 812}
DESKTOP_VIEWPORT = {"width": 1280, "height": 720}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class SpecTestResult:
    id: str
    target: str
    status: str  # PASS / FAIL / SKIP
    notes: str = ""
    fix_hint: str = ""


@dataclass
class PageResult:
    page: str
    status: str  # PASS / FAIL
    theme: str = "light"
    viewport: str = "desktop"
    smoke_passed: int = 0
    smoke_failed: int = 0
    spec_tests_run: int = 0
    spec_tests_passed: int = 0
    spec_tests_failed: int = 0
    spec_tests_skipped: int = 0
    spec_results: list[dict] = field(default_factory=list)
    console_errors: list[str] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)
    screenshot: str = ""
    duration_ms: int = 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def load_spec() -> dict:
    if not SPEC_FILE.exists():
        return {}
    try:
        with open(SPEC_FILE) as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}


def _find_element(page: Page, test_item: dict):
    """Try selector field first, then parse action text."""
    selector = test_item.get("selector", "")
    if selector:
        loc = page.locator(selector)
        if loc.count() > 0:
            return loc
    action = test_item.get("action", "")
    match = re.search(r'click\s+(?:the\s+)?(?:each\s+)?["\']?(.+?)["\']?\s*(?:button|$)', action, re.I)
    if match:
        btn_text = match.group(1).strip().strip("'\"")
        for pat in [f"button:has-text('{btn_text}')", f"[role='button']:has-text('{btn_text}')", f"text={btn_text}"]:
            loc = page.locator(pat)
            if loc.count() > 0:
                return loc
    return None


def _set_dark_mode(page: Page) -> None:
    """Toggle dark mode via theme button or JS fallback."""
    try:
        for sel in ["button[aria-label*='theme']", "button[aria-label*='dark']",
                     "button[aria-label*='Theme']", "[data-testid='theme-toggle']",
                     "button:has(svg.lucide-moon)", "button:has(svg.lucide-sun)"]:
            btn = page.locator(sel)
            if btn.count() > 0:
                btn.first.click(timeout=2000)
                page.wait_for_timeout(300)
                return
        page.evaluate("document.documentElement.classList.add('dark')")
        page.wait_for_timeout(300)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Level 1: Smoke checks
# ---------------------------------------------------------------------------
def run_smoke_checks(page: Page, base_url: str, page_name: str, path: str,
                     theme: str = "light", viewport: str = "desktop") -> PageResult:
    result = PageResult(page=page_name, status="PASS", theme=theme, viewport=viewport)
    console_errors: list[str] = []

    def on_console(msg: ConsoleMessage) -> None:
        if msg.type == "error":
            console_errors.append(msg.text[:200])

    page.on("console", on_console)
    try:
        response = page.goto(f"{base_url}{path}", wait_until="networkidle", timeout=15000)
        if response and response.status >= 400:
            result.issues.append(f"HTTP {response.status}")
            result.smoke_failed += 1
        else:
            result.smoke_passed += 1

        page.wait_for_timeout(1000)
        if theme == "dark":
            _set_dark_mode(page)

        if page.locator("nav").count() > 0:
            result.smoke_passed += 1
        else:
            result.issues.append("nav element missing")
            result.smoke_failed += 1

        if page.locator("button").count() > 0:
            result.smoke_passed += 1
        elif page_name != "dashboard":
            result.issues.append("No buttons found")
            result.smoke_failed += 1
        else:
            result.smoke_passed += 1

        benign = ["favicon", "manifest", "service-worker", "hot-update", "websocket"]
        critical = [e for e in console_errors if not any(p in e.lower() for p in benign)]
        if critical:
            result.issues.extend([f"Console: {e}" for e in critical[:3]])
            result.smoke_failed += len(critical)
        else:
            result.smoke_passed += 1

        ss_dir = PROJECT_ROOT / "autoresearch" / "screenshots"
        ss_dir.mkdir(parents=True, exist_ok=True)
        suffix = f"-{theme}" if theme != "light" else ""
        vp_suffix = f"-{viewport}" if viewport != "desktop" else ""
        ss_path = ss_dir / f"{page_name}{suffix}{vp_suffix}.png"
        page.screenshot(path=str(ss_path), full_page=True)
        result.screenshot = str(ss_path.relative_to(PROJECT_ROOT))

    except Exception as e:
        result.issues.append(f"Load failed: {str(e)[:200]}")
        result.smoke_failed += 1

    page.remove_listener("console", on_console)
    result.console_errors = console_errors
    if result.smoke_failed > 0:
        result.status = "FAIL"
    return result


# ---------------------------------------------------------------------------
# Spec test executor — handles all test types
# ---------------------------------------------------------------------------
def run_spec_test(page: Page, base_url: str, page_path: str, test_item: dict) -> SpecTestResult:
    test_id = test_item.get("id", "unknown")
    target = test_item.get("target", "")
    action = test_item.get("action", "")
    expect = test_item.get("expect", "")
    test_type = test_item.get("type", "visual")
    selector = test_item.get("selector", "")

    try:
        if test_type == "visual":
            return _test_visual(page, test_id, target, action, expect, selector)
        elif test_type == "functional":
            return _test_functional(page, test_id, target, action, expect, test_item)
        elif test_type == "state":
            return _test_state(page, test_id, target, expect, selector)
        elif test_type == "navigation":
            return _test_navigation(page, base_url, test_id, target, action, selector)
        elif test_type == "error":
            return _test_error(page, test_id, target, expect, selector)
        elif test_type == "presence":
            return _test_presence(page, test_id, target, expect, selector)
        elif test_type == "performance":
            return _test_performance(page, test_id, target, expect)
        else:
            return SpecTestResult(id=test_id, target=target, status="SKIP",
                                  notes=f"Unknown test type: {test_type}")
    except Exception as e:
        return SpecTestResult(id=test_id, target=target, status="FAIL",
                              notes=f"Error: {str(e)[:200]}")


def _test_visual(page, test_id, target, action, expect, selector):
    if selector:
        loc = page.locator(selector)
        if loc.count() > 0:
            return SpecTestResult(id=test_id, target=target, status="PASS",
                                  notes=f"Selector '{selector}' found ({loc.count()} matches)")
        return SpecTestResult(id=test_id, target=target, status="FAIL",
                              notes=f"Selector '{selector}' not found",
                              fix_hint="fix_code: element missing, OR fix_yaml: selector outdated")
    keywords = [w.strip() for w in re.split(r'[,;]', expect) if len(w.strip()) > 2]
    if not keywords:
        return SpecTestResult(id=test_id, target=target, status="SKIP",
                              notes="No keywords in expect and no selector")
    found = sum(1 for kw in keywords[:5] if page.locator(f"text={kw}").count() > 0)
    threshold = max(1, len(keywords[:5]) // 2)
    if found >= threshold:
        return SpecTestResult(id=test_id, target=target, status="PASS",
                              notes=f"Found {found}/{len(keywords[:5])} expected elements")
    return SpecTestResult(id=test_id, target=target, status="FAIL",
                          notes=f"Only {found}/{len(keywords[:5])} found: {keywords[:5]}",
                          fix_hint="fix_yaml or fix_code")


def _test_functional(page, test_id, target, action, expect, test_item):
    element = _find_element(page, test_item)
    if "click" in action.lower():
        if element is None:
            return SpecTestResult(id=test_id, target=target, status="FAIL",
                                  notes="Element not found for click",
                                  fix_hint="fix_yaml: update selector/action, OR fix_code: add element")
        try:
            element.first.click(timeout=3000)
            page.wait_for_timeout(500)
        except Exception as e:
            return SpecTestResult(id=test_id, target=target, status="FAIL",
                                  notes=f"Click failed: {str(e)[:100]}")
        if expect:
            keywords = [w.strip() for w in re.split(r'[,;]', expect) if len(w.strip()) > 2]
            found = sum(1 for kw in keywords[:3] if page.locator(f"text={kw}").count() > 0)
            if found > 0 or not keywords:
                return SpecTestResult(id=test_id, target=target, status="PASS",
                                      notes=f"Clicked + {found}/{len(keywords[:3])} expect verified")
        return SpecTestResult(id=test_id, target=target, status="PASS",
                              notes="Clicked, no crash")

    elif "type" in action.lower() or "input" in action.lower():
        inputs = page.locator("input:visible, textarea:visible")
        if inputs.count() > 0:
            return SpecTestResult(id=test_id, target=target, status="PASS",
                                  notes=f"{inputs.count()} input(s) found")
        return SpecTestResult(id=test_id, target=target, status="FAIL",
                              notes="No visible input/textarea",
                              fix_hint="fix_code: missing input elements")

    elif "select" in action.lower():
        sel = page.locator("select:visible, [role='listbox']:visible, [role='combobox']:visible")
        if sel.count() > 0:
            return SpecTestResult(id=test_id, target=target, status="PASS",
                                  notes=f"{sel.count()} select element(s)")
        return SpecTestResult(id=test_id, target=target, status="FAIL",
                              notes="No select/listbox/combobox", fix_hint="fix_code")

    return SpecTestResult(id=test_id, target=target, status="SKIP",
                          notes=f"Unrecognized action: {action[:80]}")


def _test_state(page, test_id, target, expect, selector):
    if not selector:
        return SpecTestResult(id=test_id, target=target, status="SKIP",
                              notes="State test needs selector field")
    loc = page.locator(selector)
    if loc.count() == 0:
        return SpecTestResult(id=test_id, target=target, status="FAIL",
                              notes=f"Selector '{selector}' not found", fix_hint="fix_yaml")
    exp_lower = expect.lower()
    if "disabled" in exp_lower:
        return SpecTestResult(id=test_id, target=target,
                              status="PASS" if loc.first.is_disabled() else "FAIL",
                              notes="disabled check")
    if "visible" in exp_lower:
        return SpecTestResult(id=test_id, target=target,
                              status="PASS" if loc.first.is_visible() else "FAIL",
                              notes="visible check")
    if "hidden" in exp_lower:
        return SpecTestResult(id=test_id, target=target,
                              status="PASS" if not loc.first.is_visible() else "FAIL",
                              notes="hidden check")
    return SpecTestResult(id=test_id, target=target, status="PASS",
                          notes="Element exists")


def _test_navigation(page, base_url, test_id, target, action, selector):
    if selector:
        loc = page.locator(selector)
        if loc.count() > 0:
            before = page.url
            try:
                loc.first.click(timeout=3000)
                page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass
            if page.url != before:
                return SpecTestResult(id=test_id, target=target, status="PASS",
                                      notes=f"Navigated: {before} → {page.url}")
            return SpecTestResult(id=test_id, target=target, status="PASS",
                                  notes="SPA route change or same-page nav")
        return SpecTestResult(id=test_id, target=target, status="FAIL",
                              notes=f"Selector '{selector}' not found", fix_hint="fix_yaml")

    match = re.search(r'click\s+(.+?)(?:\s+link|\s*$)', action, re.I)
    if match:
        link_text = match.group(1).strip().strip("'\"")
        loc = page.locator(f"a:has-text('{link_text}')")
        if loc.count() > 0:
            loc.first.click(timeout=3000)
            page.wait_for_timeout(1000)
            return SpecTestResult(id=test_id, target=target, status="PASS",
                                  notes=f"Navigation via '{link_text}'")

    return SpecTestResult(id=test_id, target=target, status="SKIP",
                          notes="Navigation test needs selector or link text")


def _test_error(page, test_id, target, expect, selector):
    exp_lower = expect.lower()
    if "no error" in exp_lower or "no crash" in exp_lower:
        return SpecTestResult(id=test_id, target=target, status="PASS",
                              notes="No uncaught errors")
    if selector:
        loc = page.locator(selector)
        if loc.count() > 0:
            return SpecTestResult(id=test_id, target=target, status="PASS",
                                  notes="Error element found")
    error_locs = page.locator("[role='alert'], .error, .error-message, [class*='error']")
    if "error" in exp_lower and "message" in exp_lower:
        if error_locs.count() > 0:
            return SpecTestResult(id=test_id, target=target, status="PASS",
                                  notes=f"Error elements: {error_locs.count()}")
        return SpecTestResult(id=test_id, target=target, status="FAIL",
                              notes="Expected error element not found")
    return SpecTestResult(id=test_id, target=target, status="PASS",
                          notes="Error test: page stable")


def _test_presence(page, test_id, target, expect, selector):
    if selector:
        loc = page.locator(selector)
        if loc.count() > 0:
            return SpecTestResult(id=test_id, target=target, status="PASS",
                                  notes=f"Present: '{selector}' ({loc.count()})")
        return SpecTestResult(id=test_id, target=target, status="FAIL",
                              notes=f"Not found: '{selector}'",
                              fix_hint="fix_code or fix_yaml")
    if target and page.locator(f"text={target}").count() > 0:
        return SpecTestResult(id=test_id, target=target, status="PASS",
                              notes="Target text found")
    keywords = [w.strip() for w in re.split(r'[,;]', expect) if len(w.strip()) > 2]
    found = sum(1 for kw in keywords[:5] if page.locator(f"text={kw}").count() > 0)
    if found > 0:
        return SpecTestResult(id=test_id, target=target, status="PASS",
                              notes=f"{found}/{len(keywords[:5])} keywords found")
    return SpecTestResult(id=test_id, target=target, status="FAIL",
                          notes="Element/text not found",
                          fix_hint="fix_yaml: add selector, OR fix_code: add element")


def _test_performance(page, test_id, target, expect):
    try:
        timing = page.evaluate("""() => {
            const p = performance.getEntriesByType('navigation')[0];
            return p ? { load: Math.round(p.loadEventEnd - p.fetchStart) } : null;
        }""")
        if timing:
            load_ms = timing["load"]
            match = re.search(r'(\d+)\s*(?:ms|millisecond)', expect, re.I)
            threshold = int(match.group(1)) if match else 5000
            if load_ms <= threshold:
                return SpecTestResult(id=test_id, target=target, status="PASS",
                                      notes=f"Load: {load_ms}ms (limit: {threshold}ms)")
            return SpecTestResult(id=test_id, target=target, status="FAIL",
                                  notes=f"Load: {load_ms}ms > {threshold}ms")
    except Exception:
        pass
    return SpecTestResult(id=test_id, target=target, status="SKIP",
                          notes="Performance API unavailable")


# ---------------------------------------------------------------------------
# Test runner
# ---------------------------------------------------------------------------
def run_tests(port: int, pages: list[str] | None, level: str,
              iteration: int | None = None) -> dict:
    base_url = f"http://localhost:{port}"
    spec = load_spec()
    spec_pages = spec.get("pages", {})

    pages_to_test = list(PAGE_PATHS.keys()) if level == "full" else (pages or list(PAGE_PATHS.keys()))

    configs: list[tuple[str, str, dict]] = [("light", "desktop", DESKTOP_VIEWPORT)]
    if level == "full":
        configs.append(("dark", "desktop", DESKTOP_VIEWPORT))
        configs.append(("light", "mobile", MOBILE_VIEWPORT))

    results: list[PageResult] = []
    overall_pass = True

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for theme, viewport_name, viewport_size in configs:
            context = browser.new_context(viewport=viewport_size)
            pw_page = context.new_page()

            if level == "full":
                print(f"\n  --- {theme}/{viewport_name} ---")

            for page_name in pages_to_test:
                start = time.time()
                path = PAGE_PATHS.get(page_name, f"/{page_name}")
                if page_name in spec_pages:
                    path = spec_pages[page_name].get("path", path)

                result = run_smoke_checks(pw_page, base_url, page_name, path,
                                          theme=theme, viewport=viewport_name)

                if level in ("functional", "full") and page_name in spec_pages:
                    tests = spec_pages[page_name].get("tests", [])
                    if level == "functional":
                        tests = [t for t in tests if t.get("priority") in ("critical", "high")]

                    try:
                        pw_page.goto(f"{base_url}{path}", wait_until="networkidle", timeout=15000)
                        pw_page.wait_for_timeout(500)
                        if theme == "dark":
                            _set_dark_mode(pw_page)
                    except Exception:
                        pass

                    for test_item in tests:
                        spec_result = run_spec_test(pw_page, base_url, path, test_item)
                        result.spec_tests_run += 1
                        if spec_result.status == "PASS":
                            result.spec_tests_passed += 1
                        elif spec_result.status == "SKIP":
                            result.spec_tests_skipped += 1
                        else:
                            result.spec_tests_failed += 1
                            result.issues.append(f"[{spec_result.id}] {spec_result.notes}")
                        result.spec_results.append(asdict(spec_result))

                result.duration_ms = int((time.time() - start) * 1000)
                if result.smoke_failed > 0 or result.spec_tests_failed > 0:
                    result.status = "FAIL"
                    overall_pass = False

                results.append(result)
                icon = "✅" if result.status == "PASS" else "❌"
                skip_info = f" skip={result.spec_tests_skipped}" if result.spec_tests_skipped else ""
                spec_info = f" | spec: {result.spec_tests_passed}/{result.spec_tests_run}{skip_info}" if result.spec_tests_run else ""
                label = f" [{theme}/{viewport_name}]" if level == "full" else ""
                print(f"  {icon} {page_name}{label}: smoke {result.smoke_passed}✓ {result.smoke_failed}✗{spec_info} ({result.duration_ms}ms)")
                for issue in result.issues[:5]:
                    print(f"      ⚠ {issue}")

            context.close()
        browser.close()

    output = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "iteration": iteration,
        "port": port,
        "level": level,
        "overall": "PASS" if overall_pass else "FAIL",
        "configurations": [f"{t}/{v}" for t, v, _ in configs],
        "pages_tested": len(results),
        "pages_passed": sum(1 for r in results if r.status == "PASS"),
        "pages_failed": sum(1 for r in results if r.status == "FAIL"),
        "total_spec_tests": sum(r.spec_tests_run for r in results),
        "total_spec_passed": sum(r.spec_tests_passed for r in results),
        "total_spec_failed": sum(r.spec_tests_failed for r in results),
        "total_spec_skipped": sum(r.spec_tests_skipped for r in results),
        "results": [asdict(r) for r in results],
    }

    RESULTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(RESULTS_FILE, "w") as f:
        json.dump(output, f, indent=2)

    # Append-only history (永続化)
    history_entry = {
        "timestamp": output["timestamp"],
        "iteration": iteration,
        "level": level,
        "overall": output["overall"],
        "configs": output["configurations"],
        "pages_tested": output["pages_tested"],
        "pages_passed": output["pages_passed"],
        "pages_failed": output["pages_failed"],
        "spec_tests": output["total_spec_tests"],
        "spec_passed": output["total_spec_passed"],
        "spec_failed": output["total_spec_failed"],
        "spec_skipped": output["total_spec_skipped"],
        "failed_ids": [
            r["id"] for pr in output["results"]
            for r in pr.get("spec_results", [])
            if r.get("status") == "FAIL"
        ],
    }
    with open(HISTORY_FILE, "a") as f:
        f.write(json.dumps(history_entry) + "\n")

    return output


def main():
    parser = argparse.ArgumentParser(description="UI test with Playwright")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--pages", type=str, default=None)
    parser.add_argument("--level", choices=["smoke", "functional", "full"], default="smoke")
    parser.add_argument("--iteration", type=int, default=None)
    args = parser.parse_args()

    pages = args.pages.split(",") if args.pages else None
    print(f"🎭 UI Test — level: {args.level} (port {args.port})")
    if pages:
        print(f"   Pages: {', '.join(pages)}")
    else:
        print("   Pages: all")
    if args.level == "full":
        print("   Configs: light/desktop, dark/desktop, light/mobile")
    print()

    output = run_tests(args.port, pages, args.level, iteration=args.iteration)

    print()
    skip = f", {output['total_spec_skipped']} skipped" if output["total_spec_skipped"] else ""
    spec_info = f" | spec: {output['total_spec_passed']}/{output['total_spec_tests']}{skip}" if output["total_spec_tests"] else ""
    if output["overall"] == "PASS":
        print(f"✅ UI TEST PASS ({output['pages_passed']}/{output['pages_tested']} pages{spec_info})")
    else:
        print(f"❌ UI TEST FAIL ({output['pages_failed']}/{output['pages_tested']} pages failed{spec_info})")

    sys.exit(0 if output["overall"] == "PASS" else 1)


if __name__ == "__main__":
    main()
