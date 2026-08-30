# Visual Refresh — Slice 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **When editing any `.svelte` file, use the `svelte:svelte-file-editor` skill / Svelte MCP tools to validate the component after each change.**

**Goal:** Land the everywhere-visible foundation of the Mathion visual refresh — new tokens, self-hosted IBM Plex fonts, the logo + `AppHeader`, the shared `ui/` primitives (`Button`, new `IconButton`, `StatusBadge`, form controls), and the SVG `ItemIcon` — so every later slice restyles onto a finished base.

**Architecture:** The refresh is styling + interaction-pattern only; no feature is added or removed. The handoff `base.css` is split into two files that keep every existing variable name: **`theme-default.css`** holds the design-token `:root` block (the future white-label override surface) and **`base.css`** holds the element/structural rules that consume those tokens — so the token swap changes the look without breaking any component. Slice 1 also seeds the **branding seam** for a later white-label slice: the product name comes from a single `branding.ts` source and the logo from one `Logo.svelte` component, rather than being hardcoded across components (the runtime mechanism — superuser Admin-page branding settings for name/logo/primary-color, served by the backend and applied at boot; an optional mounted `theme.css` for full design overrides — is a separate future slice). The design's exact SVG geometry (logo, avatar, five item-type marks, action glyphs) lives in the vendored reference bundle — **extract it, do not redraw it**.

**Tech Stack:** Svelte 5 (runes), Vite, TypeScript, vitest (jsdom). No CSS framework, no component library. Self-hosted IBM Plex Sans + Mono (woff2 + `@font-face`).

**Spec:** The visual authority is `docs/design/visual-refresh/mathion-visual-spec.md` (vendored in Task 1 from the handoff). Reference screens: `docs/design/visual-refresh/reference-screens.dc.html`. This plan implements Slice 1 of that spec (foundation only).

## Global Constraints

