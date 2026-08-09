# Loader Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable React `Loader` that renders the branded animated mark inline, sized by a single width prop while preserving the 32∶33 aspect ratio.

**Architecture:** Inline SVG in `loader.tsx` with path data and colors from `public/billing-agent-loader.svg`. Animation keyframes live in `loader.module.scss`. `size` sets width; height is always `size * (33 / 32)`.

**Tech Stack:** React 18, CSS Modules (SCSS), Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-08-09-loader-component-design.md`

## Global Constraints

- Filenames: kebab-case only; React export name `Loader` is PascalCase
- `size: number` is required and means **width in CSS pixels**
- Height must be `size * (33 / 32)` — never stretch, square, or override aspect ratio
- Keep `viewBox="0 0 32 33"`
- Colors: primary `#843c3c`, secondary `#cb8383`
- Default a11y: `role="img"`, `aria-label="Loading"` (overridable via props if spread)
- No centering / fullscreen / layout wrapper
- Do not change `index.html` boot SVG or replace Cleanplate `Spinner` call sites
- Do not commit unless the user explicitly asks

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/web/src/components/loader.tsx` | `Loader` component: inline SVG + size → width/height |
| `apps/web/src/components/loader.module.scss` | Keyframes + `.logo` transform helpers |
| `apps/web/src/components/loader.test.tsx` | Size, aspect ratio, a11y, className |

---

### Task 1: Loader component (TDD)

**Files:**
- Create: `apps/web/src/components/loader.test.tsx`
- Create: `apps/web/src/components/loader.module.scss`
- Create: `apps/web/src/components/loader.tsx` (replace empty stub)

**Interfaces:**
- Consumes: none
- Produces:

```ts
export type LoaderProps = {
  size: number;
  className?: string;
} & Omit<React.SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox'>;

export function Loader(props: LoaderProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/loader.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Loader } from './loader';

const ASPECT = 33 / 32;

describe('Loader', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders with width from size and height preserving 32:33 aspect ratio', () => {
    const size = 64;
    render(<Loader size={size} />);
    const svg = screen.getByRole('img', { name: /loading/i });
    expect(svg).toHaveAttribute('width', String(size));
    expect(svg).toHaveAttribute('height', String(size * ASPECT));
    expect(svg).toHaveAttribute('viewBox', '0 0 32 33');
  });

  it('applies className to the svg', () => {
    render(<Loader size={48} className="my-loader" />);
    expect(screen.getByRole('img', { name: /loading/i })).toHaveClass('my-loader');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npm test -- src/components/loader.test.tsx`

Expected: FAIL (empty/missing `Loader` export or missing attributes)

- [ ] **Step 3: Write SCSS module**

Create `apps/web/src/components/loader.module.scss`:

```scss
@keyframes top-loop {
  0%,
  8%,
  92%,
  to {
    opacity: 0;
    transform: translate(5.25px, -4.25px) scale(0.92);
  }
  24%,
  78% {
    opacity: 1;
    transform: translate(0, 0) scale(1.02);
  }
  34%,
  68% {
    opacity: 1;
    transform: translate(0, 0) scale(1);
  }
}

@keyframes bottom-loop {
  0%,
  8%,
  92%,
  to {
    opacity: 0;
    transform: translate(-5.25px, 4.25px) scale(0.92);
  }
  24%,
  78% {
    opacity: 1;
    transform: translate(0, 0) scale(1.02);
  }
  34%,
  68% {
    opacity: 1;
    transform: translate(0, 0) scale(1);
  }
}

.logo {
  transform-box: fill-box;
  transform-origin: center;
}

.top {
  composes: logo;
  animation: top-loop 2.8s cubic-bezier(0.22, 1, 0.36, 1) infinite;
}

.bottom {
  composes: logo;
  animation: bottom-loop 2.8s cubic-bezier(0.22, 1, 0.36, 1) infinite;
}
```

Note: If CSS Modules `composes` is awkward with local keyframes, apply both classes on each path (`className={`${styles.logo} ${styles.top}`}`) instead of `composes`. Prefer dual `className` if `composes` fails the build.

- [ ] **Step 4: Write Loader implementation**

Create `apps/web/src/components/loader.tsx`:

```tsx
import type { SVGProps } from 'react';
import styles from './loader.module.scss';

const VIEWBOX_WIDTH = 32;
const VIEWBOX_HEIGHT = 33;

export type LoaderProps = {
  size: number;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox'>;

export function Loader({ size, className, 'aria-label': ariaLabel = 'Loading', ...rest }: LoaderProps) {
  const height = size * (VIEWBOX_HEIGHT / VIEWBOX_WIDTH);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={height}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      role="img"
      aria-label={ariaLabel}
      className={className}
      {...rest}
    >
      <path
        fill="#843c3c"
        d="M32 7.776 24.224 0H8.3L16 8.075h8.224v8L32 23.85z"
        className={`${styles.logo} ${styles.top}`}
      />
      <path
        fill="#cb8383"
        d="m23.85 16.15-7.775-7.776H.15l7.7 8.075h8.225v8l7.776 7.775z"
        className={`${styles.logo} ${styles.bottom}`}
      />
    </svg>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npm test -- src/components/loader.test.tsx`

Expected: PASS (2 tests)

- [ ] **Step 6: Manual smoke check (optional)**

Temporarily render `<Loader size={128} />` on any page, confirm animation and proportions match `public/billing-agent-loader.svg`, then remove the temporary usage.

- [ ] **Step 7: Commit only if the user asks**

If requested:

```bash
git add \
  apps/web/src/components/loader.tsx \
  apps/web/src/components/loader.module.scss \
  apps/web/src/components/loader.test.tsx \
  docs/superpowers/specs/2026-08-09-loader-component-design.md \
  docs/superpowers/plans/2026-08-09-loader-component.md
git commit -m "$(cat <<'EOF'
feat(web): add reusable branded Loader component

EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| Inline SVG React component | Task 1 |
| `size` = width | Task 1 |
| Height = size × 33/32 | Task 1 |
| Preserve viewBox 32×33 | Task 1 |
| Optional `className` | Task 1 |
| Default `aria-label="Loading"` | Task 1 |
| Keyframes match public SVG | Task 1 SCSS |
| No layout wrapper | Task 1 (SVG root only) |
| No Spinner migration / index.html change | Explicit non-goals; no tasks |

## Placeholder scan

No TBD/TODO placeholders. Full file contents included.
