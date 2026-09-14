#!/usr/bin/env python3
"""
Compute the exact WCAG contrast ratio between two colors.

Usage:
    python contrast_ratio.py <fg> <bg>

Colors can be hex (#RRGGBB, #RGB) or rgb()/rgba() strings, e.g.:
    python contrast_ratio.py "#6B7280" "#FFFFFF"
    python contrast_ratio.py "rgb(107, 114, 128)" "white"

Prints the ratio plus WCAG AA/AAA pass/fail for normal and large text.
No dependencies — safe to run anywhere with Python 3.
"""
import re
import sys

NAMED = {
    "white": "#FFFFFF", "black": "#000000", "transparent": "#FFFFFF",
}


def parse_color(s: str):
    s = s.strip()
    low = s.lower()
    if low in NAMED:
        s = NAMED[low]

    if s.startswith("#"):
        h = s[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) != 6:
            raise ValueError(f"Can't parse hex color: {s}")
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
        return r, g, b

    m = re.match(r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)", s, re.I)
    if m:
        return tuple(round(float(x)) for x in m.groups())

    raise ValueError(f"Unrecognized color format: {s}")


def relative_luminance(rgb):
    def chan(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (chan(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(fg, bg):
    l1, l2 = relative_luminance(fg), relative_luminance(bg)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    fg, bg = parse_color(sys.argv[1]), parse_color(sys.argv[2])
    ratio = contrast_ratio(fg, bg)

    print(f"Foreground: {sys.argv[1]} -> rgb{fg}")
    print(f"Background: {sys.argv[2]} -> rgb{bg}")
    print(f"Contrast ratio: {ratio:.2f}:1")
    print()
    print(f"{'Normal text (AA >=4.5, AAA >=7)':38} "
          f"AA {'PASS' if ratio >= 4.5 else 'FAIL':4} / "
          f"AAA {'PASS' if ratio >= 7 else 'FAIL'}")
    print(f"{'Large text/UI (AA >=3, AAA >=4.5)':38} "
          f"AA {'PASS' if ratio >= 3 else 'FAIL':4} / "
          f"AAA {'PASS' if ratio >= 4.5 else 'FAIL'}")


if __name__ == "__main__":
    main()