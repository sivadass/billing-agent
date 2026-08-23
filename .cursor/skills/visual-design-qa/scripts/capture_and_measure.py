#!/usr/bin/env python3
"""
Capture full-page screenshots at multiple breakpoints and dump computed
layout/typography/color data for key elements — the raw evidence a
design QA audit reasons over, instead of eyeballing a single screenshot.

Setup (one-time, needs network access to npm/playwright's CDN):
    pip install playwright --break-system-packages
    python -m playwright install chromium

Usage:
    python capture_and_measure.py <url> [--out-dir ./qa-audit] \
        [--widths 1440,768,375] [--selector "h1,h2,h3,p,button,a"]

Output (in --out-dir):
    screenshot-<width>.png   — one full-page screenshot per breakpoint
    measurements.json        — per-breakpoint, per-element computed styles
                                and bounding boxes for every element
                                matching --selector

The default selector covers the elements a design QA pass cares about
most: headings, body text, and interactive elements. Narrow it with
--selector to focus on a specific component.
"""
import argparse
import json
import sys
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print(
        "Playwright isn't installed. Run:\n"
        "  pip install playwright --break-system-packages\n"
        "  python -m playwright install chromium",
        file=sys.stderr,
    )
    sys.exit(1)

DEFAULT_SELECTOR = "h1,h2,h3,h4,h5,h6,p,button,a,input,label,li,img"

MEASURE_JS = """
(selector) => {
  const els = Array.from(document.querySelectorAll(selector));
  return els.slice(0, 300).map((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const text = (el.textContent || "").trim().slice(0, 60);
    return {
      tag: el.tagName.toLowerCase(),
      classes: el.className && typeof el.className === "string" ? el.className : "",
      text_preview: text,
      box: {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
      },
      spacing: {
        margin: cs.margin, padding: cs.padding, gap: cs.gap,
      },
      typography: {
        font_size: cs.fontSize, font_weight: cs.fontWeight,
        line_height: cs.lineHeight, font_family: cs.fontFamily,
        letter_spacing: cs.letterSpacing,
      },
      color: {
        color: cs.color, background_color: cs.backgroundColor,
      },
      box_model: {
        border_radius: cs.borderRadius, box_shadow: cs.boxShadow,
        border: cs.border,
      },
    };
  });
}
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url")
    ap.add_argument("--out-dir", default="./qa-audit")
    ap.add_argument("--widths", default="1440,768,375", help="comma-separated viewport widths")
    ap.add_argument("--selector", default=DEFAULT_SELECTOR)
    ap.add_argument("--wait-ms", type=int, default=500, help="settle time after load, in ms")
    args = ap.parse_args()

    widths = [int(w.strip()) for w in args.widths.split(",")]
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for width in widths:
            page = browser.new_page(viewport={"width": width, "height": 900})
            page.goto(args.url, wait_until="networkidle")
            page.wait_for_timeout(args.wait_ms)

            screenshot_path = out_dir / f"screenshot-{width}.png"
            page.screenshot(path=str(screenshot_path), full_page=True)

            measurements = page.evaluate(MEASURE_JS, args.selector)
            results[str(width)] = measurements
            page.close()
            print(f"[{width}px] captured screenshot + {len(measurements)} element measurements")
        browser.close()

    measurements_path = out_dir / "measurements.json"
    measurements_path.write_text(json.dumps(results, indent=2))
    print(f"\nDone. Screenshots + measurements.json written to {out_dir.resolve()}")


if __name__ == "__main__":
    main()