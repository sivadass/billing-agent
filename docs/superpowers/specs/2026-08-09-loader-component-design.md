# Loader Component Design

**Date:** 2026-08-09  
**Status:** Approved for implementation planning  
**Related:** `apps/web/public/billing-agent-loader.svg`, `apps/web/index.html` boot SVG

## Problem

The branded animated loader exists only as a static SVG (boot splash in `index.html` / `public/billing-agent-loader.svg`). There is no reusable React component for in-app loading states that matches the brand mark.

## Goals

- Provide a reusable `Loader` React component with the same mark and animation as `billing-agent-loader.svg`
- Allow size customization via a single `size` number (width in CSS pixels)
- Preserve the SVG’s native aspect ratio (viewBox `32 × 33`) at every size
- Keep layout decisions with the parent (no built-in centering / fullscreen)

## Non-goals

- Replacing Cleanplate `Spinner` usages across pages (can happen later)
- Changing or deduplicating the HTML boot-time loader
- Named size tokens (`sm` / `md` / `lg`)
- Separate `width` / `height` props
- Color theming / dark-mode variants

## Decisions

| Topic | Decision |
| --- | --- |
| Render approach | Inline SVG in React (paths + animation CSS in a module) |
| Size API | Required `size: number` = rendered **width** in px |
| Aspect ratio | Height = `size * (33 / 32)`; never stretch or square-crop the mark |
| Extra props | Optional `className`; default `aria-label="Loading"`; `role="img"` |
| Layout | Component is the SVG only; no wrapper flex/center |
| Source of truth for art | Match `public/billing-agent-loader.svg` colors and keyframes; public file remains for boot/static use |
| Default size | No default — callers pass `size` explicitly |

## Aspect ratio (hard requirement)

- Source viewBox: `0 0 32 33` (width∶height = **32∶33**)
- Given `size` (width), set:
  - `width={size}`
  - `height={size * (33 / 32)}`
- Keep `viewBox="0 0 32 33"` and do not set CSS that overrides aspect ratio (`object-fit`, mismatched width/height, etc.)
- CSS modules may size via `width` only with `height: auto` if preferred, as long as the rendered box stays 32∶33

## Architecture

```text
<Loader size={48} className={?} />
  └─ <svg viewBox="0 0 32 33" width={size} height={size * 33/32} …>
       ├─ path (primary #843c3c) — top-loop animation
       └─ path (secondary #cb8383) — bottom-loop animation
```

### Files

| Path | Role |
| --- | --- |
| `apps/web/src/components/loader.tsx` | `Loader` component + props type |
| `apps/web/src/components/loader.module.scss` | Keyframes + `.logo` transform-origin (from SVG `<style>`) |

### Animation

Port existing keyframes from `billing-agent-loader.svg` unchanged:

- `top-loop` / `bottom-loop`, 2.8s, `cubic-bezier(0.22, 1, 0.36, 1)`, infinite
- `.logo { transform-box: fill-box; transform-origin: center; }`

### Usage examples

```tsx
<Loader size={48} />
<Loader size={256} className={styles.boot} />
```

## Out of scope for follow-ups

- Migrating page-level `Spinner` → `Loader`
- Sharing one asset between `index.html` and the React component (would require build/SVGR or duplication tradeoffs)

## Success criteria

- `<Loader size={N} />` renders the branded animation at width `N` and height `N * 33/32`
- Aspect ratio matches the public SVG at any `N`
- No layout side effects on parents beyond the SVG’s own box
