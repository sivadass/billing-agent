# Design QA Checklist

Concrete, checkable criteria per category. Cite the actual measured value against the expected one — this file gives you what "expected" means.

## Severity definitions

- **Blocker** — actively broken: overlapping/clipped text, illegible contrast (fails WCAG AA), content unreachable at a common breakpoint.
- **Major** — clearly unpolished and noticeable without a trained eye: inconsistent spacing between visually parallel elements, hierarchy that doesn't match content importance, misaligned grid.
- **Minor** — noticeable to a trained eye, doesn't hurt usability: a spacing value one step off the scale, slightly inconsistent icon sizing.
- **Nit** — true nitpick, optional polish: sub-pixel rounding, a shadow that could be 1 value softer.

## 1. Spacing rhythm (padding, margin, gap)

- Check whether the project uses a spacing scale (commonly 4px or 8px base: 4/8/12/16/24/32/48/64). Infer it from the most common values on the page if not documented.
- Flag any padding/margin/gap value that doesn't fall on the scale, unless it's a hairline (1-2px) border adjustment.
- Compare spacing between *visually parallel* elements (card grid items, list rows, sibling sections) — these should match exactly. A 2-4px mismatch here is more damaging than a single off-scale value in isolation because it reads as misalignment, not just "a bit tight."
- Check for asymmetric padding inside a single container (e.g. 16px left, 12px right) that isn't intentional (icon-adjacent asymmetry is fine; unexplained asymmetry isn't).
- Vertical rhythm: spacing between stacked text blocks (heading → body, body → button) should step down in a logical order (more space before a new section than between elements within one).

## 2. Typographic hierarchy

- Check the type scale is a real scale, not arbitrary sizes — common ratios are 1.125, 1.2, 1.25, 1.333. List the distinct font-sizes in use; more than ~5-6 on one page usually signals drift.
- Heading levels should be visually distinct from each other and from body text by size AND weight (not size alone, not weight alone) — two heading levels that only differ by 2px read as a mistake, not a hierarchy.
- Line-height: body text ~1.4-1.6x font-size; headings can go tighter, ~1.1-1.3x. Flag line-height that's tight enough to make descenders/ascenders touch.
- Line length: body paragraphs should sit roughly 45-75 characters per line for readability — flag full-bleed body text in wide containers.
- Font-weight usage should be consistent for the same semantic role (all H2s the same weight, all body text the same weight) unless a specific one is emphasized.
- Truncation/ellipsis: check long real-world content (long names, long numbers) doesn't silently overflow or wrap awkwardly where truncation was clearly intended.

## 3. Color & contrast

- Compute exact contrast ratio (via `scripts/contrast_ratio.py`) for every distinct body-text/background and interactive-element-label/background pairing.
  - WCAG AA: **4.5:1** minimum for normal text, **3:1** for large text (≥24px, or ≥19px bold) and UI component boundaries/icons.
  - WCAG AAA (worth noting, not always required): 7:1 normal text, 4.5:1 large text.
- Flag any pairing under 4.5:1 (normal) / 3:1 (large) as **Blocker**, since it's an accessibility failure, not a taste call.
- Check disabled/placeholder/secondary text specifically — these are the most common contrast failures because they're intentionally dimmed and often overshoot.
- Palette discipline: count distinct colors in use outside the documented palette/tokens. One-off colors (a random blue that isn't the brand blue) are a Major even if contrast passes, because it signals no shared source of truth.
- Check color isn't the *only* signal for state (error/success/required) — should be paired with an icon, label, or shape change too.

## 4. Alignment & grid

- Check elements that should share an edge actually share a pixel-exact edge (card left edges, form label/input starts, icon+text baselines).
- Check optical alignment on icons/text pairs — icons often need a 1-2px nudge to look vertically centered against text due to icon canvas padding; flag if it visibly doesn't.
- Check consistent column widths/gutters across a grid or table.
- Center a check: is something "centered" actually centered, or off by the width of an adjacent element (a common bug: centering text in a flex row that also has an icon on one side only)?

## 5. Component & pattern consistency

- Same component, same look: two buttons of the same semantic type (e.g. both "primary") should have identical padding, radius, font-weight, height — flag any drift.
- Check border-radius values are drawn from a small consistent set (e.g. 4/8/12/full), not ad hoc per component.
- Check shadow/elevation styles are reused, not bespoke per card.
- Check icon sizing and stroke-width are consistent across the page.
- If a design-token file, Tailwind config, or CSS variable set exists in the project, prefer flagging "not using token `space-4`" over "should be 16px" — it's the more useful, more durable fix.

## 6. Responsive behavior

- Check the 3 captured breakpoints (desktop/tablet/mobile) independently — a page can be perfect at 1440 and broken at 375.
- Flag: horizontal scroll/overflow that shouldn't exist, text that becomes illegibly small, tap targets under ~40x40px on mobile, content that disappears or becomes unreachable, images that don't scale/crop sensibly.
- Check that spacing scales down sensibly at smaller widths rather than staying desktop-sized and cramped, or vice versa.

## 7. Interactive states (when applicable)

- Hover, focus, active, disabled states should exist and be visually distinct for anything clickable.
- Focus states must be visible for keyboard navigation — don't accept `outline: none` with nothing replacing it (accessibility Blocker).
- Loading and empty states should match the visual language of the loaded state, not look like a different product.

## 8. Imagery & iconography

- Consistent icon set (mixing outline and filled icon styles within one context reads as unpolished).
- Images consistently cropped/aspect-ratioed within a repeating context (e.g. all card thumbnails same ratio).
- Alt text / accessible labels present for meaningful images (flag as Minor here — full a11y audit is a separate pass, but glaring gaps are worth a note).