- **Visual authority is the spec; every metric is deliberate.** Use the exact values in `mathion-visual-spec.md` / `base.css` (13–14px base, 5px radii, `--control-h` 30px / 28px in rows, `--btn-pad`, 1px hairlines). Do NOT substitute roomier component-library defaults.
- **Extract SVG, don't redraw.** Logo + avatar SVG source is at the foot of `base.css`; the five item-type marks are in the first "visual system" card of `reference-screens.dc.html`; the action glyphs are NOT in that card — they live in the screen cards, matched by their `title=` attribute (see Task 5). Transcribe geometry verbatim (viewBox, path data, stroke-width, caps/joins).
- **Feature-neutral.** No behavior change in Slice 1 beyond the two explicit markup changes in scope (remove the status emoji from `StatusBadge`; SVG marks replace emoji in `ItemIcon`). The §5 state-machine changes (per-field version editing, item-editor modal) are NOT in this slice.
- **No new JS/CSS dependencies.** Fonts are self-hosted woff2 (no Google Fonts CDN links). No Tailwind/PostCSS/component libs.
- **Svelte 5 runes** (`$props`, `$derived`, `$state`); scoped `<style>` per component; validate every `.svelte` edit with the Svelte MCP.
- **Tests use `mount`/`unmount`/`flushSync` from `svelte`**, never `@testing-library/svelte` (not a dependency; forbidden by CLAUDE.md/MEMORY.md).
- **The token split keeps every existing variable name** — all design tokens move to `theme-default.css` verbatim (same names, same values); `base.css` keeps only element rules. Nothing may rely on a renamed/removed token.
- **Branding seam (for the future white-label slice):** the *in-app-rendered* product name comes from `branding.ts` and the logo only from `Logo.svelte`; do not add NEW hardcoded "Mathion" or logo markup in components. The one known exception this slice is the existing literal `<title>Mathion</title>` in `index.html` — it stays as-is and migrates onto `branding.ts` in the branding slice (Slice 1 does not wire the document title). Do NOT build the runtime branding mechanism in this slice — only the seam. (That mechanism, later: superuser Admin-page settings for name/logo/primary-color, served via `GET /api/branding` and applied at boot; an optional mounted `theme.css` for full design overrides.)
- **Verification per task:** `npm test` (from `frontend/`, runs `vitest run`) green, `npm run check` (svelte-check) 0 errors, `npm run build` succeeds. Styling-only tasks additionally get a manual visual check against the named reference screen.
- **Commit discipline:** `git add` exact named paths only (never `-A`/`.`). Every commit MUST end with the co-author trailer as a second `-m` paragraph (each task's commit step already shows this form) — EXACTLY:
  `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`
- **Branch:** all Slice 1 work on a single feature branch off `main` (e.g. `feat/visual-refresh-slice1-foundation`), NOT a worktree.

---

## File Structure

**Created:**
- `docs/design/visual-refresh/` — vendored handoff (spec, README, reference HTML + its two runtime JS files, base.css archive). Docs only, never imported by the app.
- `frontend/src/styles/theme-default.css` — the design-token `:root` block (all colors, spacing, radii, fonts, control metrics). The single file a future operator override shadows.
- `frontend/src/styles/fonts.css` — `@font-face` blocks for the 5 self-hosted faces.
- `frontend/src/styles/fonts/*.woff2` — 5 vendored font files.
- `frontend/src/lib/branding.ts` — source for the in-app-rendered product name (`PRODUCT_NAME = 'Mathion'`); the branding seam's config point (the `index.html` `<title>` and any other name sites migrate onto it in the branding slice). Slice 1 defines the name constant only, not a logo default (the logo is `Logo.svelte`).
- `frontend/src/components/ui/IconButton.svelte` — shared square icon-button primitive + named glyph set.
- `frontend/src/components/ui/Logo.svelte` — the two-peak SVG mark (header form only this slice; the sizing/reverse variants for login/favicon are added by their consuming slices), reused by AppHeader now and Login later.
- `frontend/src/tests/IconButton.svelte.test.ts`, `frontend/src/tests/Button.svelte.test.ts`, `frontend/src/tests/ItemIcon.svelte.test.ts` — new unit tests (all under `src/tests/`, matching the repo convention — every existing `*.svelte.test.ts` lives there).

**Modified:**
- `frontend/src/styles/base.css` — split: the token `:root` block moves to `theme-default.css`; this file keeps only the element/structural rules (`body`, `.mono`/`code`, `a`, `h1`–`h4`, `:focus-visible`, the logo/avatar reference comments).
- `frontend/src/app.css` — import order: `reset.css` → `fonts.css` → `theme-default.css` → `base.css`.
- `frontend/src/components/ui/Button.svelte` — exact variant metrics + danger/danger-off + disabled treatment.
- `frontend/src/components/ui/StatusBadge.svelte` — remove emoji icon; bring to reference badge metrics (11px/500, 3px 8px, `--radius-pill`).
- `frontend/src/components/chrome/AppHeader.svelte` — 44px, logo lockup, nav pills.
- `frontend/src/components/course/ItemIcon.svelte` — SVG marks (5 types) + 3 states.
- `frontend/src/components/ui/{Input,FormRow,Spinner,LoadingPlaceholder,InlineConfirm}.svelte` — align to control tokens.
- `frontend/src/lib/dashboards.ts` — remove now-unused `STATUS_ICON`.
- `frontend/src/components/runs/RunSubmissionTab.svelte` — drop the `void STATUS_ICON` shim + import.
- `frontend/src/tests/StatusBadge.svelte.test.ts`, `frontend/src/tests/RunSubmissionTab.svelte.test.ts` — drop icon assertions.

**Interfaces produced (for later slices):**
- `theme-default.css` — the design-token `:root` block; the single file a future operator theme (Admin-page settings or a mounted `theme.css`) overrides. Import order guarantees any later `:root` wins, unset tokens fall back here.
- `branding.ts` — `export const PRODUCT_NAME = 'Mathion'`; the source of the *in-app rendered* product name, consumed by `AppHeader` this slice. It is NOT yet the single source everywhere: `index.html` keeps its literal `<title>Mathion</title>` and Login has no hardcoded name — the document title (and any other name sites) migrate onto `branding.ts` in the branding slice. A plain export the branding slice can later back with the Admin-page setting; consumers that then need live updates move to a store at that point.
- `IconButton` props: `{ glyph: GlyphName, title: string (required), size?: 'sm'|'md' (24|28), borderless?: boolean (chevron/fold — no border/bg, `--muted`), disabled?: boolean, danger?: boolean, onclick?: () => void, 'aria-label'?: string }`.
- `Logo` — **no props in Slice 1** (only the `'header'` form is built, and it needs none, so no inert props ship). The `'login'`/`'favicon'` forms and any props they require (a `context`/form selector, `reversed`) are added by their consuming slices. The single logo component (later gains an optional custom-image source from branding config).
- `Button` variants: `'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-off'`; existing props unchanged (`type`, `disabled`, `loading`, `title`, `aria-label`, `onclick`, `children`).
- `ItemIcon` unchanged public API: `{ item: Item, state: 'covered'|'current'|'not-yet', onclick: () => void }`.

---

### Task 1: Vendor the design handoff into the repo

The handoff currently lives only in `~/Downloads/design_handoff_mathion_visual_refresh/`. Vendor the whole bundle into the repo so no later task depends on `~/Downloads` surviving, and so implementers/reviewers of every slice can read it. `base.css` is archived here as the handoff reference; Task 3 drops it into `src/styles/` from this repo copy.

**Files:**
- Create: `docs/design/visual-refresh/{mathion-visual-spec.md, README.md, reference-screens.dc.html, support.js, image-slot.js, base.css}`

- [ ] **Step 1: Copy the whole bundle**

```bash
mkdir -p docs/design/visual-refresh
cp ~/Downloads/design_handoff_mathion_visual_refresh/mathion-visual-spec.md docs/design/visual-refresh/
cp ~/Downloads/design_handoff_mathion_visual_refresh/README.md          docs/design/visual-refresh/
cp ~/Downloads/design_handoff_mathion_visual_refresh/reference-screens.dc.html docs/design/visual-refresh/
cp ~/Downloads/design_handoff_mathion_visual_refresh/support.js          docs/design/visual-refresh/
cp ~/Downloads/design_handoff_mathion_visual_refresh/image-slot.js       docs/design/visual-refresh/
cp ~/Downloads/design_handoff_mathion_visual_refresh/base.css            docs/design/visual-refresh/
```

- [ ] **Step 2: Sanity-check the reference HTML** — confirm it references only the two colocated JS files (`support.js`, `image-slot.js`) for behavior. It also carries Google-Font `<link>`s (`fonts.googleapis.com`) — those are inert in the vendored docs copy (docs-only, never served by the app), so they are fine to leave; just note them.

- [ ] **Step 3: Commit**

```bash
git add docs/design/visual-refresh/
git commit -m "docs(design): vendor visual-refresh handoff (spec + reference screens)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Self-host IBM Plex (fonts + @font-face)

**Files:**
- Create: `frontend/src/styles/fonts/` (5 × `.woff2`), `frontend/src/styles/fonts.css`

Weights required by the spec: **IBM Plex Sans 400/500/600**, **IBM Plex Mono 400/500** (latin subset is sufficient — the UI is English). (Mono 500 may have no consumer yet — `.mono`/`code` render at 400 — but is kept per the spec's declared mono weights for later emphasis use; a tiny unused asset, not worth dropping.)

- [ ] **Step 1: Fetch the woff2 files** (from the OFL `@fontsource` mirror on jsDelivr — a build-time vendoring, not a runtime dependency)

```bash
cd frontend/src/styles/fonts
BASE=https://cdn.jsdelivr.net/npm
curl -fsSLO $BASE/@fontsource/ibm-plex-sans@5/files/ibm-plex-sans-latin-400-normal.woff2
curl -fsSLO $BASE/@fontsource/ibm-plex-sans@5/files/ibm-plex-sans-latin-500-normal.woff2
curl -fsSLO $BASE/@fontsource/ibm-plex-sans@5/files/ibm-plex-sans-latin-600-normal.woff2
curl -fsSLO $BASE/@fontsource/ibm-plex-mono@5/files/ibm-plex-mono-latin-400-normal.woff2
curl -fsSLO $BASE/@fontsource/ibm-plex-mono@5/files/ibm-plex-mono-latin-500-normal.woff2
ls -l && for f in *.woff2; do [ "$(head -c 4 "$f")" = "wOF2" ] && echo "OK  $f" || echo "BAD $f (not a woff2 — likely an HTML error page)"; done
# each of the 5 must print "OK" (valid woff2 magic), not "BAD" — catches a saved error page that `ls` alone would miss
```

If the sandbox blocks network egress, STOP and ask the human partner to run the block above in a normal shell (in Claude Code, the `!` prefix runs it in-session), then resume. Do not substitute a different font or leave the app pointing at the runtime CDN.

- [ ] **Step 2: Write `frontend/src/styles/fonts.css`** — five `@font-face` rules, `font-display: swap`, relative `url()` so Vite fingerprints them:

```css
/* Self-hosted IBM Plex (OFL). No third-party font CDN: Mathion must run
   offline/air-gapped and must not leak requests to Google. */
@font-face {
  font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 400;
  font-display: swap; src: url('./fonts/ibm-plex-sans-latin-400-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 500;
  font-display: swap; src: url('./fonts/ibm-plex-sans-latin-500-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 600;
  font-display: swap; src: url('./fonts/ibm-plex-sans-latin-600-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 400;
  font-display: swap; src: url('./fonts/ibm-plex-mono-latin-400-normal.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 500;
  font-display: swap; src: url('./fonts/ibm-plex-mono-latin-500-normal.woff2') format('woff2');
}
```

- [ ] **Step 3: Verify the downloads only** — confirm the 5 `.woff2` are non-empty and `npm run build` still succeeds. Do NOT assert emitted fonts here: `fonts.css` is an orphan until Task 3 wires `@import './styles/fonts.css'` into `app.css`, so Vite bundles no woff2 yet and produces no unresolved-`url()` warning (the `url()` is never processed). The "fingerprinted in `dist/_app/`" check lives in Task 3 Step 5, after the import is wired.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/fonts frontend/src/styles/fonts.css
git commit -m "feat(frontend): self-host IBM Plex Sans + Mono (woff2 + @font-face)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Split the handoff CSS into `theme-default.css` (tokens) + `base.css` (rules) + wire import order

The handoff ships one `base.css` (archived at `docs/design/visual-refresh/base.css`). Split it so the token `:root` block — the white-label override surface — is its own file. Values are unchanged; this is organization, not a redesign.

**Files:**
- Create: `frontend/src/styles/theme-default.css`
- Modify: `frontend/src/styles/base.css`, `frontend/src/app.css`

- [ ] **Step 1: Create `theme-default.css`** — copy the entire `:root { … }` block (every token: surfaces, text, lines, accent, gold, semantic, geometry, control sizing, danger-off, type, avatars, space, heatmap, status pairs, state pairs) from `docs/design/visual-refresh/base.css` **verbatim — exactly as the handoff `base.css` defines them** (that file is the source that produced the reference screens; do not "correct" values against the spec prose). Head it with a comment: `/* Design tokens = the white-label override surface. A future operator theme (superuser Admin-page settings, or an optional mounted theme.css) redefines any subset of these in a later-loaded :root; unset tokens fall back to the values here. */`

  **One known spec-vs-reference conflict rides along, entirely in deferred territory — do NOT resolve it here.** The spec prose (§1 note "the one exception is `--dimmed` (#6B7280)", and §4's disabled-version-row treatment) describes a `--dimmed` token and a #6B7280 disabled fill, but the handoff `base.css` deliberately defines **no** `--dimmed` (its own comment: "a disabled version does not get a dim colour") and sets `--state-disabled-fg: #5A616E`. Nothing in Slice 1 consumes `--dimmed` or `--state-disabled-*` (the disabled-version rows are the deferred editor slice, and `StatusBadge` has no `disabled` status — its `--status-*` set is not-submitted/awaiting-eval/needs-revision/accepted/rejected). So do **not** invent `--dimmed` — inventing a token for an unconsumed, contested treatment would be guessing a design decision. Copy `base.css` as-is and drop a marker for the slice that will build those rows: `/* TODO(version-slice): reconcile the disabled-version treatment with design — spec §4 prose uses --dimmed #6B7280; this reference deliberately omits --dimmed and uses --state-disabled-fg #5A616E. */`

- [ ] **Step 2: Reduce `base.css`** to ONLY the non-token remainder of the handoff file — the element/structural rules: `body`, the `.mono, code, kbd` rule, `a`/`a:hover`, `h1`–`h4`, `:focus-visible`, and the header-lockup + teacher-avatar reference comment blocks. No `:root` block remains here.

- [ ] **Step 3: Wire `app.css` import order** — `reset.css` → `fonts.css` → `theme-default.css` → `base.css`:

```css
@import './styles/reset.css';
@import './styles/fonts.css';
@import './styles/theme-default.css';
@import './styles/base.css';
```

- [ ] **Step 4: Verify the split is value-identical** — no token dropped, renamed, OR revalued. Compare full `name: value` declarations, not just names (a names-only grep passes even if every value is silently corrupted). Normalize whitespace **per line** (do NOT `tr` newlines away — that would collapse every declaration onto one line and defeat the set compare): `grep -oE -- '--[a-z0-9-]+:[^;]+;' docs/design/visual-refresh/base.css | sed 's/[[:space:]]\{1,\}/ /g' | sort -u` vs the same over `frontend/src/styles/theme-default.css`, and confirm `diff` of the two normalized, sorted declaration sets is empty.

- [ ] **Step 5: Full test + check + build + font-emit check** — `npm test` && `npm run check` && `npm run build`, all green. Now that `app.css` imports `fonts.css` (Step 3), confirm the 5 woff2 are fingerprinted into **`dist/_app/`** (`vite.config.ts` sets `build.assetsDir:'_app'` — NOT `dist/assets/`): `ls dist/_app/*.woff2` shows 5, or grep the built CSS for the hashed woff2 URLs. **Expect a full visual shift, not a subtle one:** replacing the app's live `base.css` changes almost every base token — `--bg` #fff→#FBFBFC, `--text`, `--muted`, `--border`, `--primary` #444→#3F5C77, `--danger`, `--success`, `--radius` 4→5px, `--font-size-base` 16→14px — plus the deepened `--status-needs-revision` and the four version-lifecycle pairs. It is test-safe (verified: `src/tests` has 0 literal hex/size assertions and no snapshots), so a green suite is expected; if any test DOES assert an old literal value, that is a real find — report it, don't silently edit it. Note the four `--state-*` tokens are seeded here but consumed by nobody until the editor slice (the version screens still hardcode their badge colors).

- [ ] **Step 6: Manual visual check** — `npm run dev` and load at least one dense screen (a Run dashboard Progress/Submissions tab) AND one form screen (Login or NewRunModal): IBM Plex renders, background `#FBFBFC`, primary steel blue, no layout explosions. The token flip ripples `--danger` (#c33→#991B1B) into un-restyled *fills* — `chrome/Toast.svelte` `.error` background and the quiz `.opt.wrong` color — so glance at a toast/quiz too; both are intended foundation ripples, just confirm they still read correctly.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/styles/theme-default.css frontend/src/styles/base.css frontend/src/app.css
git commit -m "feat(frontend): split design tokens into theme-default.css (white-label override surface)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `ui/Button.svelte` — exact variants + danger + disabled

**Files:**
- Modify: `frontend/src/components/ui/Button.svelte`
- Test: `frontend/src/tests/Button.svelte.test.ts` (new)

**Interfaces:**
- Consumes: tokens from Task 3 (`--btn-pad`, `--btn-pad-sm`, `--primary`, `--border-strong`, `--text-3`, `--muted`, `--faint`, `--border-faint`, `--danger`, `--danger-off-*`).
- Produces: `Button` with variant union `'primary'|'secondary'|'ghost'|'danger'|'danger-off'`; all other props unchanged.

Per spec §4 (Button): primary = `--primary` bg / `--primary-text` / `--btn-pad` / weight 500; secondary = `--surface` bg / 1px `--border-strong` / `--text-3` / `--btn-pad`; ghost = no bg / `--muted` / `--btn-pad-sm`. All radius `--radius`, font 13px. Disabled = `--faint` text, `--border-faint` border, `--bg` bg, `cursor:not-allowed`, **no opacity**, keep `title`. Danger = `--danger` text, never a red fill. Danger-off (unarmed Force delete) = `--danger-off-bg` / `--danger-off-border` / `--danger-off-text`. **A natively `disabled` danger-off button keeps the danger-off treatment, not the grey disabled one** — per the spec/`base.css` a disabled Force delete "stays recognisably destructive" (the `--danger-off-*` tokens exist precisely for the disabled destructive button). Since the generic `.btn:disabled` rule (specificity 0,2,0) would otherwise win over `.danger-off` (0,1,0) and grey it out, add a `.btn.danger-off:disabled` rule (0,3,0) that re-asserts the three `--danger-off-*` tokens.

- [ ] **Step 1: Write the failing test** `frontend/src/tests/Button.svelte.test.ts`

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Button from '../components/ui/Button.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(Button, { target: host, props });
  flushSync();
  return host.querySelector('button') as HTMLButtonElement;
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

describe('Button', () => {
  for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'danger-off'] as const) {
    it(`marks the ${variant} variant via data-variant + class`, () => {
      const btn = render({ variant });
      // data-variant is the RED-first guard: the current component renders
      // `class="btn {variant}"` (any string passes classList.contains), so it
      // does NOT set data-variant — this assertion fails until the rewrite adds it.
      expect(btn.getAttribute('data-variant')).toBe(variant);
      expect(btn.classList.contains('btn')).toBe(true);
      expect(btn.classList.contains(variant)).toBe(true);
    });
  }

  it('keeps disabled + title (token-based disabled, verified visually not here)', () => {
    // jsdom does not compute stylesheet styles, so the opacity→token swap is a
    // manual/visual check; this only guards the disabled attr + tooltip.
    const btn = render({ disabled: true, title: 'nope' });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('nope');
  });

  it('fires onclick when enabled', () => {
    const onclick = vi.fn();
    const btn = render({ onclick });
    btn.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('defaults to the primary variant', () => {
    const btn = render({});
    expect(btn.getAttribute('data-variant')).toBe('primary');
  });

  it('keeps the danger-off treatment when also natively disabled', () => {
    // The disabled Force-delete IS the danger-off state, so a disabled danger-off
    // button must NOT collapse to the generic grey disabled variant. jsdom can't
    // compute the cascade, so this guards that variant identity survives `disabled`;
    // the `.btn.danger-off:disabled` colour precedence itself is a visual check.
    const btn = render({ variant: 'danger-off', disabled: true });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('data-variant')).toBe('danger-off');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — `npm test -- Button` → FAIL: the current `Button.svelte` sets no `data-variant` attribute, so every `expect(btn.getAttribute('data-variant'))…` assertion is `null`. (Note: the bare `classList.contains(variant)` checks would false-pass on current code because `class="btn {variant}"` interpolates any string — that is exactly why `data-variant` is the real red gate.) The red gate here is the runtime `data-variant` assertions, NOT a type error: the test passes `variant` through a `Record<string, unknown>` prop bag (so the widened union is not type-checked at the call site) and no app component passes `'danger'`/`'danger-off'` yet, so `npm run check` stays green both before and after — do not expect a check-time failure as the gate.

- [ ] **Step 3: Implement** — extend the `Variant` union with `'danger' | 'danger-off'`, add `data-variant={variant}` to the `<button>`, and rewrite the `<style>` to the spec metrics. Keep the existing script API and the `loading` spinner. Replace the `.btn:disabled { opacity: 0.5 }` rule with the token-based disabled treatment (`--faint` text / `--border-faint` border / `--bg` bg, no opacity). Add `.danger` (=`--danger` text, no red fill) and `.danger-off` (=`--danger-off-*`) rules, **plus a `.btn.danger-off:disabled` rule that re-applies the three `--danger-off-*` tokens** so a natively-disabled Force-delete keeps its destructive look instead of being greyed by the higher-specificity generic `.btn:disabled` rule. Validate with the Svelte MCP.

- [ ] **Step 4: Run tests + check** — `npm test -- Button` PASS; `npm run check` 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Button.svelte frontend/src/tests/Button.svelte.test.ts
git commit -m "feat(frontend): restyle Button to refresh metrics + danger variants" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `ui/IconButton.svelte` — new shared primitive + glyph set

**Files:**
- Create: `frontend/src/components/ui/IconButton.svelte`, `frontend/src/tests/IconButton.svelte.test.ts`

**Interfaces:**
- Produces: `IconButton` — props `{ glyph, title (required), size?: 'sm'|'md', borderless?: boolean, disabled?, danger?, onclick?, 'aria-label'? }`. `sm`=24px (table/accordion/modal rows), `md`=28px (page-level). Default (boxed): radius `--radius`, 1px `--border-strong`, `--surface` bg. **`borderless: true`** (spec §4: "chevron = expand/collapse — borderless, `--muted`"; also the section-fold chevrons) = no border, no bg, `--muted` color. SVG 12–14px, `stroke-width:1.6`, `stroke:currentColor`, `viewBox="0 0 16 16"`. Disabled (a forbidden action that must keep its slot): `1px --border-faint`, `--bg` bg, `--faint` color, reason in `title`. Danger (trash): `--danger` color.

Glyph set (spec §4, Icon button): `pencil` (edit), `duplicate` (overlapping rects), `disable` (circle-slash), `enable` (circle-check), `trash` (delete, danger), `plus` (create), `up`/`down` (reorder), `chevron` (expand/collapse — pair with `borderless`), `close` (×). **Extract each glyph's exact SVG from the titled action controls in the SCREEN examples of `docs/design/visual-refresh/reference-screens.dc.html` — NOT the first "visual system" card** (that card holds only the logo, palette, status badges, coverage ramp, and the five item-type marks — no action glyphs). Locate each by its `title=` anchor and transcribe path data verbatim:
- `pencil` = `title="Edit"` (the same pencil path also appears on `title="Open"`)
- `duplicate` = `title="Duplicate"` (rect + folded-corner path)
- `disable` = `title="Disable"` (circle + diagonal slash)
- `enable` = `title="Enable"` (circle + check `polyline`)
- `trash` = the `title="Delete"` whose SVG is the **lidded can** (`M4.4 4.6l.7 8.2…`, e.g. the version-actions row around line 1486) — NOT the other `title="Delete"` that is an ✕ of two crossed lines
- `up`/`down` = `title="Move up"` / `title="Move down"`
- `chevron` = `title="Collapse"` (down chevron `polyline points="4.6,6.6 8,10 11.4,6.6"`); `title="Expand"` is the right-facing variant
- `close` = `title="Close"` (✕)
- `plus` (create) = the inline mark on the primary "+ New…" button

All marks use `viewBox="0 0 16 16"`, `stroke-width:1.6`, round caps/joins. Prefer the ENABLED instance — some titled controls also appear greyed/disabled (e.g. `title="Delete — only for a created version"`), do not transcribe those. **Chevron orientation:** Slice 1 seeds the single `chevron` glyph as the down-facing Collapse form only; the right-facing Expand orientation (and any orientation prop/state) is added by the first slice that actually toggles a fold — do not build an untested second orientation now. **Note:** no screen consumes `IconButton` in Slice 1 (only `ItemIcon` is wired, via `SequencePlayer`), so these glyphs are covered only by this task's unit test — double-check each transcription against the reference now, since a wrong path won't surface until a later slice adopts it.

- [ ] **Step 1: Write the failing test** `frontend/src/tests/IconButton.svelte.test.ts`

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import IconButton from '../components/ui/IconButton.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(IconButton, { target: host, props });
  flushSync();
  return host.querySelector('button') as HTMLButtonElement;
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

const GLYPHS = ['pencil','duplicate','disable','enable','trash','plus','up','down','chevron','close'] as const;

describe('IconButton', () => {
  it('requires and renders a title (tooltip + a11y)', () => {
    const btn = render({ glyph: 'pencil', title: 'Edit' });
    expect(btn.getAttribute('title')).toBe('Edit');
    expect(btn.querySelector('svg')).not.toBeNull();
  });

  // Cover the WHOLE glyph set (no consumer wires most glyphs in Slice 1, so this
  // unit test is their only guard): each renders its data-glyph hook + an <svg>.
  for (const glyph of GLYPHS) {
    it(`renders the ${glyph} glyph as an SVG via data-glyph`, () => {
      const btn = render({ glyph, title: glyph });
      expect(btn.getAttribute('data-glyph')).toBe(glyph);
      expect(btn.querySelector('svg')).not.toBeNull();
    });
  }

  it('renders distinct geometry for EVERY glyph (no shared/placeholder mark)', () => {
    // Full-set distinctness: a 2-glyph spot check would let the other 8 share one
    // arbitrary mark and still pass. Render all 10, assert every SVG body is unique.
    const marks = GLYPHS.map((glyph) => {
      const svg = render({ glyph, title: glyph }).querySelector('svg')!.innerHTML;
      unmount(component!); component = null; host.parentNode?.removeChild(host);
      return svg;
    });
    expect(new Set(marks).size).toBe(GLYPHS.length);
  });

  it('renders disabled but still present (fixed-slot alignment)', () => {
    const btn = render({ glyph: 'disable', title: 'Not allowed', disabled: true });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('Not allowed');
  });

  it('does not fire onclick when disabled', () => {
    const onclick = vi.fn();
    const btn = render({ glyph: 'plus', title: 'Add', disabled: true, onclick });
    btn.click();
    expect(onclick).not.toHaveBeenCalled();
  });

  it('applies the danger class for destructive glyphs', () => {
    const btn = render({ glyph: 'trash', title: 'Delete', danger: true });
    expect(btn.classList.contains('danger')).toBe(true);
  });

  it('applies the borderless class for chevron/fold controls', () => {
    const btn = render({ glyph: 'chevron', title: 'Collapse', borderless: true });
    expect(btn.classList.contains('borderless')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — `npm test -- IconButton` → FAIL (component absent).

- [ ] **Step 3: Implement `IconButton.svelte`** — a `<button>` shell carrying `data-glyph={glyph}`, `title`, `aria-label` (defaults to `title`), `disabled`, size + `danger` + `borderless` classes, and an inline `{#if}` / lookup rendering the glyph SVG extracted from the reference HTML. The `borderless` class drops the border/bg and sets `--muted` (for chevrons). Validate with the Svelte MCP.

- [ ] **Step 4: Run tests + check** — PASS; svelte-check 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/IconButton.svelte frontend/src/tests/IconButton.svelte.test.ts
git commit -m "feat(frontend): add IconButton primitive + refresh glyph set" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `course/ItemIcon.svelte` — SVG marks + 3 states (no emoji)

**Files:**
- Modify: `frontend/src/components/course/ItemIcon.svelte`
- Test: `frontend/src/tests/ItemIcon.svelte.test.ts` (new)

**Interfaces:**
- Consumes: `Item` (`item.type` ∈ `static_page | video | quiz | interactive_app | mini_project`). Public API unchanged: `{ item, state: 'covered'|'current'|'not-yet', onclick }` (consumer `pages/SequencePlayer.svelte` must keep working untouched).

Per spec §4 (ItemIcon): 22px rounded square (radius 5) carrying an 11px SVG mark, `viewBox="0 0 16 16"`, `stroke-width:1.6` (1.9 for the check), `stroke:currentColor`. Marks keyed by `item.type`: **`static_page`** = three horizontal lines, last short; **`video`** = filled play triangle; **`quiz`** = check; **`interactive_app`** = three vertical slider tracks with offset knobs; **`mini_project`** = flag on a pole. (Note the enum value is `static_page`, not the spec-prose word "page".) **Extract each mark's exact SVG from the visual-system reference (first card) of `docs/design/visual-refresh/reference-screens.dc.html`** — search the file for the `"Item types"` / `"visual system"` anchor; all five marks share `viewBox="0 0 16 16"`. States: **covered** = `--primary` fill / white mark; **current** = `--primary-soft` fill / 1.5px `--primary` border / `--primary` mark; **not-yet** (not started) = `--surface` fill / 1px `--border-strong` / `--muted` mark (drop the old `opacity`). **Slice-1 scope note:** `editor/ItemRow.svelte` renders the *same* item-type emoji today and is NOT in this slice, so afterward the sequence player shows SVG marks while the editor item rows still show emoji until the editor slice — an expected intermediate inconsistency, not a bug.

- [ ] **Step 1: Write the failing test** `frontend/src/tests/ItemIcon.svelte.test.ts`

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ItemIcon from '../components/course/ItemIcon.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(type: string, state: 'covered' | 'current' | 'not-yet') {
  host = document.createElement('div');
  document.body.appendChild(host);
  const item = { id: 1, title: 'T', slug: 't', order: 0, type } as any;
  component = mount(ItemIcon, { target: host, props: { item, state, onclick: vi.fn() } });
  flushSync();
  return host.querySelector('button') as HTMLButtonElement;
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

describe('ItemIcon', () => {
  const types = ['static_page', 'video', 'quiz', 'interactive_app', 'mini_project'];
  for (const type of types) {
    it(`renders an SVG mark (not emoji) for ${type}`, () => {
      const btn = render(type, 'not-yet');
      expect(btn.querySelector('svg')).not.toBeNull();          // SVG, not a text glyph
      expect(btn.getAttribute('data-type')).toBe(type);
      expect((btn.textContent ?? '').trim()).toBe('');          // no emoji text node
    });
  }
  for (const state of ['covered', 'current', 'not-yet'] as const) {
    it(`applies the ${state} state class`, () => {
      const btn = render('quiz', state);
      expect(btn.classList.contains(state)).toBe(true);
    });
  }
  it('renders a distinct mark for EVERY item type (no shared SVG)', () => {
    // Full-set distinctness: render all five types, assert every SVG body is unique
    // (a 2-type check would let quiz/interactive_app/mini_project reuse one mark).
    const marks = types.map((type) => {
      const svg = render(type, 'not-yet').querySelector('svg')!.innerHTML;
      unmount(component!); component = null; host.parentNode?.removeChild(host);
      return svg;
    });
    expect(new Set(marks).size).toBe(types.length);
  });
  it('fires onclick when the icon is activated', () => {
    const onclick = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    const item = { id: 1, title: 'T', slug: 't', order: 0, type: 'quiz' } as any;
    component = mount(ItemIcon, { target: host, props: { item, state: 'current', onclick } });
    flushSync();
    (host.querySelector('button') as HTMLButtonElement).click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });
  it('keeps title + aria-label for a11y', () => {
    const btn = render('video', 'covered');
    expect(btn.getAttribute('title')).toBe('T');
    expect(btn.getAttribute('aria-label')).toBe('T');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — `npm test -- ItemIcon` → FAIL (emoji text present, no `data-type`, no `<svg>`).

- [ ] **Step 3: Implement** — replace the emoji `$derived` with a per-`item.type` SVG mark (extracted from the reference), add `data-type={item.type}`, keep the `<button>` wrapper + `onclick`/`title`/`aria-label`, and rewrite `<style>` to the 22px square + three state treatments (drop the `opacity` on not-yet — use the `--surface`/`--border-strong`/`--muted` treatment). Validate with the Svelte MCP.

- [ ] **Step 4: Run the full suite** — `npm test` + `npm run check`. (There is no existing `ItemIcon`/`SequencePlayer` component test, so this confirms nothing else regresses; the new `ItemIcon.svelte.test.ts` is the coverage.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/course/ItemIcon.svelte frontend/src/tests/ItemIcon.svelte.test.ts
git commit -m "feat(frontend): ItemIcon SVG marks + coverage states (drop emoji)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `branding.ts` seam + `Logo.svelte` + `AppHeader` logo lockup + nav pills

**Files:**
- Create: `frontend/src/lib/branding.ts`, `frontend/src/components/ui/Logo.svelte`
- Modify: `frontend/src/components/chrome/AppHeader.svelte`
- Test: `frontend/src/tests/AppHeader.svelte.test.ts` (verify still green; adjust only if structure moves the text nodes)

**Interfaces:**
- Produces: `branding.ts` — `export const PRODUCT_NAME = 'Mathion';` (the source of the *in-app rendered* app name — `AppHeader` this slice; `index.html`'s `<title>` and any other name sites migrate onto it in the branding slice). The future white-label slice backs this constant with the Admin-page setting. Keep it a plain module export; a later slice can turn it into a store then (consumers that need live updates move to the store at that point, not now).
- Produces: `Logo` — **no props this slice** (the `'header'` form is self-contained). Two overlapping peaks (front `--primary`/`#3F5C77`, back `--gold`/`#E8A317`), round caps/joins, no fill. **Slice 1 implements only the `'header'` form** (the only one consumed this slice): cropped **`viewBox="0 0 32 23.6"`**, mark box **26 × 19.2px**, stroke-width **3.6** — transcribe the exact SVG from the header-lockup block at the foot of the handoff `base.css`. The `'login'` (28px, stroke 4, full `viewBox="0 0 32 32"`) and `'favicon'` (24px, reversed, stroke 3.2, on a `#3F5C77` tile) forms are added by the slices that consume them (Login / favicon) with their exact §2 values — do NOT build untested variants now. Below ~17px the one-ink form (both peaks `--primary`, back at 72%).

Per spec §4 (AppHeader): 44px tall, `--surface` bg, 1px `--border` bottom. **The brand lockup is exact** (§2 "Header geometry is exact"): `<Logo />` (the 26×19.2 header mark) sits before the product name (14px/600) in an `align-items:center` row with **`gap:7px`**, and the mark is nudged **`translateY(-4.35px)`** so the stroke ends land on the wordmark baseline. That lockup CSS (gap + nudge) lives in AppHeader's brand styling, not in `Logo`. Nav items are pills: **active** = `--gold-text` 500 on `--gold-soft`, **`border-radius: 4px`** (a literal — matches no token; `--radius` is 5, `--radius-pill` is 3 — do NOT "correct" it), padding 4px 10px; **inactive** = `--muted`, no bg. User email 12.5px `--muted` on the right. **Preserve the existing DOM text and roles the tests depend on**: nav items **stay `<a>` anchors** (the guard tests query `<a>` by text — do not switch to `<button>`); the brand anchor renders `PRODUCT_NAME` (default `'Mathion'`, so the `Mathion` assertion still holds) + its `href`; nav anchors keep text `Authoring`/`Teaching` + `aria-current`; the name/email text node and the `Logout` button text + logout-awaits-then-navigates behavior are unchanged.

- [ ] **Step 1: Confirm the guard tests exist and pass pre-change** — `npm test -- AppHeader` (green on current code).

- [ ] **Step 2: Create `branding.ts`** — `export const PRODUCT_NAME = 'Mathion';` with a comment noting it is the branding seam (later fed by the superuser Admin-page branding setting).

- [ ] **Step 3: Create `Logo.svelte`** — the `'header'` form only: `aria-hidden="true"`, the two peaks transcribed verbatim from the header-lockup block at the foot of the handoff `base.css` (cropped `viewBox="0 0 32 23.6"`, 26×19.2px box, stroke-width 3.6, front `--primary` / back `--gold`, round caps+joins, no fill). Declare NO props this slice (the header form is self-contained); the `'login'`/`'favicon'` forms and any props they need (a `context`/form selector, `reversed`) are added by their consuming slices — do NOT declare inert props now. This is the single logo component (a future slice teaches it an optional custom-image source). Validate with the Svelte MCP.

- [ ] **Step 4: Restyle `AppHeader.svelte`** — import `PRODUCT_NAME` from `branding.ts` and render it as the wordmark (do NOT hardcode "Mathion"); place `<Logo />` before the wordmark inside the existing brand anchor with the exact lockup (`align-items:center`, `gap:7px`, mark `transform: translateY(-4.35px)`), keeping the anchor + onclick; keep the two nav items as `<a>` anchors but style them as pills (active = `--gold-text` 500 on `--gold-soft`, `border-radius:4px`, pad 4px 10px; inactive `--muted` no bg; keep `aria-current`); set the header 44px / `--surface` / 1px `--border` bottom; style the user name at 12.5px `--muted`; render Logout as a ghost `Button` (or a styled button) keeping its `Logout` text + `onLogout` handler. Do NOT change any handler logic. Validate with the Svelte MCP.

- [ ] **Step 5: Run the guard tests** — `npm test -- AppHeader` must stay green (the wordmark still reads `Mathion` because `PRODUCT_NAME` defaults to it). If a text lookup breaks (e.g. the wordmark got split across nodes), fix the markup to keep `Mathion`/`Authoring`/`Teaching`/`Logout` as single trimmed text nodes rather than weakening the test. `npm run check` 0 errors.

- [ ] **Step 6: Manual visual check** vs reference (AppHeader on any screen): 44px bar, gold active pill, mark+wordmark baseline aligned.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/branding.ts frontend/src/components/ui/Logo.svelte frontend/src/components/chrome/AppHeader.svelte frontend/src/tests/AppHeader.svelte.test.ts
git commit -m "feat(frontend): AppHeader logo lockup + nav pills + branding.ts name seam" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `ui/StatusBadge.svelte` — remove the emoji (§5 #8)

**Files:**
- Modify: `frontend/src/components/ui/StatusBadge.svelte`, `frontend/src/lib/dashboards.ts`, `frontend/src/components/runs/RunSubmissionTab.svelte`
- Test: `frontend/src/tests/StatusBadge.svelte.test.ts`, `frontend/src/tests/RunSubmissionTab.svelte.test.ts`

The badge currently renders `STATUS_ICON[status]` — Unicode symbol glyphs (`○ … ↻ ✓ ✗`), strictly not emoji, but the same §5 #8 "no decorative glyph in the badge" rule applies. `STATUS_ICON` is consumed only by `StatusBadge` (render) and `RunSubmissionTab` (a `void STATUS_ICON` no-op shim) — verified there are no other importers — so it can be deleted after both stop using it.

This is a removal/refactor, not a red-first feature, so the sequence is: tighten the tests to stop asserting the emoji, remove it from the component, then delete the dead symbol — verifying the suite stays green and no emoji remains.

**§5 #8 scope (do not overclaim — this is NOT an exhaustive glyph audit):** this task removes the decorative glyph from **`StatusBadge` only**; `ItemIcon` (Task 6) drops its emoji separately. Slice 1's no-emoji claim is scoped strictly to `StatusBadge` + `ItemIcon`; §5 #8 ("no emoji anywhere") is otherwise NOT satisfied this slice. Two separate categories remain, both deliberately untouched now:
  - **Emoji (emoji-presentation) glyphs** still live in `editor/ItemRow.svelte`, `editor/ItemTypePicker.svelte`, `editor/OptionRow.svelte`, `editor/QuestionAccordion.svelte`, `editor/AssetSidebar.svelte`, `editor/QuestionTypePicker.svelte` (→ authoring/editor slice) and `course/MiniProjectLink.svelte` (→ student-surfaces slice).
  - **Non-emoji symbol glyphs** (`✓`/`✗`/`○`/`↻` and similar dingbats — NOT emoji, so not strictly a §5 #8 violation) still appear in various status/coverage/checklist components (e.g. `course/StatusPill.svelte`, `course/SequenceLink.svelte`, `items/VideoItem.svelte`, `runs/RosterImportModal.svelte`, `runs/RunOverviewTab.svelte`, `runs/DashboardSidePanel.svelte`). These are swapped for SVG as each screen is restyled in its slice; the list here is illustrative, not complete.

- [ ] **Step 1: Add a guard for the new behavior** — in `StatusBadge.svelte.test.ts` add one assertion that the rendered badge contains NO `STATUS_ICON` glyph (e.g. `expect(badge.textContent?.trim()).toBe(STATUS_LABEL[status])` — label only, nothing else). Run it: it FAILS on current code (the emoji is still in `textContent`). This is the red state.

- [ ] **Step 2: Update the old assertions** —
  - `StatusBadge.svelte.test.ts`: drop the `STATUS_ICON` import, remove `+ icon "${STATUS_ICON[status]}"` from the `it(...)` name, and delete the `expect(badge.textContent...).toContain(STATUS_ICON[status])` line. Keep the label + `data-status` + inline-var assertions (plus the Step-1 guard).
  - `RunSubmissionTab.svelte.test.ts`: drop the `STATUS_ICON` import and the `expect(badge.textContent).toContain(STATUS_ICON[status])` at :175 (keep the label assertion).

- [ ] **Step 3: Implement the removal** —
  - `StatusBadge.svelte`: remove the `STATUS_ICON` import + the `<span class="icon">` node; render label only; bring the badge to the reference visual-system metrics — `font-size: 11px`, `font-weight: 500`, `padding: 3px 8px`, `border-radius: var(--radius-pill)` (current is 14px / `0.125rem 0.5rem` / `2px`, so this is a real restyle, not just the radius); drop the now-dead `.icon` font rule.
  - `RunSubmissionTab.svelte`: remove `STATUS_ICON` from the import and delete the `void STATUS_ICON;` line + its comment.
  - `dashboards.ts`: remove the `STATUS_ICON` export (confirm no other consumer first: `grep -rn STATUS_ICON src`).
  - Validate both `.svelte` files with the Svelte MCP.

- [ ] **Step 4: Full suite + check** — the Step-1 guard now PASSES; `npm test` all green; `npm run check` 0 errors; `grep -rn STATUS_ICON src` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/StatusBadge.svelte frontend/src/lib/dashboards.ts frontend/src/components/runs/RunSubmissionTab.svelte frontend/src/tests/StatusBadge.svelte.test.ts frontend/src/tests/RunSubmissionTab.svelte.test.ts
git commit -m "feat(frontend): drop status emoji from StatusBadge (§5 no-emoji)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Align remaining `ui/` form primitives to control tokens

**Files:**
- Modify: `frontend/src/components/ui/{Input,FormRow,Spinner,LoadingPlaceholder,InlineConfirm}.svelte`

Forms appear on nearly every screen, so aligning the shared primitives to the dense control tokens now (rather than per-screen later) moves the foundation forward. Read each component first; change only styling to the tokens — no API/behavior change.

**Scope reality (don't overclaim "every control shrinks"):** `Input` and `FormRow` are currently imported by `Login` only, and many forms use **raw** `<input>`/`<select>`/`<textarea>` these primitives don't touch — e.g. Login's own duration `<select>` and `NewRunModal`'s title/date `<input>`s. So this task aligns the *primitives*; it does NOT make every control on a screen 30px. Aligning raw controls app-wide (a base-layer `input, select, textarea` rule, or per-screen migration) is a later slice, deliberately out of scope here.

Targets (spec §1/§4): field height `--control-h` (30px; `--control-h-sm` 28px in rows), horizontal pad `--control-pad-x` (9px), field VALUE font `--control-font` (13px) while labels stay 12.5px, textarea pad `--control-pad-textarea` (8px 10px), border `--border-strong`, radius `--radius`, `:focus-visible` already themed globally in base.css. `Spinner`/`LoadingPlaceholder` adopt `--muted`/`--border-soft`. `InlineConfirm` uses the danger-text (not red-fill) convention.

- [ ] **Step 1: Read the five components** and note each one's current style hooks. Report any that already fully match (skip those in the diff).

- [ ] **Step 2: Restyle to tokens** — one component at a time; validate each with the Svelte MCP. No markup/prop changes.

- [ ] **Step 3: Full suite + check + build** — `npm test` green (these primitives have existing consumers/tests), `npm run check` 0 errors, `npm run build` OK.

- [ ] **Step 4: Manual visual check** — on Login, the **`Input`-based** Email/PIN fields render at 30px height / 13px value with their 12.5px `FormRow` labels. (Login's duration `<select>` and `NewRunModal`'s raw `<input>`s are NOT `Input` components, so they keep their current sizing this slice — expected, not a regression.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Input.svelte frontend/src/components/ui/FormRow.svelte frontend/src/components/ui/Spinner.svelte frontend/src/components/ui/LoadingPlaceholder.svelte frontend/src/components/ui/InlineConfirm.svelte
git commit -m "feat(frontend): align ui form primitives to refresh control tokens" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done-when

- New tokens + self-hosted IBM Plex live; `app.css` imports `reset → fonts → theme-default → base`; `AppHeader`'s product name comes from `branding.ts` (the document `<title>` and any other name sites migrate onto it in the branding slice).
- `AppHeader` shows the logo lockup + gold active pill; `Button`, `IconButton`, `StatusBadge`, `ItemIcon`, and the form primitives all render the refresh language.
- No emoji in `StatusBadge` or `ItemIcon`; `STATUS_ICON` removed.
- `npm test`, `npm run check`, `npm run build` all green on the final tree.
- The app is fully usable and shippable; later slices restyle screens onto this base.
