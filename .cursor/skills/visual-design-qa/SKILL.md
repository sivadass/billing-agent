---
name: visual-design-qa
description: Perform a designer's visual QA audit on a rendered web page, component, or UI artifact — the same pass a design lead does before sign-off, distinct from functional QA. Checks spacing/padding/margin rhythm, alignment and grid discipline, text hierarchy and type scale, color contrast and palette consistency, component/state consistency, and responsive behavior. Use this whenever the user asks to review, audit, QA, critique, or "polish" a UI, frontend, page, component, or PR preview; asks "does this look right," "is the spacing off," "check the design," or wants a final visual pass before shipping — even if they don't say "design QA" by name. Always use this instead of a generic freeform look at a screenshot, because it produces a structured, severity-ranked report with exact fixes instead of vague impressions.
---

# Visual Design QA

Acts as the designer counterpart to functional QA: functional QA asks "does it work?", this skill asks "is it polished?" — spacing rhythm, hierarchy, contrast, alignment, and consistency, the kind of finish check a design lead does on a developer's implementation before sign-off.

Output is a structured, severity-ranked **Design QA Report**, not a vague "looks good to me." Every flagged issue names the exact element, the exact numbers involved, and the exact fix — never "the spacing feels off," always "gap is 14px, nearest rhythm step is 16px."

## Workflow

### 1. Get visual evidence

Prefer live rendering over static screenshots — layout bugs (overflow, wrapping, truncation) often only show up in a real browser.

- If a browser automation tool is available (Playwright/Puppeteer MCP, browser tool, etc.), navigate to the page and capture full-page screenshots at **three breakpoints minimum**: 1440px (desktop), 768px (tablet), 375px (mobile). `scripts/capture_and_measure.py` does this plus a computed-style dump in one pass — see step 2.
- If no browser tool is available, ask the user for screenshots (ideally at those three widths) rather than guessing from code alone. Reading JSX/CSS tells you intent, not what actually rendered — margin collapse, inherited line-height, and flex/grid quirks routinely produce a different result than the source suggests.
- If given both code and a screenshot, use the code to explain *why* a visual defect exists (which class/rule is responsible) so the fix is a direct pointer, not a re-diagnosis.

### 2. Pull hard numbers, don't eyeball them

Human-in-the-loop visual review is good at *spotting* that something looks off and bad at *quantifying* it precisely. Close that gap with measurement:

- Run `scripts/capture_and_measure.py <url>` (requires Playwright — see script header for setup) to get, per key element: bounding box, computed `margin`/`padding`/`gap`, `font-size`/`font-weight`/`line-height`, and `color`/`background-color`.
- Run `scripts/contrast_ratio.py <fg-hex> <bg-hex>` to get an exact WCAG contrast ratio instead of eyeballing "that text looks light." Do this for every body-text/background and button-text/button-background pair you flag or clear.
- If script execution isn't available in the current environment, fall back to reading exact values from browser DevTools output the user provides, or from the CSS/computed styles directly — but always cite a real number, never an impression.

### 3. Audit against the checklist

Read `references/checklist.md` for the full criteria (spacing rhythm, type scale, contrast thresholds, alignment, consistency, responsive, states). Work through it category by category against the captured evidence. Skip categories that plainly don't apply (e.g., no interactive states on a static marketing page).

### 4. Rank and report

Use `references/report-template.md` as the structure. Key rules:

- **Severity, not vibes.** Every issue is Blocker / Major / Minor / Nit (definitions in the checklist). Sort the report by severity, not by page order.
- **Numbers over adjectives.** "24px gap, everywhere else on the page uses the 8/16/24/32 scale — this one's an outlier at 24px... actually fine" — i.e., show the actual value, the expected value, and the delta. Don't say "cramped," say "8px where surrounding sections use 24px."
- **One fix per issue, stated as a diff.** `padding: 12px 14px` → `padding: 12px 16px` — not "adjust the padding a bit." If the project has design tokens (check for a token file, Tailwind config, or CSS variables first), reference the token instead of a raw value.
- **No pile-ons.** If five buttons share the same misaligned padding because they share one component, that's **one** issue with five locations, not five issues.
- **Say what's already right, briefly.** A one-line "consistent, no issues" per category that passed keeps the report credible — a report that's all complaints reads as nitpicking rather than QA.

### 5. Deliver

Default to a markdown report (matches the user's usual deliverable style — save as an artifact/file, not just inline chat, if it's more than a couple of issues). Include the screenshots or crops next to the issues they support when the environment allows inline images. If the user has design tokens or a component library, note when an issue is really "component X doesn't use the shared token" rather than a one-off value — that's a more valuable finding than the pixel diff alone.

## When categories don't apply

Don't force all checklist categories onto every artifact — a single static component doesn't need a responsive-breakpoint section, an internal admin table doesn't need brand-palette commentary. State briefly what was skipped and why so the omission reads as a decision, not an oversight.