# Design QA Report — <page/component name>

**Reviewed:** <url or file> · <date>
**Breakpoints checked:** <e.g. 1440 / 768 / 375>

## Summary

<2-3 sentences: overall polish level, what's already solid, the theme of the issues found — e.g. "Layout and hierarchy are solid; most issues are spacing-scale drift and one contrast failure on secondary text.">

**Blockers: N · Major: N · Minor: N · Nit: N**

---

## Blockers

### 1. <Issue title> — `<element/selector>`
- **Where:** <screen/section, breakpoint if relevant>
- **What:** <measured value> vs **expected:** <value/token> — <one line on why it matters>
- **Fix:** `<exact property>: <old value>` → `<new value>` <or token reference>

*(repeat per issue — omit section entirely if none)*

## Major

*(same structure)*

## Minor

*(same structure — can be terser, one line each is fine)*

## Nit

*(same structure — one line each)*

---

## Passed / no issues

- <Category>: <one-line confirmation, e.g. "Spacing rhythm: consistent 8/16/24 scale throughout.">
- <Category>: ...

## Skipped

- <Category>: <why it doesn't apply to this artifact>