#!/bin/zsh
# Visual-refresh built-CSS gate — Slice-3, all nine tasks (T1-T8b).
#
#   zsh frontend/scripts/visual-refresh-gate.sh     # from anywhere
#
# Exits non-zero on the first failure class; prints one PASS/FAIL line per
# assertion. It runs `npm run build` itself and grades `dist/_app/*.css`.
#
# WHY THIS EXISTS. jsdom gets no component CSS (vite.config.ts sets no
# `css: true`), and `svelte-check` type-checks rather than reading the cascade —
# so nothing in `npm test` or `npm run check` can see a styling regression. This
# script is the only lane that can. Concretely: T6 moves a 22px bordered box off
# `ItemIcon`'s button onto `ItemMark`, and putting it back would render a
# visible double ring with all 1324 tests still green.
#
# HOW TO EXTEND IT — the rules were learned the hard way, each from a mutation
# that escaped a weaker check:
#   * Hash-couple every assertion to an anchor proved unique on THIS build, and
#     prove the anchor's OWNERSHIP too (one dist hash alone does not show which
#     component it belongs to — a class can migrate and the gate then grades a
#     different component while the real defect is live).
#   * Prefer a PARSED-selector inventory + declaration-SET comparison over a
#     declaration-level regex. A regex like `\.icon\.HASH\{` demands the
#     compound sit immediately before the brace, so a selector list and a
#     `:where()` suffix both walk through it; a grep also cannot see a later
#     duplicate or an `@media`/`@supports`-wrapped override, which still win the
#     cascade while the original rule keeps matching.
#   * A negative (`none`) assertion must be paired with a positive one on the
#     same anchor, or it passes vacuously when the anchor disappears.
#   * Anchor a `none` as `\{([^}]*;)?prop:`, never `\{[^}]*(^|;)prop:` — the
#     latter needs a preceding `;` and so cannot see a declaration sitting first
#     in the rule.
#   * Source greps must strip comments: several components' comments quote the
#     very forms they forbid.
#   * NEVER put an apostrophe inside the `node -e '…'` payload — not even in a
#     comment. It closes the shell string and silently kills the scanner, with
#     no error you would notice; both times this happened the only signal was
#     EXPECTED_CHECKS coming up short. Write "each component own tests", not
#     "each component's own tests".
#   * Mutation-test every new assertion. Break the thing it claims to guard and
#     watch it go red; an assertion never seen to fail is not known to work.
#
# spec:197 — every assertion is a DECLARATION-LEVEL regex, hash-coupled to a
# gate-verified-unique anchor, and NEVER declaration-order-dependent.
#
# "Declaration-level" needs anchoring on BOTH sides. `\{[^}]*decl` is a
# declaration-SUFFIX match: it accepts `line-height:` for `height:`, `column-gap:`
# for `gap:`, `max-width:` for `width:`, `caret-color:` for `color:` — and a
# `column-gap` swap silently zeroes the whole prompt->field->answer rhythm in a
# flex COLUMN. So the left side anchors to the rule brace or a `;` (laneA-I1),
# and the right side terminates with `[;}]`.
#
# Several things no per-declaration grep can see, so they are parsed instead:
#   * a rule this task never authored (laneA-I2 — a `input, .num { … }` selector
#     LIST re-introduces the retargeted bare rule and beats every `input\.H\{`
#     regex, and it wins the cascade at equal specificity because it comes
#     later);
#   * a DUPLICATE property inside a pinned rule (laneA-I3 — the minifier keeps
#     both, the later one wins, and the positive grep still matches the earlier);
#   * the forced-colors focus outline, which must sit in exactly one such block.
#
# The per-rule comparison is a set of EXACT minified declaration strings, so it is
# order-independent but value-exact: rewriting `border:1px solid X` as the three
# longhands, or 14.5px as .90625rem, reds it. That is the intent — a pin that
# accepted equivalents could not tell an equivalent from a drift.
#
# `rules()` is not string-aware: a `content:"{"` anywhere in the bundle would
# desync it. It fails SAFE (following rules read as missing -> FAIL), the bundle
# has no such string today, and a real one would red the gate rather than hide a
# regression.
# Resolve relative to this script, not the caller's cwd: every path below
# (`src/...`, `dist/_app/*.css`) is frontend-relative, and the script is run
# from the repo root as often as from frontend/.
# Resolve this script's own ABSOLUTE path BEFORE the cd: the re-exec below needs
# it, and `$0` is relative when the documented `zsh frontend/scripts/...` form is
# used from the repo root — re-execing that after cd'ing into frontend/ looked
# for frontend/frontend/scripts/... and reported "FAILURES (0 checks)"
# (codex-r2-I3). Resolve relative to the script, not the caller's cwd: every
# path below (`src/...`, `dist/_app/*.css`) is frontend-relative, and the script
# is run from the repo root as often as from frontend/.
SELF=${0:A}
cd "${SELF:h}/.." || { echo "FAIL  cannot cd to frontend/"; exit 1 }
# Report how many assertions actually RAN, and require the expected number. The
# count is only knowable after the run, so the script re-execs itself once: the
# child does the work, the parent counts its PASS/FAIL lines. The count is
# EXACT, not a floor — a floor conceals a check that stops running once later
# checks are added, which is the failure this exists to catch (codex-r1-M2,
# tightened by codex-r2-M). Bump EXPECTED_CHECKS when you add assertions; that
# speed bump is intentional.
EXPECTED_CHECKS=1382
if [[ -z ${VRGATE_IS_CHILD_7f3a:-} ]]; then
  log=$(mktemp "${TMPDIR:-/tmp}/vrgate.XXXXXX") || { echo "FAIL  cannot create temp log"; exit 1 }
  # EXIT cleans up; INT/TERM additionally re-raise so the caller sees a real
  # signal status. A single combined trap ran `rm` on the way out, which
  # overwrote $pipestatus before it was read and deleted the log before it was
  # counted, and reported an ordinary failure instead of 130/143 (codex-r3-M2).
  trap 'rm -f "$log"' EXIT
  trap 'rm -f "$log"; trap - INT;  kill -INT  $$' INT
  trap 'rm -f "$log"; trap - TERM; kill -TERM $$' TERM
  VRGATE_IS_CHILD_7f3a=1 zsh "$SELF" "$@" | tee "$log"
  ps=($pipestatus); rc=$ps[1]; tee_rc=$ps[2]
  n=$(grep -cE '^(PASS|FAIL)' "$log")
  [[ $tee_rc -eq 0 ]] || { echo "FAIL  tee failed (rc=$tee_rc) — the count is unreliable"; rc=1 }
  if [[ $rc -eq 0 && $n -ne $EXPECTED_CHECKS ]]; then
    echo "FAIL  ran $n checks, expected $EXPECTED_CHECKS — either a section skipped its"
    echo "      assertions, or you added some without bumping EXPECTED_CHECKS."
    rc=1
  fi
  [[ $rc -eq 0 ]] && echo "VISUAL-REFRESH GATE: ALL PASS ($n checks)" \
                  || echo "VISUAL-REFRESH GATE: FAILURES ($n checks, expected $EXPECTED_CHECKS)"
  exit $rc
fi
fail=0
# Build here rather than trusting whatever is in dist/. A stale or foreign dist
# yields a confident PASS about nothing: during a two-lane review this gate once
# reported `unexpected: .verdict.svelte-1w098ps`, a selector in no source file
# in the repo — it was grading CSS built from another agent's working tree.
npm run build >/dev/null 2>&1 || { echo "FAIL  vite build failed"; exit 1 }
CSS=(dist/_app/*.css)
[[ ${#CSS[@]} -eq 1 ]] || { echo "FAIL  expected exactly one dist CSS file, found ${#CSS[@]}"; exit 1 }
# No dist-freshness check: `npm run build` two lines up always rewrites dist, so
# the CSS can never be stale — but a src file with a future mtime (clock skew on
# a synced tree) made the check fail with a message asserting the opposite.
# What DOES need asserting is that no OTHER channel puts CSS in the document.
extra_css=$(find dist -name '*.css' ! -path 'dist/_app/*' | head -5)
[[ -z $extra_css ]] || { echo "FAIL  CSS outside dist/_app (public/ is copied verbatim and links after the bundle): $extra_css"; fail=1 }
grep -q '<style' dist/index.html && { echo "FAIL  dist/index.html carries an inline <style> — it wins over the bundle"; fail=1 }
links=$(grep -o 'rel="stylesheet"' dist/index.html | wc -l | tr -d ' ')
[[ $links -eq 1 ]] || { echo "FAIL  dist/index.html links $links stylesheets, expected 1"; fail=1 }
head_styles=$(grep -rl 'svelte:head' src --include='*.svelte' | xargs grep -l '<style' 2>/dev/null)
[[ -z $head_styles ]] || { echo "FAIL  <svelte:head> <style> compiles into the JS bundle, invisible to every CSS check: $head_styles"; fail=1 }

# --- anchors: double-verify (source ownership AND dist uniqueness) ----------
# `.num:disabled` lives only in NumericQuestion.svelte, `.txt:disabled` only in
# TextQuestion.svelte — that per-file split is itself what spec §3 pins, so the
# anchors and the combined-selector-list check are the same fact.
grep -qE '^[[:space:]]*\.num:disabled[[:space:]]*\{' src/components/items/quiz/NumericQuestion.svelte || { echo "FAIL  .num:disabled not authored in NumericQuestion.svelte"; fail=1 }
grep -qE '^[[:space:]]*\.txt:disabled[[:space:]]*\{' src/components/items/quiz/TextQuestion.svelte     || { echo "FAIL  .txt:disabled not authored in TextQuestion.svelte"; fail=1 }
NH=$(grep -ohE '\.num\.svelte-[a-z0-9]+:disabled' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)
TH=$(grep -ohE '\.txt\.svelte-[a-z0-9]+:disabled' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)
[[ $(echo "$NH" | wc -l) -eq 1 && -n "$NH" ]] || { echo "FAIL  Numeric anchor not unique: $NH"; fail=1 }
[[ $(echo "$TH" | wc -l) -eq 1 && -n "$TH" ]] || { echo "FAIL  Text anchor not unique: $TH"; fail=1 }
[[ "$NH" != "$TH" ]] || { echo "FAIL  Numeric and Text resolved to the same hash"; fail=1 }
echo "anchors: Numeric=$NH  Text=$TH"

check() { if grep -oqE "$2" $CSS; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1 fi }
none()  { if grep -oqE "$2" $CSS; then echo "FAIL  $1"; fail=1; else echo "PASS  $1"; fi }
plain() { echo "${1//\\/}" }   # the label shows the selector, not its escaping
# d SELECTOR SUFFIX DECL... — one anchored declaration-level check per DECL
d()  { local sel=$1 suf=$2; shift 2; for decl in "$@"; do check "$N $(plain $sel)$(plain $suf) { $(plain $decl) }" "${sel}\.${H}${suf}\{([^}]*;)?${decl}[;}]"; done }
# dd SELECTOR CHILD DECL... — the same for a descendant rule
dd() { local sel=$1 kid=$2; shift 2; for decl in "$@"; do check "$N $(plain $sel) $(plain $kid) { $(plain $decl) }" "${sel}\.${H} ${kid}\{([^}]*;)?${decl}[;}]"; done }
# chk EMITTED-SELECTOR-REGEX DECL... — one declaration-level check per DECL; the caller
# supplies the full emitted selector (descendant/:has/:where forms), hash already expanded.
chk() { local pre=$1; shift; for decl in "$@"; do check "$N $(plain $pre) { $(plain $decl) }" "${pre}\{([^}]*;)?${decl}[;}]"; done }

for pair in "Numeric:$NH:\\.num:160px" "Text:$TH:\\.txt:100%"; do
  N=${pair%%:*}; rest=${pair#*:}; H=${rest%%:*}; rest=${rest#*:}; FIELD=${rest%%:*}; W=${rest##*:}

  # ---- .row is the sole rhythm owner (prompt -> field -> answer) ----
  d '\.row' '' 'display:flex' 'flex-direction:column' 'gap:16px' 'margin:0'
  # The .q-block gap owns the step to the explanation panel and the .quiz gap the
  # step to the next question; a surviving margin here would add to both.
  none "$N .row has no leftover margin-*" "\.row\.${H}\{[^}]*margin-[a-z-]+:"

  # ---- the prompt takes the choice questions' treatment (ref 2125) ----
  # Without it the div inherits body copy and one quiz shows two prompt sizes.
  d '\.text' '' 'font-size:14\.5px' 'line-height:1\.6' 'font-weight:400' \
                'color:var\(--text-2\)' 'text-wrap:pretty'

  # ---- paired .text paragraph margins (`:global(p)` stays bare in dist) ----
  # Paired, not a blanket zero: the first keeps multi-paragraph prompts
  # separated, the second zeroes the trailing gap the .row gap already owns.
  # These greps stay declaration-level, but the parse below now pins each rule's
  # full declaration set, so an ADDED declaration here does red the gate. That
  # retires round 1's laneA-M1 exemption deliberately: "nothing added" is the
  # stronger property, and the prompt rhythm is exactly what T2 and T3 share.
  dd '\.text' 'p'            'margin:0 0 var\(--space-2\)'
  dd '\.text' 'p:last-child' 'margin:0'

  # ---- the field: control tokens, retained width ----
  d "$FIELD" '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' \
                'font-size:var\(--control-font\)' 'background:var\(--surface\)' \
                'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' \
                "width:${W}"

  # ---- focus: restore the border the scoped field rule out-specifies ----
  # The global :focus-visible is (0,1,0), this rule is (0,2,0), so without the
  # (0,3,0) restore the only focus signal is a 1.12:1 halo.
  d "$FIELD" ':focus-visible' 'border-color:var\(--primary\)'

  # ---- disabled treatment on the reserved disabled-control tokens ----
  d "$FIELD" ':disabled' 'background:var\(--surface-2\)' 'color:var\(--muted\)' \
                         'border-color:var\(--border-faint\)'
  # Constraint 2: never opacity.
  none "$N :disabled uses no opacity" "${FIELD}\.${H}:disabled\{[^}]*opacity"

  # ---- reveal line ----
  # overflow-wrap: a teacher-authored answer is capped only at 500 chars, so one
  # unbreakable token would paint past the viewport and scroll the page (1.4.10).
  d '\.correct-line' '' 'overflow-wrap:anywhere' 'margin:0' \
                        'color:var\(--status-accepted-fg\)' 'font-size:13px'
  # Retargeted off --success/0.9rem. The uniqueness parse below already stops a
  # later duplicate re-winning; these name the specific values being left behind.
  none "$N .correct-line dropped --success"  "\.correct-line\.${H}\{[^}]*var\(--success\)"
  none "$N .correct-line dropped .9rem"      "\.correct-line\.${H}\{[^}]*font-size:[^;}]*rem"
done

# Text-only: the numeric field has ONE width, the text field a width + a cap.
check "Text .txt { max-width:480px }" "\.txt\.${TH}\{([^}]*;)?max-width:480px[;}]"

# ---- cross-file: the per-file split spec §3 pins (NOT one combined list) ----
none "Numeric stylesheet carries no .txt"  "\.txt\.${NH}"
none "Text stylesheet carries no .num"     "\.num\.${TH}"

# The `.mono` utility check moved into the parse below: a regex over minified CSS
# could span from one rule's selector into the NEXT rule's body, so `.mono {
# color:inherit } code,kbd { font-family:var(--font-mono) }` passed it while the
# field silently lost --font-mono (laneA3-I2).

python3 - "$NH" "$TH" ${CSS[@]} <<'PYEOF'
import glob, hashlib, os, re, sys
from collections import Counter
nh, th = sys.argv[1], sys.argv[2]
css = '\n'.join(open(p).read() for p in sys.argv[3:])
bad = 0
FC = '@media (forced-colors:active)'   # normalised form — see the prelude fix in rules()

def rules(text, anc=()):
    """Flat (selector, body, ancestry) triples, descending into @-blocks.

    `ancestry` is the FULL tuple of enclosing at-rules, not just the innermost:
    it used to be replaced at each descent, so `@supports (display:grid) {
    @media (forced-colors:active) { … } }` — or an outer `@media
    (min-width:9999px)`, which never matches — read as exactly the one
    permitted block and passed the guard (codex-r2-I2).
    """
    out, i, start = [], 0, 0
    while i < len(text):
        c = text[i]
        if c == '{':
            # A statement at-rule (`@layer x;`, `@import url(…);`, `@charset`)
            # ends at its `;`, not at a brace. Without this split the pending text
            # for the NEXT rule begins `@…;`, `startswith('@')` fires, and that
            # rule's DECLARATION body is recursed into as though it were an
            # at-block — it holds no braces, so the rule vanishes from the
            # inventory entirely. One no-op `@layer compat;` hid a
            # `p,input{border:0;height:60px}` from every parse-based check.
            sel = text[start:i].rsplit(';', 1)[-1].strip()
            depth, j = 1, i + 1
            while j < len(text) and depth:
                if text[j] == '{': depth += 1
                elif text[j] == '}': depth -= 1
                j += 1
            body = text[i+1:j-1]
            if sel.startswith('@'):
                # normalise the prelude: selectors are minifier-normalised, so comparing
                # `@media (forced-colors: active)` raw made the gate source-format-sensitive
                out.extend(rules(body, anc + (re.sub(r'\s*:\s*', ':', ' '.join(sel.split())),)))
            else:
                out.append((sel, body, anc))
            i, start = j, j
        elif c == '}':
            i += 1; start = i
        else:
            i += 1
    return out

ALL = rules(css)
def decls(body): return {d.strip() for d in body.split(';') if d.strip()}

FIELD = ('height:var(--control-h);padding:0 var(--control-pad-x);'
         'font-size:var(--control-font);background:var(--surface);'
         'border:1px solid var(--border-strong);border-radius:var(--radius);')
SPECS = (('Numeric', nh, 'num', 'width:160px'),
         ('Text',    th, 'txt', 'width:100%;max-width:480px'))

# (a) FULL RULE INVENTORY — a sorted MULTISET including at-rule children (so a
#     duplicate selector and a rule smuggled inside `@media (min-width:1px)`
#     both fail), plus a per-rule declaration-SET comparison (so an ADDED
#     declaration that overrides a pinned one — max-width beating width,
#     padding-left beating padding — fails too). Sets, so order never matters.
PINNED_TOKENS = set()   # every var(--x) the pins below reference; (b5) guards these
for name, h, field, width in SPECS:
    want = [
        ('', '.row.%s' % h, 'display:flex;flex-direction:column;gap:16px;margin:0'),
        ('', '.text.%s' % h, 'overflow-wrap:anywhere;font-size:14.5px;line-height:1.6;font-weight:400;color:var(--text-2);text-wrap:pretty'),
        ('', '.text.%s pre' % h, 'overflow-x:auto;max-width:100%'),
        ('', '.text.%s pre:focus-visible' % h,
             'outline:2px solid var(--primary);outline-offset:2px'),
        ('', '.text.%s p' % h, 'margin:0 0 var(--space-2)'),
        ('', '.text.%s p:last-child' % h, 'margin:0'),
        ('', '.%s.%s' % (field, h), FIELD + width),
        ('', '.%s.%s:disabled' % (field, h),
             'background:var(--surface-2);color:var(--muted);border-color:var(--border-faint)'),
        ('', '.%s.%s:focus-visible' % (field, h), 'border-color:var(--primary)'),
        ('', '.correct-line.%s' % h,
             'overflow-wrap:anywhere;margin:0;color:var(--status-accepted-fg);font-size:13px'),
        # forced-colors: that mode drops box-shadow while base.css:22's
        # `outline:none` still applies, so this is the ONLY focus indicator left.
        (FC, '.%s.%s:focus-visible' % (field, h), 'outline:2px solid Highlight;outline-offset:-2px'),
    ]
    for _m, _s, _b in want:
        PINNED_TOKENS |= set(re.findall(r'var\((--[\w-]+)\)', _b))
    got = sorted((' >> '.join(a), s) for s, b, a in ALL if h in s)
    exp = sorted((m, s) for m, s, _ in want)
    if got != exp:
        bad = 1
        print('FAIL  %s rule inventory differs (ordered, at-rules included)' % name)
        from collections import Counter
        cg, ce = Counter(got), Counter(exp)
        for k in sorted((cg - ce).elements()): print('        unexpected: %s %s' % k)
        for k in sorted((ce - cg).elements()): print('        missing:    %s %s' % k)
        continue
    print('PASS  %s compiles to exactly its %d rules — no duplicate, no stray at-rule'
          % (name, len(want)))
    index = {(' >> '.join(a), s): b for s, b, a in ALL if h in s}
    off = 0
    for m, s, wb in want:
        have, wantd = decls(index[(m, s)]), decls(wb)
        if have != wantd:
            bad = 1; off += 1
            print('FAIL  %s %s%s declarations differ' % (name, (m + ' ') if m else '', s))
            print('        extra:   %s' % sorted(have - wantd))
            print('        missing: %s' % sorted(wantd - have))
    if not off:
        print('PASS  %s declares exactly the pinned set in every rule — nothing added' % name)

# (b) `:global()` escapes scoping entirely, so such a rule carries NO hash and
#     the dist inventory above cannot see it — `:global(input){border:0}` would
#     re-introduce the retargeted bare rule app-wide. Pin the source instead.
# Match `:global`, not `:global(` — Svelte 5 also accepts the BLOCK form
# `:global { … }`, which contains no parenthesis and whose rules reach dist with
# NO scope hash, so it evades the source test and the dist inventory at once
# (laneA3-I1). Compare normalised SELECTORS rather than raw lines, so
# reformatting cannot red the gate (laneA3-M3).
WANT_GLOBAL = ['.text :global(p)', '.text :global(p:last-child)',
               '.text :global(pre)', '.text :global(pre:focus-visible)']
def global_selectors(path):
    src = open(path).read()
    sm = re.search(r'<style[^>]*>(.*?)</style>', src, re.S)
    if sm is None: return []
    body = sm.group(1)
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)   # a comment may mention :global
    return sorted(' '.join(m.group(1).split())
                  for m in re.finditer(r'([^{}]*:global[^{}]*)\{', body))
for name, path in (('Numeric', 'src/components/items/quiz/NumericQuestion.svelte'),
                   ('Text',    'src/components/items/quiz/TextQuestion.svelte')):
    got = global_selectors(path)
    if got == sorted(WANT_GLOBAL):
        print('PASS  %s uses :global only for the two pinned prompt-paragraph rules' % name)
    else:
        bad = 1
        print('FAIL  %s :global usage differs' % name)
        for l in got: print('        %s' % l)

# (b2) The global `.mono` utility is the mechanism BOTH mono assertions ride on —
#      the field's `class="num mono"` and the reveal's `<strong class="mono">`.
#      Looked up structurally, not by regex: a rule whose selector list contains
#      an exact `.mono` compound and whose declarations carry the mono family.
#      `.input.mono` (ui/Input's PIN treatment) is a different compound and must
#      not satisfy this.
mono = [s for s, b, m in ALL
        if not m                          # @media print { .mono {…} } is not it
        and any(part.strip() == '.mono' for part in s.split(','))
        and 'font-family:var(--font-mono)' in decls(b)]
if mono:
    print('PASS  global .mono utility maps to --font-mono (%s)' % mono[0])
else:
    bad = 1
    print('FAIL  no rule gives an exact `.mono` selector font-family:var(--font-mono)')
    print('        rules mentioning .mono: %s' % [s for s, b, m in ALL if '.mono' in s])

# ---------------------------------------------------------------------------
# (b3) `:global` FROM ANY OTHER COMPONENT.
#      Two discriminators were tried and BOTH are unsound. Payload vocabulary:
#      a payload can match anything at all — `*`, `[data-x]`, `#app`, or `.math`,
#      which the backend really does emit inside a prompt
#      (`render_markdown('$x^2$')` -> `<span class="math inline">`, and
#      `_ALLOWED_ATTRS` keeps `class` on span/div). Authoring file: a wrapper
#      that renders `{@render children()}` is a real DOM ancestor of T3 while
#      importing nothing from it, so an import graph cannot see it; the graph
#      also mislabels a SIBLING scope in a genuine ancestor (QuizItem's `.exp`
#      renders explanation markdown next to the T3 component, never around it).
#      Neither is sound, so enumerate instead: every `:global` in the app must
#      appear below, reviewed. A new one reds this check BY DESIGN — that is the
#      prompt to check whether it can wrap a T3 subtree.
GLOBAL_ALLOW = {
    # PageItem renders the Page item type; it never contains a quiz.
    ('src/components/items/PageItem.svelte', 'h1'),
    ('src/components/items/PageItem.svelte', 'h2'),
    ('src/components/items/PageItem.svelte', 'h3'),
    # T5 SPLIT the blanket `li` rule by list type (reset.css:4 zeroes markers,
    # so the blanket disc forced bullets onto <ol>). Both stay ancestor-scoped
    # under `.content`, PageItem's own {@html} container. ItemRouter dispatches
    # exactly ONE component per item, so a PageItem never wraps a quiz.
    ('src/components/items/PageItem.svelte', 'ul > li'),
    ('src/components/items/PageItem.svelte', 'ol > li'),
    ('src/components/items/PageItem.svelte', 'a'),
    ('src/components/items/PageItem.svelte', 'code'),
    ('src/components/items/PageItem.svelte', 'pre'),
    ('src/components/items/PageItem.svelte', 'pre code'),
    # T5 card framing. Ancestor-scoped under .video-card/.app-card, which wrap
    # only their own shared frame component -- never a quiz. A BARE top-level
    # :global(.frame) is forbidden by the spec: it would also reach the
    # deferred editor previews.
    ('src/components/items/VideoItem.svelte', '.frame'),
    ('src/components/items/InteractiveAppItem.svelte', '.frame'),
    ('src/components/items/PageItem.svelte', 'ol'),
    ('src/components/items/PageItem.svelte', 'p'),
    ('src/components/items/PageItem.svelte', 'ul'),
    # The choice questions are SIBLINGS of T3 under QuizItem's `.q-block`, and
    # their prefix `.text` carries their own hash, so these cannot match T3.
    ('src/components/items/quiz/MultiChoiceQuestion.svelte', 'p'),
    ('src/components/items/quiz/MultiChoiceQuestion.svelte', 'p:last-child'),
    ('src/components/items/quiz/SingleChoiceQuestion.svelte', 'p'),
    ('src/components/items/quiz/SingleChoiceQuestion.svelte', 'p:last-child'),
    # Reflow fix (whole-branch review I2): the two choice prompts and QuizItem's
    # explanation panel render unbounded teacher markdown and had no <pre>
    # scroller, measured at 294-464px of PAGE-level horizontal scroll on a 320px
    # viewport — a WCAG 1.4.10 AA failure of the same class this slice already
    # treated as ship-blocking in T5. Each is ancestor-scoped (`.text :global(pre)`
    # / `.exp :global(pre)`), so the hashed prefix pins it inside its own
    # component. None can reach T3: T3's own `.text` carries a different hash and
    # already ships the identical rule (TextQuestion.svelte:91).
    ('src/components/items/QuizItem.svelte', 'pre'),
    ('src/components/items/quiz/MultiChoiceQuestion.svelte', 'pre'),
    ('src/components/items/quiz/SingleChoiceQuestion.svelte', 'pre'),
    # T8a. Ancestor-scoped as `ul li:last-child :global(.row)`, so the hashed part
    # pins it inside BlockGroup own panel list; the only thing a <li> there
    # contains is a SequenceLink or MiniProjectLink whose root IS `.row`. It
    # cannot reach T3: those rows live on the course landing page, while every T3
    # question renders inside SequencePlayer. It kills the last row hairline that
    # would otherwise double up against the card border.
    ('src/components/course/BlockGroup.svelte', '.row'),
    # Slice-4 T3. The mini-project assignment card's content typography (spec
    # §3.3), every rule ancestor-scoped under `.assignment-html` — the page own
    # {@html} container, which carries this component hash. None can reach
    # Slice-3 T3: those questions render inside SequencePlayer QuizItem, and a
    # mini-project detail page is a different route that renders no quiz at all.
    # The list is the assignment SUBSET of PageItem block above (no headings,
    # no pre, no img), so it also cannot widen what PageItem already froze.
    ('src/pages/MiniProjectDetailPage.svelte', 'p'),
    ('src/pages/MiniProjectDetailPage.svelte', 'p:last-child'),
    ('src/pages/MiniProjectDetailPage.svelte', 'a'),
    ('src/pages/MiniProjectDetailPage.svelte', 'ul'),
    ('src/pages/MiniProjectDetailPage.svelte', 'ol'),
    ('src/pages/MiniProjectDetailPage.svelte', 'ul > li'),
    ('src/pages/MiniProjectDetailPage.svelte', 'ol > li'),
    ('src/pages/MiniProjectDetailPage.svelte', 'code'),
    # Slice-5b T1: `.modal-body > :global(*)` (spec :220-221). Child-combinator
    # scoped under the hashed `.modal-body`, so it reaches only the direct
    # children of a modal body. A T3 question renders inside SequencePlayer,
    # which never mounts a Modal.
    ('src/components/ui/Modal.svelte', '*'),
    # Slice-5c T1 (R3): `:global(body):has(.canvas.dN)` — the page shade. The
    # `.canvas` inside :has() stays SCOPED (compiled `.canvas.dN.svelte-<h>`),
    # so the rule matches only while VersionEditPage is mounted; no quiz
    # question renders under it (the editor never mounts SequencePlayer).
    ('src/pages/editor/VersionEditPage.svelte', 'body'),
    # 5c follow-up (user, 2026-10-08): the versions list takes the editor's
    # page shade. `:global(body):has(.page)` keeps `.page` SCOPED, so it matches
    # only while VersionsPage is mounted; that page never renders a quiz.
    ('src/pages/editor/VersionsPage.svelte', 'body'),
}
def global_payloads(style):
    """(payload, …) for every `:global(...)` and `:global{…}`, balanced."""
    for m in re.finditer(r':global\s*(\(|\{)', style):
        o = m.end() - 1
        closer = ')' if m.group(1) == '(' else '}'
        depth, j = 1, o + 1
        while j < len(style) and depth:
            if style[j] == m.group(1): depth += 1
            elif style[j] == closer: depth -= 1
            j += 1
        yield ' '.join(style[o + 1:j - 1].split())

T3_FILES = {os.path.normpath('src/components/items/quiz/NumericQuestion.svelte'),
            os.path.normpath('src/components/items/quiz/TextQuestion.svelte')}
SVELTE = sorted(os.path.normpath(f) for f in glob.glob('src/**/*.svelte', recursive=True))
got_global = set()
for f in SVELTE:
    if f in T3_FILES: continue
    for sm in re.finditer(r'<style[^>]*>(.*?)</style>', open(f).read(), re.S):
        style = re.sub(r'/\*.*?\*/', ' ', sm.group(1), flags=re.S)   # a comment may say :global
        for payload in global_payloads(style):
            got_global.add((f, payload))
if got_global == GLOBAL_ALLOW:
    print('PASS  all %d :global rules outside T3 are the reviewed ones' % len(GLOBAL_ALLOW))
else:
    bad = 1
    print('FAIL  the set of :global rules outside T3 changed — review each for T3 reach')
    for f, p in sorted(got_global - GLOBAL_ALLOW): print('        new:     %s  :global(%s)' % (f, p))
    for f, p in sorted(GLOBAL_ALLOW - got_global): print('        gone:    %s  :global(%s)' % (f, p))


# (b4) THE WHOLE HASHLESS INVENTORY. The (a) inventory keys on T3's scope hash,
#      so a rule with no hash is invisible to it however much it changes the
#      render. An earlier version froze only the hashless rules a predicate
#      judged capable of reaching T3; that predicate was unsound three ways —
#      it knew no ids (`#app` is the mount node and so an ancestor of
#      everything), no classes beyond T3's own (`.math` renders inside a
#      prompt), and it compared SELECTOR STRINGS, so `p{margin:0}` growing a
#      `font-size:22px`, or an `a` rule moving into `@layer low` and losing the
#      cascade, both stayed green. So freeze all of it, as
#      (at-rule context, selector, sha1(sorted declarations)): no predicate to
#      be wrong about, and declaration and cascade-origin drift are both visible.
#      `@keyframes` children are excluded — `to`/`from` are stops, not selectors.
# The two `body` hashes moved on 2026-09-06 (6015bdd1 -> 0c999c4b, base.css;
# 972a896c -> 77e2fef1, reset.css): both rules carried
# `-webkit-font-smoothing: antialiased` and both lost it. That is the ONLY
# change; the freeze existing is what made it a deliberate two-line edit here
# rather than silent drift. See the note at the top of reset.css.
# The :root hash moved on 2026-10-08 (8872e5cb -> 58c75427, theme-default.css):
# Slice-5c T1 added the six --focus-* tokens. That is the ONLY change.
# It then moved twice in T5 (58c75427 -> 712f8080 -> 255b1037): +--focus-page
# (the page shade with nothing open), then +--focus-row (rows at the focus
# level). Each time the new token was the ONLY change. Then once more on the
# 5c follow-up (255b1037 -> aaed0f95): +--ordinal (the block numbers "1."),
# again the ONLY change (dropping it reproduces 255b1037).
WANT_FULL = [
    ('', '*,*:before,*:after', '8d5d6c83'), ('', '.mono,code,kbd', '84a226e9'),
    ('', ':focus-visible', '1684b043'), ('', ':root', 'aaed0f95'),
    ('', 'a', '1cdc0f83'), ('', 'a', '7bb41747'), ('', 'a:hover', '36ec7417'),
    ('', 'body', '0c999c4b'), ('', 'body', '77e2fef1'), ('', 'button', 'd50dfcde'),
    ('', 'button,input,select,textarea', '790e37af'), ('', 'h1', '778e3e41'),
    ('', 'h1,h2,h3,h4,h5,h6', '610dd856'), ('', 'h2', 'a8b134e8'),
    ('', 'h3', 'b36ddbd5'), ('', 'h4', 'f98d3d7e'), ('', 'html,body', '3bd2fa51'),
    ('', 'img,video', 'aa84fbab'), ('', 'p', '11696618'), ('', 'ul,ol', '99409a76'),
]
# Document ORDER of the same 20 rules. `a` at #9 (reset.css) and #13 (base.css)
# are the live case: only order decides that base's --primary wins, and swapping
# two @imports in app.css flips it while the sorted multiset stays identical.
WANT_ORDER = [
    ('', '*,*:before,*:after'), ('', 'html,body'), ('', 'body'), ('', 'ul,ol'),
    ('', 'h1,h2,h3,h4,h5,h6'), ('', 'p'), ('', 'button,input,select,textarea'),
    ('', 'button'), ('', 'img,video'), ('', 'a'), ('', ':root'), ('', 'body'),
    ('', '.mono,code,kbd'), ('', 'a'), ('', 'a:hover'), ('', 'h1'), ('', 'h2'),
    ('', 'h3'), ('', 'h4'), ('', ':focus-visible'),
]
def dhash(b):
    return hashlib.sha1(';'.join(sorted(decls(b))).encode()).hexdigest()[:8]
bodies = {}
got_full = []
for s, b, m in ALL:
    # A scope class is `.svelte-<hash>`; a substring test also swallows an
    # author class that merely CONTAINS the text, e.g. a selector list
    # `.svelte-inspector-overlay p, p{…}` — which is hashless and does reach.
    if any(x.startswith('@keyframes') for x in m): continue
    if re.search(r'\.svelte-[a-z0-9]+(?![\w-])', s): continue
    if 'svelte-' in s:
        bad = 1
        print('FAIL  selector carries the text `svelte-` but no scope class: %s' % s)
    got_full.append((' >> '.join(m), s, dhash(b)))
    bodies[(' >> '.join(m), s, dhash(b))] = b
got_order = [(m, s) for m, s, _ in got_full]   # DOCUMENT order, before sorting
got_full.sort()
# Document ORDER decides the winner between two same-selector rules (the bundle
# has two `a` and two `body`). Reordering the @imports in app.css flips which
# wins while the sorted multiset stays byte-identical.
if got_order != WANT_ORDER:
    bad = 1
    print('FAIL  hashless rule ORDER changed — the cascade winner may have flipped')
    for i, (g, w) in enumerate(zip(got_order + [None] * len(WANT_ORDER),
                                   WANT_ORDER + [None] * len(got_order))):
        if g != w: print('        first divergence at #%d: %r (was %r)' % (i, g, w)); break
elif got_full == WANT_FULL:
    print('PASS  all %d hashless rules unchanged — selector, context, declarations and order'
          % len(got_full))
else:
    bad = 1
    print('FAIL  the hashless rule inventory changed (%d -> %d)' % (len(WANT_FULL), len(got_full)))
    cg, cw = Counter(got_full), Counter(WANT_FULL)
    for k in sorted((cg - cw).elements()):
        print('        new/changed: %s%s  {%s}' % (k[0] + ' ' if k[0] else '', k[1],
                                                   ';'.join(sorted(decls(bodies[k])))[:90]))
    for k in sorted((cw - cg).elements()):
        print('        gone:        %s%s  (decls %s)' % (k[0] + ' ' if k[0] else '', k[1], k[2]))


# (b5) Every geometry/colour pin above is a `var(--token)` REFERENCE, so a
#      redefinition anywhere on T3's ancestor chain changes the render while
#      every literal pin still matches. TOKENS is DERIVED from the pinned
#      declaration sets (plus --font-mono, which (b2) asserts) — hand-listing it
#      silently omitted `--space-2` and `--font-mono`, both of which the gate
#      pins and neither of which was checked. Four definition sites, all real:
#      a CSS rule; an `@property` initial-value (invisible to the rule parser —
#      its body holds declarations, not rules); an inline `style="--t:…"`; and
#      Svelte's `style:--t={…}` directive, which compiles to a runtime
#      setProperty and touches no CSS at all.
# Seed from the frozen global rules too: (b4) pins `:focus-visible`'s
# `box-shadow: … var(--primary-soft)` as a STRING, leaving the value it resolves
# to unguarded — `.q-block{--primary-soft:transparent}` erased the field's focus
# halo with the whole gate green.
for _k, _b in bodies.items():
    PINNED_TOKENS |= set(re.findall(r'var\((--[\w-]+)\)', _b))
# PINNED_TOKENS above is derived from T3's pinned bodies only, because those are
# the ones stated in THIS process — but the later sections pin components that
# reference tokens of their own, and an ancestor can null any of them by
# inheritance. `.block { --border-soft: transparent }` on BlockGroup erased BOTH
# T7 rows' separators with section (j) still seeing the exact pinned
# `border-bottom:1px solid var(--border-soft)`, because the redefinition lives
# under an unrelated hash (codex-r1-#1, reproduced). Harvest from the guarded
# components' own sources rather than hand-listing, so a token added to any of
# them is guarded automatically instead of silently unguarded. It reads the WHOLE
# file, comments included, so a token merely NAMED in prose joins TOKENS too
# (reviewer, round 3). That direction is safe -- it can only forbid more
# definition sites, never fewer -- and every token it currently picks up that way
# is already pinned from a real rule elsewhere, so the set is unchanged in
# practice. Left as-is deliberately: narrowing it to the <style> body could drop
# a token that only a comment happens to mention today and silently weaken the
# guard, which is the failure direction that matters.
for _f in ('src/components/course/ItemMark.svelte', 'src/components/course/ItemIcon.svelte',
           'src/components/course/SequenceLink.svelte', 'src/components/course/MiniProjectLink.svelte',
           # T8a made BlockGroup a graded component (section (k)), and the attack
           # this guard was built from is literally `.block { --border-soft:
           # transparent }` ON BlockGroup. Its own --surface-2 / --space-2 /
           # --space-3 were unguarded until this line: an ancestor redefining
           # --surface-2 erases the header strip tint step — the one thing the 3b
           # card pattern exists for — with section (k) still reading
           # `background:var(--surface-2)` and the whole gate green.
           # T8b: same reasoning one task later. StatusPill's five --status-*
           # pairs and --radius-pill are its ENTIRE visual identity, so an
           # ancestor nulling one erases a status colour with section (l) still
           # reading the rule as correct.
           'src/components/course/BlockGroup.svelte',
           'src/components/course/StatusPill.svelte',
           # Student-view follow-up 2 (2026-10-08): the bar + chip pair and the
           # course summary card are graded in section (j); same guard.
           'src/components/course/ProgressMeter.svelte',
           'src/components/course/CourseProgress.svelte',
           # The four components of the close-out. Computing TOKENS without them
           # left exactly two of their tokens unguarded: --btn-pad-sm (the T2
           # `.opt` padding, ref 2126) and --faint (the T1 `.crumbs .sep`, ref
           # 2108). An ancestor redefining either -- the
           # `.block { --border-soft: transparent }` attack this guard was built
           # from -- retunes them with sections (m) and (n) still reading the
           # pinned `var(...)` and the whole gate green.
           'src/pages/SequencePlayer.svelte',
           'src/components/items/QuizItem.svelte',
           'src/components/items/quiz/SingleChoiceQuestion.svelte',
           'src/components/items/quiz/MultiChoiceQuestion.svelte',
           # Round 3 added six components to the SCANNER and forgot this list --
           # the identical omission round 2 had just fixed for the four above.
           # It left --space-4 and --control-pad-textarea (both PageItem) with no
           # guard, so an ancestor could zero them: every markdown page loses its
           # list padding-left, so bullets and numbers sit outside the text
           # column, heading top margins collapse and code blocks lose their
           # padding -- gate ALL PASS, 1349 tests green (reviewer, round 4).
           'src/components/items/PageItem.svelte',
           'src/components/items/VideoItem.svelte',
           'src/components/items/InteractiveAppItem.svelte',
           'src/components/items/UnsupportedItem.svelte',
           'src/components/items/quiz/NumericQuestion.svelte',
           'src/components/items/quiz/TextQuestion.svelte',
           'src/components/course/CourseCard.svelte'):
    PINNED_TOKENS |= set(re.findall(r'var\((--[\w-]+)\)', open(_f).read()))
TOKENS = sorted(PINNED_TOKENS | {'--font-mono'})
TOKEN_ALT = '|'.join(re.escape(t) for t in TOKENS)
TOKEN_DECL = re.compile(r'(^|;)\s*(%s)\s*:' % TOKEN_ALT)
definers = sorted((m, s) for s, b, m in ALL if TOKEN_DECL.search(b))
prop_at = sorted(set(re.findall(r'@property\s+(%s)(?![\w-])' % TOKEN_ALT, css)))
inline = []
# .ts/.js too: `document.documentElement.style.setProperty('--control-h','60px')`
# in main.ts retunes the very :root this check names. Single quotes are valid
# HTML/Svelte, so the attribute regex must accept either.
for f in sorted(set(SVELTE) | {os.path.normpath(p) for p in
                glob.glob('src/**/*.ts', recursive=True) + glob.glob('src/**/*.js', recursive=True)}):
    src = open(f).read()
    for m in re.finditer(r'style\s*=\s*["\'][^"\']*?(%s)\s*:' % TOKEN_ALT, src):
        inline.append('%s  style="… %s: …"' % (f, m.group(1)))
    for m in re.finditer(r'style:(%s)\s*[=}]' % TOKEN_ALT, src):                # style:--t={v}
        inline.append('%s  style:%s={…}  (Svelte directive)' % (f, m.group(1)))
    for m in re.finditer(r'setProperty\(\s*[\'"`](%s)[\'"`]' % TOKEN_ALT, src):  # imperative
        inline.append('%s  setProperty("%s", …)' % (f, m.group(1)))
    for m in re.finditer(r'style=\{[^}]*?(%s)' % TOKEN_ALT, src):                 # style={…}
        inline.append('%s  style={… %s …}' % (f, m.group(1)))
if definers == [((), ':root')] and not prop_at and not inline:
    print('PASS  all %d pinned tokens are defined once, on a bare :root' % len(TOKENS))
else:
    bad = 1
    print('FAIL  a pinned token is defined outside the single bare :root rule')
    for md, s in definers:
        md = ' >> '.join(md)   # join only to FORMAT — see codex-r3-M1
        if (md, s) != ('', ':root'):
            print('        rule:    %s%s' % (md + ' ' if md else '', s))
    for t in prop_at: print('        @property %s  (initial-value can override :root)' % t)
    for x in inline: print('        source:  %s' % x)
    if definers.count(((), ':root')) > 1:
        print('        (:root itself is declared %d times)' % definers.count(((), ':root')))
# (c) A system colour outside forced-colors would ignore the theme (Constraint 1
#     exempts it only inside such a block).
SYSCOL = ('Canvas|CanvasText|LinkText|VisitedText|ActiveText|ButtonFace|ButtonText|'
          'ButtonBorder|Field|FieldText|Highlight|HighlightText|SelectedItem|'
          'SelectedItemText|Mark|MarkText|GrayText|AccentColor|AccentColorText')
stray = [(s, m2.group(0)) for s, b, m in ALL for m2 in [re.search(r'\b(%s)\b' % SYSCOL, b)]
         if m2 and not any('forced-colors' in x for x in m)]
if stray:
    bad = 1
    print('FAIL  system colour used outside a forced-colors block: %s' % stray)
else:
    print('PASS  no CSS system colour appears outside a forced-colors block')

# (d) A duplicated property inside ONE rule survives minification and the later
#     one wins, so a positive grep can match a declaration never applied.
for name, h, field, width in SPECS:
    dupes = []
    for sel, body, _ in ALL:
        if h not in sel: continue
        props = [d.split(':', 1)[0].strip() for d in body.split(';') if ':' in d]
        dupes += ['%s { %s }' % (sel, x) for x in {x for x in props if props.count(x) > 1}]
    if dupes:
        bad = 1
        print('FAIL  %s has a duplicated property (the later one wins)' % name)
        for x in sorted(set(dupes)): print('        %s' % x)
    else:
        print('PASS  %s declares every property exactly once per rule' % name)

# (e) mono must come from the global `.mono` utility — that is what makes the DOM
#     classList assertions load-bearing.
for name, h, field, width in SPECS:
    hits = [s for s, b, _ in ALL if h in s and 'font-family' in b]
    if hits:
        bad = 1; print('FAIL  %s sets a component-local font-family: %s' % (name, hits))
    else:
        print('PASS  %s sets no component-local font-family' % name)

# (f) CUMULATIVE — T2's two prompt-paragraph pairs plus T3's two, in one bundle.
BASE = [(s, b) for s, b, m in ALL if not m]
pairs = sorted({s.split()[0] for s, b in BASE if re.fullmatch(r'\.text\.svelte-[a-z0-9]+ p', s)})
last  = {s.split()[0] for s, b in BASE if re.fullmatch(r'\.text\.svelte-[a-z0-9]+ p:last-child', s)}
mine = {'.text.%s' % nh, '.text.%s' % th}
if set(pairs) == last and mine <= set(pairs) and len(pairs) >= 4:
    print('PASS  %d .text prompt-paragraph rules, each with a :last-child companion, T3\'s two among them'
          % len(pairs))
else:
    bad = 1
    print('FAIL  .text prompt-paragraph pairs: %d inter-para / %d last-child, matched=%s, T3 present=%s'
          % (len(pairs), len(last), set(pairs) == last, mine <= set(pairs)))

sys.exit(bad)
PYEOF
[[ $? -eq 0 ]] || fail=1

# ---------------------------------------------------------------------------
# (g) THE 68ch -> 652px CORRECTION (spec §103) and the rules that landed with
#     it. Every value here is a literal with NO other in-repo guard: the suite,
#     svelte-check and the build all stay green if any is deleted or drifts,
#     and jsdom cannot see CSS at all. Regexes use the script's own anchoring
#     discipline (`\{([^}]*;)?decl[;}]`) rather than the hand-rolled
#     `\{[^}]*decl` form section (g) originally shipped with (laneC-M5).
# ---------------------------------------------------------------------------
echo
echo "--- (g) corrected measure + T4-reopen rules ---"

# The literal that caused the bug must not return -- in EITHER channel. An
# inline `style="max-width:68ch"` compiles into the JS chunk, which $CSS does
# not cover (laneC-M4).
none "68ch absent from the CSS bundle" '68ch'
if grep -rqE '68ch' dist/_app/*.js 2>/dev/null; then
  echo "FAIL  68ch present in the JS chunk (inline style attribute?)"; fail=1
else
  echo "PASS  68ch absent from the JS chunk too"
fi

# --- .quiz: anchor-verify, then pin BOTH halves of the measure claim ---------
# The max-width only MEANS 652px of text because padding is 0; asserting the cap
# without the padding lets the text measure drift silently (laneC-I4).
qh=(${(f)"$(grep -ohE '\.quiz\.svelte-[a-z0-9]+' $CSS | sort -u)"})
if [[ ${#qh[@]} -eq 1 ]]; then
  echo "PASS  .quiz resolves to exactly one hash ($qh[1]) -- QuizItem-unique"
  QS="${qh[1]//./\\.}"
  check "quiz measure max-width:652px"          "${QS}\{([^}]*;)?max-width:652px[;}]"
  check "quiz padding:0 (so 652px IS the text)" "${QS}\{([^}]*;)?padding:0[;}]"
else
  echo "FAIL  .quiz is not dist-unique (${#qh[@]} hashes: $qh)"; fail=1
fi

# --- .page-item: the plain 652px measure and the padding T5 zeroed -----------
ph=(${(f)"$(grep -ohE '\.page-item\.svelte-[a-z0-9]+' $CSS | sort -u)"})
if [[ ${#ph[@]} -eq 1 ]]; then
  echo "PASS  .page-item resolves to exactly one hash ($ph[1])"
  PS="${ph[1]//./\\.}"
  # T5 zeroed this article's padding (§2 article rhythm), so the calc()
  # compensation is gone and the measure is the plain literal -- which also
  # makes .page-item and .quiz share an EDGE, not just a measure.
  check "page-item measure max-width:652px (plain, post-T5)" \
        "${PS}\{([^}]*;)?max-width:652px[;}]"
  check "page-item padding:0 (so 652px IS the text, as on .quiz)" \
        "${PS}\{([^}]*;)?padding:0[;}]"
  none  "page-item no longer carries the pre-T5 calc() compensation" \
        "${PS}\{[^}]*calc\(652px"
else
  echo "FAIL  .page-item is not dist-unique (${#ph[@]} hashes: $ph)"; fail=1
fi

# --- the player's slot must NOT re-acquire a cap -----------------------------
# Hash-coupled: PageItem authors `.content` too (.content.svelte-1uu0qfr vs the
# player's), so a bare `.content` grep judges the wrong component (laneC-M2).
sh=(${(f)"$(grep -ohE '\.strip\.svelte-[a-z0-9]+' $CSS | sort -u)"})
if [[ ${#sh[@]} -eq 1 ]]; then
  SP_H=${sh[1]#.strip.}
  echo "PASS  .strip resolves to one hash ($SP_H) -- the SequencePlayer anchor"
  check "player .content still exists under that hash" "\.content\.${SP_H}\{"
  none  "player .content carries no max-width"         "\.content\.${SP_H}\{[^}]*max-width"
else
  echo "FAIL  .strip is not dist-unique (${#sh[@]}: $sh) -- cannot anchor .content"; fail=1
fi

# --- the group divider: --border, never the disabled-control token -----------
check "q-block divider uses var(--border)" \
      '\.q-block\.svelte-[a-z0-9]+\+\.q-block:where\(\.svelte-[a-z0-9]+\)\{([^}]*;)?border-top:1px solid var\(--border\)[;}]'
check "q-block divider padding-top:20px" \
      '\.q-block\.svelte-[a-z0-9]+\+\.q-block:where\(\.svelte-[a-z0-9]+\)\{([^}]*;)?padding-top:20px[;}]'
none  "q-block divider does NOT use --border-faint (the disabled-control token)" \
      '\.q-block\.svelte-[a-z0-9]+\+\.q-block:where\(\.svelte-[a-z0-9]+\)\{[^}]*var\(--border-faint\)'

# --- both positional counters at 12.5px -- the PAIRING is the point ----------
check "quiz .q-counter is 12.5px"           '\.q-counter\.svelte-[a-z0-9]+\{([^}]*;)?font-size:12\.5px[;}]'
check "player .counter is 12.5px (matches)" '\.counter\.svelte-[a-z0-9]+\{([^}]*;)?font-size:12\.5px[;}]'
none  "no positional counter left at 11.5px" \
      '\.(counter|q-counter)\.svelte-[a-z0-9]+\{([^}]*;)?font-size:11\.5px[;}]'
# The progress-ratio family deliberately KEEPS 11.5px (spec §124(c)): asserting
# its absence app-wide would forbid the rule the design actually wants.
# HASH-ANCHORED to CourseCard. Unanchored, `.count.svelte-[a-z0-9]+` also matched
# SequenceLink `.count`, which section (j) pins at 11.5px -- so this check could
# never fail, and CourseCard `.count` at 22px passed the whole gate (reviewer,
# round 3, reproduced). `.bar-fill` is the anchor: authored by CourseCard alone
# and compiled under the same hash. If it stops resolving uniquely the
# substitution below cannot match anything and this check reds, which is the
# right direction.
cc=(${(f)"$(grep -ohE '\.bar-fill\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
ccsrc=(${(f)"$(grep -rlE '^[[:space:]]*\.bar-fill[[:space:]]*[,{]' src --include='*.svelte')"})
if [[ ${#cc[@]} -ne 1 || ${#ccsrc[@]} -ne 1 || ${ccsrc[1]:t} != 'CourseCard.svelte' ]]; then
  # Say WHY. Without this the substitution simply stops matching and the check
  # below reds as "CourseCard .count (a RATIO) still 11.5px", sending whoever
  # reads it to the font-size rule rather than to the anchor (reviewer, round 4).
  # Every sibling anchor guard in this file prints an explicit line; this one
  # prints to stderr so it does not disturb the PASS/FAIL count.
  print -u2 "      note: CourseCard anchor unproven (.bar-fill dist hashes ${#cc[@]}: $cc; source owners ${#ccsrc[@]}: $ccsrc)"
  cc=(NO-UNIQUE-COURSECARD-ANCHOR)
fi
check "CourseCard .count (a RATIO) still 11.5px" \
      "\.count\.${cc[1]}\{([^}]*;)?font-size:11\.5px[;}]"

# --- the 480px answer-control edge -------------------------------------------
# Count alone is not identity: a third component gaining `.opts` while Single
# lost it keeps the count at 2 (laneC-M3). Discriminate by the shape-unique
# interior rule the spec already pins -- the radio's `.ctl .dot{border-radius:50%}`
# vs the checkbox-only `.opt.selected .ctl{background:var(--primary)}`.
sgl=$(grep -ohE '\.ctl\.svelte-[a-z0-9]+ \.dot' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)
mlt=$(grep -ohE '\.opt\.selected\.svelte-[a-z0-9]+ \.ctl:where\(\.svelte-[a-z0-9]+\)\{([^}]*;)?background:var\(--primary\)' $CSS \
      | grep -ohE 'svelte-[a-z0-9]+' | sort -u | head -1)
oh=(${(f)"$(grep -ohE '\.opts\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ -n $sgl && -n $mlt && ${#oh[@]} -eq 2 ]] && [[ ${oh[(I)$sgl]} -gt 0 && ${oh[(I)$mlt]} -gt 0 ]]; then
  echo "PASS  the 2 .opts hashes ARE Single ($sgl) and Multi ($mlt), by shape-unique rule"
  for h in $sgl $mlt; do check "option group $h capped at 480px" "\.opts\.${h}\{([^}]*;)?max-width:480px[;}]" ; done
else
  echo "FAIL  .opts identity unproven (single=$sgl multi=$mlt opts=$oh)"; fail=1
fi
check "text field max-width:480px (the value .opts pairs with)" \
      '\.txt\.svelte-[a-z0-9]+\{([^}]*;)?max-width:480px[;}]'

# --- (g2) STRUCTURAL: a grep cannot see a duplicate or an @media override -----
# Section (g)'s checks are greps, and a grep still matches the ORIGINAL rule
# when a later duplicate (or one smuggled inside `@media (min-width:1px)`) wins
# the cascade. Part (a) solves this for .num/.txt via the rule inventory; these
# selectors had no such cover, and two mutation tests escaped because of it.
# Every selector section (g) pins must be declared EXACTLY ONCE, at top level.
# $SP_H is passed in rather than hardcoded: every other anchor in this file is
# DERIVED and gate-proved unique, and a literal hash here would go stale into a
# confusing "0 top-level copies" the moment SequencePlayer's CSS changed.
python3 - $SP_H ${CSS[@]} <<'G2EOF'
import re, sys
SP_H = sys.argv[1]
css = '\n'.join(open(p).read() for p in sys.argv[2:])

def rules(text, anc=()):
    out, i, start = [], 0, 0
    while i < len(text):
        c = text[i]
        if c == '{':
            sel = text[start:i].rsplit(';', 1)[-1].strip()
            depth, j = 1, i + 1
            while j < len(text) and depth:
                if text[j] == '{': depth += 1
                elif text[j] == '}': depth -= 1
                j += 1
            if sel.startswith('@'):
                out.extend(rules(text[i+1:j-1], anc + (' '.join(sel.split()),)))
            else:
                out.append((sel, anc))
            i, start = j, j
        elif c == '}':
            i += 1; start = i
        else:
            i += 1
    return out

ALL = rules(css)
# One entry per pinned rule: (label, selector regex). Each must match exactly one
# top-level rule and zero inside any at-rule.
# (label, selector regex, how many top-level copies are legitimate).
# .opts has TWO rightful authors; everything else must be
# declared exactly once. A grep cannot see a duplicate or an @media override —
# it still matches the ORIGINAL rule while the later one wins the cascade —
# which is why every selector sections (g) and (h) pin is listed here.
FC = ['@media (forced-colors: active)']
TARGETS = [
    # T3/T4 measure + counters
    ('quiz article',          r'\.quiz\.svelte-[a-z0-9]+$', 1),
    ('quiz h2',               r'\.quiz\.svelte-[a-z0-9]+ h2:where\(\.svelte-[a-z0-9]+\)$', 1),
    ('page-item article',     r'\.page-item\.svelte-[a-z0-9]+$', 1),
    ('page-item h2',          r'\.page-item\.svelte-[a-z0-9]+ h2:where\(\.svelte-[a-z0-9]+\)$', 1),
    ('player .content',       r'\.content\.' + re.escape(SP_H) + r'$', 1),
    ('quiz .q-counter',       r'\.q-counter\.svelte-[a-z0-9]+$', 1),
    ('player .counter',       r'\.counter\.svelte-[a-z0-9]+$', 1),
    ('q-block divider',       r'\.q-block\.svelte-[a-z0-9]+\+\.q-block:where\(\.svelte-[a-z0-9]+\)$', 1),
    # T5 item components
    ('video-item article',    r'\.video-item\.svelte-[a-z0-9]+$', 1),
    ('video-item h2',         r'\.video-item\.svelte-[a-z0-9]+ h2:where\(\.svelte-[a-z0-9]+\)$', 1),
    ('interactive article',   r'\.interactive-app\.svelte-[a-z0-9]+$', 1),
    ('interactive h2',        r'\.interactive-app\.svelte-[a-z0-9]+ h2:where\(\.svelte-[a-z0-9]+\)$', 1),
    ('video-card',            r'\.video-card\.svelte-[a-z0-9]+$', 1),
    ('app-card',              r'\.app-card\.svelte-[a-z0-9]+$', 1),
    ('video-card frame reset', r'\.video-card\.svelte-[a-z0-9]+ \.frame$', 1),
    ('app-card frame reset',  r'\.app-card\.svelte-[a-z0-9]+ \.frame$', 1),
    ('watched row',           r'\.watched\.svelte-[a-z0-9]+$', 1),
    ('cover-hint',            r'\.cover-hint\.svelte-[a-z0-9]+$', 1),
    ('unsupported box',       r'\.unsupported\.svelte-[a-z0-9]+$', 1),
    # T6 ItemMark. The state rules compile as `.item-mark.covered.svelte-<h>`
    # -- the hash lands at the END of the compound, not after `.item-mark`.
    ('item-mark base',        r'\.item-mark\.svelte-[a-z0-9]+$', 1),
    # Each state gets ONE extra copy, inside the forced-colors block and nowhere
    # else: that block is the a11y treatment (the states are otherwise
    # colour-only and collapse under Windows High Contrast), so it has to be
    # permitted here -- but named exactly, so an `@media (min-width:1px)`
    # override is still caught. An empty/absent 4th element means "no at-rule
    # copy at all", which is what every other target wants.
    ('item-mark covered',     r'\.item-mark\.covered\.svelte-[a-z0-9]+$', 1, FC),
    ('item-mark current',     r'\.item-mark\.current\.svelte-[a-z0-9]+$', 1, FC),
    ('item-mark not-yet',     r'\.item-mark\.not-yet\.svelte-[a-z0-9]+$', 1, FC),
    ('ItemIcon .icon wrapper',r'\.icon\.svelte-[a-z0-9]+$', 1),
    # PageItem's {@html} rules: `:global` leaves the PAYLOAD hashless but the
    # LEADING part keeps the scope hash, so they are pinnable here. This is what
    # makes their dist checks duplicate- and @media-proof; as source greps both
    # mutations escaped.
    ('page content p',        r'\.content\.svelte-[a-z0-9]+ p$', 1),
    ('page list padding',     r'\.content\.svelte-[a-z0-9]+ ul,\.content\.svelte-[a-z0-9]+ ol$', 1),
    ('page ul markers',       r'\.content\.svelte-[a-z0-9]+ ul>li$', 1),
    ('page ol markers',       r'\.content\.svelte-[a-z0-9]+ ol>li$', 1),
    # .opts has two rightful authors (Single+Multi). .notice had two until
    # Slice 5b replaced InteractiveAppEditor with AppBody (whose rule is
    # .app-hint), so InteractiveAppItem is now its only author.
    ('option groups',         r'\.opts\.svelte-[a-z0-9]+$', 2),
    ('notices',               r'\.notice\.svelte-[a-z0-9]+$', 1),
]

bad = 0
def norm(m):
    return re.sub(r'\s*:\s*', ':', ' '.join(m.split()))
for target in TARGETS:
    label, pat, want = target[0], target[1], target[2]
    allowed = sorted(norm(m) for m in (target[3] if len(target) > 3 else []))
    top  = [s for s, a in ALL if not a and re.fullmatch(pat, s)]
    inat = [(s, a) for s, a in ALL if a and re.fullmatch(pat, s)]
    # The whole ANCESTRY, joined — a permitted entry is a ONE-element ancestry,
    # so an extra outer wrapper no longer masquerades as it (codex-r2-I2).
    got_at = sorted(' >> '.join(norm(m) for m in a) for _, a in inat)
    if len(top) == want and len(set(top)) == want and got_at == allowed:
        print('PASS  %s declared exactly %d\xd7, top level%s' %
              (label, want, (' (+%d in %s)' % (len(allowed), allowed)) if allowed else ''))
    else:
        bad = 1
        print('FAIL  %s: %d top-level copies (%d distinct), want %d%s' %
              (label, len(top), len(set(top)), want,
               (', at-rules %s want %s' % (got_at, allowed)) if got_at != allowed else ''))
        for x in top: print('        %s' % x)

sys.exit(bad)
G2EOF
[[ $? -eq 0 ]] || fail=1

# --- (h) T5: Page / Video / Interactive / Unsupported items -------------------
echo
echo "--- (h) T5 item components ---"

# The three article roots share one rhythm rule. Asserted as a class-form regex
# matching exactly THREE distinct hashes: a bare `article{...}` selector could
# not be attributed to a component, and a count alone would pass if one
# component authored the rule twice.
# ANCHORED, not `grep -F` over the rule body. Until the whole-branch review (I3)
# this was the ONE section in the file using the unanchored substring idiom its
# own preamble (:45-51) forbids, and all three traps were live: `column-gap:16px`
# satisfied `gap:16px` -- which in a COLUMN flex sets the vertical rhythm to ZERO,
# collapsing title, card and button together -- `padding:0 20px` satisfied
# `padding:0`, and `flex-direction:column-reverse` satisfied
# `flex-direction:column`, rendering the whole article bottom-up. Each printed
# `PASS all 3 P/V/I articles carry <decl>` while shipping the defect: a FALSE
# pass, not a missing check. The left side now anchors to the rule brace or a
# `;` and the right side terminates on `[;}]`, exactly as `check()` does.
for want in 'gap:16px' 'padding:0' 'display:flex' 'flex-direction:column' 'align-items:stretch'; do
  n=$(grep -ohE "\.(page-item|video-item|interactive-app)\.svelte-[a-z0-9]+\{([^}]*;)?${want}[;}]" $CSS \
      | sed 's/{.*//' | sort -u | wc -l | tr -d ' ')
  if [[ $n -eq 3 ]]; then echo "PASS  all 3 P/V/I articles carry $want"
  else echo "FAIL  $want found on $n of 3 P/V/I articles"; fail=1; fi
done
h2n=$(grep -ohE "\.(page-item|video-item|interactive-app)\.svelte-[a-z0-9]+ h2:where\(\.svelte-[a-z0-9]+\)\{([^}]*;)?font-size:16px[;}]" $CSS \
      | sed 's/ h2.*//' | sort -u | wc -l | tr -d ' ')
[[ $h2n -eq 3 ]] && echo "PASS  all 3 P/V/I item h2 at 16px (ref 2122)" \
                 || { echo "FAIL  P/V/I h2 16px on $h2n of 3"; fail=1 }

# Card framing. The payload is hashless (`:global`), the PREFIX carries the hash
# -- that ancestor scoping is the whole point: a bare top-level :global(.frame)
# would reach the deferred editor previews.
check "video card zeroes the shared frame margin (ancestor-scoped)" \
      '\.video-card\.svelte-[a-z0-9]+ \.frame\{([^}]*;)?margin-bottom:0[;}]'
check "app card zeroes the shared frame margin (ancestor-scoped)" \
      '\.app-card\.svelte-[a-z0-9]+ \.frame\{([^}]*;)?margin-bottom:0[;}]'
for c in video-card app-card; do
  check "$c is a bordered --surface card with overflow:hidden" \
        "\.${c}\.svelte-[a-z0-9]+\{([^}]*;)?overflow:hidden[;}]"
done
# A bare top-level :global(.frame) compiles to a HASHLESS `.frame{...}` rule.
# The (b4) inventory would also catch it, but name it here so the failure says why.
none "no bare top-level :global(.frame) (would reach the editor previews)" \
     '(^|\})\.frame\{'

check "watched line uses the reserved status token, not --success" \
      '\.watched\.svelte-[a-z0-9]+\{([^}]*;)?color:var\(--status-accepted-fg\)[;}]'
none  "watched line dropped --success" '\.watched\.svelte-[a-z0-9]+\{[^}]*var\(--success\)'
check "watched row is inline-flex (else the SVG baseline-aligns, not centres)" \
      '\.watched\.svelte-[a-z0-9]+\{([^}]*;)?display:inline-flex[;}]'
check "cover-hint is 12.5px --muted" \
      '\.cover-hint\.svelte-[a-z0-9]+\{([^}]*;)?font-size:12\.5px[;}]'
# .notice was not component-unique until Slice 5b (InteractiveAppEditor authored
# one too). Stay anchored on the name-unique .interactive-app hash anyway, so a
# future second author can never be the one judged here.
ih=(${(f)"$(grep -ohE '\.interactive-app\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#ih[@]} -eq 1 ]]; then
  check "InteractiveAppItem .notice exists"              "\.notice\.${ih[1]}\{"
  none  "InteractiveAppItem .notice dropped italic"      "\.notice\.${ih[1]}\{[^}]*font-style:italic"
else
  echo "FAIL  .interactive-app is not dist-unique (${#ih[@]}: $ih)"; fail=1
fi

# PageItem {@html} content rules. Load-bearing against reset.css:4, which zeroes
# ul/ol padding AND markers; the split by list type is a content-correctness fix
# -- a blanket `list-style:disc` renders <ol> as bullets instead of 1. 2. 3.
#
# Checked in DIST, not source. These were source greps until a mutation round
# showed that form unsound in BOTH directions: a later duplicate
# `:global(ol > li){list-style:none}` and an `@media`-wrapped `padding-left:0`
# both ESCAPED (the grep still matched the original rule while the later one won
# the cascade), and merely reflowing the selector list across two lines RED the
# gate on a semantically identical file. `:global` keeps the payload hashless but
# the LEADING part still takes the scope hash, so every one of these rules is
# visible in dist and hash-couplable -- and (g2) then pins each to exactly one
# top-level declaration, which is what closes the duplicate/@media hole.
P=src/components/items/PageItem.svelte
ph=(${(f)"$(grep -ohE '\.page-item\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#ph[@]} -eq 1 ]]; then
  PI_H=${ph[1]}
  echo "PASS  .page-item resolves to one hash ($PI_H) -- the PageItem anchor"
  # `.content` is NOT PageItem-unique (SequencePlayer authors one too), so every
  # rule below is anchored on PI_H rather than on the class name.
  # The reflow guard (WCAG 1.4.10). `.content` is the largest {@html} surface
  # in the app; without this one declaration a single unbreakable URL gave a
  # measured 433px of PAGE-level horizontal scroll at a 320px viewport: the
  # overflow escapes both .page-item (652px) and .page (960px), neither of
  # which clips. T2/T3 pinned the identical rule on their own {@html} prompts
  # (TextQuestion.svelte:70, NumericQuestion.svelte:71); this is the sibling
  # they missed. Inherited by every descendant rule below.
  check "PageItem {@html} prose wraps unbreakable tokens" \
        "\\.content\\.${PI_H}\\{([^}]*;)?overflow-wrap:anywhere[;}]"
  check "PageItem :global(p) margin-bottom"   "\.content\.${PI_H} p\{([^}]*;)?margin-bottom:var\(--space-3\)[;}]"
  check "PageItem :global(p) line-height"     "\.content\.${PI_H} p\{([^}]*;)?line-height:1\.6[;}]"
  check "PageItem ul/ol padding restored"     "\.content\.${PI_H} ul,\.content\.${PI_H} ol\{([^}]*;)?padding-left:var\(--space-4\)[;}]"
  check "PageItem ul/ol bottom margin"        "\.content\.${PI_H} ul,\.content\.${PI_H} ol\{([^}]*;)?margin-bottom:var\(--space-3\)[;}]"
  check "PageItem <ul> markers are disc"      "\.content\.${PI_H} ul>li\{([^}]*;)?list-style:disc[;}]"
  check "PageItem <ol> markers are decimal"   "\.content\.${PI_H} ol>li\{([^}]*;)?list-style:decimal[;}]"
  # The whole point of the split: a blanket disc would render <ol> as bullets.
  none  "no blanket list-style:disc reaching <ol>" "\.content\.${PI_H} (ol>li|ul,[^{]*ol)\{[^}]*list-style:disc"
else
  echo "FAIL  .page-item is not dist-unique (${#ph[@]}: $ph) -- cannot anchor .content"; fail=1
fi
# The middle-position form is BOTH a compile error and, if it compiled, would
# carry the scope hash the {@html} nodes lack.
# Grep the CODE, not the comments: PageItem's own comment explains why this
# form is invalid and therefore contains it verbatim (as did an earlier version
# of this check, which red the gate on a correct file).
if python3 -c "
import re,sys
src=open('$P').read()
src=re.sub(r'/\*.*?\*/','',src,flags=re.S)
src=re.sub(r'<!--.*?-->','',src,flags=re.S)
sys.exit(1 if re.search(r':global\((ul|ol)\) +li', src) else 0)
"; then echo "PASS  PageItem uses no mid-sequence :global(ul) li form (comments excluded)"
else echo "FAIL  PageItem code has the invalid :global(ul) li form"; fail=1 fi

# UnsupportedItem: type-neutral copy, and the empty TYPED script block that
# keeps every importer from resolving it as implicit `any`.
U=src/components/items/UnsupportedItem.svelte
grep -q 'This item isn'"'"'t available in this view yet\.' $U \
  && echo "PASS  UnsupportedItem copy is type-neutral" \
  || { echo "FAIL  UnsupportedItem copy changed"; fail=1 }
# Same: the markup comment quotes the copy that was REMOVED, so an unstripped
# grep reds a correct file.
if python3 -c "
import re,sys
src=open('$U').read()
src=re.sub(r'/\*.*?\*/','',src,flags=re.S)
src=re.sub(r'<!--.*?-->','',src,flags=re.S)
src=re.sub(r'<script[^>]*>.*?</script>','',src,flags=re.S)
sys.exit(1 if re.search(r'\{type\}|\(\"', src) else 0)
"; then echo "PASS  UnsupportedItem leaks no raw type identifier (comments excluded)"
else echo "FAIL  UnsupportedItem code still interpolates a type"; fail=1 fi
# Spec §2 rules UnsupportedItem's padding is deliberately RETAINED against the
# article rule (no <article>, no <h2>, so the rhythm rule does not apply and the
# inset is the dashed box's own). That ruling had no guard on EITHER lane: jsdom
# gets no component CSS, so no test can see it -- which leaves dist.
check "UnsupportedItem keeps its retained inset padding" \
      '\.unsupported\.svelte-[a-z0-9]+\{([^}]*;)?padding:var\(--space-3\)[;}]'
check "UnsupportedItem keeps the dashed border" \
      '\.unsupported\.svelte-[a-z0-9]+\{([^}]*;)?border:1px dashed var\(--border\)[;}]'
grep -q '<script lang="ts">' $U \
  && echo "PASS  UnsupportedItem keeps an empty TYPED script block (0 check errors)" \
  || { echo "FAIL  UnsupportedItem lost lang=ts -> importers become implicit any"; fail=1 }
grep -qE 'UnsupportedItem type=' src/components/items/ItemRouter.svelte \
  && { echo "FAIL  ItemRouter still passes a type= to UnsupportedItem"; fail=1 } \
  || echo "PASS  ItemRouter drops both type= passes"

echo


# --- (i) T6: ItemMark primitive + ItemIcon refactor -------------------------
# PARSE-BASED, not grep-based. The first version of this section pinned each
# declaration with `\.icon\.HASH\{…`, which demands the compound sit immediately
# before the brace -- so a selector LIST (`.icon, .covered { …22px box… }`) and a
# `:where()` suffix (`.icon:where(button) { … }`) BOTH restored the exact
# double-ring defect T6 exists to prevent, under a green gate (laneB-C1,
# reproduced independently). The remedy is not more greps: select rules by the
# PARSED selector carrying the component hash, then compare the full inventory
# and each rule's declaration SET, exactly as section (a) does for T3. That one
# change also closes laneB-I1 (an ADDED declaration -- `min-width:44px` beating
# `width:22px`, `flex-shrink:1` beating `flex:0 0 auto`, `opacity` on the base --
# and a DELETED unpinned one, e.g. `.current`'s `color:var(--primary)`),
# laneB-I2 (hash ownership silently migrating to another component: every rule
# of that component then carries the hash and shows up as unexpected), and
# laneB-I3 (the bare-state check, which was blind to @media and to selector
# lists, and false-FAILED when an unrelated component legitimately authored
# `.covered`; the deletion half is now stated positively as "these are the ONLY
# rules carrying this hash").
echo
echo "--- (i) T6 ItemMark ---"
# Anchors: double-verified per the gate rule -- authored in exactly one source
# file AND resolving to exactly one dist hash. Both greps anchor to a RULE START
# (`^\s*\.name\s*[,{]`), not a bare mention: the loose form was satisfied by a
# COMMENT naming the class (laneB-m2).
grep -qE '^[[:space:]]*\.item-mark[[:space:]]*[,{]' src/components/course/ItemMark.svelte \
  || { echo "FAIL  .item-mark is not authored as a rule in ItemMark.svelte"; fail=1 }
grep -qE '^[[:space:]]*\.icon[[:space:]]*[,{]' src/components/course/ItemIcon.svelte \
  || { echo "FAIL  .icon is not authored as a rule in ItemIcon.svelte"; fail=1 }
# ...and that no OTHER component authors either class, so the hash cannot migrate.
for cls in item-mark icon; do
  owners=(${(f)"$(grep -rlE "^[[:space:]]*\.${cls}[[:space:]]*[,{]" src --include='*.svelte')"})
  if [[ ${#owners[@]} -eq 1 ]]; then
    echo "PASS  .${cls} is authored by exactly one component (${owners[1]:t})"
  else
    echo "FAIL  .${cls} is authored by ${#owners[@]} components: $owners"; fail=1
  fi
done
# Inline styling bypasses this gate COMPLETELY: Svelte emits `style="…"` and
# `style:prop` into the JS bundle, never into dist/_app/*.css. An inline 22px
# bordered box on ItemIcon's button restores the exact double ring T6 removes,
# with this gate reporting ALL PASS and every component test green
# (codex-r1-C1, reproduced). PARSED with the Svelte compiler, not grepped: a
# regex missed `style = "…"`, uppercase `STYLE=`, the `{style}` shorthand and
# `--x={…}` CSS-property props, and its comment-stripping was not syntax-aware,
# so a `//` inside a URL could erase the forbidden source that followed
# (codex-r2-C). The check is an ALLOWLIST on THREE axes — node type, tag and
# attribute NAME — so `use:`, `{@attach}`, `bind:this`, spreads,
# `<svelte:element>` and an attribute nobody reviewed all red rather than
# needing to be enumerated as they are invented. It does NOT judge the VALUE of
# an allowed non-visual attribute; the scope note on the walk below says so in
# full, and says which lane does.
node -e '
const { parse } = require("svelte/compiler");
const fs = require("fs");
let bad = 0;
// Allowlists on BOTH axes, and the walk itself is a whitelist of markup
// constructs rather than a generic recursion that only enforces on elements:
// that earlier shape visited every node but checked only RegularElement /
// Component / SvelteElement, so `{@html "<style>.icon{…22px box…}</style>"}`
// after the button produced zero hits, restored the double ring, and left the
// built CSS and the check count untouched (codex-r3-C). Any construct not
// named below -- HtmlTag, RenderTag, SlotElement, a snippet, an await block, a
// <svelte:head>, or whatever Svelte adds next -- falls through to the default
// and REDS, which is the point: the scanned set is small and mostly static, so
// anything new here deserves a human look before the gate keeps vouching for
// it. (That sentence began life when the set WAS two components; it is 17 now,
// listed at the foot of this payload.)
//
// SCOPE, stated precisely because the old PASS text overclaimed (codex-r4): this
// is a check on DECLARATIVE markup. It cannot see runtime style mutation — an
// allowed `onpointerenter` (or an OnDirective handler) assigning
// `currentTarget.style.cssText` parses as an ordinary Attribute, leaves the CSS
// inventory untouched, and passes the initial no-style assertions
// because nothing has fired yet. Nor does it traverse the internals of an
// imported Component, so a helper could inject a stylesheet at runtime. Closing that
// would need a rendered-DOM check (a real browser, computed styles after
// interaction), which this slice does not have.
//
// THE FRAGMENT-ONLY BOUNDARY, written down rather than claimed away (reviewer,
// close-out round 5). This scanner walks `ast.fragment` and NEVER `<script>`.
// So every value it pins BY NAME is defined where it cannot look: the `@html`
// expression it now records by source resolves to a variable a `$derived` can
// build from a hostile string; the `{expr}` it records in a class attribute is
// some `meta.cls` computed in script; the `{pct}` inside the one exempted style
// attribute likewise. Naming a thing stops the payload being written INLINE at
// that spot -- which is a real and worthwhile narrowing, and it is all it is.
// Five review rounds each found the next door precisely because the comments
// kept promising closure the code did not deliver, so: this file constrains
// DECLARATIVE markup and the built stylesheet. It does not constrain script.
// What the gate DOES guarantee, written as the list it actually is: no scanned
// component carries UNAPPROVED declarative styling outside its <style> block.
//
// Every attribute and prop is pinned by SOURCE except the CONTENT names below,
// which are pinned by name. So the SVG presentation and geometry values, and
// every prop that selects appearance (`variant`, `loading`, `disabled`,
// `state`, `type`, `status`, `role`, `checked`, `data-type`,
// `correctOptionIds`, `correctValue`), red on an edit without anyone having to
// classify them first.
//
// Two single-element carve-outs sit on top of that, each pinned to its exact
// source AND required to appear exactly once, so an addition, an edit or a
// DELETION reds: the inline `style` on the CourseCard progress fill, and the
// `hidden` on the BlockGroup panel. Everything else in that family is refused
// outright — any other inline `style`, any CSS-property prop, any other
// `hidden` or `inert`, and any `<style>` written INLINE into an `{@html}`
// payload. There is one deliberate tolerance: `inert` on the BlockGroup panel
// itself, allowed without a source pin because it changes focus order and
// nothing visual.
//
// The `{@html}` EXPRESSION is pinned by source, though what the backend puts in
// that variable is not — the limitation the sanitiser owns.
//
// That family is the actual regression path for the double ring. Beyond it:
// every markup construct and tag is allowlisted, so a new one reds for review;
// and element order, literal classes and literal text are pinned in document
// order.
//
// What it does NOT guarantee, named here so no later round has to rediscover it
// (codex, close-out round 3): the VALUE of an allowed NON-visual attribute or
// component prop. `src="about:blank"` on the video frame, an `href` pointing
// elsewhere, a swapped `onclick` — each of those keeps this scanner green,
// because each is a CONTENT question rather than a styling one, and content
// belongs to the component tests. The boundary is deliberate. Pinning every prop
// would make this a markup snapshot test, and every legitimate markup edit would
// become a pin regeneration — which is precisely the moment a human waves a diff
// through. VideoItem asserts its iframe `src` in its own test, which is where
// that finding belongs.
//
// It does NOT pin the VALUE of a CONTENT attribute: `src`, `href`, `title`,
// `id`, `name`, `value`, `inputmode`, the `aria-*` family, the handler props and
// the three data objects (`item`, `question`, `sequence`). Their presence is
// pinned -- they are recorded by name, so adding or dropping one reds -- but
// what they carry is owned by the component tests. That is the same content
// boundary stated above, and CONTENT is now the only list a reviewer has to
// audit: everything not on it is pinned by source, so a name nobody thought
// about is pinned rather than unread.
//
// An earlier shape had this exactly backwards and said so in a comment: it
// claimed no name in the allowlist could style anything, which three rounds
// falsified in a row (`opacity`, then `variant`, then `state`). The list that
// needs auditing is now the one whose entries are CLAIMS about content, not the
// one whose entries are permissions.
// `hidden` and `inert` are refused for the same reason as `style`: both switch an
// element off visually from the markup, where no CSS lane can see it. Hiding the
// count with `hidden` passed every pin in this file and every unit test — DOM
// textContent reads hidden nodes, so even the new normalised-text assertion stays
// green (first-party lane, T7 round 5). Exactly one scanned component has a
// legitimate use: the BlockGroup panel takes `hidden={!expanded}` as its pinned
// collapse mechanism. BlockGroup IS graded here (it is in SPEC and in the file
// list below), and that attribute has the per-file `hiddenOn` carve-out this
// paragraph used to say it would need -- pinned to its exact source and required
// exactly once. An earlier wording still said BlockGroup was not scanned, which
// stopped being true several rounds ago (codex, close-out round 6).
// Per FILE, so T6 keeps its tight pin while T7 gets the same protection: a
// construct legitimate in one of these is not thereby legitimate in another.
const BASE = ["Fragment", "Text", "Comment", "ExpressionTag", "RegularElement", "Component", "IfBlock"];
const SPEC = {
  // `path`: the open book (the `sequence` mark, user 2026-10-08).
  "ItemMark.svelte":        { nodes: BASE,                     tags: ["span", "svg", "line", "polygon", "polyline", "circle", "path"] },
  "ItemIcon.svelte":        { nodes: BASE,                     tags: ["button"] },
  // Student-view follow-up (user, 2026-10-08): the mark chain (EachBlock) is
  // gone; a progress bar and a quiz chip replace it. Follow-up 2 moved the pair
  // into ProgressMeter (shared with the block header), so the row is glyph +
  // title + component and carries no inline style any more.
  "SequenceLink.svelte":    { nodes: BASE, tags: ["a", "span"] },
  // The bar + chip pair. The fill width is per-row data -- the CourseCard
  // `styleOn` form, pinned the same way.
  "ProgressMeter.svelte":   { nodes: BASE, tags: ["span", "svg", "polyline"],
                              styleOn: { "span:fill.class:done": "style=\"width:{p.barPct}%\"" } },
  // The course summary card (follow-up 2): the same fill, same pin.
  "CourseProgress.svelte":  { nodes: BASE, tags: ["div", "p", "span", "svg", "polyline", "b"],
                              styleOn: { "span:fill.class:done": "style=\"width:{p.barPct}%\"" } },
  "MiniProjectLink.svelte": { nodes: BASE,                     tags: ["a", "span"] },
  // T8a allowed `HtmlTag` for the `{@html block.info_html}`; Slice-5c D7 removed
  // block info from every screen, so an `{@html}` here now reds.
  // `hiddenOn` is the panel and ONLY the panel: `hidden={!expanded}` IS the
  // pinned collapse mechanism there, while a `hidden` anywhere else in this
  // component would switch an element off where no CSS lane can see it. It
  // tolerates `inert` on the same element — it changes focus order, never
  // appearance — but no longer treats the pair as one: `hidden` there is pinned
  // to its exact source and required exactly once, so DELETING it reds. What
  // keeps the carve-out narrow is SIG: a SECOND unclassed <div> reds on the
  // signature before this exemption could shelter it. If the panel is ever
  // given a class its signature stops matching and the LEGITIMATE hidden reds
  // — loud, and the right direction.
  // T8b makes StatusPill a graded component (section (l)). Its class attribute
  // is `class="pill {meta.cls}"` -- the literal `pill` is pinned in SIG, the
  // `{meta.cls}` part is a dynamic expression and deliberately excluded, exactly
  // as the header states; which of the five `pill-*` classes each status yields
  // is pinned by StatusPill own tests instead.
  "StatusPill.svelte":      { nodes: BASE,                     tags: ["span"] },
  // The four components the close-out gave CSS inventories to -- sections (m),
  // (n) and (o). Both final lanes found, independently, that pinning their CSS
  // closed only HALF of C1: none of them was in this scanner, so
  // `<article class="quiz" style="--btn-pad-sm: 4px 40px">` retuned every option
  // row in BOTH choice components, `style="max-width:200px"` overrode the 652px
  // measure that sections (g) and (o) both exist to pin, and `class="quiz mono"`
  // set the whole quiz in IBM Plex Mono -- each with the gate at ALL PASS and
  // 1349 tests green. Being here also pins DOM ORDER, which nothing else does:
  // the T1 strip/main/footer order and the T4 questions-before-submit order are
  // load-bearing and were invisible to every lane.
  "SequencePlayer.svelte":  { nodes: BASE.concat("EachBlock", "RenderTag", "SnippetBlock"),
                              tags: ["a", "div", "footer", "h1", "main", "nav", "p", "span"] },
  "QuizItem.svelte":        { nodes: BASE.concat("EachBlock", "HtmlTag", "ConstTag"),
                              tags: ["article", "div", "h2", "p", "span", "strong"] },
  "SingleChoiceQuestion.svelte": { nodes: BASE.concat("EachBlock", "HtmlTag", "ConstTag"),
                              tags: ["div", "fieldset", "input", "label", "legend",
                                     "line", "polyline", "span", "svg"] },
  "MultiChoiceQuestion.svelte":  { nodes: BASE.concat("EachBlock", "HtmlTag", "ConstTag"),
                              tags: ["div", "fieldset", "input", "label", "legend",
                                     "line", "polyline", "span", "svg"] },
  // Round 3. Section (p) gave these four CSS inventories in the very commit
  // whose SPEC comment above explains that a CSS inventory closes only HALF of
  // the problem -- and then did not wire them in here. All three named attacks
  // were still live on `.page-item`: `style="max-width:200px"` overrode the same
  // 652px measure, `class="page-item mono"` set every static page in Plex Mono,
  // and `{@html "<style>…</style>"}` injected a stylesheet into the JS chunk
  // where no CSS lane can reach it. Gate ALL PASS (228), 1349 tests green
  // (reviewer, close-out round 3, all reproduced).
  "PageItem.svelte":        { nodes: BASE.concat("HtmlTag"), tags: ["article", "div", "h2"] },
  "VideoItem.svelte":       { nodes: BASE, tags: ["article", "div", "h2", "p", "polyline", "svg"] },
  "InteractiveAppItem.svelte": { nodes: BASE, tags: ["article", "div", "h2", "p"] },
  "UnsupportedItem.svelte": { nodes: BASE, tags: ["div", "p"] },
  "CourseCard.svelte":      { nodes: BASE.concat("RenderTag", "SnippetBlock"),
                              tags: ["a", "div", "h3", "span"],
                              styleOn: { "span:bar-fill": "style=\"width:{pct}%\"" } },
  // T3 for the same reason. Their own tests DO reject an inline `style`, but the
  // sibling class assertion reads `el.className.split(" ")[0]` -- the FIRST
  // token only -- so `class="text mono"` set every numeric prompt in Plex Mono
  // with the gate green and all 1349 tests passing (reviewer, round 3).
  "NumericQuestion.svelte": { nodes: BASE.concat("HtmlTag"), tags: ["div", "input", "p", "strong"] },
  "TextQuestion.svelte":    { nodes: BASE.concat("HtmlTag"), tags: ["div", "input", "p", "strong"] },
  "BlockGroup.svelte":      { nodes: BASE.concat("EachBlock"),
                              tags: ["section", "header", "h2", "button", "span", "svg",
                                     "polyline", "div", "ul", "li"],
                              hiddenOn: { "div:": "hidden={!expanded}" } },
};
const ATTR = new Set(["Attribute", "OnDirective", "ClassDirective"]);
// The DEFAULT is to PIN an attribute by source. CONTENT below is the explicit
// exception list, and inverting the default this way is the whole point.
//
// The earlier shape was the other way round: an ATTR_OK allowlist of names that
// went unread, and a VISUAL set of names pinned by value. That put every
// attribute in the repo on trial one at a time, and three consecutive review
// rounds each found exactly one more name filed on the wrong side --
// `opacity` (unread entirely), then `variant` (`class="btn {variant}"` inside
// Button), then `state` (picks the covered/current/not-yet mark). Each was a
// real student-visible regression passing at ALL PASS with every test green,
// and each was fixed by moving one name. A fourth was already queued when this
// landed: `correctOptionIds` / `correctValue` drive `class:locked` and the whole
// D2 reveal cascade, so a literal at the QuizItem call site reveals every
// question permanently.
//
// The defect was never the individual name. It was that FORGETTING a name made
// it unread. Inverted, forgetting a name makes it PINNED -- noisy, and safe.
// A new attribute now reds through the signature rather than through a special
// message, which is the same fail-closed behaviour by a shorter route.
//
// CONTENT names are recorded by NAME, not by value, so the attribute SET is
// still pinned (adding or dropping one reds) while what they carry stays owned
// by the component tests -- the boundary the scope note above draws, unchanged.
// A name belongs here only if its value cannot reach the cascade: no class
// expression, no `class:` predicate, no attribute selector, no script-derived
// class, no rendered chrome.
// The four whole-data-object props are NOT here, and they were the first
// version of this list getting it wrong: `item`, `question`, `sequence` and
// `value` each reach the cascade through a field. `item` picks the ItemRouter
// branch, the ItemIcon glyph and (via `item.latest_status`) the StatusPill
// class -- and worse, it reaches `{@html item.content_html}`, so an item built
// at the call site reopens the injected-stylesheet channel an earlier round
// graded Critical. `question` reaches `{@html question.text_html}` and the
// option ids that drive selection. `value` becomes `selected`, then `isChosen`,
// then `class:selected` and the reveal predicates. `sequence.items` sets the
// number and type of ItemMark glyphs. All four pass a NAME-only record; all four
// are pinned by source now (codex, close-out round 6, all reproduced).
const CONTENT = new Set([
  "aria-controls", "aria-expanded", "aria-hidden", "aria-label",
  "aria-labelledby", "courseSlug", "href", "id", "inputmode",
  "name", "onanswer", "onchange", "onclick", "oninput",
  "scriptSource", "src", "title",
]);
// Rejecting inline `style` is NOT enough to make a component gradeable: a
// GLOBAL utility class needs no scoped rule, so `class="row mono"` or
// `class:mono={true}` restyles the whole row with the CSS inventory
// byte-identical and every test green (codex-r1-#2 / laneA-C3, both
// reproduced). A per-FILE list of allowed tokens does NOT close it -- `mono` is
// legitimately used by the badge and the count, so `class="row mono"` reuses an
// allowed token on the wrong element (my first fix, caught by mutation).
//
// So the pin is the whole per-ELEMENT signature, in document order:
// `tag:token.token`. That pins which elements exist, their order, their tags
// and their literal classes at once -- so it also reds on a reordered row, an
// appended completion ELEMENT, or a class landing on the wrong element. It is
// blind, by construction, to a glyph that is only TEXT: `{#if covered === total}`
// wrapping a bare star adds no element, so the signature is byte-identical and
// this scanner passed it (codex, T7 round 4 -- verified by mutation on both
// lanes). Hence the second pin below: every non-whitespace literal text node,
// keyed by the element that owns it. Dynamic
// `{expr}` parts of a class attribute are deliberately not included: the state
// values they carry are pinned by each component own tests and by the CSS
// inventory. Update these when the markup legitimately changes; that is the
// same intentional speed bump as EXPECTED_CHECKS.
const SIG = {
  "ItemMark.svelte":
    ["span:item-mark.{expr}[class=\"item-mark {state}\" aria-hidden]",
     "svg:[width=\"11\" height=\"11\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width={type === '\''quiz'\'' ? '\''1.9'\'' : '\''1.6'\''} stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden]",
     "#if:", "line:[x1=\"3\" y1=\"4\" x2=\"13\" y2=\"4\"]",
     "line:[x1=\"3\" y1=\"8\" x2=\"13\" y2=\"8\"]", "line:[x1=\"3\" y1=\"12\" x2=\"9\" y2=\"12\"]",
     "#else:", "#if:",
     "polygon:[points=\"5,3.4 13,8 5,12.6\" fill=\"currentColor\" stroke=\"none\"]", "#else:",
     "#if:", "polyline:[points=\"3,8.6 6.4,12 13,4.6\"]", "#else:", "#if:",
     "line:[x1=\"4\" y1=\"2.6\" x2=\"4\" y2=\"13.4\"]",
     "line:[x1=\"8\" y1=\"2.6\" x2=\"8\" y2=\"13.4\"]",
     "line:[x1=\"12\" y1=\"2.6\" x2=\"12\" y2=\"13.4\"]",
     "circle:[cx=\"4\" cy=\"10\" r=\"1.9\" fill=\"currentColor\" stroke=\"none\"]",
     "circle:[cx=\"8\" cy=\"5.4\" r=\"1.9\" fill=\"currentColor\" stroke=\"none\"]",
     "circle:[cx=\"12\" cy=\"8.6\" r=\"1.9\" fill=\"currentColor\" stroke=\"none\"]", "#else:",
     "#if:", "line:[x1=\"4.2\" y1=\"2.4\" x2=\"4.2\" y2=\"13.6\"]",
     "polygon:[points=\"4.2,3.2 12.4,5.8 4.2,8.4\" fill=\"currentColor\" stroke=\"none\"]",
     "#else:", "#if:",
     "path:[d=\"M8 4.6C6.4 3.5 4.6 3.1 2.6 3.3V12.7C4.6 12.5 6.4 12.9 8 14C9.6 12.9 11.4 12.5 13.4 12.7V3.3C11.4 3.1 9.6 3.5 8 4.6Z\"]",
     "line:[x1=\"8\" y1=\"4.6\" x2=\"8\" y2=\"14\"]"],
  "ItemIcon.svelte":
    ["button:icon.{expr}[class=\"icon {istate}\" data-type={item.type} onclick title aria-label]",
     "ItemMark:[type={item.type} state={istate}]"],
  "SequenceLink.svelte":
    ["a:row[class=\"row\" href aria-label onclick]",
     "span:seq-glyph[class=\"seq-glyph\" aria-hidden]", "ItemMark:[type=\"sequence\"]",
     "span:row-title[class=\"row-title\"]", "ProgressMeter:[{p}]"],
  "ProgressMeter.svelte":
    ["span:progress[class=\"progress\" aria-hidden]",
     "span:track[class=\"track\"]", "span:fill.class:done[class=\"fill\"]",
     "span:pct.mono[class=\"pct mono\"]",
     "span:quiz-chip.class:on-strip.class:none.class:empty[class=\"quiz-chip\" aria-hidden]", "#if:",
     "svg:[width=\"10\" height=\"10\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"]",
     "polyline:[points=\"3,8.6 6.4,12 13,4.6\"]", "#else:", "#if:"],
  "CourseProgress.svelte":
    ["div:summary[class=\"summary\"]", "p:sl[class=\"sl\" aria-hidden]",
     "div:sb[class=\"sb\" aria-hidden]", "span:track[class=\"track\"]",
     "span:fill.class:done[class=\"fill\"]", "span:sp[class=\"sp\"]", "#if:",
     "p:sq[class=\"sq\" aria-hidden]", "#if:",
     "svg:[width=\"10\" height=\"10\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"]",
     "polyline:[points=\"3,8.6 6.4,12 13,4.6\"]", "b:", "p:sr-only[class=\"sr-only\"]"],
  "MiniProjectLink.svelte":
    ["a:row.row-mp[class=\"row row-mp\" href aria-label]",
     "span:row-glyph[class=\"row-glyph\" aria-hidden]", "ItemMark:[type=\"mini_project\"]",
     "span:row-title[class=\"row-title\"]", "StatusPill:[status={item.latest_status}]"],
  "StatusPill.svelte":
    ["span:pill.{expr}[class=\"pill {meta.cls}\"]",
     "span:pill-token[class=\"pill-token\" aria-hidden]"],
  "SequencePlayer.svelte":
    ["#snippet:crumbs", "nav:crumbs[class=\"crumbs\" aria-label]", "a:[href onclick]", "#if:",
     "span:sep[class=\"sep\" aria-hidden]", "span:crumb[class=\"crumb\"]",
     "span:sep[class=\"sep\" aria-hidden]",
     "span:current[class=\"current\" aria-current=\"page\"]", "div:page[class=\"page\"]", "#if:",
     "Skeleton:", "#else:", "#if:", "ErrorState:[variant=\"page\" title message={errorMessage}]",
     "#snippet:action", "Button:[variant=\"secondary\" onclick]", "#else:", "#if:",
     "ErrorState:[variant=\"page\" title]", "#snippet:action",
     "Button:[variant=\"secondary\" onclick]", "#else:", "#if:", "@render:crumbs",
     "h1:seq-title.sr-only[class=\"seq-title sr-only\"]", "EmptyState:[title]", "#else:",
     "@render:crumbs", "h1:seq-title.sr-only[class=\"seq-title sr-only\"]",
     "nav:strip[class=\"strip\" aria-label]", "#each:",
     "ItemIcon:[item={it} state={iconState(it.id)} onclick]", "span:counter[class=\"counter\"]",
     "main:content[class=\"content\"]", "#if:",
     "ItemRouter:[item={currentItem} state={currentCourse.value.state}]", "footer:",
     "Button:[variant=\"secondary\" onclick disabled={flatIndex <= 0} title]", "#if:",
     "Button:[variant=\"primary\" onclick]", "#else:",
     "Button:[variant=\"primary\" onclick disabled={flatIndex < 0} title]", "#if:",
     "span:next-label[class=\"next-label\"]", "span:next-title[class=\"next-title\"]", "#else:"],
  "QuizItem.svelte":
    ["#if:", "article:quiz[class=\"quiz\"]", "h2:", "EmptyState:[title]", "#else:",
     "article:quiz[class=\"quiz\"]", "h2:", "#each:", "div:q-block[class=\"q-block\"]",
     "span:q-counter.mono[class=\"q-counter mono\"]", "#if:",
     "SingleChoice:[question={q} value={valueFor(q.id)} onanswer disabled={locked} correctOptionIds={r?.correct_option_ids ?? null}]",
     "#else:", "#if:",
     "MultiChoice:[question={q} value={valueFor(q.id)} onanswer disabled={locked} correctOptionIds={r?.correct_option_ids ?? null}]",
     "#else:", "#if:",
     "Numeric:[question={q} value={valueFor(q.id)} onanswer disabled={locked} correctValue={r?.correct_numeric ?? null}]",
     "#else:", "#if:",
     "Text:[question={q} value={valueFor(q.id)} onanswer disabled={locked} correctValue={r?.correct_text ?? null}]",
     "#if:", "div:exp[class=\"exp\"]", "@html:r.explanation_html", "#if:",
     "div:submit-row[class=\"submit-row\"]",
     "Button:[onclick loading={inflight !== null} disabled={!allAnswered || inflight !== null} title]",
     "#if:", "p:hint[class=\"hint\"]", "span:mono[class=\"mono\"]", "#else:", "#if:",
     "div:result[class=\"result\"]", "p:", "strong:", "span:mono[class=\"mono\"]",
     "p:meta[class=\"meta\"]", "span:mono[class=\"mono\"]", "span:mono[class=\"mono\"]", "#if:",
     "Button:[onclick]", "#else:", "#if:", "Button:[variant=\"secondary\" onclick]"],
  // The two choice components differ in their CONTROL markup exactly as they
  // differ in their control CSS (the divergence set in section (n)): the radio
  // has a `span:dot`, the checkbox an `svg:check`. Everything else is one shape.
  "SingleChoiceQuestion.svelte":
    ["fieldset:", "legend:", "div:text[class=\"text\"]", "@html:question.text_html",
     "div:opts[class=\"opts\"]", "#each:",
     "label:opt.class:selected.class:locked.class:reveal-correct.class:reveal-wrong.class:reveal-missed.class:reveal-neutral[class=\"opt\"]",
     "input:[type=\"radio\" name value={opt.id} checked={isChosen} {disabled} onchange]",
     "span:ctl[class=\"ctl\"]", "#if:", "span:dot[class=\"dot\"]", "#if:",
     "svg:mark[class=\"mark\" width=\"13\" height=\"13\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden]",
     "polyline:[points=\"3,8.6 6.4,12 13,4.6\"]", "#else:", "#if:",
     "svg:mark[class=\"mark\" width=\"13\" height=\"13\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden]",
     "line:[x1=\"4.2\" y1=\"4.2\" x2=\"11.8\" y2=\"11.8\"]",
     "line:[x1=\"11.8\" y1=\"4.2\" x2=\"4.2\" y2=\"11.8\"]", "#if:",
     "span:sr-only[class=\"sr-only\"]"],
  "PageItem.svelte":
    ["article:page-item[class=\"page-item\"]", "h2:", "div:content[class=\"content\"]",
     "@html:item.content_html"],
  "VideoItem.svelte":
    ["article:video-item[class=\"video-item\"]", "h2:", "div:video-card[class=\"video-card\"]",
     "VideoFrame:[src title]", "#if:", "div:actions[class=\"actions\"]",
     "Button:[onclick loading={busy}]", "#else:", "p:watched[class=\"watched\"]",
     "svg:[width=\"13\" height=\"13\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden]",
     "polyline:[points=\"3,8.6 6.4,12 13,4.6\"]"],
  "InteractiveAppItem.svelte":
    ["article:interactive-app[class=\"interactive-app\"]", "h2:", "#if:",
     "div:app-card[class=\"app-card\"]", "InteractiveFrame:[scriptSource title]",
     "p:cover-hint[class=\"cover-hint\"]", "#else:", "#if:", "p:notice[class=\"notice\"]",
     "#else:", "#if:", "p:notice[class=\"notice\"]"],
  "UnsupportedItem.svelte": ["div:unsupported[class=\"unsupported\"]", "p:"],
  // CourseCard is a Slice-2 component, but the gate pins its `.count` at 11.5px
  // (the progress-RATIO step), so the markup half was open in exactly the way
  // every other graded component was: `<span class="count" style="font-size:22px">`
  // shipped the same 22px the CSS check forbids, gate ALL PASS, 1349 tests green
  // (reviewer, round 4). Scanning it closes the last component in this file that
  // had a CSS pin and no markup pin.
  "CourseCard.svelte":
    ["#snippet:bar", "span:bar[class=\"bar\" aria-hidden]", "span:bar-fill[class=\"bar-fill\"]",
     "#snippet:adminFooter", "div:footer[class=\"footer\"]",
     "a:foot-link[class=\"foot-link\" href onclick aria-label]",
     "a:foot-link[class=\"foot-link\" href onclick aria-label]", "#if:",
     "span:badge-draft[class=\"badge-draft\"]", "#else:",
     "span:badge-admin[class=\"badge-admin\"]", "#if:", "div:card[class=\"card\"]",
     "div:body[class=\"body\"]", "h3:title[class=\"title\"]",
     "a:title-link[class=\"title-link\" href onclick]", "span:hint[class=\"hint\"]",
     "@render:adminFooter", "#else:", "#if:", "div:card[class=\"card\"]",
     "div:body[class=\"body\"]", "h3:title[class=\"title\"]",
     "a:title-link[class=\"title-link\" href onclick]", "@render:bar",
     "span:meta[class=\"meta\"]", "span:count[class=\"count\"]",
     "a:cta[class=\"cta\" href onclick]", "@render:adminFooter", "#else:",
     "a:card.card-link[class=\"card card-link\" href onclick]", "div:body[class=\"body\"]",
     "h3:title[class=\"title\"]", "@render:bar", "span:meta[class=\"meta\"]",
     "span:count[class=\"count\"]", "span:cta[class=\"cta\"]",
     "div:footer.footer-status[class=\"footer footer-status\"]"],
  "NumericQuestion.svelte":
    ["div:row[class=\"row\"]", "div:text[class=\"text\" id]", "@html:question.text_html",
     "input:num.mono[class=\"num mono\" type=\"text\" inputmode aria-labelledby value={text} {disabled} oninput]",
     "#if:", "p:correct-line[class=\"correct-line\"]", "strong:mono[class=\"mono\"]"],
  "TextQuestion.svelte":
    ["div:row[class=\"row\"]", "div:text[class=\"text\" id]", "@html:question.text_html",
     "input:txt[class=\"txt\" type=\"text\" aria-labelledby value={text} {disabled} oninput]",
     "#if:", "p:correct-line[class=\"correct-line\"]", "strong:"],
  "MultiChoiceQuestion.svelte":
    ["fieldset:", "legend:", "div:text[class=\"text\"]", "@html:question.text_html",
     "div:opts[class=\"opts\"]", "#each:",
     "label:opt.class:selected.class:locked.class:reveal-correct.class:reveal-wrong.class:reveal-missed.class:reveal-neutral[class=\"opt\"]",
     "input:[type=\"checkbox\" value={opt.id} checked={isChosen} {disabled} onchange]",
     "span:ctl[class=\"ctl\"]", "#if:",
     "svg:check[class=\"check\" width=\"11\" height=\"11\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden]",
     "polyline:[points=\"3,8.6 6.4,12 13,4.6\"]", "#if:",
     "svg:mark[class=\"mark\" width=\"13\" height=\"13\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden]",
     "polyline:[points=\"3,8.6 6.4,12 13,4.6\"]", "#else:", "#if:",
     "svg:mark[class=\"mark\" width=\"13\" height=\"13\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden]",
     "line:[x1=\"4.2\" y1=\"4.2\" x2=\"11.8\" y2=\"11.8\"]",
     "line:[x1=\"11.8\" y1=\"4.2\" x2=\"4.2\" y2=\"11.8\"]", "#if:",
     "span:sr-only[class=\"sr-only\"]"],
  "BlockGroup.svelte":
    ["section:block[class=\"block\"]", "header:", "h2:",
     "button:acc[id class=\"acc\" aria-expanded aria-controls aria-label onclick]",
     "span:num[class=\"num\" aria-hidden]", "span:acc-title[class=\"acc-title\"]",
     "ProgressMeter:[{p} onStrip]",
     "svg:chev.class:collapsed[class=\"chev\" width=\"13\" height=\"13\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden]",
     "polyline:[points=\"4.6,6.6 8,10 11.4,6.6\"]", "div:[id role=\"region\" aria-labelledby]",
     "ul:", "#each:", "li:",
     "SequenceLink:[courseSlug sequence={s} state={vstate}]", "#if:", "li:",
     "MiniProjectLink:[courseSlug item={mpByBlockId[String(block.id)]}]"],
};
// Every non-whitespace LITERAL text node these components emit, as
// `owner-signature:text` in document order, interleaved with a `{expr}` marker
// wherever an ExpressionTag renders. The marker pins THAT dynamic text appears
// there and how many times, never what it says; whitespace between elements
// trims away. The list is
// short on purpose -- these are marks-and-badges components, so any growth is a
// glyph or a label someone added in markup, which is exactly what T7 removed
// (`✓`) and what a replacement (`★`) would reinstate.
const TEXT = {
  "ItemMark.svelte": [],
  "ItemIcon.svelte": [],
  "SequenceLink.svelte": ["span:row-title:{expr}"],
  "ProgressMeter.svelte":
    ["span:pct.mono:{expr}", "span:pct.mono:%",
     "span:quiz-chip.class:on-strip.class:none.class:empty:Quiz",
     "span:quiz-chip.class:on-strip.class:none.class:empty:{expr}",
     "span:quiz-chip.class:on-strip.class:none.class:empty:%",
     "span:quiz-chip.class:on-strip.class:none.class:empty:Quiz –"],
  "CourseProgress.svelte":
    ["p:sl:Your progress", "span:sp:{expr}", "span:sp:%", "p:sq:Quiz score", "b::{expr}",
     "p:sr-only:Your progress:", "p:sr-only:{expr}", "p:sr-only:."],
  "MiniProjectLink.svelte": ["span:row-title:Mini-project:", "span:row-title:{expr}"],
  "BlockGroup.svelte": ["span:num:{expr}", "span:num:.", "span:acc-title:{expr}"],
  // No LITERAL entry on purpose -- the two below are `{expr}` markers. BOTH the
  // glyph and the label come through `{meta.token}` / `{meta.label}` from
  // LATEST_STATUS_META, so a LITERAL appearing here means someone hard-coded
  // copy into the markup and bypassed that map.
  "StatusPill.svelte": ["span:pill-token:{expr}", "span:pill.{expr}:{expr}"],
  // Longer than the marks-and-badges lists above because these are PAGE
  // components carrying real copy: a literal label edit becomes a deliberate act.
  // SCOPE, stated precisely because an earlier wording overclaimed (reviewer,
  // round 3): this pins literal TEXT NODES, plus the POSITION and COUNT of the
  // dynamic ones. What a `{expr}` renders is still not here and cannot be --
  // the choice components build their `.sr-only` reveal labels in script,
  // QuizItem picks attempt/attempts, and SequencePlayer carries button
  // `title`s, all of which resolve where this scanner does not look. Those
  // values are pinned by each component own tests instead. The marker closes
  // only the cheaper hole: adding or removing an expression, which used to cost
  // nothing at all (codex, close-out round 3).
  "SequencePlayer.svelte":
    ["a::{expr}", "span:sep:/", "span:crumb:{expr}", "span:crumb:.",
     "span:crumb:{expr}", "span:sep:/", "span:current:{expr}", "Button::Back to course",
     "Button::Back to course", "h1:seq-title.sr-only:{expr}", "h1:seq-title.sr-only:{expr}",
     "span:counter:Item", "span:counter:{expr}", "span:counter:of", "span:counter:{expr}",
     "Button::← Previous", "Button::Finish sequence", "span:next-label:Next:",
     "span:next-title:{expr}", "span:next-label:→", "Button::Next →"],
  "QuizItem.svelte":
    ["h2::{expr}", "h2::{expr}",
     "span:q-counter.mono:Question", "span:q-counter.mono:{expr}", "span:q-counter.mono:of",
     "span:q-counter.mono:{expr}", "Button::Submit answer", "span:mono:{expr}", "p:hint:{expr}",
     "p:hint:left", "strong::Score:", "span:mono:{expr}", "span:mono:/", "span:mono:{expr}",
     "p:meta:Attempt", "span:mono:{expr}", "p:meta:of", "span:mono:{expr}", "Button::Try again",
     "Button::Show correct answers"],
  // No LITERAL entry on purpose in either -- the entries below are `{expr}`
  // markers. Every option label is `{opt.text}` from the API, so a LITERAL here
  // means someone hard-coded question copy into the markup.
  // The `.sr-only` reveal WORDING is built in script; the ExpressionTag that
  // renders it is now marked here in position, so removing or duplicating it
  // reds, but what it says stays out of scope by construction, not by oversight
  // -- see the SCOPE note above.
  "SingleChoiceQuestion.svelte":
    [
     "label:opt.class:selected.class:locked.class:reveal-correct.class:reveal-wrong.class:reveal-missed.class:reveal-neutral:{expr}",
     "span:sr-only:{expr}"],
  "MultiChoiceQuestion.svelte":
    [
     "label:opt.class:selected.class:locked.class:reveal-correct.class:reveal-wrong.class:reveal-missed.class:reveal-neutral:{expr}",
     "span:sr-only:{expr}"],
  "PageItem.svelte": ["h2::{expr}"],
  "VideoItem.svelte": ["h2::{expr}", "Button::Mark as watched", "p:watched:Marked as watched"],
  "InteractiveAppItem.svelte":
    ["h2::{expr}", "p:cover-hint:Marked covered once opened.",
     "p:notice:This app couldn'\''t be loaded.", "p:notice:No app uploaded yet."],
  "UnsupportedItem.svelte": ["p::This item isn'\''t available in this view yet."],
  "NumericQuestion.svelte": ["p:correct-line:Correct answer:", "strong:mono:{expr}"],
  "TextQuestion.svelte": ["p:correct-line:Correct answer:", "strong::{expr}"],
  "CourseCard.svelte":
    ["a:foot-link:Edit", "a:foot-link:Runs", "span:badge-draft:DRAFT", "span:badge-admin:ADMIN",
     "a:title-link:{expr}", "span:hint:No active enrolment", "a:title-link:{expr}",
     "span:count:{expr}", "a:cta:{expr}", "h3:title:{expr}", "span:count:{expr}",
     "span:cta:{expr}", "div:footer.footer-status:{expr}"],
};
for (const f of process.argv.slice(1)) {
  const hits = [];
  const srcText = fs.readFileSync(f, "utf8");
  const ast = parse(srcText, { modern: true, filename: f });
  const spec = SPEC[f.split("/").pop()];
  if (!spec) { console.log(`FAIL  ${f} has no entry in SPEC — add one before the gate can vouch for it`); bad = 1; continue; }
  const NODE = new Set(spec.nodes), TAG = new Set(spec.tags);
  const sig = [];
  const txt = [];
  const renders = [];
  const snippets = [];
  // An approved channel that is only checked WHEN ENCOUNTERED is not a pin: it
  // reds on an edit and stays silent on a deletion. Removing
  // `style="width:{pct}%"` left `span:bar-fill` byte-identical in SIG and no
  // check fired (codex, close-out round 5). These counters make each approved
  // channel required, exactly once.
  const seenStyle = {};
  const seenHidden = {};
  // `owner` is the signature of the nearest enclosing element, so a text node
  // is reported against the thing that renders it rather than in isolation --
  // and a glyph appended straight into the row reads as `a:row:...`, which no
  // pinned list contains.
  (function walk(n, owner) {
    if (!n) return;
    if (!NODE.has(n.type)) { hits.push(`unreviewed markup construct ${n.type}`); return; }
    switch (n.type) {
      case "Fragment": (n.nodes || []).forEach((k) => walk(k, owner)); return;
      case "Text": {
        const t = String(n.data || "").trim();
        if (t) txt.push(`${owner}:${t}`);
        return;
      }
      // `{@const}` joins Comment: it binds a local and emits no DOM, so it can
      // carry no style and no class. Anything it computes reaches the page
      // through an ExpressionTag or an attribute -- both of which are VISITED,
      // and neither of which has its VALUE pinned unless the attribute is
      // visual. The earlier wording here said the two were "already scanned",
      // which reads as a guarantee about values that this walk does not make
      // (codex, close-out round 3).
      case "Comment": case "ConstTag": return;
      // An ExpressionTag emits DOM, so unlike the two above it cannot simply be
      // discarded. It leaves a `{expr}` marker in the TEXT pin, in position and
      // counted: `Marked as watched {STAR}` put a student-visible glyph on the
      // page with every pin byte-identical, because a node dropped on the floor
      // is a node that can be added for free (codex, close-out round 3,
      // reproduced). The marker records THAT dynamic text renders here and
      // where, never what it says -- that resolves in script, which this
      // scanner never reads.
      case "ExpressionTag": txt.push(`${owner}:{expr}`); return;
      // Position-pinned, NOT swallowed. Allowing the node type is per-FILE, so a
      // bare `return` here sanctioned ANY {@html} in that file — including a
      // second one carrying `<style>…</style>`, which is exactly the codex-r3-C
      // attack the header above records as DEFEATED: an injected stylesheet
      // lives in the JS bundle, never in dist CSS, so no other lane can see it.
      // Reproduced passing the whole gate before this line existed.
      // The marker carries the EXPRESSION, not just the position. Pinning the
      // position alone sanctioned any payload at that spot, so the already
      // allowed `{@html item.content_html}` became
      // `{@html "<style>.page-item{max-width:200px !important}</style>" + item.content_html}`
      // -- a stylesheet in the JS chunk, which $CSS, (b4) and every inventory
      // are blind to, restyling the whole document. Gate ALL PASS (234), 1349
      // tests green (reviewer, close-out round 4). Every scanned component with
      // an allowed `@html:` had the same opening.
      //
      // WHAT THIS DOES NOT DO, stated because the sentence above overclaimed and
      // was corrected (reviewer, round 5): naming the expression stops an INLINE
      // payload, not A payload. This scanner reads `ast.fragment` and never
      // `<script>`, so the VALUE behind the name is defined where it cannot see --
      // `const item = $derived({ ...srcItem, content_html: "<style>…</style>" +
      // srcItem.content_html })` reaches the identical end state with this pin
      // byte-identical. That is the fragment-only boundary the SCOPE paragraph in
      // the header records; it cannot be closed at this layer, and no comment here
      // should imply otherwise.
      case "HtmlTag":
        sig.push("@html:" + srcText.slice(n.expression.start, n.expression.end).split(/\s+/).join(" "));
        return;
      // T1 uses `{#snippet crumbs()}` + `{@render crumbs()}` for the breadcrumb,
      // which BOTH branches of the page render. The snippet BODY is walked, so
      // its elements land in the signature at the point of declaration and the
      // markup it contributes is pinned exactly like any other.
      //
      // Both markers NAME what they refer to. An earlier version pushed a bare
      // `@render:`, on the argument that swapping in a different snippet needs
      // that snippet to exist and a new `#snippet:` would red on its own. That
      // holds only for snippets declared in the SAME file: Svelte 5 supports
      // `<script module>`-exported snippets, so the callee can live in another
      // component entirely. Proven by mutation -- a foreign snippet reproducing
      // the breadcrumb DOM, carrying `style="color:#c00; font-size:24px"`, and
      // rendered in the non-empty branch only, left the local snippet declared
      // and every marker byte-identical: gate ALL PASS, 1349 tests green
      // (reviewer, close-out round 3).
      case "SnippetBlock": {
        const nm = (n.expression && n.expression.name) || "?";
        snippets.push(nm); sig.push("#snippet:" + nm); walk(n.body, owner); return;
      }
      case "RenderTag": {
        const e = n.expression || {};
        const c = e.callee || e;
        // A non-identifier callee is REJECTED rather than recorded as "?".
        // Recording it would work only until the first legitimate
        // `{@render x?.()}` pinned `@render:?`, after which every member
        // expression, optional call and conditional callee would match that pin
        // and the marker would silently decay back to the bare form
        // (reviewer, round 4, m-1). `{@render a?.()}` parses as a
        // ChainExpression, so this is reachable by ordinary code, not just attack.
        const nm = (c && c.type === "Identifier" && c.name) || null;
        if (!nm) hits.push(`{@render} callee is not a plain identifier`);
        renders.push(nm || "?");
        sig.push("@render:" + (nm || "?"));
        return;
      }
      // `#if:` / `#else:` for the same reason `#each:` exists: a construct that
      // contributes nothing can be wrapped around anything for free. `{#if false}`
      // around the local `{#snippet crumbs}` left the name declared in the file --
      // satisfying the same-file rule below -- while `{@render crumbs(...)}` bound
      // to an IMPORTED snippet, so the breadcrumb rendered from unscanned markup
      // that carries no scope hash at all and therefore none of the 14 `.crumbs`
      // rules section (m) inventories. Gate ALL PASS (235), 1349 tests green,
      // `npm run check` identical to baseline (reviewer, round 5).
      // It also pins branch STRUCTURE: collapsing an {#if}/{:else} so both
      // branches render unconditionally was previously byte-identical.
      case "IfBlock":
        sig.push("#if:"); walk(n.consequent, owner);
        if (n.alternate) { sig.push("#else:"); walk(n.alternate, owner); }
        return;
      // `#each:` is emitted because a block that contributes NOTHING can be
      // wrapped around anything for free. `{#each [evilCrumbs] as crumbs}` bound
      // the name `crumbs` to a snippet imported from another component, so
      // `@render:crumbs` stayed byte-identical and the breadcrumb rendered from
      // foreign, unscoped markup carrying `style="font-size:24px; color:#c00"`
      // -- gate ALL PASS (234), 1349 tests green (reviewer, round 4).
      case "EachBlock": sig.push("#each:"); walk(n.body, owner); walk(n.fallback, owner); return;
      case "RegularElement": case "Component": {
        if (n.type === "RegularElement" && !TAG.has(n.name)) hits.push(`unreviewed element <${n.name}>`);
        const cls = [];
        for (const a of n.attributes || []) {
          if (a.type === "ClassDirective") cls.push("class:" + a.name);
          else if (a.type === "Attribute" && String(a.name).toLowerCase() === "class") {
            const parts = Array.isArray(a.value) ? a.value : [a.value];
            for (const v of parts) {
              if (v && v.type === "Text") cls.push(...String(v.data).split(/\s+/).filter(Boolean));
              // ONE token per dynamic part, pushed IN POSITION. Hoisting a single
              // flag out of this loop pinned only THAT the attribute is dynamic,
              // so `class="pill {meta.cls}"` and `class="pill {meta.cls} {extra}"`
              // shared a signature: every status pill rendered in Plex Mono via
              // the global `.mono`, gate ALL PASS (235), 1349 tests green
              // (reviewer, round 5). ItemMark and ItemIcon had the same opening.
              else if (v) cls.push("{expr}");
            }
            // A `{expr}` token records THAT the attribute has a dynamic part,
            // never its value. Without it only the literal half was read, so
            // `class="text {extraCls}"` with `extraCls = "mono"` set every
            // numeric prompt in Plex Mono with the signature byte-identical --
            // gate ALL PASS (234), 1349 tests green (reviewer, round 4). The
            // fully dynamic form `class={cls}` was already caught (the element
            // loses its literal tokens); the MIXED form is ordinary Svelte, so
            // this was reachable by accident, not only by attack. StatusPill
            // and the two mark components use the mixed form legitimately, and
            // their pins carry `{expr}` to say so.
          }
        }
        const me = n.name + ":" + cls.join(".");
        // The signature is computed FIRST so the hidden/inert carve-out can name a
        // single element rather than exempting a whole file.
        const vis = [];
        for (const a of n.attributes || []) {
          const nm = a.name || "";
          const low = nm.toLowerCase();
          if (!ATTR.has(a.type)) { hits.push(`<${n.name}> ${a.type} ${nm}`.trim()); continue; }
          // A ClassDirective is read by the class collector above, and an
          // OnDirective names an EVENT rather than an attribute, so neither
          // carries a name the allowlist below is entitled to judge.
          if (a.type !== "Attribute") continue;
          // `styleOn` is the twin of `hiddenOn` and exists for exactly one
          // element: the CourseCard progress fill, whose width IS the datum
          // (`style="width:{pct}%"`) and cannot be expressed in a stylesheet.
          //
          // It pins the attribute SOURCE, not merely the permission. Exempting
          // the attribute wholesale let the same element carry
          // `style="width:{pct}%;position:fixed;inset:0;background:#c00;z-index:9999"`
          // -- `position:fixed` escapes the `overflow:hidden` on `.bar`, so a red
          // block covered the whole viewport on the student course-list page, with
          // the gate at ALL PASS (235) and 1349 tests green (reviewer, round 5).
          // The tests could not see it either: they assert `bar.style.width` only.
          // Pinning the source also settles the second-element case -- a further
          // `span:bar-fill` carrying a different style reds on the VALUE, not just
          // on the signature that a pin regeneration would absorb.
          if (low === "style") {
            const want = (spec.styleOn || {})[me];
            const got = srcText.slice(a.start, a.end).split(/\s+/).join(" ");
            if (want === undefined) hits.push(`<${n.name}> style attribute`);
            else if (got !== want) hits.push(`<${n.name}> style attribute is ${got} (pinned ${want})`);
            else seenStyle[me] = (seenStyle[me] || 0) + 1;
            continue;
          }
          if (nm.startsWith("--")) { hits.push(`<${n.name}> CSS-property prop ${nm}`); continue; }
          if (low === "hidden" || low === "inert") {
            const want = (spec.hiddenOn || {})[me];
            if (want === undefined) { hits.push(`<${n.name}> ${low} attribute`); continue; }
            // `inert` on the SAME element is TOLERATED, not pinned, and the two
            // are no longer treated as one: `inert` takes the panel out of the
            // tab order and cannot change how anything LOOKS, which is the only
            // axis this file grades. Saying that here is the point -- the
            // guarantee paragraph used to claim every `hidden`/`inert` outside
            // the carve-out was refused, which was not what the code did
            // (codex, close-out round 5).
            if (low === "inert") continue;
            const got = srcText.slice(a.start, a.end).split(/\s+/).join(" ");
            if (got !== want) hits.push(`<${n.name}> hidden attribute is ${got} (pinned ${want})`);
            else seenHidden[me] = (seenHidden[me] || 0) + 1;
            continue;
          }
          // A CONTENT name is recorded by NAME only; everything else is pinned
          // by SOURCE. Appending to the signature puts each in document order
          // beside the classes it sits with, so an attribute moving to a
          // different element reds too.
          if (CONTENT.has(nm)) { vis.push(nm); continue; }
          vis.push(srcText.slice(a.start, a.end).split(/\s+/).join(" "));
        }
        sig.push(vis.length ? `${me}[${vis.join(" ")}]` : me);
        walk(n.fragment, me);
        return;
      }
    }
  })(ast.fragment, "");
  // Naming the callee raises the bar but does not close it on its own: the
  // name can be bound to a snippet from another component. Requiring the
  // declaration to be in THIS file is what actually forbids foreign markup,
  // and it composes with `#each:` above, which catches the shadowing route.
  // Note the deliberate cost: this permanently forbids a scanned component from
  // rendering a snippet PROP -- `{@render children?.()}`, the form Button itself
  // uses. None of the scanned components does today, so it is a speed bump rather
  // than a restriction, but a component that legitimately needs one has to be
  // reviewed out of this list rather than quietly allowed (reviewer, round 5, m3).
  for (const r of renders) {
    if (!snippets.includes(r)) hits.push(`{@render ${r}} has no {#snippet ${r}} in this file`);
  }
  for (const [k, v] of Object.entries(spec.styleOn || {})) {
    const c = seenStyle[k] || 0;
    if (c !== 1) hits.push(`approved style ${v} on ${k} appears ${c} times (pinned exactly once)`);
  }
  for (const [k, v] of Object.entries(spec.hiddenOn || {})) {
    const c = seenHidden[k] || 0;
    if (c !== 1) hits.push(`approved ${v} on ${k} appears ${c} times (pinned exactly once)`);
  }
  const base = f.split("/").pop();
  const want = SIG[base] || [];
  if (JSON.stringify(sig) !== JSON.stringify(want)) {
    hits.push(`markup signature changed: ${JSON.stringify(sig)} (pinned ${JSON.stringify(want)})`);
  }
  const wantTxt = TEXT[base] || [];
  if (JSON.stringify(txt) !== JSON.stringify(wantTxt)) {
    hits.push(`literal text changed: ${JSON.stringify(txt)} (pinned ${JSON.stringify(wantTxt)})`);
  }
  if (hits.length) { bad = 1; console.log(`FAIL  ${base} markup pin broken: ${hits.join("; ")}`); }
  else console.log(`PASS  ${base} carries only approved attribute names; its styling values, markup and text match their pins`);
}
process.exit(bad);
' src/components/course/ItemMark.svelte src/components/course/ItemIcon.svelte \
  src/components/course/SequenceLink.svelte src/components/course/MiniProjectLink.svelte \
  src/components/course/ProgressMeter.svelte src/components/course/CourseProgress.svelte \
  src/components/course/BlockGroup.svelte src/components/course/StatusPill.svelte \
  src/pages/SequencePlayer.svelte src/components/items/QuizItem.svelte \
  src/components/items/quiz/SingleChoiceQuestion.svelte \
  src/components/items/quiz/MultiChoiceQuestion.svelte \
  src/components/items/PageItem.svelte src/components/items/VideoItem.svelte \
  src/components/items/InteractiveAppItem.svelte src/components/items/UnsupportedItem.svelte \
  src/components/items/quiz/NumericQuestion.svelte \
  src/components/items/quiz/TextQuestion.svelte \
  src/components/course/CourseCard.svelte || fail=1
im=(${(f)"$(grep -ohE '\.item-mark\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
ic=(${(f)"$(grep -ohE '\.icon\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#im[@]} -ne 1 || ${#ic[@]} -ne 1 ]]; then
  echo "FAIL  T6 anchors not dist-unique (.item-mark=${#im[@]}: $im, .icon=${#ic[@]}: $ic)"; fail=1
else
  echo "PASS  T6 anchors resolve to one hash each (.item-mark ${im[1]}, .icon ${ic[1]})"
  python3 - ${im[1]} ${ic[1]} ${CSS[@]} <<'T6EOF'
import re, sys
from collections import Counter
im_h, ic_h = sys.argv[1], sys.argv[2]
css = '\n'.join(open(p).read() for p in sys.argv[3:])
bad = 0

def rules(text, anc=()):
    """Flat (selector, body, ancestry) triples, descending into @-blocks.

    `ancestry` is the FULL tuple of enclosing at-rules, not just the innermost:
    it used to be replaced at each descent, so `@supports (display:grid) {
    @media (forced-colors:active) { … } }` — or an outer `@media
    (min-width:9999px)`, which never matches — read as exactly the one
    permitted block and passed the guard (codex-r2-I2).
    """
    out, i, start = [], 0, 0
    while i < len(text):
        c = text[i]
        if c == '{':
            sel = text[start:i].rsplit(';', 1)[-1].strip()
            depth, j = 1, i + 1
            while j < len(text) and depth:
                if text[j] == '{': depth += 1
                elif text[j] == '}': depth -= 1
                j += 1
            body = text[i+1:j-1]
            if sel.startswith('@'):
                out.extend(rules(body, anc + (re.sub(r'\s*:\s*', ':', ' '.join(sel.split())),)))
            else:
                out.append((sel, body, anc))
            i, start = j, j
        elif c == '}':
            i += 1; start = i
        else:
            i += 1
    return out

ALL = rules(css)
def decls(body): return {d.strip() for d in body.split(';') if d.strip()}

# The base box is stated in FULL because it MOVED off ItemIcon rather than being
# a delta, and the three state rules are Constraint 7. `.icon` is the whole of
# what ItemIcon may keep -- listing it here IS the deletion half.
SPECS = [
    ('ItemMark', im_h, [
        ('', '.item-mark.%s' % im_h,
             'box-sizing:border-box;width:22px;height:22px;flex:0 0 auto;'
             'border-radius:var(--radius);border:1px solid var(--border-strong);'
             'background:var(--surface);display:inline-flex;align-items:center;'
             'justify-content:center'),
        ('', '.item-mark.covered.%s' % im_h,
             'background:var(--primary);color:var(--primary-text);border-color:var(--primary)'),
        ('', '.item-mark.current.%s' % im_h,
             'background:var(--primary-soft);color:var(--primary);border:1.5px solid var(--primary)'),
        ('', '.item-mark.not-yet.%s' % im_h,
             'background:var(--surface);color:var(--muted);border-color:var(--border-strong)'),
        # The three states differ ONLY by colour, which forced-colors mode
        # overrides wholesale -- covered and not-yet would collapse into one
        # appearance. border-WIDTH and border-STYLE survive, so each state is
        # restated with a non-colour distinction (solid fill / 2px ring /
        # dashed). Pinned here so a later edit cannot quietly drop the block:
        # nothing in npm test can see it, and the states still LOOK right in a
        # normal theme with it gone (codex-r1-I1).
        ('@media (forced-colors:active)', '.item-mark.covered.%s' % im_h,
             'background:CanvasText;color:Canvas;border:1px solid CanvasText'),
        ('@media (forced-colors:active)', '.item-mark.current.%s' % im_h,
             'background:Canvas;color:Highlight;border:2px solid Highlight'),
        ('@media (forced-colors:active)', '.item-mark.not-yet.%s' % im_h,
             'background:Canvas;color:GrayText;border:1px dashed GrayText'),
    ]),
    ('ItemIcon', ic_h, [
        ('', '.icon.%s' % ic_h, 'display:inline-flex;border-radius:var(--radius)'),
    ]),
]

for name, h, want in SPECS:
    # `h in s` — substring of the PARSED selector, so a selector list, a
    # `:where()` suffix and an @media child are all selected, and any of them
    # that is not in `want` reports as unexpected.
    got = sorted((' >> '.join(a), s) for s, b, a in ALL if h in s)
    exp = sorted((m, s) for m, s, _ in want)
    if got != exp:
        bad = 1
        print('FAIL  %s rule inventory differs (at-rules and selector lists included)' % name)
        cg, ce = Counter(got), Counter(exp)
        for k in sorted((cg - ce).elements()): print('        unexpected: %s %s' % k)
        for k in sorted((ce - cg).elements()): print('        missing:    %s %s' % k)
        continue
    print('PASS  %s compiles to exactly its %d rule(s) — no duplicate, no stray at-rule, '
          'no selector list' % (name, len(want)))
    index = {(' >> '.join(a), s): b for s, b, a in ALL if h in s}
    off = 0
    for m, s, wb in want:
        have, wantd = decls(index[(m, s)]), decls(wb)
        if have != wantd:
            bad = 1; off += 1
            print('FAIL  %s %s%s declarations differ' % (name, (m + ' ') if m else '', s))
            print('        extra:   %s' % sorted(have - wantd))
            print('        missing: %s' % sorted(wantd - have))
    if not off:
        print('PASS  %s declares exactly the pinned set in every rule — nothing added, '
              'nothing dropped' % name)

sys.exit(bad)
T6EOF
  [[ $? -eq 0 ]] || fail=1
fi

# --- (j) T7: SequenceLink row + MiniProjectLink row -------------------------
# PARSE-BASED for the same reason as (i): these two rows share every class name
# they use (`.row`, `.row:hover`, `.row-title`), so a grep for `.row{…}` cannot
# say WHICH component it matched, and a selector list or a `:where()` suffix
# walks through a declaration-level regex anyway. Selecting by the component
# hash and comparing the full inventory settles both at once: the shared names
# are disambiguated by hash, and the pinned set is stated per component.
echo
echo "--- (j) T7 rows ---"
# Anchors: each is authored by exactly ONE component and slice-introduced.
# `.row` deliberately is NOT an anchor -- it is the 2-way collision itself.
# Student-view follow-up 2 (user, 2026-10-08): the bar + chip pair moved out of
# SequenceLink into ProgressMeter (shared with the block header), and the course
# summary card CourseProgress joined. `.track`/`.fill` now exist in BOTH meter
# components, so neither is an anchor; each component anchors on a class only
# it authors: SequenceLink `.seq-glyph`, MiniProjectLink `.row-glyph`,
# ProgressMeter `.quiz-chip`, CourseProgress `.summary`.
grep -qE '^[[:space:]]*\.seq-glyph[[:space:]]*[,{]' src/components/course/SequenceLink.svelte \
  || { echo "FAIL  .seq-glyph is not authored as a rule in SequenceLink.svelte"; fail=1 }
grep -qE '^[[:space:]]*\.row-glyph[[:space:]]*[,{]' src/components/course/MiniProjectLink.svelte \
  || { echo "FAIL  .row-glyph is not authored as a rule in MiniProjectLink.svelte"; fail=1 }
grep -qE '^[[:space:]]*\.quiz-chip[[:space:]]*[,{]' src/components/course/ProgressMeter.svelte \
  || { echo "FAIL  .quiz-chip is not authored as a rule in ProgressMeter.svelte"; fail=1 }
grep -qE '^[[:space:]]*\.summary[[:space:]]*[,{]' src/components/course/CourseProgress.svelte \
  || { echo "FAIL  .summary is not authored as a rule in CourseProgress.svelte"; fail=1 }
for cls in seq-glyph row-glyph quiz-chip summary; do
  owners=(${(f)"$(grep -rlE "^[[:space:]]*\.${cls}[[:space:]]*[,{]" src --include='*.svelte')"})
  if [[ ${#owners[@]} -eq 1 ]]; then
    echo "PASS  .${cls} is authored by exactly one component (${owners[1]:t})"
  else
    echo "FAIL  .${cls} is authored by ${#owners[@]} components: $owners"; fail=1
  fi
done
sq=(${(f)"$(grep -ohE '\.seq-glyph\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
mp=(${(f)"$(grep -ohE '\.row-glyph\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
pm=(${(f)"$(grep -ohE '\.quiz-chip\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
cp=(${(f)"$(grep -ohE '\.summary\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#sq[@]} -ne 1 || ${#mp[@]} -ne 1 || ${#pm[@]} -ne 1 || ${#cp[@]} -ne 1 \
      || $(print -l ${sq[1]} ${mp[1]} ${pm[1]} ${cp[1]} | sort -u | wc -l) -ne 4 ]]; then
  echo "FAIL  T7 anchors not dist-unique/distinct (.seq-glyph=${#sq[@]}: $sq, .row-glyph=${#mp[@]}: $mp, .quiz-chip=${#pm[@]}: $pm, .summary=${#cp[@]}: $cp)"; fail=1
else
  echo "PASS  T7 anchors resolve to one distinct hash each (.seq-glyph ${sq[1]}, .row-glyph ${mp[1]}, .quiz-chip ${pm[1]}, .summary ${cp[1]})"
  python3 - ${sq[1]} ${mp[1]} ${pm[1]} ${cp[1]} ${CSS[@]} <<'T7EOF'
import re, sys
from collections import Counter
sq_h, mp_h, pm_h, cp_h = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
css = '\n'.join(open(p).read() for p in sys.argv[5:])
bad = 0

def rules(text, anc=()):
    out, i, start = [], 0, 0
    while i < len(text):
        c = text[i]
        if c == '{':
            sel = text[start:i].rsplit(';', 1)[-1].strip()
            depth, j = 1, i + 1
            while j < len(text) and depth:
                if text[j] == '{': depth += 1
                elif text[j] == '}': depth -= 1
                j += 1
            body = text[i+1:j-1]
            if sel.startswith('@'):
                # Normalise the prelude exactly as the T3 heredoc does: the
                # minifier collapses whitespace unpredictably around a media
                # feature's colon -- it ships `@media (forced-colors: active)`
                # WITH the space today -- so an ancestry pinned to one spelling
                # reds on a minifier bump rather than on a real change.
                out.extend(rules(body, anc + (re.sub(r'\s*:\s*', ':', ' '.join(sel.split())),)))
            else:
                out.append((sel, body, anc))
            i, start = j, j
        elif c == '}':
            i += 1; start = i
        else:
            i += 1
    return out

ALL = rules(css)
def decls(body): return {d.strip() for d in body.split(';') if d.strip()}

# Both rows' `.row` and `.row-title` are stated in FULL and identically, because
# "the two row kinds agree" IS the pin -- they are <li> siblings in one BlockGroup
# panel <ul>, and a drift in either makes the list read as two unrelated lists.
# Right padding 35px = header padding 12 + chevron 13 + gap 10, so the row
# bar/chip columns sit exactly under the block header totals (follow-up 2).
ROW   = ('display:flex;align-items:center;gap:10px;padding:8px 35px 8px 12px;'
         'border-bottom:1px solid var(--border-soft);color:var(--text)')
HOVER = 'background:var(--primary-soft);text-decoration:none'
# An INSET ring, not the global outset one. base.css:21-25 gives every focusable
# element `box-shadow: 0 0 0 3px var(--primary-soft)`, painted OUTSIDE the border
# box -- and T8a's card is `overflow:hidden` with these rows spanning its padding
# box EXACTLY, so the left and right bands were clipped away entirely and the
# first/last row lost its outer band too. An inset ring paints inside the border
# box and survives the clip. Pinned in full because "just use the global ring"
# reads as a tidy-up in review and would silently re-clip it.
FOCUS = 'box-shadow:inset 0 0 0 2px var(--primary)'
# ...and its forced-colors companion, which is NOT optional decoration: that mode
# drops box-shadow outright while base.css:22's `outline:none` still applies, so
# without this the row has NO focus indicator at all there. Same statement as the
# T3 heredoc's note above. `Highlight` is a system colour under Constraint 1's
# forced-colors exemption. Normalised (unspaced) form -- dist is minified.
FC    = '@media (forced-colors:active)'
FCRING = 'outline:2px solid Highlight;outline-offset:-2px'
# `flex:1 1 auto`, NOT `flex:1`. The shorthand `flex:1` means basis ZERO; when
# the row's other children outgrow it (the old `.chain` did past ~24 items on a
# 760px card -- since 2026-10-08 it is a fixed bar + chip column, and a status
# pill on the mini-project row), flex-grow stops applying and a basis-zero title
# resolves to 0px. The auto basis shares the shrink instead. A revert to `flex:1` reads as a harmless cleanup in
# review, which is why the basis is pinned here rather than left to the comment.
# 14.5px / 400 (follow-up 2, user): the admin sequence-row size, not bold.
# `overflow-wrap:anywhere` (Fable lane, follow-up 2): one unbroken word longer
# than the free width otherwise paints across the bar and chip columns.
TITLE = ('flex:1 1 auto;min-width:0;overflow-wrap:anywhere;font-size:14.5px;font-weight:400;'
         'color:var(--text)')
SPECS = [
    ('SequenceLink', sq_h, [
        ('', '.row.%s' % sq_h, ROW),
        ('', '.row.%s:hover' % sq_h, HOVER),
        ('', '.row.%s:focus-visible' % sq_h, FOCUS),
        (FC, '.row.%s:focus-visible' % sq_h, FCRING),
        # Student-view follow-up (user, 2026-10-08): the S-badge, mark chain
        # and count became the open-book glyph, a progress bar and a quiz chip
        # (the latter two now in ProgressMeter, below).
        # The glyph wrapper is the twin of MiniProjectLink .row-glyph.
        ('', '.seq-glyph.%s' % sq_h, 'display:inline-flex;flex:0 0 auto'),
        ('', '.row-title.%s' % sq_h, TITLE),
    ]),
    ('ProgressMeter', pm_h, [
        # A FIXED column so the bars line up row to row (layout A).
        ('', '.progress.%s' % pm_h, 'display:flex;align-items:center;gap:8px;flex:0 0 150px'),
        # --border, not CourseCard --border-soft: the row hovers --primary-soft.
        ('', '.track.%s' % pm_h,
             'flex:1 1 auto;height:6px;border-radius:var(--radius-pill);'
             'background:var(--border);overflow:hidden'),
        ('', '.fill.%s' % pm_h,
             'display:block;height:100%;border-radius:var(--radius-pill);background:var(--primary)'),
        ('', '.fill.done.%s' % pm_h, 'background:var(--success)'),
        # 11.5px: a progress ratio. Fixed width so 100% does not shift the bar.
        # weight 400 explicitly: in the block header button it would inherit 600.
        ('', '.pct.%s' % pm_h,
             'width:34px;text-align:right;font-size:11.5px;font-weight:400;color:var(--muted)'),
        ('', '.quiz-chip.%s' % pm_h,
             'box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;'
             'gap:4px;flex:0 0 86px;padding:2px 7px;border-radius:var(--radius-pill);'
             'background:var(--surface-2);font-size:11.5px;font-weight:500;color:var(--muted);'
             'white-space:nowrap'),
        # On the tinted header strip the --surface-2 chip would vanish.
        ('', '.quiz-chip.on-strip.%s' % pm_h, 'background:var(--surface)'),
        # ONE rule with a selector list, authored that way: "Quiz –" and the
        # empty slot carry no chip fill.
        ('', '.quiz-chip.none.%s,.quiz-chip.empty.%s' % (pm_h, pm_h), 'background:none'),
        ('@media (max-width:560px)', '.progress.%s' % pm_h, 'flex-basis:80px'),
        # Forced colors repaint backgrounds: outline the track, paint the fill.
        (FC, '.track.%s' % pm_h, 'border:1px solid CanvasText'),
        # `.fill.done` too: its theme green out-specifies a bare `.fill`, so a
        # finished bar kept --success with adjustment off (Fable lane, r1).
        (FC, '.fill.%s,.fill.done.%s' % (pm_h, pm_h), 'forced-color-adjust:none;background:CanvasText'),
    ]),
    ('CourseProgress', cp_h, [
        # The summary card: right of the info text, full width on a phone.
        ('', '.summary.%s' % cp_h,
             'box-sizing:border-box;flex:none;width:250px;margin-left:auto;padding:10px 14px;'
             'border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)'),
        ('', '.sl.%s' % cp_h, 'margin:0 0 6px;font-size:11.5px;color:var(--muted)'),
        ('', '.sb.%s' % cp_h, 'display:flex;align-items:center;gap:10px'),
        # The row bar one step taller (8px): the course total.
        ('', '.track.%s' % cp_h,
             'flex:1 1 auto;height:8px;border-radius:var(--radius-pill);'
             'background:var(--border);overflow:hidden'),
        ('', '.fill.%s' % cp_h,
             'display:block;height:100%;border-radius:var(--radius-pill);background:var(--primary)'),
        ('', '.fill.done.%s' % cp_h, 'background:var(--success)'),
        ('', '.sp.%s' % cp_h, 'font-size:15px;font-weight:600;font-variant-numeric:tabular-nums'),
        ('', '.sq.%s' % cp_h,
             'display:flex;align-items:center;gap:5px;margin:8px 0 0;font-size:12.5px;color:var(--muted)'),
        ('', '.sq.%s b:where(.%s)' % (cp_h, cp_h), 'font-weight:600;color:var(--text)'),
        ('', '.sr-only.%s' % cp_h,
             'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;'
             'clip-path:inset(50%);white-space:nowrap;border:0'),
        ('@media (max-width:640px)', '.summary.%s' % cp_h, 'width:100%'),
        (FC, '.track.%s' % cp_h, 'border:1px solid CanvasText'),
        (FC, '.fill.%s,.fill.done.%s' % (cp_h, cp_h), 'forced-color-adjust:none;background:CanvasText'),
    ]),
    ('MiniProjectLink', mp_h, [
        ('', '.row.%s' % mp_h, ROW),
        ('', '.row.%s:hover' % mp_h, HOVER),
        ('', '.row.%s:focus-visible' % mp_h, FOCUS),
        (FC, '.row.%s:focus-visible' % mp_h, FCRING),
        ('', '.row-glyph.%s' % mp_h, 'display:inline-flex;flex:0 0 auto'),
        ('', '.row-title.%s' % mp_h, TITLE),
    ]),
]

for name, h, want in SPECS:
    got = sorted((' >> '.join(a), s) for s, b, a in ALL if h in s)
    exp = sorted((m, s) for m, s, _ in want)
    if got != exp:
        bad = 1
        print('FAIL  %s rule inventory differs (at-rules and selector lists included)' % name)
        # MULTISET, not set. A duplicated rule appears in both `got` and `exp`, so
        # a set difference is empty and this printed a bare FAIL with no diff at
        # all -- while "no duplicate" is the first defect the PASS string claims to
        # cover. Detection was never affected (`got != exp` compares lists); only
        # the diagnostics were, which is worse than it sounds, because the next
        # person sees a failure the gate refuses to explain.
        cg, ce = Counter(got), Counter(exp)
        for k in sorted((cg - ce).elements()): print('        unexpected: %s %s' % k)
        for k in sorted((ce - cg).elements()): print('        missing:    %s %s' % k)
        continue
    print('PASS  %s compiles to exactly its %d rule(s) — no duplicate, no stray at-rule, no selector list'
          % (name, len(want)))
    index = {(' >> '.join(a), s): b for s, b, a in ALL if h in s}
    off = 0
    for m, sel, wb in want:
        have, wantd = decls(index[(m, sel)]), decls(wb)
        if have != wantd:
            bad = 1; off += 1
            print('FAIL  %s %s%s declarations differ' % (name, (m + ' ') if m else '', sel))
            print('        extra:   %s' % sorted(have - wantd))
            print('        missing: %s' % sorted(wantd - have))
    if not off:
        print('PASS  %s declares exactly the pinned set in every rule — nothing added, '
              'nothing dropped' % name)

# The two rows must agree BYTE-FOR-BYTE on the shared geometry, not merely each
# match its own copy of the spec: they are siblings in one list.
for label, sel in (('.row', '.row.%s'), ('.row-title', '.row-title.%s'),
                   ('.row:focus-visible', '.row.%s:focus-visible')):
    # TOP-LEVEL rules only (`not anc`). `.row:focus-visible` is authored twice per
    # component -- once bare, once under `@media (forced-colors:active)` -- and a
    # lookup keyed on the selector alone keeps whichever comes last, which would
    # have silently switched this check onto the forced-colors bodies. The two
    # forced-colors rules need no separate agreement check: SPECS above pins each
    # to the same FCRING literal, so they cannot drift apart.
    a = [b for s, b, anc in ALL if not anc and s == sel % sq_h]
    m = [b for s, b, anc in ALL if not anc and s == sel % mp_h]
    if a and m and decls(a[0]) == decls(m[0]):
        print('PASS  both row kinds declare an identical %s — the list reads as one list' % label)
    else:
        bad = 1
        print('FAIL  the two row kinds disagree on %s' % label)

sys.exit(bad)
T7EOF
  [[ $? -eq 0 ]] || fail=1
fi

# --- (k) T8a: BlockGroup accordion -----------------------------------------
# PARSE-BASED, same reasoning as (i) and (j). `.block` is deliberately NOT the
# anchor: it is a 3-way collision (the authoring editor and the run views author
# their own `.block`), so a grep for `.block{…}` cannot say which component it
# matched. `.acc` is BlockGroup-only and slice-introduced.
#
# The last-row hairline fix needs no separate source grep: it compiles to
# `ul.<hash> li:where(.<hash>):last-child .row`, which the inventory below states
# in full, and its `:global` form is separately pinned by GLOBAL_ALLOW in (b3).
echo
echo "--- (k) T8a BlockGroup accordion ---"
grep -qE '^[[:space:]]*\.acc[[:space:]]*[,{]' src/components/course/BlockGroup.svelte \
  || { echo "FAIL  .acc is not authored as a rule in BlockGroup.svelte"; fail=1 }
owners=(${(f)"$(grep -rlE "^[[:space:]]*\.acc[[:space:]]*[,{]" src --include='*.svelte')"})
if [[ ${#owners[@]} -eq 1 ]]; then
  # The claim is exactly what the grep tests — a TOP-LEVEL `.acc {`/`.acc,` rule.
  # It is blind to `.foo .acc {` and `.acc:hover {` in another component, and that
  # is sound rather than lucky — but for two DIFFERENT reasons, so neither case
  # is load-bearing on this grep. A DESCENDANT `.foo .acc {` compiles to
  # `.foo.svelte-Y .acc:where(.svelte-Y)`, which the anchor pattern below does not
  # match and which never carries this component hash into the inventory. A
  # COMPOUND `.acc:hover {` compiles to `.acc.svelte-Y:hover`, which DOES match the
  # anchor pattern — so it resolves to two hashes and the next check fails loudly.
  # Either way the dist-hash step, not this grep, is what makes the section sound.
  echo "PASS  .acc is authored as a top-level rule in exactly one component (${owners[1]:t})"
else
  echo "FAIL  .acc is authored by ${#owners[@]} components: $owners"; fail=1
fi
bg=(${(f)"$(grep -ohE '\.acc\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#bg[@]} -ne 1 ]]; then
  echo "FAIL  T8a anchor not dist-unique (.acc=${#bg[@]}: $bg)"; fail=1
else
  echo "PASS  T8a anchor resolves to one hash (.acc ${bg[1]})"
  python3 - ${bg[1]} ${CSS[@]} <<'T8AEOF'
import re, sys
from collections import Counter
h = sys.argv[1]
css = '\n'.join(open(p).read() for p in sys.argv[2:])
bad = 0

def rules(text, anc=()):
    """Every rule, carrying its FULL at-rule ancestry -- never just the innermost."""
    out, i, start = [], 0, 0
    while i < len(text):
        c = text[i]
        if c == '{':
            sel = text[start:i].rsplit(';', 1)[-1].strip()
            depth, j = 1, i + 1
            while j < len(text) and depth:
                if text[j] == '{': depth += 1
                elif text[j] == '}': depth -= 1
                j += 1
            body = text[i+1:j-1]
            if sel.startswith('@'):
                # Normalise the prelude exactly as the T3 heredoc does: the
                # minifier collapses whitespace unpredictably around a media
                # feature's colon -- it ships `@media (forced-colors: active)`
                # WITH the space today -- so an ancestry pinned to one spelling
                # reds on a minifier bump rather than on a real change.
                out.extend(rules(body, anc + (re.sub(r'\s*:\s*', ':', ' '.join(sel.split())),)))
            else:
                out.append((sel, body, anc))
            i, start = j, j
        elif c == '}':
            i += 1; start = i
        else:
            i += 1
    return out

ALL = rules(css)
def decls(body): return {d.strip() for d in body.split(';') if d.strip()}

# Stated in FULL, not as deltas. Two of these carry a note that a reviewer would
# otherwise "correct": `.block` margin-bottom is 10px (ref 1563), NOT the 16px
# var(--space-3) it replaced and NOT a decorative value -- it is the only
# inter-card gap; and `.block` background is load-bearing, since the page sets
# none and the header strip plus row separators lose their tint step without it.
WANT = [
    ('.block.%s' % h,
     'padding:0;overflow:hidden;margin-bottom:10px;border:1px solid var(--border);'
     'border-radius:var(--radius);background:var(--surface)'),
    # NO border-bottom here. The separator lives on the PANEL instead (below):
    # the panel is `hidden` when collapsed, so a header-owned border sat directly
    # on top of `.block`'s own border with zero gap and drew the collapsed card a
    # 2px bottom edge. Ref 1630 -- the collapsed B2 card -- omits it for exactly
    # that reason, while ref 1564's EXPANDED header carries it. Same defect class
    # as the last-row double hairline pinned at the end of this list.
    ('header.%s' % h,
     'background:var(--surface-2);padding:9px 12px;display:flex;align-items:center'),
    # ...and here it is. Pinned in the MINIFIED form: the source authors
    # `[role='region']` but the dist minifier strips quotes from a value that is a
    # valid identifier, and dist is what ships and what this section grades.
    ('[role=region].%s' % h, 'border-top:1px solid var(--border)'),
    # Without flex:1 the h2 shrink-wraps, `.acc width:100%` resolves against a
    # content-width box, and the chevron margin-left:auto has no free space.
    ('header.%s h2:where(.%s)' % (h, h), 'flex:1;min-width:0'),
    # 15px: the admin block-title size (AccordionHeader .title), follow-up 2.
    ('.acc.%s' % h,
     'width:100%;display:flex;align-items:center;gap:10px;text-align:left;'
     'font-size:15px;font-weight:600;border-radius:var(--radius)'),
    # Half of the long-title fix (2026-09-05 ruling): without it one unbroken word
    # longer than the card carries the chevron outside the clipped card. `flex:1
    # 1 auto` (follow-up 2): the title takes the free space so the totals sit in
    # the row bar/chip columns.
    # `overflow-wrap:anywhere` (Fable lane): with the totals to its right, an
    # unbroken long word would otherwise paint over the bar and chip (the admin
    # AccordionHeader .title carries the same).
    ('.acc-title.%s' % h, 'flex:1 1 auto;min-width:0;overflow-wrap:anywhere'),
    # The "B1" badge became the admin "1." ordinal (follow-up 2, user); the light
    # --ordinal is decorative, aria-hidden. Hash-coupled to .acc, NOT to .block.
    ('.num.%s' % h,
     'flex:none;margin-right:-4px;color:var(--ordinal);font-variant-numeric:tabular-nums'),
    # `color` is load-bearing: reset.css:7 gives a button `color: inherit`, so an
    # unstyled chevron reads --text instead of --muted.
    # `flex:0 0 auto` is the other half: with no text to floor it this item shrank
    # to ZERO width under that overflow. Ref 1559 carries it on the same glyph.
    ('.acc.%s .chev:where(.%s)' % (h, h), 'color:var(--muted);margin-left:auto;flex:0 0 auto'),
    # The rotation IS the visible collapsed cue -- aria-expanded alone is invisible.
    ('.acc.%s .chev.collapsed:where(.%s)' % (h, h), 'transform:rotate(-90deg)'),
    # Slice-5c D7: the `.info` rule is gone with block info (any return reds the inventory).
    # The last-row hairline would otherwise double against the card border.
    ('ul.%s li:where(.%s):last-child .row' % (h, h), 'border-bottom:0'),
]

got = sorted((' >> '.join(a), s) for s, b, a in ALL if h in s)
exp = sorted(('', s) for s, _ in WANT)
if got != exp:
    bad = 1
    print('FAIL  BlockGroup rule inventory differs (at-rules and selector lists included)')
    cg, ce = Counter(got), Counter(exp)
    for k in sorted((cg - ce).elements()): print('        unexpected: %s %s' % k)
    for k in sorted((ce - cg).elements()): print('        missing:    %s %s' % k)
else:
    print('PASS  BlockGroup compiles to exactly its %d rule(s) — no duplicate, no stray '
          'at-rule, no selector list' % len(WANT))
    index = {s: b for s, b, a in ALL if h in s and not a}
    off = 0
    for sel, wb in WANT:
        have, wantd = decls(index[sel]), decls(wb)
        if have != wantd:
            bad = 1; off += 1
            print('FAIL  BlockGroup %s declarations differ' % sel)
            print('        extra:   %s' % sorted(have - wantd))
            print('        missing: %s' % sorted(wantd - have))
    if not off:
        print('PASS  BlockGroup declares exactly the pinned set in every rule — nothing '
              'added, nothing dropped')

sys.exit(bad)
T8AEOF
  [[ $? -eq 0 ]] || fail=1
fi

# --- (l) T8b: StatusPill ----------------------------------------------------
# PARSE-BASED, same reasoning as (i), (j) and (k). `.pill` is deliberately NOT
# the anchor: RunMiniProjectsTab.svelte already authors its own top-level
# `.pill` (plus `.pill-published`/`.pill-locked`), so the moment T8b adds
# StatusPill the class is a 2-way collision and a grep for `.pill{...}` cannot
# say which component it matched -- the same trap `.block` set in (k).
# `.pill-success` is StatusPill-only and slice-introduced.
#
# The five status rules are stated in FULL rather than as a bg/fg pair each,
# because the DEFECT this section exists to catch is a swapped or duplicated
# token pair -- rejected wearing the accepted green -- which reads as correct in
# every other lane: jsdom cannot see the colour, and the class name is right.
echo
echo "--- (l) T8b StatusPill ---"
grep -qE '^[[:space:]]*\.pill-success[[:space:]]*[,{]' src/components/course/StatusPill.svelte \
  || { echo "FAIL  .pill-success is not authored as a rule in StatusPill.svelte"; fail=1 }
owners=(${(f)"$(grep -rlE "^[[:space:]]*\.pill-success[[:space:]]*[,{]" src --include='*.svelte')"})
if [[ ${#owners[@]} -eq 1 ]]; then
  echo "PASS  .pill-success is authored as a top-level rule in exactly one component (${owners[1]:t})"
else
  echo "FAIL  .pill-success is authored by ${#owners[@]} components: $owners"; fail=1
fi
sp=(${(f)"$(grep -ohE '\.pill-success\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#sp[@]} -ne 1 ]]; then
  echo "FAIL  T8b anchor not dist-unique (.pill-success=${#sp[@]}: $sp)"; fail=1
else
  echo "PASS  T8b anchor resolves to one hash (.pill-success ${sp[1]})"
  python3 - ${sp[1]} ${CSS[@]} <<'T8BEOF'
import re, sys
from collections import Counter
h = sys.argv[1]
css = '\n'.join(open(p).read() for p in sys.argv[2:])
bad = 0

def rules(text, anc=()):
    """Every rule, carrying its FULL at-rule ancestry -- never just the innermost."""
    out, i, start = [], 0, 0
    while i < len(text):
        c = text[i]
        if c == '{':
            sel = text[start:i].rsplit(';', 1)[-1].strip()
            depth, j = 1, i + 1
            while j < len(text) and depth:
                if text[j] == '{': depth += 1
                elif text[j] == '}': depth -= 1
                j += 1
            body = text[i+1:j-1]
            if sel.startswith('@'):
                # Normalised exactly as the other heredocs do -- see (j).
                out.extend(rules(body, anc + (re.sub(r'\s*:\s*', ':', ' '.join(sel.split())),)))
            else:
                out.append((sel, body, anc))
            i, start = j, j
        elif c == '}':
            i += 1; start = i
        else:
            i += 1
    return out

ALL = rules(css)
def decls(body): return {d.strip() for d in body.split(';') if d.strip()}

# Stated in FULL, not as deltas. `padding: 3px 8px` is ref 1112 AND the documented
# badge scale at ui/StatusBadge.svelte:18-19; `gap:4px` is a Constraint 5(b)
# no-reference literal -- StatusBadge is label-only with no glyph and no gap, so
# it is NOT a precedent for this one, which separates the .pill-token glyph from
# the label. D6: component-scoped, never a global `.pill`, which is what keeps
# visual-spec section 3's one-amber rule intact.
WANT = [
    ('.pill.%s' % h,
     'display:inline-flex;align-items:center;white-space:nowrap;gap:4px;'
     'padding:3px 8px;border-radius:var(--radius-pill);font-size:11px;font-weight:500'),
    # The class->token table. Two statuses share pill-neutral and two share
    # pill-warning, which is why the table is five rules and not seven.
    ('.pill-neutral.%s' % h,
     'background:var(--status-not-submitted-bg);color:var(--status-not-submitted-fg)'),
    ('.pill-info.%s' % h,
     'background:var(--status-awaiting-eval-bg);color:var(--status-awaiting-eval-fg)'),
    ('.pill-danger.%s' % h,
     'background:var(--status-rejected-bg);color:var(--status-rejected-fg)'),
    ('.pill-warning.%s' % h,
     'background:var(--status-needs-revision-bg);color:var(--status-needs-revision-fg)'),
    ('.pill-success.%s' % h,
     'background:var(--status-accepted-bg);color:var(--status-accepted-fg)'),
]

got = sorted((' >> '.join(a), s) for s, b, a in ALL if h in s)
exp = sorted(('', s) for s, _ in WANT)
if got != exp:
    bad = 1
    print('FAIL  StatusPill rule inventory differs (at-rules and selector lists included)')
    # MULTISET, not set -- see the same note in (j). A duplicated rule sits in both
    # collections, so a set difference prints nothing.
    cg, ce = Counter(got), Counter(exp)
    for k in sorted((cg - ce).elements()): print('        unexpected: %s %s' % k)
    for k in sorted((ce - cg).elements()): print('        missing:    %s %s' % k)
else:
    print('PASS  StatusPill compiles to exactly its %d rule(s) — no duplicate, no stray '
          'at-rule, no selector list' % len(WANT))
    index = {s: b for s, b, a in ALL if h in s and not a}
    off = 0
    for sel, wb in WANT:
        have, wantd = decls(index[sel]), decls(wb)
        if have != wantd:
            bad = 1; off += 1
            print('FAIL  StatusPill %s declarations differ' % sel)
            print('        extra:   %s' % sorted(have - wantd))
            print('        missing: %s' % sorted(wantd - have))
    if not off:
        print('PASS  StatusPill declares exactly the pinned set in every rule — nothing '
              'added, nothing dropped')

sys.exit(bad)
T8BEOF
  [[ $? -eq 0 ]] || fail=1
fi

# --- (m) T1: SequencePlayer chrome ------------------------------------------
# WHY THIS EXISTS (whole-branch review C1): T1 shipped with NO gate section at
# all. Both review lanes independently found it, and the second proved the
# consequence by mutation -- deleting `.crumbs a { color: var(--muted) }` renders
# the breadcrumb course link `--primary` blue (the precise defect spec section 1
# pins that rule to prevent), deleting `.next-title { max-width: 22ch }` lets a
# long title grow the footer button unbounded, and zeroing `.strip`
# `margin-bottom` collides the chain strip with the content -- each with the gate
# at ALL PASS and every test green.
#
# `.strip` is the anchor and is already resolved as $SP_H by section (g); it is
# recomputed here so this section is readable and movable on its own.
echo
echo "--- (m) T1 SequencePlayer chrome ---"
# The filename is asserted, not merely reported. "Exactly one owner" leaves the
# hash free to migrate to a DIFFERENT component wholesale, and this section would
# then grade that component against T1 pins -- the gate header states proving
# OWNERSHIP as a rule, and printing `${owners[1]:t}` looked like proof without
# being it (codex, close-out round 1).
owners=(${(f)"$(grep -rlE "^[[:space:]]*\.crumbs[[:space:]]*[,{]" src --include='*.svelte')"})
if [[ ${#owners[@]} -eq 1 && ${owners[1]:t} == 'SequencePlayer.svelte' ]]; then
  echo "PASS  .crumbs is authored as a top-level rule by SequencePlayer.svelte and nothing else"
else
  echo "FAIL  .crumbs owner is not SequencePlayer.svelte alone (${#owners[@]}: $owners)"; fail=1
fi
sp=(${(f)"$(grep -ohE '\.strip\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#sp[@]} -ne 1 ]]; then
  echo "FAIL  T1 anchor not dist-unique (.strip=${#sp[@]}: $sp)"; fail=1
else
  echo "PASS  T1 anchor resolves to one hash (.strip ${sp[1]})"
  python3 - ${sp[1]} ${CSS[@]} <<'T1EOF'
import re, sys
from collections import Counter
h = sys.argv[1]
css = '\n'.join(open(p).read() for p in sys.argv[2:])
bad = 0

def rules(text, anc=()):
    out, i, start = [], 0, 0
    while i < len(text):
        c = text[i]
        if c == '{':
            sel = text[start:i].rsplit(';', 1)[-1].strip()
            depth, j = 1, i + 1
            while j < len(text) and depth:
                if text[j] == '{': depth += 1
                elif text[j] == '}': depth -= 1
                j += 1
            body = text[i+1:j-1]
            if sel.startswith('@'):
                out.extend(rules(body, anc + (re.sub(r'\s*:\s*', ':', ' '.join(sel.split())),)))
            else:
                out.append((sel, body, anc))
            i, start = j, j
        elif c == '}':
            i += 1; start = i
        else:
            i += 1
    return out

ALL = rules(css)
def decls(body): return {d.strip() for d in body.split(';') if d.strip()}

# Stated in FULL. Values a reviewer would otherwise "tidy": `.crumbs a` colour is
# --muted NOT --primary (the global `a` colour is what it exists to override, and
# the :hover rule re-asserts the underline because the scoped rule out-specifies
# the global one); `.next-title` max-width is 22ch, the only thing bounding the
# footer button; `.strip` margin-bottom 20px is ref 2112; `.counter` is 12.5px
# because it is a POSITIONAL counter, not a ratio.
W = '.%s' % h
WANT = [
    ('.page' + W, 'max-width:960px;margin:0 auto;padding:var(--space-3)'),
    # Student-view follow-up (user, 2026-10-08): the crumb trail ends with the
    # sequence title in bold 14px and the visible h1 is gone -- `baseline` keeps
    # the 12.5px crumbs from sitting low beside it; 14px is the gap the h1 left.
    ('.crumbs' + W,
     'display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;font-size:12.5px;'
     'color:var(--muted);margin-bottom:14px'),
    ('.crumbs%s a:where(%s)' % (W, W), 'color:var(--muted);text-decoration:none'),
    ('.crumbs%s a:where(%s):hover' % (W, W), 'color:var(--text);text-decoration:underline'),
    ('.crumbs%s .sep:where(%s)' % (W, W), 'color:var(--faint)'),
    ('.crumbs%s .current:where(%s)' % (W, W), 'color:var(--text);font-size:14px;font-weight:600'),
    # The h1 stays for screen-reader heading navigation, visually hidden -- the
    # same rule VersionsPage carries (no global class exists).
    ('.sr-only' + W,
     'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;'
     'clip-path:inset(50%);white-space:nowrap;border:0'),
    ('.strip' + W,
     'display:flex;gap:6px;padding:0 0 14px;margin-bottom:20px;'
     'border-bottom:1px solid var(--border);align-items:center;flex-wrap:wrap'),
    ('.counter' + W, 'margin-left:auto;font-family:var(--font-mono);font-size:12.5px;color:var(--muted)'),
    ('.content' + W, 'padding:0;min-height:200px'),
    ('footer' + W,
     'display:flex;justify-content:space-between;align-items:center;'
     'margin-top:24px;padding-top:14px;border-top:1px solid var(--border)'),
    ('.next-label' + W, 'white-space:nowrap;min-width:0'),
    ('.next-title' + W,
     'display:inline-block;max-width:22ch;overflow:hidden;text-overflow:ellipsis;'
     'white-space:nowrap;vertical-align:bottom'),
]

got = sorted((' >> '.join(a), s) for s, b, a in ALL if h in s)
exp = sorted(('', s) for s, _ in WANT)
if got != exp:
    bad = 1
    print('FAIL  SequencePlayer rule inventory differs (at-rules and selector lists included)')
    cg, ce = Counter(got), Counter(exp)
    for k in sorted((cg - ce).elements()): print('        unexpected: %s %s' % k)
    for k in sorted((ce - cg).elements()): print('        missing:    %s %s' % k)
else:
    print('PASS  SequencePlayer compiles to exactly its %d rule(s) — no duplicate, no stray '
          'at-rule, no selector list' % len(WANT))
    index = {s: b for s, b, a in ALL if h in s and not a}
    off = 0
    for sel, wb in WANT:
        have, wantd = decls(index[sel]), decls(wb)
        if have != wantd:
            bad = 1; off += 1
            print('FAIL  SequencePlayer %s declarations differ' % sel)
            print('        extra:   %s' % sorted(have - wantd))
            print('        missing: %s' % sorted(wantd - have))
    if not off:
        print('PASS  SequencePlayer declares exactly the pinned set in every rule — nothing '
              'added, nothing dropped')

sys.exit(bad)
T1EOF
  [[ $? -eq 0 ]] || fail=1
fi

# --- (n) T2: SingleChoiceQuestion / MultiChoiceQuestion ---------------------
# WHY THIS EXISTS (whole-branch review C1): T2 shipped with NO gate section
# either, and it is the slice's largest CSS surface -- the whole D2 reveal
# system. The second lane proved two escapes with the gate at ALL PASS and 1349
# tests green: retokenising `.opt.reveal-wrong` from --status-rejected-* to the
# accepted pair (a wrong answer painted GREEN), and moving `.opt.selected` after
# the three evaluative reveal rules, which is invisible to any declaration-set
# check because the declarations are unchanged -- only the cascade moves.
#
# The two components differ in EXACTLY three rules, so they are pinned as one
# shared spec plus a named divergence set, and the gate asserts the divergence
# set itself. Applying a drift to one component only is what that catches: it
# lands as either an unexpected divergence or a missing one.
echo
echo "--- (n) T2 choice questions (Single / Multi) ---"
opth=(${(f)"$(grep -ohE '\.opt\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
doth=(${(f)"$(grep -ohE '\.dot:where\(\.svelte-[a-z0-9]+\)' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
dotsrc=(${(f)"$(grep -rlE '^[[:space:]]*\.ctl[[:space:]]+\.dot[[:space:]]*\{' src --include='*.svelte')"})
# `.dot` proves which hash is Single. NOTHING proved the other one was Multi:
# with the Multi rules deleted and any third component authoring `.opt`, the
# count would still be 2 and this section would grade that component against
# Multi pins (codex, close-out round 1). Naming both source owners closes it.
optsrc=(${(f)"$(grep -rlE '^[[:space:]]*\.opt[[:space:]]*[,{]' src --include='*.svelte')"})
optnames=(${(on)${(f)"$(print -l ${optsrc[@]:t})"}})
if [[ ${#opth[@]} -ne 2 ]]; then
  echo "FAIL  expected exactly 2 components to compile a top-level .opt rule, got ${#opth[@]}: $opth"; fail=1
elif [[ "$optnames" != 'MultiChoiceQuestion.svelte SingleChoiceQuestion.svelte' ]]; then
  echo "FAIL  .opt is not authored by exactly the two choice components: $optnames"; fail=1
elif [[ ${#doth[@]} -ne 1 || ${#dotsrc[@]} -ne 1 || ${dotsrc[1]:t} != 'SingleChoiceQuestion.svelte' ]]; then
  # The discriminator. `.dot` is the radio's filled centre and exists ONLY in the
  # single-choice control, so it names which of the two anonymous hashes is
  # which. Both halves are checked: one dist owner, and that owner is the file
  # SingleChoiceQuestion.svelte -- without the second half the hashes could be
  # swapped wholesale and every pin below would still pass, since the spec is
  # shared and the divergences would simply trade places.
  echo "FAIL  .dot discriminator is ambiguous (dist owners=${#doth[@]}: $doth; source owners: $dotsrc)"; fail=1
else
  # Not `${opth[(r)^$sc]}` — the `^` negation needs extendedglob, which this
  # script does not set, so that subscript silently yields an EMPTY string.
  sc=${doth[1]}
  mc=''
  for x in $opth; do [[ $x == $sc ]] || mc=$x; done
  echo "PASS  T2 hashes resolve unambiguously — .opt is authored by exactly the two choice"
  echo "      components and .dot names which is which (Single=$sc, Multi=$mc)"
  python3 - $sc $mc ${CSS[@]} <<'T2EOF'
import re, sys
from collections import Counter
sc, mc = sys.argv[1], sys.argv[2]
css = '\n'.join(open(p).read() for p in sys.argv[3:])
bad = 0

def rules(text, anc=()):
    out, i, start = [], 0, 0
    while i < len(text):
        c = text[i]
        if c == '{':
            sel = text[start:i].rsplit(';', 1)[-1].strip()
            depth, j = 1, i + 1
            while j < len(text) and depth:
                if text[j] == '{': depth += 1
                elif text[j] == '}': depth -= 1
                j += 1
            body = text[i+1:j-1]
            if sel.startswith('@'):
                out.extend(rules(body, anc + (re.sub(r'\s*:\s*', ':', ' '.join(sel.split())),)))
            else:
                out.append((sel, body, anc))
            i, start = j, j
        elif c == '}':
            i += 1; start = i
        else:
            i += 1
    return out

ALL = rules(css)
def decls(body): return {d.strip() for d in body.split(';') if d.strip()}
FC = ('@media (forced-colors:active)',)

def want(h, ctl_radius, selected_ctl, dot):
    """The pinned rule set for ONE choice component.

    Everything here is shared by both; the three parameters ARE the divergence
    set, asserted as such below. Values a reviewer would otherwise 'tidy':

      `.opt` padding is var(--btn-pad-sm), the shared small-control padding, NOT
      a literal -- ref 2126. `border-color: var(--border-strong)`, not --border:
      an option is an interactive target, and the faint line reads as disabled.
      `overflow-wrap: anywhere` on both `.opt` and `.text` is the I2 reflow fix
      (long unbroken option/prompt text used to push the page into horizontal
      scroll); `.text pre { overflow-x: auto; max-width: 100% }` is its
      companion, and `legend { max-width: 100% }` is load-bearing with it --
      a rendered <legend> is shrink-to-fit, so without the cap the legend simply
      grows to the <pre> and the scroller never fires.

      The four reveal ROW rules carry the D2 semantics and are the pins the
      second lane defeated by retokenising: correct = accepted bg + accepted
      border, wrong = REJECTED bg + REJECTED border, missed = accepted bg with a
      DASHED border (the dash is what separates 'you missed this' from 'you got
      this'), neutral = surface-2/muted, deliberately non-evaluative. All four
      set `cursor: default` because the reveal state is not clickable.

      The reveal `.ctl` rules recede to --border-faint so the control stops
      competing with the row tint; `.opt.selected .ctl` re-asserts --primary
      AFTER them, which is the cascade the source-order gate below protects.

      The focus pair is the slice's inset-ring idiom: the visually-hidden input
      has its global glow suppressed (`box-shadow: none`) and the ROW takes the
      ring via :has(), with the forced-colors companion because that mode drops
      box-shadow entirely. `.opt.selected` also outlines in forced-colors --
      there the --primary tint is not rendered, so selection would otherwise be
      invisible; the reveal rows are deliberately NOT outlined (their meaning
      survives via the .mark SVG)."""
    W = '.' + h
    L = [
        ('fieldset' + W, 'border:0;padding:0;margin:0;min-inline-size:0', ()),
        ('legend' + W,
         'display:block;padding:0;margin:0 0 16px;font-size:14.5px;line-height:1.6;'
         'font-weight:400;color:var(--text-2);text-wrap:pretty;max-width:100%', ()),
        ('.text' + W, 'overflow-wrap:anywhere', ()),
        ('.text%s pre' % W, 'overflow-x:auto;max-width:100%', ()),
        ('.text%s p' % W, 'margin:0 0 var(--space-2)', ()),
        ('.text%s p:last-child' % W, 'margin:0', ()),
        ('.opts' + W, 'display:flex;flex-direction:column;gap:8px;max-width:480px', ()),
        ('.opt' + W,
         'position:relative;display:flex;align-items:center;gap:10px;'
         'padding:var(--btn-pad-sm);border:1px solid var(--border-strong);'
         'border-radius:var(--radius);background:var(--surface);font-size:14px;'
         'color:var(--text-2);cursor:pointer;overflow-wrap:anywhere', ()),
        ('.opt%s input:where(%s)' % (W, W),
         'position:absolute;width:1px;height:1px;opacity:0;margin:-1px', ()),
        ('.ctl' + W,
         'display:flex;align-items:center;justify-content:center;width:15px;height:15px;'
         'border:1.5px solid var(--border-strong);border-radius:%s;flex:0 0 auto' % ctl_radius, ()),
        ('.mark' + W, 'margin-left:auto;flex:0 0 auto', ()),
        ('.sr-only' + W,
         'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);'
         'white-space:nowrap', ()),
        ('.opt.locked' + W,
         'background:var(--surface-2);color:var(--muted);border-color:var(--border-faint);'
         'cursor:default', ()),
        ('.opt.locked%s .ctl:where(%s)' % (W, W), 'border-color:var(--border-faint)', ()),
        ('.opt.reveal-correct%s .ctl:where(%s),.opt.reveal-missed%s .ctl:where(%s),'
         '.opt.reveal-wrong%s .ctl:where(%s),.opt.reveal-neutral%s .ctl:where(%s)'
         % ((W,) * 8), 'border-color:var(--border-faint)', ()),
        ('.opt.selected' + W,
         'border:1.5px solid var(--primary);background:var(--primary-soft);'
         'font-weight:500;color:var(--text)', ()),
        ('.opt.selected%s .ctl:where(%s)' % (W, W), selected_ctl, ()),
        ('.opt.reveal-correct' + W,
         'background:var(--status-accepted-bg);border-color:var(--status-accepted-fg);'
         'border-width:1.5px;color:var(--text-2);cursor:default', ()),
        ('.opt.reveal-wrong' + W,
         'background:var(--status-rejected-bg);border-color:var(--status-rejected-fg);'
         'border-width:1.5px;color:var(--text-2);cursor:default', ()),
        ('.opt.reveal-missed' + W,
         'background:var(--status-accepted-bg);border:1.5px dashed var(--status-accepted-fg);'
         'color:var(--text-2);cursor:default', ()),
        ('.opt.reveal-neutral' + W,
         'background:var(--surface-2);color:var(--muted);border-color:var(--border-faint);'
         'cursor:default', ()),
        ('.opt.reveal-correct%s .mark:where(%s),.opt.reveal-missed%s .mark:where(%s)'
         % ((W,) * 4), 'color:var(--status-accepted-fg)', ()),
        ('.opt.reveal-wrong%s .mark:where(%s)' % (W, W), 'color:var(--status-rejected-fg)', ()),
        ('.opt%s input:where(%s):focus-visible' % (W, W), 'box-shadow:none', ()),
        ('.opt%s:has(input:where(%s):focus-visible)' % (W, W),
         'box-shadow:inset 0 0 0 2px var(--primary)', ()),
        ('.opt.selected' + W, 'outline:2px solid;outline-offset:-2px', FC),
        ('.opt%s:has(input:where(%s):focus-visible)' % (W, W),
         'outline:2px solid Highlight;outline-offset:-2px', FC),
    ]
    if dot:
        L.insert(11, ('.ctl%s .dot:where(%s)' % (W, W),
                      'width:7px;height:7px;border-radius:50%;background:var(--primary)', ()))
    return L

# The divergence set, stated as three facts rather than three magic arguments:
#   .ctl        -- a radio is round (50%), a checkbox takes the shared --radius.
#   .ctl .dot   -- the radio's filled centre; a checkbox has no such element
#                  (its tick is the .mark SVG), so Multi must NOT compile one.
#   .opt.selected .ctl -- a selected radio only tints its RING (the dot inside
#                  already carries --primary, and filling the ring would hide
#                  it); a selected checkbox FILLS, which is what makes its tick
#                  legible, so it also sets --primary-text on the glyph.
SPECS = [
    ('SingleChoiceQuestion', sc, want(sc, '50%', 'border-color:var(--primary)', True)),
    ('MultiChoiceQuestion',  mc, want(mc, 'var(--radius)',
                                      'background:var(--primary);border-color:var(--primary);'
                                      'color:var(--primary-text)', False)),
]

for name, h, WANT in SPECS:
    got = sorted((' >> '.join(a), s) for s, b, a in ALL if h in s)
    exp = sorted((' >> '.join(a), s) for s, _, a in WANT)
    if got != exp:
        bad = 1
        print('FAIL  %s rule inventory differs (at-rules and selector lists included)' % name)
        cg, ce = Counter(got), Counter(exp)
        for k in sorted((cg - ce).elements()): print('        unexpected: %s %s' % k)
        for k in sorted((ce - cg).elements()): print('        missing:    %s %s' % k)
        continue
    print('PASS  %s compiles to exactly its %d rule(s) — no duplicate, no stray at-rule'
          % (name, len(WANT)))
    index = {(a, s): b for s, b, a in ALL if h in s}
    off = 0
    for sel, wb, anc in WANT:
        have, wantd = decls(index[(anc, sel)]), decls(wb)
        if have != wantd:
            bad = 1; off += 1
            print('FAIL  %s %s%s declarations differ'
                  % (name, (' >> '.join(anc) + ' >> ') if anc else '', sel))
            print('        extra:   %s' % sorted(have - wantd))
            print('        missing: %s' % sorted(wantd - have))
    if not off:
        print('PASS  %s declares exactly the pinned set in every rule — the four reveal row '
              'rules keep their own status tokens' % name)

# The two components must agree everywhere EXCEPT the three rules above. This is
# what catches a drift applied to one component only: it surfaces as an
# unexpected divergence, or -- if a shared rule is edited to match a divergent
# one -- as a missing one.
def norm(h, rs):
    return {(a, s.replace('.' + h, '⟨H⟩')): ';'.join(sorted(decls(b)))
            for s, b, a in rs if h in s}
A, B = norm(sc, ALL), norm(mc, ALL)
diverge = {k for k in set(A) | set(B) if A.get(k) != B.get(k)}
EXPECTED_DIVERGENCE = {
    ((), '.ctl⟨H⟩'),
    ((), '.ctl⟨H⟩ .dot:where(⟨H⟩)'),
    ((), '.opt.selected⟨H⟩ .ctl:where(⟨H⟩)'),
}
if diverge != EXPECTED_DIVERGENCE:
    bad = 1
    print('FAIL  Single/Multi diverge somewhere other than the three control rules')
    for k in sorted(diverge - EXPECTED_DIVERGENCE): print('        unexpected divergence: %s %s' % k)
    for k in sorted(EXPECTED_DIVERGENCE - diverge): print('        no longer divergent:   %s %s' % k)
else:
    print('PASS  Single and Multi agree on every rule except the three control rules — a drift '
          'applied to only one of them cannot pass')

sys.exit(bad)
T2EOF
  [[ $? -eq 0 ]] || fail=1

  # The source-order gate (spec:140). Declaration-set checks above cannot see
  # cascade order at all: moving `.opt.selected` below the three evaluative
  # reveal rules changes NO declaration anywhere and passes every other lane,
  # while a revealed row that the student had selected reverts to the --primary
  # tint and loses its correct/wrong colour entirely. Offsets are compared in
  # the component's own <style> SOURCE, because the compiled sheet is what the
  # bundler emits, not what an author edits.
  python3 - src/components/items/quiz/SingleChoiceQuestion.svelte \
             src/components/items/quiz/MultiChoiceQuestion.svelte <<'T2ORDER'
import re, sys
bad = 0
# `.opt.selected` is authored TWICE — once at top level and once inside the
# forced-colors block — so that block is removed before offsets are taken;
# comments go too, since several of them quote selectors verbatim.
PAIRS = [
    (r'\.opt\.locked\s*\{',                '.opt.locked',
     r'\.opt\.selected\s*\{',              '.opt.selected'),
    (r'\.opt\.reveal-correct\s+\.ctl\s*,', '.opt.reveal-* .ctl (combined recede)',
     r'\.opt\.selected\s+\.ctl\s*\{',      '.opt.selected .ctl'),
    # The fourth relation, and the one the plan Step-5 line does not spell out
    # even though the spec canonical order does (design doc step (3) before step
    # (6)). `.opt.locked .ctl` and `.opt.selected .ctl` BOTH compile to (0,4,0) --
    # `:where()` contributes nothing -- and both apply to the same element in the
    # post-submit pre-reveal window, so ONLY source order decides. Swapped, the
    # student own pick loses its --primary control ring on the score screen: the
    # Single radio ring drops to --border-faint around a floating dot, the Multi
    # box loses its --primary border. Declarations are untouched, so every
    # inventory in this file passes it (reviewer, close-out round 1, reproduced).
    (r'\.opt\.locked\s+\.ctl\s*\{',        '.opt.locked .ctl',
     r'\.opt\.selected\s+\.ctl\s*\{',      '.opt.selected .ctl'),
]
# Spec:140 names the three EVALUATIVE reveal rules; .reveal-neutral is checked
# with them because it is the same row group and equally must not out-cascade
# the selected tint.
for pat, lab in [(r'\.opt\.reveal-%s\s*\{' % k, '.opt.reveal-%s' % k)
                 for k in ('correct', 'wrong', 'missed', 'neutral')]:
    PAIRS.append((r'\.opt\.selected\s*\{', '.opt.selected', pat, lab))

for path in sys.argv[1:]:
    src = open(path).read()
    style = src[src.index('<style>'):]
    style = re.sub(r'/\*.*?\*/', '', style, flags=re.S)
    fc = re.search(r'@media\s*\(forced-colors:\s*active\)\s*\{', style)
    if not fc:
        print('FAIL  %s has no forced-colors block — the order gate cannot isolate the '
              'top-level rules' % path.split('/')[-1]); bad = 1; continue
    style = style[:fc.start()]
    off, dup = {}, []
    for a_pat, a_lab, b_pat, b_lab in PAIRS:
        for pat, lab in ((a_pat, a_lab), (b_pat, b_lab)):
            hits = [m.start() for m in re.finditer(pat, style)]
            if len(hits) != 1:
                dup.append('%s matched %d time(s)' % (lab, len(hits)))
            else:
                off[lab] = hits[0]
    if dup:
        bad = 1
        print('FAIL  %s: order anchors are not unique — %s' % (path.split('/')[-1], '; '.join(sorted(set(dup)))))
        continue
    wrong = ['%s must precede %s' % (a_lab, b_lab)
             for _, a_lab, _, b_lab in PAIRS if off[a_lab] > off[b_lab]]
    if wrong:
        bad = 1
        print('FAIL  %s: authored cascade order is wrong — %s'
              % (path.split('/')[-1], '; '.join(sorted(set(wrong)))))
    else:
        print('PASS  %s authors the D2 cascade in order: .opt.locked and both .ctl recede rules '
              'precede .opt.selected and .opt.selected .ctl, which precede all four '
              '.opt.reveal-* row rules' % path.split('/')[-1])
sys.exit(bad)
T2ORDER
  [[ $? -eq 0 ]] || fail=1
fi

# --- (o) T4: QuizItem shell --------------------------------------------------
# WHY THIS EXISTS (whole-branch review C1): T4 was covered only by section (g)'s
# greps, which pin the `.quiz` measure, the `.q-block` divider and the two
# positional counters — four values out of a twelve-rule component. `.submit-row`,
# `.hint`, `.result`, `.meta` and `.exp` had NO pin at all, so the second lane
# deleted `.result`'s border and background outright (the evaluation panel
# dissolves into the page) and flipped `.exp`'s `border-left` accent to
# `--border`, both under a green gate and 1349 green tests.
#
# Section (g) is kept as-is rather than folded in here: its value is the
# CROSS-component pairings (the two positional counters agreeing at 12.5px, the
# 480px answer-control edge shared with the choice components, `.page-item`
# sharing an EDGE with `.quiz` at a plain 652px), which a single-component
# inventory cannot express. Both places used to call that measure a calc(); T5
# removed the calc and section (g) now rejects it outright (codex, close-out
# round 3).
echo
echo "--- (o) T4 QuizItem shell ---"
owners=(${(f)"$(grep -rlE "^[[:space:]]*\.q-block[[:space:]]*[,{+]" src --include='*.svelte')"})
if [[ ${#owners[@]} -eq 1 && ${owners[1]:t} == 'QuizItem.svelte' ]]; then
  echo "PASS  .q-block is authored as a top-level rule by QuizItem.svelte and nothing else"
else
  echo "FAIL  .q-block owner is not QuizItem.svelte alone (${#owners[@]}: $owners)"; fail=1
fi
qi=(${(f)"$(grep -ohE '\.quiz\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#qi[@]} -ne 1 ]]; then
  echo "FAIL  T4 anchor not dist-unique (.quiz=${#qi[@]}: $qi)"; fail=1
else
  echo "PASS  T4 anchor resolves to one hash (.quiz ${qi[1]})"
  python3 - ${qi[1]} ${CSS[@]} <<'T4EOF'
import re, sys
from collections import Counter
h = sys.argv[1]
css = '\n'.join(open(p).read() for p in sys.argv[2:])
bad = 0

def rules(text, anc=()):
    out, i, start = [], 0, 0
    while i < len(text):
        c = text[i]
        if c == '{':
            sel = text[start:i].rsplit(';', 1)[-1].strip()
            depth, j = 1, i + 1
            while j < len(text) and depth:
                if text[j] == '{': depth += 1
                elif text[j] == '}': depth -= 1
                j += 1
            body = text[i+1:j-1]
            if sel.startswith('@'):
                out.extend(rules(body, anc + (re.sub(r'\s*:\s*', ':', ' '.join(sel.split())),)))
            else:
                out.append((sel, body, anc))
            i, start = j, j
        elif c == '}':
            i += 1; start = i
        else:
            i += 1
    return out

ALL = rules(css)
def decls(body): return {d.strip() for d in body.split(';') if d.strip()}

# Stated in FULL. The values a reviewer would otherwise "tidy":
#
#   `.quiz` max-width is 652px, NOT 68ch. The handoff sets no root font-size, so
#   its `ch` resolves against 16px while this app sets 14px on BODY — an
#   inherit-relative unit therefore shrinks the measure 12.5% here and nowhere in
#   the reference. 652px is that measure expressed absolutely.
#   `align-items: stretch` is load-bearing on a COLUMN flex: without it the
#   children shrink to content and the divider hairline stops spanning the block.
#
#   `.q-block + .q-block` takes `--border`, never `--border-faint` — section (g)
#   states the same pin as a `none` grep, and it is repeated here because this
#   inventory would otherwise accept the swap silently.
#
#   `.result` is a real card (surface-2 + --border + --radius + --space-3), with
#   `align-items: flex-start` so it shrink-wraps its verdict instead of stretching
#   the button inside it, and `margin-top: 0` because the parent's 16px gap owns
#   that step. `.exp` is the opposite treatment — a 3px `--primary` LEFT accent,
#   no full border — which is what distinguishes explanation from verdict.
#
#   `.exp`'s `overflow-wrap: anywhere` and `.exp pre { overflow-x: auto }` are
#   the I2 reflow fix; teacher-authored explanations carry code and URLs, and
#   without the pair a single long token pushed the whole page into horizontal
#   scroll.
#
#   12.5px on `.q-counter`, `.hint` and `.meta` is the positional-counter /
#   secondary-text step (refs 2134, 2122); the 11.5px sibling step is for
#   progress RATIOS and must not appear here.
W = '.%s' % h
WANT = [
    ('.quiz' + W,
     'display:flex;flex-direction:column;gap:16px;align-items:stretch;padding:0;max-width:652px'),
    ('.quiz%s h2:where(%s)' % (W, W), 'font-size:16px;font-weight:600;color:var(--text)'),
    ('.q-block' + W, 'display:flex;flex-direction:column;gap:6px'),
    ('.q-block%s+.q-block:where(%s)' % (W, W),
     'border-top:1px solid var(--border);padding-top:20px'),
    ('.q-counter' + W, 'font-size:12.5px;color:var(--muted)'),
    ('.submit-row' + W, 'display:flex;align-items:center;gap:12px'),
    ('.hint' + W, 'color:var(--muted);font-size:12.5px;margin:0'),
    ('.result' + W,
     'background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);'
     'padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-2);'
     'align-items:flex-start;margin-top:0'),
    ('.meta' + W, 'color:var(--muted);font-size:12.5px'),
    ('.exp' + W,
     'background:var(--surface-2);border-left:3px solid var(--primary);color:var(--text-2);'
     'font-size:13px;padding:8px 10px;margin:0;overflow-wrap:anywhere'),
    ('.exp%s pre' % W, 'overflow-x:auto;max-width:100%'),
]

got = sorted((' >> '.join(a), s) for s, b, a in ALL if h in s)
exp = sorted(('', s) for s, _ in WANT)
if got != exp:
    bad = 1
    print('FAIL  QuizItem rule inventory differs (at-rules and selector lists included)')
    cg, ce = Counter(got), Counter(exp)
    for k in sorted((cg - ce).elements()): print('        unexpected: %s %s' % k)
    for k in sorted((ce - cg).elements()): print('        missing:    %s %s' % k)
else:
    print('PASS  QuizItem compiles to exactly its %d rule(s) — no duplicate, no stray at-rule, '
          'no selector list' % len(WANT))
    index = {s: b for s, b, a in ALL if h in s and not a}
    off = 0
    for sel, wb in WANT:
        have, wantd = decls(index[sel]), decls(wb)
        if have != wantd:
            bad = 1; off += 1
            print('FAIL  QuizItem %s declarations differ' % sel)
            print('        extra:   %s' % sorted(have - wantd))
            print('        missing: %s' % sorted(wantd - have))
    if not off:
        print('PASS  QuizItem declares exactly the pinned set in every rule — .result keeps its '
              'card, .exp keeps its --primary left accent')

sys.exit(bad)
T4EOF
  [[ $? -eq 0 ]] || fail=1
fi

# --- (p) T5: Page / Video / Interactive / Unsupported item bodies ------------
# WHY THIS EXISTS (close-out review, reviewer I-2). Section (h) grades T5 with
# POSITIVE greps only, and a positive grep cannot see an ADDED declaration --
# including a duplicate of one it just matched, which the minifier keeps and the
# cascade resolves last-wins. Appending `flex-direction: row` to `.page-item`
# compiles to
#     .page-item.svelte-1uu0qfr{…flex-direction:column;…;flex-direction:row}
# and (h) still prints `PASS all 3 P/V/I articles carry flex-direction:column`
# while every page, video and interactive item lays its <h2> out BESIDE its body
# -- gate ALL PASS, 1349 tests green (reproduced). That is the same false-pass
# class I3 set out to end, and after this section T5 is no longer the last
# grep-only surface: every (h) target and every (g) target INSIDE THIS SLICE is
# now also covered by a declaration-set inventory. The one grep left standing
# alone is the CourseCard ratio in (g) -- CourseCard is a Slice-2 component with
# no inventory in this file -- and it is hash-anchored there instead. An earlier
# wording here said the escape was dead "everywhere", which was wrong while that
# grep was still unanchored (reviewer, round 3).
echo
echo "--- (p) T5 item bodies ---"
t5ok=1
typeset -A T5H
for spec in 'page-item:PageItem.svelte' 'video-item:VideoItem.svelte' \
            'interactive-app:InteractiveAppItem.svelte' 'unsupported:UnsupportedItem.svelte'; do
  cls=${spec%%:*}; want=${spec#*:}
  own=(${(f)"$(grep -rlE "^[[:space:]]*\.${cls}[[:space:]]*[,{]" src --include='*.svelte')"})
  hh=(${(f)"$(grep -ohE "\.${cls}\.svelte-[a-z0-9]+" $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
  if [[ ${#own[@]} -eq 1 && ${own[1]:t} == $want && ${#hh[@]} -eq 1 ]]; then
    echo "PASS  .${cls} is authored by ${want} alone and resolves to one hash (${hh[1]})"
    T5H[$cls]=${hh[1]}
  else
    echo "FAIL  .${cls} anchor unproven (owners ${#own[@]}: $own; hashes ${#hh[@]}: $hh)"
    fail=1; t5ok=0
  fi
done
if (( t5ok )); then
  python3 - $T5H[page-item] $T5H[video-item] $T5H[interactive-app] $T5H[unsupported] ${CSS[@]} <<'T5EOF'
import re, sys
from collections import Counter
pi, vi, ia, un = sys.argv[1:5]
css = '\n'.join(open(p).read() for p in sys.argv[5:])
bad = 0

def rules(text, anc=()):
    out, i, start = [], 0, 0
    while i < len(text):
        c = text[i]
        if c == '{':
            sel = text[start:i].rsplit(';', 1)[-1].strip()
            depth, j = 1, i + 1
            while j < len(text) and depth:
                if text[j] == '{': depth += 1
                elif text[j] == '}': depth -= 1
                j += 1
            body = text[i+1:j-1]
            if sel.startswith('@'):
                out.extend(rules(body, anc + (re.sub(r'\s*:\s*', ':', ' '.join(sel.split())),)))
            else:
                out.append((sel, body, anc))
            i, start = j, j
        elif c == '}':
            i += 1; start = i
        else:
            i += 1
    return out

ALL = rules(css)
def decls(body): return {d.strip() for d in body.split(';') if d.strip()}

# The three article shells are deliberately IDENTICAL apart from the page one
# carrying a measure: `display:flex; flex-direction:column; gap:16px;
# align-items:stretch; padding:0`. That agreement is what section (g) pins
# across components; what it could not pin is that nothing has been ADDED.
SHELL = 'display:flex;flex-direction:column;gap:16px;align-items:stretch;padding:0'
H2 = 'font-size:16px;font-weight:600;color:var(--text)'   # ref 2122, shared with T4
CARD = ('background:var(--surface);border:1px solid var(--border);'
        'border-radius:var(--radius);overflow:hidden')

def spec(name, h, extra):
    W = '.' + h
    return (name, h, [(s.replace('@W@', W), d) for s, d in extra])

SPECS = [
    # `max-width:652px` is the corrected measure -- the handoff sets no root
    # font-size so its `ch` resolves against 16px while this app sets 14px on
    # BODY, and 68ch would silently shrink the measure 12.5% here. `.content`
    # descendants are the `{@html}` body: they are authored `:global(...)` and so
    # carry the hash on the ANCESTOR only, which is what scopes them.
    # `overflow-wrap:anywhere` on `.content` is the I2 reflow fix and is
    # INHERITED by every descendant, which is why no descendant repeats it;
    # `pre` keeps its own `overflow-x:auto` because inheritance cannot help a
    # box that must scroll. `ol>li{list-style:decimal}` is the T5 split that
    # made stored ordered lists render as numbers.
    spec('PageItem', pi, [
        ('.page-item@W@', SHELL + ';max-width:652px'),
        ('.page-item@W@ h2:where(@W@)', H2),
        ('.content@W@', 'overflow-wrap:anywhere;color:var(--text-2)'),
        ('.content@W@ p', 'margin-bottom:var(--space-3);line-height:1.6'),
        ('.content@W@ h1,.content@W@ h2,.content@W@ h3', 'margin:var(--space-4) 0 var(--space-2)'),
        ('.content@W@ h1', 'font-size:21px;font-weight:600;color:var(--text)'),
        ('.content@W@ h2', H2),
        ('.content@W@ h3', 'font-size:14px;font-weight:600;color:var(--text)'),
        ('.content@W@ a', 'color:var(--primary)'),
        ('.content@W@ ul,.content@W@ ol', 'padding-left:var(--space-4);margin-bottom:var(--space-3)'),
        ('.content@W@ ul>li', 'list-style:disc'),
        ('.content@W@ ol>li', 'list-style:decimal'),
        ('.content@W@ code',
         'background:var(--surface-2);padding:2px 4px;border-radius:var(--radius);'
         'font-family:var(--font-mono)'),
        ('.content@W@ pre',
         'background:var(--surface-2);padding:var(--control-pad-textarea);'
         'border-radius:var(--radius);overflow-x:auto'),
        ('.content@W@ pre code', 'padding:0;background:none'),
    ]),
    # No measure on the video and app shells: both wrap a 16:9 frame that owns
    # its own width. `.frame { margin-bottom: 0 }` cancels the shared frame
    # component default so the card clips flush -- with `overflow:hidden` on the
    # card, a residual margin shows as a strip of --surface under the video.
    spec('VideoItem', vi, [
        ('.video-item@W@', SHELL),
        ('.video-item@W@ h2:where(@W@)', H2),
        ('.video-card@W@', CARD),
        ('.video-card@W@ .frame', 'margin-bottom:0'),
        ('.watched@W@',
         'display:inline-flex;align-items:center;gap:6px;color:var(--status-accepted-fg);margin:0'),
    ]),
    spec('InteractiveAppItem', ia, [
        ('.interactive-app@W@', SHELL),
        ('.interactive-app@W@ h2:where(@W@)', H2),
        ('.app-card@W@', CARD),
        ('.app-card@W@ .frame', 'margin-bottom:0'),
        ('.cover-hint@W@', 'font-size:12.5px;color:var(--muted);margin:0'),
        ('.notice@W@', 'color:var(--muted);margin:0'),
    ]),
    # The fallback for an item type this build cannot render. A DASHED border is
    # the point -- it reads as "nothing is here" rather than as a real card.
    spec('UnsupportedItem', un, [
        ('.unsupported@W@',
         'padding:var(--space-3);border:1px dashed var(--border);border-radius:var(--radius);'
         'color:var(--muted)'),
    ]),
]

for name, h, WANT in SPECS:
    got = sorted((' >> '.join(a), s) for s, b, a in ALL if h in s)
    exp = sorted(('', s) for s, _ in WANT)
    if got != exp:
        bad = 1
        print('FAIL  %s rule inventory differs (at-rules and selector lists included)' % name)
        cg, ce = Counter(got), Counter(exp)
        for k in sorted((cg - ce).elements()): print('        unexpected: %s %s' % k)
        for k in sorted((ce - cg).elements()): print('        missing:    %s %s' % k)
        continue
    print('PASS  %s compiles to exactly its %d rule(s) — no duplicate, no stray at-rule' % (name, len(WANT)))
    index = {s: b for s, b, a in ALL if h in s and not a}
    off = 0
    for sel, wb in WANT:
        have, wantd = decls(index[sel]), decls(wb)
        if have != wantd:
            bad = 1; off += 1
            print('FAIL  %s %s declarations differ' % (name, sel))
            print('        extra:   %s' % sorted(have - wantd))
            print('        missing: %s' % sorted(wantd - have))
    if not off:
        print('PASS  %s declares exactly the pinned set in every rule — an APPENDED declaration, '
              'duplicate or not, now reds' % name)

sys.exit(bad)
T5EOF
  [[ $? -eq 0 ]] || fail=1
fi

echo
echo "--- (q) Slice-4 T1 primitives ---"
# ownership: the anchor is authored as a top-level rule by exactly one file
for pair in "Skeleton:skeleton:Skeleton.svelte" "ErrorState:error-state:ErrorState.svelte"; do
  N=${pair%%:*}; rest=${pair#*:}; A=${rest%%:*}; F=${rest##*:}
  owners=(${(f)"$(grep -rlE "^[[:space:]]*\.${A}[[:space:]]*[,{]" src --include='*.svelte')"})
  if [[ ${#owners[@]} -eq 1 && ${owners[1]:t} == $F ]]; then
    echo "PASS  .$A is authored as a top-level rule by $F alone"
  else
    echo "FAIL  .$A owner is not $F alone (${#owners[@]}: $owners)"; fail=1
  fi
done
# .empty-state collides with RunSubmissionTab/RunAssetsTab (spec §Testing), so a
# single-owner grep cannot prove it. Ownership is pinned instead as the EXACT set
# of three authoring files (a fourth author reds), and the dist hash is picked by
# EXCLUDING the two hashes those files own — each identified by an anchor only
# that file authors (`.submission-grid`, `.run-assets-tab`).
emf=(${(f)"$(grep -rlE '^[[:space:]]*\.empty-state[[:space:]]*[,{]' src --include='*.svelte')"})
emo=(${(o)${(@)emf:t}})
if [[ "${(j:,:)emo}" == 'EmptyState.svelte,RunAssetsTab.svelte,RunSubmissionTab.svelte' ]]; then
  echo "PASS  .empty-state is authored by EmptyState.svelte plus exactly the two known run tabs"
else
  echo "FAIL  .empty-state authors are not the three known files (${#emf[@]}: $emo)"; fail=1
fi
# Union cardinality ALONE cannot prove the exclusion set: two hashes would also
# come back if one anchor resolved to two and the other to none, and the set would
# then exclude the wrong component. Each exclusion anchor is therefore proved
# dist-unique on its own FIRST, and the union is checked on top of that (T1 review).
sgh=(${(f)"$(grep -ohE '\.submission-grid\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
rah=(${(f)"$(grep -ohE '\.run-assets-tab\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#sgh[@]} -eq 1 ]]; then
  echo "PASS  .submission-grid resolves to one hash ($sgh)"
else
  echo "FAIL  .submission-grid not dist-unique (${#sgh[@]}: $sgh)"; fail=1
fi
if [[ ${#rah[@]} -eq 1 ]]; then
  echo "PASS  .run-assets-tab resolves to one hash ($rah)"
else
  echo "FAIL  .run-assets-tab not dist-unique (${#rah[@]}: $rah)"; fail=1
fi
xh=(${(f)"$(grep -ohE '\.(submission-grid|run-assets-tab)\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#xh[@]} -eq 2 ]]; then
  echo "PASS  the two colliding run tabs resolve to 2 hashes ($xh) — the exclusion set"
else
  echo "FAIL  the run-tab exclusion set is not 2 hashes (${#xh[@]}: $xh)"; fail=1
fi
sk=(${(f)"$(grep -ohE '\.skeleton\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
es=(${(f)"$(grep -ohE '\.error-state\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
allem=(${(f)"$(grep -ohE '\.empty-state\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
em=(${allem:|xh})
for t in "skeleton:${#sk[@]}:$sk" "error-state:${#es[@]}:$es" "empty-state:${#em[@]}:$em"; do
  a=${t%%:*}; rest=${t#*:}; n=${rest%%:*}
  if [[ $n -eq 1 ]]; then echo "PASS  .$a resolves to one hash (${rest#*:})"; else echo "FAIL  .$a not dist-unique ($n: ${rest#*:})"; fail=1; fi
done
if [[ ${#sk[@]} -eq 1 ]]; then
  N=Skeleton; H=$sk[1]
  d '\.skeleton' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'padding:12px' 'display:flex' 'flex-direction:column' 'gap:9px'
  d '\.row' '' 'display:flex' 'align-items:center' 'gap:12px'
  d '\.bar' '' 'display:block' 'height:13px' 'border-radius:3px' 'background:var\(--border-faint\)'
  d '\.end' '' 'margin-left:auto'
  none "Skeleton has no animation (ref 1345: never a spinner)" "\.(skeleton|row|bar)\.${H}\{[^}]*animation"
fi
if [[ ${#em[@]} -eq 1 ]]; then
  N=EmptyState; H=$em[1]
  d '\.empty-state' '' 'padding:34px 20px' 'align-items:center' 'gap:9px' 'text-align:center' 'border:1px solid var\(--border\)'
  d '\.title' '' 'font-size:14px' 'font-weight:600' 'color:var\(--text\)' 'margin:0'
fi
if [[ ${#es[@]} -eq 1 ]]; then
  N=ErrorState; H=$es[1]
  d '\.error-state' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)'
  d '\.inline' '' 'display:flex' 'align-items:center' 'gap:12px' 'padding:14px 16px' 'border-left:3px solid var\(--danger\)'
  chk "\.inline\.${H} \.body:where\(\.${H}\)"    'gap:3px' 'flex:1' 'min-width:0'
  chk "\.inline\.${H} \.title:where\(\.${H}\)"   'font-size:13px'
  chk "\.inline\.${H} \.message:where\(\.${H}\)" 'font-size:12\.5px' 'overflow-wrap:anywhere'
  d '\.page' '' 'display:flex' 'flex-direction:column' 'align-items:center' 'gap:9px' 'padding:30px 20px' 'text-align:center'
  chk "\.page\.${H} \.body:where\(\.${H}\)"    'align-items:center' 'gap:9px'
  chk "\.page\.${H} \.title:where\(\.${H}\)"   'font-size:14px' 'letter-spacing:0'
  chk "\.page\.${H} \.message:where\(\.${H}\)" 'font-size:13px' 'line-height:1\.5' 'max-width:46ch' 'text-wrap:pretty' 'overflow-wrap:anywhere'
  chk "\.page\.${H} \.action:where\(\.${H}\)"  'margin-top:4px'
  # The leak guard (spec §1.3): the UNQUALIFIED .message / .title / .body rules
  # carry no metric. Paired with the positives above on the same hash.
  # BOTH ends of the anchor allow a `,`: the minifier emits a merged selector
  # LIST (`.title.H,.message.H{…}`) whenever two rules end up with the same
  # declaration block, and the original `(^|\})…\{` form walked straight past it
  # (T1 review). The left `[},]` covers the compound sitting LAST in such a list,
  # the right `[,{]` the compound sitting first — mutation-testing merged the two
  # rules and showed the left fix alone still let `.title` pass vacuously. `[^}]*`
  # cannot cross a closing brace, so the scan stays inside the one rule.
  # The left class also admits `{`: an @media/@supports-wrapped duplicate opens
  # with the at-block's own `{` (`@media (min-width:1px){.message.H{font-size:…}}`),
  # and the primitives have NO parsed rule inventory in this script, so nothing
  # else would see it (T2 codex round 1 — the earlier comment claimed otherwise).
  none "ErrorState unqualified .message has no font-size" "(^|[{},])\.message\.${H}[,{][^}]*font-size:"
  none "ErrorState unqualified .body has no gap"          "(^|[{},])\.body\.${H}[,{][^}]*gap:"
  none "ErrorState unqualified .title has no font-size"   "(^|[{},])\.title\.${H}[,{][^}]*font-size:"
fi

echo
echo "--- (r) Slice-4 T2 student-page adoption ---"
# The four scoped `.empty` rules and CourseList's `.error` are gone (spec §2);
# a surviving one would be a css_unused_selector warning AND a stray rule.
for f in src/pages/CourseList.svelte src/pages/CourseView.svelte src/pages/SequencePlayer.svelte src/components/items/QuizItem.svelte; do
  if sed 's#/\*.*\*/##g' "$f" | grep -qE '^[[:space:]]*\.(empty|error)[[:space:]]*\{'; then
    echo "FAIL  $f still authors a .empty/.error rule"; fail=1
  else
    echo "PASS  ${f:t} no longer authors .empty/.error"
  fi
  # `ui/Spinner\.svelte`, not `components/ui/...`: QuizItem sits in components/items
  # and would import it as `../ui/Spinner.svelte`, which the longer prefix cannot see —
  # the check would have been vacuous on one of the four files (mutation-testing found it).
  if grep -qE "ui/Spinner\.svelte" "$f"; then
    echo "FAIL  $f still imports Spinner"; fail=1
  else
    echo "PASS  ${f:t} does not import Spinner"
  fi
done
# The ← glyph left SequencePlayer's error actions (enumerated 12). CourseView's
# `← Courses` text button became the admin round back button (student-view
# follow-up 2, user 2026-10-08), so its text form must be gone.
if sed 's#<!--.*-->##g' src/pages/SequencePlayer.svelte | grep -qE '← Course<'; then
  echo "FAIL  SequencePlayer still renders '← Course'"; fail=1
else
  echo "PASS  SequencePlayer error actions read 'Back to course'"
fi
# perl -0 strips MULTI-line HTML comments too (a line-based sed let a commented-out
# button inside `<!--\n…\n-->` keep the guard green — T2 codex round 2).
cv=$(perl -0pe 's/<!--.*?-->//gs' src/pages/CourseView.svelte)
if print -r -- "$cv" | grep -qF '<IconButton round glyph="back" title="Back to courses" onclick={() => navigate('"'"'/courses'"'"')} />' \
   && ! print -r -- "$cv" | grep -qF '← Courses'; then
  echo "PASS  CourseView header is the admin round back button, no '← Courses' text"
else
  echo "FAIL  CourseView header back control is not the pinned round back button"; fail=1
fi
# Collapse / expand all (user, 2026-10-08): ONE quiet control over every block,
# the shared ghost Button (no hand-rolled button styling), and it is the FIRST
# child of `.all-toggle` (matched across the two lines, not just both present).
if [[ $(print -r -- "$cv" | grep -cF '<Button variant="ghost" onclick={() => setAll(!anyOpen)}>{anyOpen ? '"'"'Collapse all'"'"' : '"'"'Expand all'"'"'}</Button>') -eq 1 ]] \
   && print -r -- "$cv" | perl -0ne 'exit(m{<div class="all-toggle">\s*<Button variant="ghost" onclick=\{\(\) => setAll\(!anyOpen\)\}>} ? 0 : 1)'; then
  echo "PASS  CourseView collapse/expand-all is the one ghost Button inside .all-toggle"
else
  echo "FAIL  CourseView collapse/expand-all control is not the pinned ghost Button"; fail=1
fi

echo
echo "--- (s) Slice-4 T3 mini-project page (frame, header, assignment, group, history) ---"
owners=(${(f)"$(grep -rlE '^[[:space:]]*\.history-entry-header[[:space:]]*[,{]' src --include='*.svelte')"})
if [[ ${#owners[@]} -eq 1 && ${owners[1]:t} == 'MiniProjectDetailPage.svelte' ]]; then
  echo "PASS  .history-entry-header is authored by MiniProjectDetailPage.svelte alone"
else
  echo "FAIL  .history-entry-header owner is not MiniProjectDetailPage.svelte alone (${#owners[@]}: $owners)"; fail=1
fi
mp=(${(f)"$(grep -ohE '\.history-entry-header\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#mp[@]} -ne 1 ]]; then
  echo "FAIL  MP anchor not dist-unique (${#mp[@]}: $mp)"; fail=1
else
  echo "PASS  MP page resolves to one hash ($mp[1])"
  N=MP; H=$mp[1]
  d '\.page' '' 'max-width:800px' 'padding:18px 20px 24px'
  d '\.breadcrumb' '' 'gap:8px' 'font-size:12\.5px' 'color:var\(--muted\)' 'margin-bottom:10px' 'flex-wrap:wrap'
  chk "\.breadcrumb\.${H} a:where\(\.${H}\)"        'color:var\(--muted\)' 'min-width:0' 'overflow-wrap:anywhere'
  chk "\.breadcrumb\.${H} \.sep:where\(\.${H}\)"     'color:var\(--faint\)'
  chk "\.breadcrumb\.${H} \.current:where\(\.${H}\)" 'color:var\(--text\)' 'min-width:0' 'overflow-wrap:anywhere'
  d '\.title-row' '' 'gap:12px' 'margin-bottom:6px' 'flex-wrap:wrap'
  chk "\.title-row\.${H} h1:where\(\.${H}\)" 'flex:1' 'min-width:0' 'overflow-wrap:anywhere'
  d '\.deadlines' '' 'gap:14px' 'margin-bottom:18px' 'flex-wrap:wrap'
  d '\.deadline' '' 'font-size:12\.5px' 'color:var\(--muted\)' 'margin:0'
  d '\.deadline-resub' '' 'color:var\(--status-needs-revision-fg\)'
  d '\.deadline-soft' '' 'font-size:11\.5px'
  d '\.assignment' '' 'padding:16px 18px' 'margin-bottom:14px' 'border:1px solid var\(--border\)'
  chk "\.assignment\.${H} h2:where\(\.${H}\)" 'font-size:14px' 'margin:0 0 8px'
  d '\.assignment-html' '' 'overflow-wrap:anywhere'
  chk "\.assignment-html\.${H} p"            'font-size:14px' 'line-height:1\.65' 'color:var\(--text-2\)' 'margin:0 0 10px'
  chk "\.assignment-html\.${H} p:last-child" 'margin-bottom:0'
  chk "\.assignment-html\.${H} a"            'color:var\(--primary\)'
  chk "\.assignment-html\.${H} ul>li"        'list-style:disc'
  chk "\.assignment-html\.${H} ol>li"        'list-style:decimal'
  chk "\.assignment-html\.${H} code"         'font-family:var\(--font-mono\)'
  d '\.grid2' '' 'display:grid' 'grid-template-columns:repeat\(auto-fit,minmax\(min\(280px,100%\),1fr\)\)' 'gap:14px' 'margin-bottom:14px'
  chk "\.group-block\.${H},\.submit-block\.${H}"  'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'padding:14px 16px'
  chk "\.group-block\.${H} h2:where\(\.${H}\),\.submit-block\.${H} h2:where\(\.${H}\)" 'font-size:13px' 'margin:0 0 8px'
  d '\.members' '' 'font-size:13px' 'line-height:1\.7' 'color:var\(--text-2\)' 'margin:0'
  d '\.group-notice' '' 'font-size:12\.5px' 'color:var\(--text-3\)' 'margin:6px 0 0'
  chk "\.history\.${H} h2:where\(\.${H}\)" 'font-size:14px' 'margin:0 0 10px'
  d '\.history-entry' '' 'overflow:hidden' 'margin-bottom:10px' 'border:1px solid var\(--border\)'
  d '\.history-entry' ':last-child' 'margin-bottom:0'
  chk "\.history-entry-header\.${H} h3:where\(\.${H}\)" 'font-size:13px' 'margin:0'
  d '\.history-entry-header' '' 'gap:9px' 'padding:9px 12px' 'background:var\(--surface-2\)' 'border-bottom:1px solid var\(--border-soft\)' 'flex-wrap:wrap'
  d '\.entry-meta' '' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.pills' '' 'margin-left:auto' 'gap:6px'
  d '\.pill-late' '' 'padding:3px 8px' 'border-radius:var\(--radius-pill\)' 'font-size:11px' 'font-weight:500' 'white-space:nowrap' 'background:var\(--status-not-submitted-bg\)' 'color:var\(--status-not-submitted-fg\)'
  none "MP Late pill is not amber (D3)"    "\.pill-late\.${H}\{[^}]*needs-revision"
  d '\.history-entry-body' '' 'padding:12px' 'gap:10px'
  d '\.file' '' 'gap:9px' 'padding:8px 10px' 'background:var\(--surface-3\)'
  d '\.file-kind' '' 'width:32px' 'height:28px' 'border-radius:4px' 'background:var\(--surface-2\)' 'font-size:9\.5px' 'font-weight:600'
  d '\.dl' '' 'width:24px' 'height:24px' 'border:1px solid var\(--border-strong\)' 'color:var\(--text-3\)'
  d '\.feedback' '' 'border-left:3px solid var\(--border\)' 'padding:2px 0 2px 11px' 'gap:5px'
  d '\.feedback\.needs-revision' '' 'border-color:var\(--status-needs-revision-bg\)'
  d '\.feedback\.rejected' ''       'border-color:var\(--status-rejected-bg\)'
  d '\.feedback\.accepted' ''       'border-color:var\(--status-accepted-bg\)'
  d '\.file-name' '' 'flex:1' 'min-width:0'
  chk "\.file-name\.${H} \.name:where\(\.${H}\)" 'font-size:12\.5px' 'color:var\(--text\)' 'overflow-wrap:anywhere'
  chk "\.file-name\.${H} \.size:where\(\.${H}\)" 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.dl' ':hover' 'text-decoration:none' 'color:var\(--text\)'
  d '\.feedback-meta' '' 'font-size:12\.5px' 'color:var\(--muted\)'
  d '\.feedback-text' '' 'font-size:13px' 'line-height:1\.6' 'color:var\(--text-2\)' 'text-wrap:pretty'
  # Constraint 1/2 deletions — paired with the positives above on the same hash.
  # (The "no hex fallback in var()" none lives in section (t): .banner-error/.banner-info
  #  keep theirs until T4, so it would be red here for a state the spec permits.)
  # The anchor is `(^|[{}])[^{}]*\.${H}[^{]*\{`: ANY selector carrying the MP hash —
  # class-first, element-first (`header.H{`), descendant, list, or at-block-wrapped.
  # The earlier `\.[a-z0-9-]+\.${H}` form needed a leading class and let
  # `header.H{opacity:.7}` through (T3 codex round 1). `[^{}]*` cannot cross a brace,
  # so the scan still starts inside one rule's selector.
  # The value class is DIM values only (`opacity:.7` / `opacity:0.5`), never a bare
  # `opacity:0`: that is the sanctioned sr-only idiom (Global Constraint 2, Login.svelte:137
  # — hiding a still-focusable control, not a disabled treatment), and T4's drop-zone input
  # emits `.drop.H input:where(.H){…opacity:0…}`, which section (t) positively pins. The
  # anchor spans descendant and compound selectors (`[^{]*` before the brace), so a dim on
  # a nested rule or a selector list is caught too — a `\{`-only anchor was not (round-1 review).
  none "MP no opacity dim (group-disabled gone)"     "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*opacity:0?\.[0-9]"
  none "MP no --warning fallback"                    "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*var\(--warning"
  none "MP no .group-disabled rule"                  "\.group-disabled(-notice)?\.${H}"
fi

echo
echo "--- (t) Slice-4 T4 submit card ---"
mp=(${(f)"$(grep -ohE '\.history-entry-header\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#mp[@]} -ne 1 ]]; then
  echo "FAIL  MP anchor not dist-unique (${#mp[@]}: $mp)"; fail=1
else
  N=MP; H=$mp[1]
  d '\.submit-block\.can' '' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  chk "\.submit-block\.can\.${H} h2:where\(\.${H}\)" 'margin-bottom:9px'
  d '\.submit-row' '' 'display:flex' 'align-items:center' 'gap:9px'
  d '\.drop' '' 'position:relative' 'display:flex' 'align-items:center' 'gap:8px' 'flex:1' 'min-width:0' 'border:2px dashed var\(--border-strong\)' 'border-radius:var\(--radius\)' 'padding:4px 9px' 'font-size:12\.5px' 'color:var\(--muted\)' 'cursor:pointer'
  # `.drop > *` — Svelte's scoping of the universal child is not pinned to one emitted form; the
  # child part is absorbed with [^{]*, the .drop half stays hash-exact.
  chk "\.drop\.${H}>[^{]*"                                       'pointer-events:none'
  chk "\.drop\.${H} input:where\(\.${H}\)"                      'position:absolute' 'width:1px' 'height:1px' 'opacity:0' 'margin:-1px'
  chk "\.drop\.has-file\.${H} \.drop-label:where\(\.${H}\)"   'color:var\(--text\)' 'overflow-wrap:anywhere'
  d '\.drop\.dragover' '' 'border-color:var\(--primary\)' 'background:var\(--primary-soft\)'
  chk "\.drop\.${H} input:where\(\.${H}\):focus-visible"        'box-shadow:none'
  chk "\.drop\.${H}:has\(input:where\(\.${H}\):focus-visible\)" 'box-shadow:inset 0 0 0 2px var\(--primary\)'
  FCM="@media \(forced-colors: ?active\)\{(\.[^{]*\{[^}]*\})*"
  chk "${FCM}\.drop\.${H}:has\(input:where\(\.${H}\):focus-visible\)" 'outline:2px solid Highlight' 'outline-offset:-2px'
  chk "${FCM}\.drop\.dragover\.${H}"                                 'outline:2px dashed'
  chk "\.drop\.${H}:has\(input:where\(\.${H}\):disabled\)"    'background:var\(--bg\)' 'border-color:var\(--border-faint\)' 'color:var\(--faint\)' 'cursor:not-allowed'
  none  "MP disabled drop uses no opacity"   "\.drop\.${H}:has\(input:where\(\.${H}\):disabled\)\{[^}]*opacity"
  d '\.submit-error' '' 'margin-top:10px'
  d '\.precondition' '' 'border-left:3px solid var\(--primary\)' 'background:var\(--surface-2\)' 'padding:14px 16px' 'font-size:13px' 'line-height:1\.55' 'color:var\(--text-3\)' 'border-radius:var\(--radius\)'
  # Constraint 1: the last hex fallbacks left with .banner-error/.banner-info (paired with the positives above).
  # Class-name and token-name char classes both admit digits: without them the check cannot see
  # `.grid2{...}` as an anchor nor `var(--surface-2,#hex)` as a fallback, and its own mutation
  # (re-introducing exactly that fallback) stayed green. Deviation from the brief, deliberate.
  none  "MP no hex fallback in var() anywhere" "\.[a-z0-9-]+\.${H}[^{]*\{[^}]*var\(--[a-z0-9-]+,#"
  # Bare hex anywhere in an MP-hashed rule: the MP page has no declaration inventory (unlike the
  # Slice-3 components), so without this a `color:#c33` would be invisible to every other check.
  # Comments never reach dist, so the sweep is on emitted declarations only (whole-branch review).
  # Same selector-agnostic anchor as section (s)'s guards (T3 codex round 1).
  none  "MP no bare hex in any declaration"   "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*:[^};]*#[0-9a-fA-F]{3}"
  none  "MP .banner-error gone"               "\.banner-error\.${H}"
  none  "MP .banner-info gone"                "\.banner-info\.${H}"
  # Old markup must not linger in source either (strip comments first).
  if sed 's#<!--.*-->##g' src/pages/MiniProjectDetailPage.svelte | grep -qE 'mp-submit-btn|mp-retry-btn|banner-(error|info)'; then
    echo "FAIL  MiniProjectDetailPage.svelte still references mp-submit-btn / mp-retry-btn / banner-*"; fail=1
  else
    echo "PASS  MiniProjectDetailPage.svelte carries no pre-Slice-4 submit seams"
  fi
fi

echo
echo "--- (u) Slice-5a T2 — IconButton, EmptyState additions, VersionBadges, VersionsPage (3a) ---"
# Slice-5a helpers (used by sections u-z):
# own ANCHOR FILE — ANCHOR is authored as a top-level rule by FILE alone.
own() {
  local owners=(${(f)"$(grep -rlE "^[[:space:]]*\.${1}[[:space:]]*[,{.:]" src --include='*.svelte')"})
  if [[ ${#owners[@]} -eq 1 && ${owners[1]:t} == $2 ]]; then
    echo "PASS  .$1 is authored by $2 alone"
  else
    echo "FAIL  .$1 owner is not $2 alone (${#owners[@]}: $owners)"; fail=1
  fi
}
# uniq1 ANCHOR — ANCHOR resolves to exactly one dist hash; the hash is left in REPLY ('' on failure).
uniq1() {
  local hs=(${(f)"$(grep -ohE "\.${1}\.svelte-[a-z0-9]+" $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
  if [[ ${#hs[@]} -eq 1 ]]; then
    echo "PASS  .$1 resolves to one hash ($hs[1])"; REPLY=$hs[1]
  else
    echo "FAIL  .$1 not dist-unique (${#hs[@]}: $hs)"; fail=1; REPLY=''
  fi
}
# sweep LABEL HASH — Constraints 1/2 over every emitted rule carrying HASH (the
# section-(s)/(t) selector-agnostic anchors): no hex, no var() hex fallback, no opacity dim.
sweep() {
  none "$1 no bare hex in any declaration" "(^|[{}])[^{}]*\.${2}[^{]*\{[^}]*:[^};]*#[0-9a-fA-F]{3}"
  none "$1 no opacity dim"                 "(^|[{}])[^{}]*\.${2}[^{]*\{[^}]*opacity:0?\.[0-9]"
}

own icon-btn IconButton.svelte
uniq1 icon-btn
if [[ -n $REPLY ]]; then
  N=IconButton; H=$REPLY
  d '\.icon-btn' '' 'display:inline-flex' 'border-radius:var\(--radius\)' 'border:1px solid var\(--border-strong\)' 'background:var\(--surface\)' 'color:var\(--muted\)' 'cursor:pointer'
  d '\.sm' '' 'width:var\(--glyph-btn\)' 'height:var\(--glyph-btn\)'
  d '\.md' '' 'width:28px' 'height:28px'
  d '\.danger' '' 'color:var\(--danger\)'
  d '\.borderless' '' 'border-color:transparent' 'background:transparent'
  d '\.round' '' 'border-radius:50%'
  d '\.primary' '' 'background:var\(--primary\)' 'color:var\(--primary-text\)' 'border-color:var\(--primary\)'
  # The disabled rule must outrank .primary/.danger: it carries the extra :disabled pseudo-class.
  d '\.icon-btn' ':disabled' 'background:var\(--bg\)' 'color:var\(--faint\)' 'border-color:var\(--border-faint\)' 'cursor:not-allowed'
  # ...and only while .primary/.danger stay BARE rules: a compound (`.icon-btn.primary`) or any
  # pseudo/suffix form would reach (0,3,0) and could out-cascade the :disabled rule.
  none "IconButton .primary/.danger are emitted only as bare rules (so :disabled outranks them)" "[^{},]\.(primary|danger)\.${H}|\.(primary|danger)\.${H}[^{]"
  sweep IconButton $H
fi

# EmptyState: the hash section (q) derived (allem minus the run-tab exclusion set xh).
emh=(${allem:|xh})
if [[ ${#emh[@]} -eq 1 ]]; then
  N=EmptyState; H=$emh[1]
  d '\.tile' '' 'display:flex' 'width:38px' 'height:38px' 'border-radius:8px' 'background:var\(--surface-2\)' 'border:1px solid var\(--border\)' 'color:var\(--muted\)'
  chk "\.tile\.${H} svg:where\(\.${H}\)" 'width:18px' 'height:18px'
  d '\.hint' '' 'margin:0' 'font-size:13px' 'line-height:1\.5' 'max-width:44ch' 'color:var\(--muted\)'
  d '\.action' '' 'margin-top:4px'
  sweep EmptyState $H
else
  echo "FAIL  EmptyState hash not derivable for the Slice-5a additions (${#emh[@]}: $emh)"; fail=1
fi

own vbadge VersionBadges.svelte
uniq1 vbadge
if [[ -n $REPLY ]]; then
  N=VersionBadges; H=$REPLY
  d '\.vbadges' '' 'display:inline-flex' 'gap:6px'
  d '\.vbadge' '' 'font-size:11px' 'font-weight:500' 'padding:3px 8px' 'border-radius:3px' 'white-space:nowrap'
  # 5c T5: the heading's outlined badges (visible on the shaded page).
  d '\.vbadge\.outlined' '' 'border:1px solid var\(--focus-line\)'
  d '\.created' '' 'background:var\(--state-created-bg\)' 'color:var\(--state-created-fg\)'
  d '\.published' '' 'background:var\(--state-published-bg\)' 'color:var\(--state-published-fg\)'
  d '\.archived' '' 'background:var\(--state-archived-bg\)' 'color:var\(--state-archived-fg\)'
  d '\.off' '' 'background:var\(--state-disabled-bg\)' 'color:var\(--state-disabled-fg\)'
  sweep VersionBadges $H
fi

own vlist VersionsPage.svelte
uniq1 vlist
if [[ -n $REPLY ]]; then
  N=VersionsPage; H=$REPLY
  d '\.heading' '' 'display:flex' 'align-items:center' 'gap:10px' 'margin-bottom:16px'
  # 5c follow-up (user, 2026-10-08): the version page's 18px title, the count as
  # its .hchip, no visible Versions row; "+ Add version" is the editor's add line.
  chk "\.heading\.${H} h1:where\(\.${H}\)" 'font-size:18px'
  d '\.hchip' '' 'font-size:11px' 'padding:2px 7px' 'border-radius:3px' 'background:var\(--surface-2\)' 'color:var\(--muted\)' 'border:1px solid var\(--focus-line\)'
  d '\.sr-only' '' 'position:absolute' 'width:1px' 'height:1px' 'overflow:hidden' 'clip-path:inset\(50%\)'
  none "VersionsPage has no Versions row (.versions-head / .count / .push)" "\.(versions-head|count|push)\.${H}"
  d '\.add-line' '' 'border:0' 'background:transparent' 'color:var\(--primary\)' 'font-size:14px' 'font-weight:600'
  d '\.add-line' ':disabled' 'color:var\(--muted\)'
  d '\.create' '' 'margin-top:6px' 'border:1px solid var\(--border\)' 'background:var\(--surface\)'
  # 5c follow-up (user, 2026-10-08): the list reads like the block list — separate
  # boxed rows with a 6px gap on the shaded page, not one bordered box.
  d '\.vlist' '' 'list-style:none' 'display:flex' 'flex-direction:column' 'gap:6px'
  none "VersionsPage .vlist is no longer one bordered box" "\.vlist\.${H}\{[^}]*(border|background|overflow):"
  d '\.vrow' '' 'display:flex' 'align-items:center' 'gap:10px' 'padding:9px 12px 9px 14px' \
                'border:1px solid var\(--focus-line\)' 'border-radius:var\(--radius\)' 'background:var\(--focus-0\)'
  none "VersionsPage no list-divider rule (.vlist > li)" "\.vlist\.${H}>li"
  none "VersionsPage rows carry no divider border-bottom" "\.(vrow|dup-row)\.${H}\{[^}]*border-bottom:"
  chk "body:has\(\.page\.${H}\)" 'background:var\(--focus-page\)'
  none "VersionsPage no fully-global body:has(.page) (.page stays scoped)" "body:has\(\.page\)"
  # 5c follow-up (user, 2026-10-08): the label is the row title (the block title's
  # 15px/600), the id a .hchip after it; a disabled version is muted. The label is
  # mandatory (2026-10-08), so there is no "(no label)" placeholder.
  d '\.vtitle' '' 'border:0' 'background:transparent' 'color:var\(--text\)' 'font-size:15px' 'font-weight:600' 'cursor:pointer'
  d '\.vtitle\.off' '' 'color:var\(--muted\)'
  none "VersionsPage has no .untitled placeholder (the label is mandatory)" "\.untitled\.${H}"
  none "VersionsPage has no .vnum / .vlabel (the id is a chip, the label the title)" "\.(vnum|vlabel)\.${H}"
  d '\.badges' '' 'margin-left:auto'
  d '\.slots' '' 'display:flex' 'gap:6px' 'margin-left:22px'
  d '\.dup-row' '' 'padding:9px 12px 9px 14px' 'background:var\(--focus-0\)' \
                   'border:1px solid var\(--focus-line\)' 'border-radius:var\(--radius\)'
  none "VersionsPage pre-Slice-5a .badge rules gone" "\.badge\.${H}"
  sweep VersionsPage $H
fi
if grep -q 'TODO(version-slice)' src/styles/theme-default.css; then
  echo "FAIL  theme-default.css still carries the TODO(version-slice) note (D5)"; fail=1
else
  echo "PASS  theme-default.css TODO(version-slice) note removed (D5)"
fi

echo
echo "--- (v) Slice-5a T3 / 5c T5 — editor heading + banners, version settings modal (3b shell) ---"
# 5c T5 (D12): the Version info card is gone; its fields live in VersionSettingsModal.
if [[ -e src/components/editor/VersionMetaForm.svelte ]] || grep -q 'VersionMetaForm\|meta-card' src/pages/editor/VersionEditPage.svelte; then
  echo "FAIL  VersionEditPage no Version info card (5c T5: VersionSettingsModal)"; fail=1
else
  echo "PASS  VersionEditPage no Version info card (5c T5: VersionSettingsModal)"
fi
own ro VersionSettingsModal.svelte
uniq1 ro
if [[ -n $REPLY ]]; then
  N=VersionSettingsModal; H=$REPLY
  # Tokens only (5c §Process): the 5b item-modal field look, the read-only list.
  d '\.field-label' '' 'color:var\(--muted\)'
  d '\.plain-input' '' 'height:var\(--control-h\)' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'color:var\(--text\)' 'font-size:var\(--control-font\)'
  chk "\.plain-input\.${H}:focus-visible" 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  chk "\.plain-input\[aria-invalid=\"?true\"?\]\.${H}" 'border:1\.5px solid var\(--danger\)'
  d '\.field-err' '' 'color:var\(--danger\)'
  chk "\.ro\.${H} dt:where\(\.${H}\)" 'color:var\(--muted\)'
  chk "\.ro\.${H} dd:where\(\.${H}\)" 'color:var\(--text\)' 'overflow-wrap:anywhere'
  sweep VersionSettingsModal $H
fi

own editor-heading VersionEditPage.svelte
uniq1 editor-heading
if [[ -n $REPLY ]]; then
  N=VersionEditPage; H=$REPLY
  d '\.editor-heading' '' 'display:flex' 'align-items:center' 'gap:10px' 'margin-bottom:18px'
  # 5c T5 (user): the title line a step smaller, the content below it a step larger.
  chk "\.editor-heading\.${H} h1:where\(\.${H}\)" 'font-size:18px'
  chk "\.editor-heading\.${H} a:where\(\.${H}\)"  'color:var\(--primary\)' 'text-decoration:none'
  chk "\.editor-heading\.${H} a:where\(\.${H}\):hover" 'text-decoration:underline'
  d '\.vlabel' '' 'color:var\(--text\)'
  # 5c T5 (user): v{id} and the attempt limit are quiet chips beside the state badge, not mono text.
  d '\.hchip' '' 'font-size:11px' 'background:var\(--surface-2\)' 'color:var\(--muted\)' 'border:1px solid var\(--focus-line\)'
  none "VersionEditPage no mono .vid in the heading (5c T5)" "\.vid\.${H}"
  # 5c T5: the settings ✎ sits at the heading's far right.
  d '\.head-push' '' 'margin-left:auto'
  # 5c T5 (user): non-empty version info, muted, under the heading.
  d '\.vinfo' '' 'font-size:14px' 'color:var\(--muted\)'
  d '\.banner' '' 'padding:8px 12px' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)' 'font-size:14px' 'color:var\(--text\)'
  none "VersionEditPage pre-Slice-5a .state-* badges gone" "\.state-(created|published|archived)\.${H}"
  none "VersionEditPage .banner.err gone"                  "\.banner\.err\.${H}"
  sweep VersionEditPage $H
fi

echo
# add_row_common — the 5c T3 "+ Add …" line and its title row, shared by
# convention (not a component) between VersionEditPage and BlockAccordion
# (N/H set by caller). Tokens only; pixel paddings stay unpinned (5c §Process).
add_row_common() {
  d '\.add-line' '' 'border:0' 'background:transparent' 'color:var\(--primary\)' 'font-size:14px' 'font-weight:600'
  chk "\.add-line\.${H}:disabled" 'color:var\(--muted\)'
  d '\.add-row' '' 'display:flex'
  # Load-bearing layout (review T3): the field fills the row.
  d '\.add-field' '' 'flex:1 1 auto' 'min-width:0'
  d '\.add-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1\.5px solid var\(--primary\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'color:var\(--text\)'
  d '\.add-err' '' 'font-size:12\.5px' 'color:var\(--danger\)'
  none "$N no create-form / interim + rules (5c T3)" "\.(cr-form|cr-actions|field-err|form-err|blocks-tools|body-tools)\.${H}"
}

echo "--- (w) Slice-5a T4 / 5c T1 / 5c T3 — the canvas (focus by depth), + Add block, state-action bar ---"
own state-actions VersionEditPage.svelte
uniq1 state-actions
if [[ -n $REPLY ]]; then
  N=VersionEditPage; H=$REPLY
  # 5c T1: no Blocks card — the list is the page body; the shade is on <body>.
  none "VersionEditPage has no .blocks-card / .card-head (5c T1)" "\.(blocks-card|card-head)\.${H}"
  # The card head's h2 lives on as a visually hidden heading (outline h1 > h2 > h3).
  d '\.sr-only' '' 'position:absolute' 'width:1px' 'height:1px' 'overflow:hidden' 'clip-path:inset\(50%\)'
  # 5c T5 (user): with nothing open the page is one half-step darker, so the white block rows stand out.
  chk "body:has\(\.canvas\.d0\.${H}\)" 'background:var\(--focus-page\)'
  chk "body:has\(\.canvas\.d1\.${H}\)" 'background:var\(--focus-1\)'
  chk "body:has\(\.canvas\.d2\.${H}\)" 'background:var\(--focus-2\)'
  none "VersionEditPage no fully-global body:has() (5c R3: .canvas stays scoped)" "body:has\(\.canvas\.d[012]\)"
  add_row_common
  d '\.blocks-list' '' 'list-style:none' 'padding:0' 'margin:0'
  d '\.state-actions' '' 'display:flex' 'align-items:center' 'gap:10px' 'justify-content:flex-end' 'margin-top:20px' 'padding-top:14px' 'border-top:1px solid var\(--border\)'
  # The pre-T4 rules are gone (old .blocks/.head/.create/.empty, rem font sizes).
  none "VersionEditPage pre-T4 .blocks/.head/.create/.empty rules gone" "\.(blocks|head|create|empty)\.${H}[{ ,:]"
  none "VersionEditPage no rem font sizes"                            "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  sweep VersionEditPage $H
fi
# Source: the state bar uses Button's own variants; Delete is the danger variant.
if grep -qE '<Button variant="danger" disabled=\{busy\} onclick=\{deleteVersion\}>Delete</Button>' src/pages/editor/VersionEditPage.svelte; then
  echo "PASS  VersionEditPage Delete uses Button variant=danger"
else
  echo "FAIL  VersionEditPage Delete uses Button variant=danger"; fail=1
fi

echo
echo "--- (x) Slice-5a T5a / 5c T2 — accordion headers ---"
own acc-row AccordionHeader.svelte
uniq1 acc-row
if [[ -n $REPLY ]]; then
  N=AccordionHeader; H=$REPLY
  # 5c T2: no strip tint and no header edges — the row takes its panel's shade (D1).
  d '\.acc-row' '' 'display:flex' 'align-items:center' 'gap:10px' 'min-height:40px' 'padding:6px 12px'
  none "AccordionHeader no strip background on .block/.seq (5c D1)" "(^|[{}])[^{}]*\.(block|seq)\.${H}\{[^}]*background"
  none "AccordionHeader no border on any .block rule" "(^|[{}])[^{}]*\.block(\.[a-z-]+)*\.${H}[^{]*\{[^}]*border"
  none "AccordionHeader no border on any .seq rule, incl. .seq.open (D10)" "(^|[{}])[^{}]*\.seq(\.[a-z-]+)*\.${H}[^{]*\{[^}]*border"
  none "AccordionHeader .acc-row carries no border" "(^|[{}])[^{}]*\.acc-row(\.[a-z-]+)*\.${H}[^{]*\{[^}]*border"
  d '\.hd' '' 'margin:0' 'flex:1 1 auto' 'min-width:0' 'font:inherit'
  d '\.toggle' '' 'display:flex' 'align-items:center' 'width:100%' 'min-height:28px' 'padding:0' 'border:0' 'background:transparent' 'color:var\(--text\)' 'text-align:left' 'cursor:pointer'
  none "AccordionHeader no hover background on any rule" "(^|[{}])[^{}]*\.${H}[^{]*:hover[^{]*\{[^}]*background"
  # 5c D5: no position code, no slug.
  none "AccordionHeader no .code / .slug rules (5c D5)" "\.(code|slug)\.${H}"
  d '\.title' '' 'font-size:15px' 'font-weight:600'
  chk "\.seq\.${H} \.title:where\(\.${H}\)" 'font-size:14\.5px'
  # User, 2026-10-08: blocks are numbered "1. Title", muted, at the title's size.
  d '\.num' '' 'margin-right:6px' 'font-size:15px' 'font-weight:600' 'color:var\(--ordinal\)' 'font-variant-numeric:tabular-nums'
  d '\.actions' '' 'display:flex' 'align-items:center' 'gap:6px'
  # 5c D8: the inline title field — the open-editor ring, tokens only.
  d '\.title-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)' 'background:var\(--surface\)' 'color:var\(--text\)'
  d '\.err' '' 'font-size:12\.5px' 'color:var\(--danger\)'
  none "AccordionHeader pre-5a .accordion-row gone" "\.accordion-row\.${H}"
  sweep AccordionHeader $H
fi
# Source: the old #f5f5f5 fallback and the ↑/↓ text glyphs are gone.
if grep -qE '#f5f5f5|surface-hover|[↑↓]' src/components/editor/AccordionHeader.svelte; then
  echo "FAIL  AccordionHeader no #f5f5f5 / --surface-hover / ↑↓ text glyphs"; fail=1
else
  echo "PASS  AccordionHeader no #f5f5f5 / --surface-hover / ↑↓ text glyphs"
fi

echo
echo "--- (y) Slice-5a T5b — accordion bodies: inline fields, create forms, delete footers (3b) ---"
# body_common LABEL — the rules BlockAccordion and SequenceAccordion share (N/H set by caller).
body_common() {
  # 5c T2: the title moved into the header (D8), delete into the header (D6).
  none "$N no .fields / .del-footer / .del-text rules (5c T2)" "\.(fields|del-footer|del-text)\.${H}"
  d '\.empty' '' 'margin:0' 'font-size:14px' 'color:var\(--muted\)'
  none "$N pre-5a .meta/.row/.head/.create/.danger rules gone" "\.(meta|row|head|create|danger)\.${H}[{ ,:>]"
  none "$N no rem font sizes"                                "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  sweep $N $H
}

own block-card BlockAccordion.svelte
uniq1 block-card
if [[ -n $REPLY ]]; then
  N=BlockAccordion; H=$REPLY
  d '\.block-card' '' 'border:1px solid var\(--focus-line\)' 'border-radius:var\(--radius\)' 'background:transparent' 'overflow:hidden' 'margin-bottom:6px'
  # 5c T5 (user): a focus-level row is white on the shaded page.
  d '\.block-card\.at-focus' '' 'background:var\(--focus-0\)'
  d '\.block-card\.parent' '' 'background:var\(--focus-1\)'
  d '\.block-card\.focus' '' 'background:var\(--focus-0\)' 'border-color:var\(--focus-line-strong\)' 'box-shadow:var\(--focus-shadow\)'
  d '\.acc-body' '' 'display:flex' 'flex-direction:column' 'gap:10px' 'padding:12px 14px'
  add_row_common
  # .acc-body is a flex column: without this the line stretches full width (review T3).
  d '\.add-line' '' 'align-self:flex-start'
  d '\.seqs-list' '' 'display:flex' 'flex-direction:column' 'gap:10px' 'list-style:none' 'padding:0' 'margin:0'
  body_common
fi

own seq-card SequenceAccordion.svelte
uniq1 seq-card
if [[ -n $REPLY ]]; then
  N=SequenceAccordion; H=$REPLY
  d '\.acc-body' '' 'padding:12px 14px' 'border-top:1px solid var\(--border-soft\)'
  none "SequenceAccordion no Items heading rules (5c T2)" "(\.items-head|h5)\.${H}"
  # "+ Add item" — a text line like + Add block / + Add sequence (user, 5c T3);
  # T4: it opens the New item modal, so the inline create form is gone.
  d '\.add-line' '' 'border:0' 'background:transparent' 'color:var\(--primary\)' 'font-size:14px' 'font-weight:600'
  chk "\.add-line\.${H}:disabled" 'color:var\(--muted\)'
  none "SequenceAccordion no interim + rule (5c T3)" "\.body-tools\.${H}"
  none "SequenceAccordion no inline create-form rules (5c T4: the New item modal)" "\.(cr-form|cr-actions|field-err|form-err)\.${H}"
  # 5c T3: item rows are separate boxes, spaced by the list gap.
  d '\.items-list' '' 'display:flex' 'flex-direction:column' 'gap:4px' 'list-style:none' 'padding:0' 'margin:0'
  none "SequenceAccordion no last-row hairline override (5c T3: rows are boxes)" "last-child>\.item-row"
  # 5c T1 (supersedes 5a D10): the sequence is a panel with its own border —
  # the translucent focus line, stronger when it is the focus.
  d '\.seq-card' '' 'border:1px solid var\(--focus-line\)' 'border-radius:var\(--radius\)' 'background:transparent' 'overflow:hidden'
  d '\.seq-card\.focus' '' 'background:var\(--focus-0\)' 'border-color:var\(--focus-line-strong\)' 'box-shadow:var\(--focus-shadow\)'
  # 5c T5 (user): rows inside an open (white) container are tinted, so they stand out from it.
  d '\.seq-card\.at-focus' '' 'background:var\(--focus-row\)'
  # Selector-agnostic: no OTHER rule authored by SequenceAccordion may draw a
  # full / left / right / bottom border; only `border-top` hairlines are
  # allowed. (No `(^|[{}])` anchor: with grep -o the previous match eats the shared `}`.)
  bad=$(grep -oE "[^{}]*\.${H}[^{}]*\{[^}]*\}" $CSS | grep -vE "^\.seq-card\.${H}\{" | grep -E 'border(-(left|right|bottom))?:[^0]')
  if [[ -z $bad ]]; then echo "PASS  SequenceAccordion: no box / side border outside .seq-card"
  else echo "FAIL  SequenceAccordion: no box / side border outside .seq-card: $bad"; fail=1; fi
  body_common
fi

echo
echo "--- (z) Slice-5a T6 — item rows + item type picker (3b) ---"
own item-row ItemRow.svelte
uniq1 item-row
if [[ -n $REPLY ]]; then
  N=ItemRow; H=$REPLY
  # 5c T3: each row is its own box on the focus panel; no slug (D5).
  d '\.item-row' '' 'display:flex' 'align-items:center' 'gap:10px' 'border:1px solid var\(--focus-line\)' 'border-radius:var\(--radius\)' 'background:var\(--focus-row\)'
  d '\.item-title' '' 'font-size:14px' 'font-weight:600' 'color:var\(--text\)'
  none "ItemRow no .item-slug rule (5c D5)" "\.item-slug\.${H}"
  d '\.sep' '' 'color:var\(--faint\)'
  d '\.q-count' '' 'font-size:13px' 'color:var\(--muted\)'
  d '\.actions' '' 'margin-left:auto' 'display:flex' 'align-items:center' 'gap:6px'
  none "ItemRow pre-5a .glyph rule gone"  "\.glyph\.${H}"
  none "ItemRow no rem font sizes"         "\.[a-z-]+\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  # Selector-agnostic: every rule that colours .sep (bare, descendant, compound) uses --faint.
  # A descendant emits the hash as `:where(.H)`, so both scoping forms count.
  bad=$(grep -oE "[^{}]*\.sep(\.${H}|:where\(\.${H}\))[^{}]*\{[^}]*\}" $CSS | grep -oE '[{;]color:[^;}]*' | grep -v '^.color:var(--faint)$')
  if [[ -z $bad ]]; then echo "PASS  ItemRow: .sep is only ever coloured --faint"
  else echo "FAIL  ItemRow: .sep is only ever coloured --faint: ${(f)bad}"; fail=1; fi
  sweep ItemRow $H
fi

own type-picker ItemTypePicker.svelte
uniq1 type-picker
if [[ -n $REPLY ]]; then
  N=ItemTypePicker; H=$REPLY
  d '\.type-picker' '' 'border:0' 'padding:0' 'margin:0'
  d 'legend' '' 'padding:0' 'margin-bottom:4px' 'font-size:12\.5px' 'color:var\(--muted\)'
  d '\.cards' '' 'display:flex' 'flex-wrap:wrap' 'gap:8px'
  d 'label' '' 'position:relative' 'display:flex' 'align-items:center' 'gap:8px' 'padding:6px 10px' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'font-size:13px' 'cursor:pointer'
  d 'label\.selected' '' 'border-color:var\(--primary\)' 'background:var\(--primary-soft\)'
  # D12 exception: the established inset ring, and the forced-colors block.
  chk "label\.${H}:has\(input:where\(\.${H}\):focus-visible\)" 'box-shadow:inset 0 0 0 2px var\(--primary\)'
  chk "@media \(forced-colors: active\)\{label\.selected\.${H}" 'border:2px solid Highlight'
  chk "label\.selected\.${H}\{border:2px solid Highlight\}label\.${H}:has\(input:where\(\.${H}\):focus-visible\)" 'outline:2px solid Highlight' 'outline-offset:-2px'
  # Constraint 2: the radio stays the sr-only idiom (position + pointer-events), not a dim.
  chk "label\.${H} input:where\(\.${H}\)" 'position:absolute' 'opacity:0' 'pointer-events:none'
  # D12: focus styling only via :focus-visible — selector-agnostic, so a :focus /
  # :focus-within on any selector (label, .cards, a compound or descendant) fails.
  none "ItemTypePicker: focus styling only via :focus-visible (D12)" "[^{}]*\.${H}[^{}]*:focus(-within|[^-])[^{}]*\{"
  # No outline but a Highlight one (the forced-colors block): the inset ring is the
  # only non-forced focus indicator. Per declaration, so a non-Highlight outline
  # cannot ride on a Highlight sibling in the same rule; the longhands count too
  # (outline-offset is geometry, not a ring).
  bad=$(grep -oE "[^{}]*\.${H}[^{}]*\{[^}]*\}" $CSS | grep -oE '[{;]outline(-(style|color|width))?:[^;}]*' | grep -v Highlight)
  if [[ -z $bad ]]; then echo "PASS  ItemTypePicker: no outline outside forced colors (D12)"
  else echo "FAIL  ItemTypePicker: no outline outside forced colors (D12): ${(f)bad}"; fail=1; fi
  none "ItemTypePicker pre-5a .picker/.glyph gone" "\.(picker|glyph)\.${H}"
  sweep ItemTypePicker $H
fi
# Source: no emoji or decorative glyph in either file (Constraint 3) — BSD grep has no -P.
if python3 - <<'PY'
import re, sys
pat = re.compile('[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u25A0-\u25FF\u2318]')
files = ('src/components/editor/ItemRow.svelte', 'src/components/editor/ItemTypePicker.svelte')
sys.exit(1 if any(pat.search(open(f).read()) for f in files) else 0)
PY
then
  echo "PASS  ItemRow / ItemTypePicker carry no emoji"
else
  echo "FAIL  ItemRow / ItemTypePicker carry no emoji"; fail=1
fi

echo
echo "--- (ab) Slice-5b T2 — MarkdownEditor + AssetSidebar (3c) ---"
# Slice-5b helper (sections ab-ag). emoji_scan LABEL FILE... — Constraint 3 over
# source with comments stripped: <!-- -->, /* */, and // when it starts a line or
# follows whitespace (so https:// is not a comment). The arrows block and the
# multiplication sign are in the set: the old quiz controls used them as glyphs.
emoji_scan() {
  local label=$1; shift
  if python3 - "$@" <<'PY'
import re, sys
pat = re.compile('[\U0001F300-\U0001FAFF☀-➿⬀-⯿■-◿←-⇿⌘×＋]')
def strip(s):
    s = re.sub(r'<!--.*?-->', ' ', s, flags=re.S)
    s = re.sub(r'/\*.*?\*/', ' ', s, flags=re.S)
    return re.sub(r'(?m)(^|\s)//.*$', ' ', s)
sys.exit(1 if any(pat.search(strip(open(f).read())) for f in sys.argv[1:]) else 0)
PY
  then echo "PASS  $label carry no emoji or decorative glyphs"
  else echo "FAIL  $label carry no emoji or decorative glyphs"; fail=1; fi
}

own md-card MarkdownEditor.svelte
uniq1 md-card
if [[ -n $REPLY ]]; then
  N=MarkdownEditor; H=$REPLY
  d '\.md-card' '' 'display:flex' 'flex-direction:column' 'overflow:hidden' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)'
  d '\.tabs' '' 'display:flex' 'border-bottom:1px solid var\(--border\)'
  chk "\.tabs\.${H} button:where\(\.${H}\)" 'padding:8px 14px' 'border:0' 'font-size:13px' 'font-weight:400' 'color:var\(--muted\)'
  chk "\.tabs\.${H} button\[aria-pressed=\"?true\"?\]:where\(\.${H}\)" 'background:var\(--surface-2\)' 'font-weight:600' 'color:var\(--text\)'
  chk "\.tabs\.${H} button:where\(\.${H}\):disabled" 'color:var\(--faint\)' 'cursor:not-allowed'
  d 'textarea' '' 'flex:1 1 0' 'min-width:0' 'min-height:230px' 'padding:12px 14px' 'border:0' 'font:13px/1\.7 var\(--font-mono\)' 'color:var\(--text-2\)' 'caret-color:var\(--primary\)' 'resize:vertical'
  d '\.preview' '' 'padding:12px 14px' 'font-size:13px' 'color:var\(--text\)'
  d '\.preview\.err' '' 'color:var\(--danger\)'
  d '\.plain-src' '' 'margin:0' 'padding:12px 14px' 'font:13px/1\.7 var\(--font-mono\)' 'color:var\(--text-2\)' 'white-space:pre-wrap'
  d '\.edit-content\.flash' '' 'box-shadow:inset 0 0 0 2px var\(--danger\)'
  # The `none` prefix (^|[{}])… is selector-agnostic, as in sweep(): it also sees
  # element-led rules (textarea, h3), where the pre-5b literals lived (T2 review).
  none "MarkdownEditor pre-5b .editor root gone"   "\.editor\.${H}[{ ,:.]"
  none "MarkdownEditor no ui-monospace literal"    "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*ui-monospace"
  none "MarkdownEditor no rem font sizes"          "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  sweep MarkdownEditor $H
fi

own asset-sidebar AssetSidebar.svelte
uniq1 asset-sidebar
if [[ -n $REPLY ]]; then
  N=AssetSidebar; H=$REPLY
  d '\.asset-sidebar' '' 'flex:0 0 260px' 'padding:12px' 'border-left:1px solid var\(--border\)' 'background:var\(--surface-3\)' 'display:flex' 'flex-direction:column' 'gap:8px'
  d 'h3' '' 'font-size:12\.5px' 'font-weight:600' 'color:var\(--text\)'
  d '\.hint' '' 'margin:0' 'padding:8px 10px' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)' 'font-size:11\.5px' 'color:var\(--text-3\)'
  d '\.error' '' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--danger\)' 'color:var\(--danger\)'
  d '\.progress' '' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)' 'color:var\(--text-3\)'
  d '\.row' '' 'display:flex' 'align-items:center' 'gap:9px' 'padding:6px 7px' 'border-radius:var\(--radius\)'
  d '\.thumb' '' 'width:32px' 'height:28px' 'border-radius:4px' 'background:var\(--border-soft\)'
  d '\.chip' '' 'font-size:9\.5px' 'font-weight:600' 'color:var\(--muted\)'
  d '\.name' '' 'font-size:12\.5px' 'color:var\(--text\)' 'text-overflow:ellipsis' 'white-space:nowrap'
  d '\.size' '' 'font-size:10\.5px' 'color:var\(--muted\)'
  d '\.used' '' 'padding:3px 8px' 'border-radius:3px' 'background:var\(--status-accepted-bg\)' 'color:var\(--status-accepted-fg\)' 'font-size:11px' 'font-weight:500'
  d '\.drop-zone' '' 'padding:11px 10px' 'border:2px dashed var\(--border-strong\)' 'border-radius:var\(--radius\)' 'font-size:12px' 'color:var\(--muted\)'
  d '\.drop-zone\.disabled' '' 'color:var\(--faint\)' 'border-color:var\(--border-faint\)'
  none "AssetSidebar pre-5b .sidebar/.banner/.trash rules gone" "\.(sidebar|banner|trash)\.${H}[{ ,:.]"
  none "AssetSidebar no rem font sizes"                         "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  sweep AssetSidebar $H
fi
emoji_scan "MarkdownEditor / AssetSidebar" src/components/editor/MarkdownEditor.svelte src/components/editor/AssetSidebar.svelte

echo
echo "--- (aa) Slice-5b T1/T3a — ui/Modal ---"
# Anchored on .modal-panel: three run modals also author .modal-backdrop (R8).
own modal-panel Modal.svelte
uniq1 modal-panel
if [[ -n $REPLY ]]; then
  N=Modal; H=$REPLY
  d '\.modal-backdrop' '' 'position:fixed' 'top:0' 'right:0' 'bottom:0' 'left:0' 'z-index:100' 'display:flex' 'justify-content:center' 'align-items:flex-start' 'padding-top:26px' 'background:color-mix\(in srgb,var\(--text\) 34%,transparent\)' 'backdrop-filter:blur\(1px\)'
  d '\.modal-panel' '' 'width:min\(var\(--modal-w\),100vw - 32px\)' 'max-height:min\(var\(--modal-h\),100vh - 52px\)' 'display:flex' 'flex-direction:column' 'overflow:hidden' 'background:var\(--surface\)' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius-lg\)' 'box-shadow:0 16px 44px #14182338'
  d '\.modal-head' '' 'display:flex' 'align-items:center' 'gap:10px' 'padding:12px 14px 12px 16px' 'border-bottom:1px solid var\(--border\)'
  d '\.modal-body' '' 'flex:1 1 auto' 'min-height:0' 'overflow:auto' 'padding:14px 16px' 'display:flex' 'flex-direction:column' 'gap:12px'
  check "Modal .modal-body > * { flex:0 0 auto }" "\.modal-body\.${H}>\*\{flex:0 0 auto\}"
  d '\.modal-foot' '' 'display:flex' 'align-items:center' 'gap:9px' 'padding:12px 16px' 'border-top:1px solid var\(--border\)' 'background:var\(--surface-3\)'
  # Constraint 11: the ref-1684 shadow is the ONE hex allowed in Modal's rules.
  modal_rules=$(grep -oE "[^{}]*\.${H}[^{]*\{[^}]*\}" $CSS)
  if print -r -- "$modal_rules" | sed 's/box-shadow:0 16px 44px #14182338//g' | grep -qE '#[0-9a-fA-F]{3}'; then
    echo "FAIL  Modal no hex beyond the ref-1684 shadow"; fail=1
  else
    echo "PASS  Modal no hex beyond the ref-1684 shadow"
  fi
  none "Modal no opacity dim"      "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*opacity:0?\.[0-9]"
  none "Modal no rem font sizes"   "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  none "Modal backdrop is not a flat rgba scrim" "\.modal-backdrop\.${H}\{[^}]*background:rgba"
fi
emoji_scan "Modal" src/components/ui/Modal.svelte

echo
echo "--- (ac) Slice-5b T3a — ItemEditorModal (3c header, Title row, footer) ---"
# 5c D11 (source): the context line is the path, not the mono "S1" code.
if grep -qE 'class="mono item-ctx"|· S\{seqIndex\}' src/components/editor/ItemEditorModal.svelte; then
  echo "FAIL  ItemEditorModal context line is the path, not mono S{n} (5c D11)"; fail=1
else
  echo "PASS  ItemEditorModal context line is the path, not mono S{n} (5c D11)"
fi
own item-ctx ItemEditorModal.svelte
uniq1 item-ctx
if [[ -n $REPLY ]]; then
  N=ItemEditorModal; H=$REPLY
  d '\.item-name' '' 'margin:0' 'font-size:15px' 'font-weight:600' 'color:var\(--text\)' 'text-overflow:ellipsis'
  # 5c D11: the path ("Vectors › Linear combinations · item 1 of 2"), not mono.
  d '\.item-ctx' '' 'font-size:12px' 'color:var\(--muted\)' 'white-space:nowrap' 'text-overflow:ellipsis'
  d '\.head-actions' '' 'margin-left:auto' 'display:flex' 'gap:6px'
  d '\.field-row' '' 'display:grid' 'grid-template-columns:132px 1fr' 'align-items:center' 'gap:12px'
  d '\.field-label' '' 'font-size:12\.5px' 'color:var\(--muted\)'
  d '\.plain-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'color:var\(--text\)' 'font-size:var\(--control-font\)' 'caret-color:var\(--primary\)'
  chk "\.plain-input\.${H}:focus-visible" 'outline:none' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  chk "\.plain-input\[aria-invalid=\"?true\"?\]\.${H}" 'border:1\.5px solid var\(--danger\)'
  d '\.field-err' '' 'margin:0' 'font-size:12px' 'color:var\(--danger\)'
  d '\.ro-value' '' 'font-size:13px' 'color:var\(--text\)'
  d '\.ro-note' '' 'margin:0' 'padding:8px 12px' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)' 'font-size:13px' 'color:var\(--text\)'
  d '\.dirty' '' 'flex:1' 'font-size:11\.5px' 'color:var\(--status-needs-revision-fg\)'
  none "ItemEditorModal Title row has no 54px pencil slot (D2)" "\.field-row\.${H}\{[^}]*54px"
  none "ItemEditorModal input padding is the token, not the 5a literal" "\.plain-input\.${H}\{[^}]*padding:0 10px"
  none "ItemEditorModal dirty marker is not --gold-text" "\.dirty\.${H}\{[^}]*--gold-text"
  none "ItemEditorModal no rem font sizes" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  sweep ItemEditorModal $H
fi
emoji_scan "ItemEditorModal / PageBody / itemBody" src/components/editor/ItemEditorModal.svelte src/components/editor/item/PageBody.svelte src/lib/itemBody.ts

echo
echo "--- (ad) Slice-5b T4 — VideoBody card (3e), AppBody (D4), frame heights ---"
own video-preview VideoBody.svelte
uniq1 video-preview
if [[ -n $REPLY ]]; then
  N=VideoBody; H=$REPLY
  d '\.field-row' '' 'display:grid' 'grid-template-columns:132px 1fr' 'align-items:baseline' 'gap:12px'
  d '\.plain-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid var\(--border-strong\)' 'caret-color:var\(--primary\)'
  chk "\.plain-input\.${H}:focus-visible" 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  d '\.field-hint' '' 'font-size:12px' 'color:var\(--muted\)'
  d '\.video-preview' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'overflow:hidden'
  d '\.preview-head' '' 'display:flex' 'align-items:center' 'gap:10px' 'padding:8px 12px' 'background:var\(--surface-2\)' 'border-bottom:1px solid var\(--border\)'
  d '\.preview-title' '' 'flex:1' 'font-size:12\.5px' 'font-weight:600' 'color:var\(--text\)'
  d '\.preview-meta' '' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.preview-area' '' 'height:296px' 'background:var\(--surface-2\)'
  d '\.preview-empty' '' 'height:100%' 'display:flex' 'align-items:center' 'justify-content:center' 'font-size:12px' 'color:var\(--muted\)'
  d '\.preview-foot' '' 'display:flex' 'gap:12px' 'padding:8px 12px' 'border-top:1px solid var\(--border-soft\)' 'background:var\(--surface-3\)'
  d '\.preview-status' '' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.open-link' '' 'margin-left:auto' 'font-size:12\.5px' 'color:var\(--primary\)'
  none "VideoBody preview footer rule is the soft one, not --border" "\.preview-foot\.${H}\{[^}]*border-top:1px solid var\(--border\)[;}]"
  none "VideoBody URL row has no 54px pencil slot (D2)" "\.field-row\.${H}\{[^}]*54px"
  none "VideoBody no rem font sizes" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  sweep VideoBody $H
fi

own app-preview AppBody.svelte
uniq1 app-preview
if [[ -n $REPLY ]]; then
  N=AppBody; H=$REPLY
  d '\.field-row' '' 'display:grid' 'grid-template-columns:132px 1fr' 'align-items:center' 'gap:12px'
  d '\.script-row' '' 'display:flex' 'align-items:center' 'gap:9px'
  d '\.script-name' '' 'font-size:12\.5px' 'color:var\(--text\)' 'text-overflow:ellipsis'
  d '\.app-preview' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'overflow:hidden'
  d '\.preview-head' '' 'display:flex' 'padding:8px 12px' 'background:var\(--surface-2\)' 'border-bottom:1px solid var\(--border\)'
  d '\.preview-area' '' 'height:360px' 'background:var\(--surface-2\)'
  d '\.app-hint' '' 'margin:0' 'padding:8px 10px' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)' 'font-size:11\.5px' 'color:var\(--text-3\)'
  d '\.warnings' '' 'padding:8px 10px' 'background:var\(--surface-2\)' 'border-left:3px solid var\(--primary\)' 'font-size:11\.5px' 'color:var\(--text-3\)'
  d '\.preview-foot' '' 'border-top:1px solid var\(--border-soft\)' 'background:var\(--surface-3\)'
  d '\.blank-hint' '' 'font-size:12px' 'color:var\(--muted\)'
  none "AppBody .notice renamed .app-hint (D4)" "\.notice\.${H}"
  none "AppBody no italic notices" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-style:italic"
  none "AppBody no rem font sizes" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+rem"
  sweep AppBody $H
fi

# R3: the shared frames size themselves when given `height`; the student
# defaults (16:9, 600px) stay. Anchored on each default rule's declarations,
# since both components author `.frame`.
VFH=(${(f)"$(grep -oE '\.frame\.svelte-[a-z0-9]+\{position:relative;padding-bottom:56\.25%' $CSS | grep -oE 'svelte-[a-z0-9]+' | sort -u)"})
IFH=(${(f)"$(grep -oE '\.frame\.svelte-[a-z0-9]+\{width:100%;height:600px' $CSS | grep -oE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#VFH[@]} -eq 1 && ${#IFH[@]} -eq 1 ]]; then
  echo "PASS  VideoFrame and InteractiveFrame defaults resolve to one hash each"
  N=VideoFrame; chk "\.frame\.fixed\.${VFH[1]}" 'padding-bottom:0' 'height:var\(--frame-h\)' 'margin-bottom:0'
  N=InteractiveFrame; chk "\.frame\.fixed\.${IFH[1]}" 'height:var\(--frame-h\)' 'margin-bottom:0'
else
  echo "FAIL  frame defaults not unique (VideoFrame ${#VFH[@]}, InteractiveFrame ${#IFH[@]})"; fail=1
fi
emoji_scan "VideoBody / AppBody / frames" src/components/editor/item/VideoBody.svelte src/components/editor/item/AppBody.svelte src/components/items/VideoFrame.svelte src/components/items/InteractiveFrame.svelte

echo
echo "--- (ae) Slice-5b T6 — quiz look (3f): QuizEditor, QuestionAccordion, OptionRow, QuestionTypePicker ---"
own questions-head QuizEditor.svelte
uniq1 questions-head
if [[ -n $REPLY ]]; then
  N=QuizEditor; H=$REPLY
  d '\.quiz-editor' '' 'display:flex' 'flex-direction:column' 'gap:12px'
  d '\.questions-head' '' 'display:flex' 'align-items:center' 'gap:10px'
  d '\.questions-label' '' 'font-size:12\.5px' 'font-weight:600' 'color:var\(--text\)'
  d '\.q-count' '' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.head-add' '' 'margin-left:auto'
  d '\.questions' '' 'display:flex' 'flex-direction:column' 'gap:12px'
  d '\.add-form' '' 'display:flex' 'flex-direction:column' 'gap:8px'
  d '\.plain-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid var\(--border-strong\)' 'caret-color:var\(--primary\)'
  chk "\.plain-input\.${H}:focus-visible" 'outline:none' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)'
  none "QuizEditor input padding is the token, not the 5a literal" "\.plain-input\.${H}\{[^}]*padding:0 10px"
  none "QuizEditor no em/rem font sizes" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+r?em"
  sweep QuizEditor $H
fi

own q-toggle QuestionAccordion.svelte
uniq1 q-toggle
if [[ -n $REPLY ]]; then
  N=QuestionAccordion; H=$REPLY
  d '\.question' '' 'border:1px solid var\(--border\)' 'border-radius:var\(--radius\)' 'overflow:hidden'
  d '\.q-head' '' 'display:flex' 'align-items:center' 'gap:10px' 'padding:8px 12px' 'background:var\(--surface\)'
  chk "\.question\.expanded\.${H} \.q-head:where\(\.${H}\)" 'background:var\(--surface-2\)' 'border-bottom:1px solid var\(--border\)'
  d '\.q-toggle' '' 'display:flex' 'flex:1' 'min-width:0' 'border:0' 'background:transparent' 'text-align:left' 'cursor:pointer'
  d '\.q-badge' '' 'font-size:11px' 'color:var\(--primary\)'
  d '\.q-title' '' 'font-size:13px' 'font-weight:600' 'color:var\(--text\)'
  d '\.q-type' '' 'font-size:11\.5px' 'color:var\(--muted\)'
  d '\.actions' '' 'display:flex' 'align-items:center' 'gap:6px'
  d '\.body' '' 'padding:12px' 'display:flex' 'flex-direction:column' 'gap:10px'
  d '\.stack' '' 'display:flex' 'flex-direction:column' 'gap:4px'
  d '\.row-label' '' 'font-size:12\.5px' 'color:var\(--muted\)'
  d '\.field-row' '' 'display:grid' 'grid-template-columns:132px 1fr' 'align-items:center' 'gap:12px'
  d '\.opts-head' '' 'display:flex' 'align-items:center' 'gap:10px'
  d '\.opts-label' '' 'width:132px'
  d '\.opts-add' '' 'margin-left:auto'
  d '\.options' '' 'display:flex' 'flex-direction:column' 'gap:6px'
  d '\.plain-input' '' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid var\(--border-strong\)' 'caret-color:var\(--primary\)'
  chk "\.plain-input\[aria-invalid=\"?true\"?\]\.${H}" 'border:1\.5px solid var\(--danger\)'
  none "QuestionAccordion closed header carries no rule (ref 1891: only the open one)" "\.q-head\.${H}\{[^}]*border-bottom"
  none "QuestionAccordion Question/Explanation rows are stacked, not the 132px grid (D23)" "\.stack\.${H}\{[^}]*grid-template-columns"
  none "QuestionAccordion no em/rem font sizes" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+r?em"
  sweep QuestionAccordion $H
fi

own correct-badge OptionRow.svelte
uniq1 correct-badge
if [[ -n $REPLY ]]; then
  N=OptionRow; H=$REPLY
  d '\.option' '' 'display:flex' 'align-items:center' 'gap:10px' 'padding:4px 9px' 'border:1px solid var\(--border\)' 'background:var\(--surface\)' 'border-radius:var\(--radius\)'
  d '\.option\.correct' '' 'border-color:var\(--primary\)' 'background:var\(--primary-soft\)'
  d '\.mark' '' 'width:15px' 'height:15px' 'margin:0' 'accent-color:var\(--primary\)'
  d '\.opt-input' '' 'flex:1' 'height:var\(--control-h\)' 'padding:0 var\(--control-pad-x\)' 'border:1px solid transparent' 'background:transparent' 'color:var\(--text\)' 'font-size:var\(--control-font\)' 'caret-color:var\(--primary\)'
  chk "\.opt-input\.${H}:focus-visible" 'outline:none' 'border:1\.5px solid var\(--primary\)' 'box-shadow:0 0 0 3px var\(--primary-soft\)' 'background:var\(--surface\)'
  d '\.correct-badge' '' 'padding:2px 7px' 'border-radius:3px' 'background:var\(--status-accepted-bg\)' 'color:var\(--status-accepted-fg\)' 'font-size:11px' 'font-weight:500'
  d '\.actions' '' 'display:flex' 'align-items:center' 'gap:6px'
  none "OptionRow plain row is not drawn with the correct border" "\.option\.${H}\{[^}]*border:1px solid var\(--primary\)"
  none "OptionRow no --success / --text-muted leftovers" "\.${H}[^{]*\{[^}]*var\(--(success|text-muted)"
  none "OptionRow no em/rem font sizes" "(^|[{}])[^{}]*\.${H}[^{]*\{[^}]*font-size:[0-9.]+r?em"
  sweep OptionRow $H
fi

own qtype-picker QuestionTypePicker.svelte
uniq1 qtype-picker
if [[ -n $REPLY ]]; then
  N=QuestionTypePicker; H=$REPLY
  d '\.qtype-picker' '' 'border:0' 'padding:0' 'margin:0' 'min-width:0'
  d '\.cards' '' 'display:flex' 'flex-wrap:wrap' 'gap:8px'
  chk "label\.${H}" 'display:flex' 'padding:6px 10px' 'border:1px solid var\(--border-strong\)' 'border-radius:var\(--radius\)' 'background:var\(--surface\)' 'color:var\(--text\)' 'font-size:13px'
  chk "label\.selected\.${H}" 'border-color:var\(--primary\)' 'background:var\(--primary-soft\)'
  none "QuestionTypePicker no --accent / --accent-bg fallbacks" "\.${H}[^{]*\{[^}]*var\(--accent"
  sweep QuestionTypePicker $H
fi
emoji_scan "quiz editor files" src/components/editor/QuizEditor.svelte src/components/editor/QuestionAccordion.svelte src/components/editor/OptionRow.svelte src/components/editor/QuestionTypePicker.svelte

echo
echo "--- (af) Slice-5b T7 — emoji scan over every Slice-5b source file (Constraint 3) ---"
# Every 5b-touched component with CSS, in one list (reused by (ag)).
# MiniProjectModal.svelte is deliberately left out: 5b gave it only T2's one-line
# Escape guard, and Slice 6 restyles it (D21; spec Constraint 11).
FILES_5B=(
  src/components/ui/Modal.svelte
  src/components/editor/MarkdownEditor.svelte src/components/editor/AssetSidebar.svelte
  src/components/editor/ItemEditorModal.svelte src/components/editor/item/PageBody.svelte
  src/components/editor/item/VideoBody.svelte src/components/editor/item/AppBody.svelte
  src/components/items/VideoFrame.svelte src/components/items/InteractiveFrame.svelte
  src/pages/editor/VersionEditPage.svelte src/components/editor/ItemRow.svelte
  src/components/editor/QuizEditor.svelte src/components/editor/QuestionAccordion.svelte
  src/components/editor/OptionRow.svelte src/components/editor/QuestionTypePicker.svelte
  src/pages/MiniProjectDetailPage.svelte src/App.svelte
)
emoji_scan "all Slice-5b source files" $FILES_5B src/components/ui/FocusTrap.svelte src/lib/itemBody.ts src/lib/quizSave.ts \
  src/lib/deriveExpansion.ts src/lib/handleStaleIdFallback.ts src/routes.ts src/stores/currentEditorVersion.svelte.ts

echo
echo "--- (ag) Slice-5b T7 — no literal colour in a 5b-touched CSS context (Constraint 11) ---"
# colour_scan LABEL FILE... — Constraint 11 over the CSS contexts of FILE...
# (shared by (ag) for the 5b files and (ah) for the 5c files; 5c T6).
colour_scan() {
  local label=$1; shift
  python3 - "$label" "$@" <<'AG'
import re, sys
# Constraint 11 (spec §Global Constraints): no literal colour in a CSS context
# of a touched file. CSS contexts = <style> blocks and inline style="…".
LABEL, FILES = sys.argv[1], sys.argv[2:]
NAMED = set('''aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan
darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen
darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite
forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink
indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral
lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue
slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
whitesmoke yellow yellowgreen'''.split())
LIT = re.compile(r'#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])|(?<![\w-])(?:rgba?|hsla?)\(')
# The one Modal literal the spec allows (Constraint 11), compared whitespace-free.
# The backdrop is color-mix(…var(--text)…transparent) — no literal, so no entry.
ALLOWED = {'Modal.svelte': {'box-shadow:0 16px 44px rgba(20,24,35,.22)'.replace(' ', '')}}

def strip_comments(s):
    s = re.sub(r'/\*.*?\*/', ' ', s, flags=re.S)
    s = re.sub(r'<!--.*?-->', ' ', s, flags=re.S)
    return re.sub(r'(?m)^\s*//.*$', ' ', s)   # only a line that STARTS with // (never https://)

def drop_forced_colors(css):
    while True:
        m = re.search(r'@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{', css)
        if not m:
            return css
        i, depth = m.end(), 1
        while i < len(css) and depth:
            depth += {'{': 1, '}': -1}.get(css[i], 0)
            i += 1
        css = css[:m.start()] + css[i:]

def bodies(src):
    out = []
    for m in re.finditer(r'<style[^>]*>(.*?)</style>', src, re.S):
        out += re.findall(r'\{([^{}]*)\}', drop_forced_colors(strip_comments(m.group(1))))
    out += [m.group(1) for m in re.finditer(r'\sstyle="([^"]*)"', src)]
    out += [m.group(1) for m in re.finditer(r"\sstyle='([^']*)'", src)]
    return out

def hits(path):
    name = path.rsplit('/', 1)[-1]
    found = []
    for body in bodies(open(path).read()):
        for decl in body.split(';'):
            if ':' not in decl:
                continue
            prop, val = (x.strip() for x in decl.split(':', 1))
            flat = (prop + ':' + val).replace(' ', '').replace('\n', '')
            if flat in ALLOWED.get(name, set()):
                continue
            # A named colour counts only as a whole value token, never inside var(--…).
            words = re.findall(r'(?<![\w-])[a-zA-Z]+(?![\w-])', re.sub(r'var\(\s*--[\w-]+', ' ', val))
            if LIT.search(val) or any(w.lower() in NAMED for w in words):
                found.append('%s: %s' % (prop, val))
    return found

bad = 0
for p in FILES:
    h = hits(p)
    if h:
        bad = 1
        print('FAIL  %s holds a literal colour in a CSS context: %s' % (p.rsplit('/', 1)[-1], '; '.join(h[:3])))
if not bad:
    print('PASS  no literal colour in any CSS context of the %d %s files (Constraint 11)' % (len(FILES), LABEL))
sys.exit(bad)
AG
  [[ $? -eq 0 ]] || fail=1
}
colour_scan 5b-touched $FILES_5B

echo
echo "--- (ah) Slice-5c T6 — focus tokens, no literal colours, no emoji in 5c files ---"
# Every component Slice 5c touched (T1-T6 and the user's follow-ups).
FILES_5C=(
  src/pages/editor/VersionEditPage.svelte src/pages/editor/VersionsPage.svelte
  src/components/editor/AccordionHeader.svelte src/components/editor/BlockAccordion.svelte
  src/components/editor/SequenceAccordion.svelte src/components/editor/ItemRow.svelte
  src/components/editor/ItemTypePicker.svelte src/components/editor/NewItemModal.svelte
  src/components/editor/VersionSettingsModal.svelte src/components/editor/VersionBadges.svelte
  src/components/editor/ItemEditorModal.svelte src/components/course/BlockGroup.svelte
)
emoji_scan "all Slice-5c files" $FILES_5C
colour_scan 5c-touched $FILES_5C
# Each focus token is defined exactly once in the theme (the shades the 5c CSS reads).
ftok=0
for t in 0 1 2 page row line line-strong shadow; do
  [[ $(grep -cE "^[[:space:]]*--focus-${t}:" src/styles/theme-default.css) -eq 1 ]] || ftok=1
done
if [[ $ftok -eq 0 ]]; then echo "PASS  the eight --focus-* tokens are each defined once in the theme"
else echo "FAIL  the eight --focus-* tokens are each defined once in the theme"; fail=1; fi
# R3 / T1 ruling: the canvas shades <body> through a scoped :has() and the tokens only.
if [[ $(grep -cE ':global\(body\):has\(\.canvas\.d[012]\)[[:space:]]*\{[[:space:]]*background:[[:space:]]*var\(--focus-(page|1|2)\);?[[:space:]]*\}' src/pages/editor/VersionEditPage.svelte) -eq 3 ]]; then
  echo "PASS  the canvas shades the body only through the focus tokens (d0/d1/d2)"
else echo "FAIL  the canvas shades the body only through the focus tokens (d0/d1/d2)"; fail=1; fi
# The focus container's border: one rule each in the block and sequence accordions.
fls=$(cat src/components/editor/BlockAccordion.svelte src/components/editor/SequenceAccordion.svelte | grep -c 'var(--focus-line-strong)')
if [[ $fls -eq 2 ]]; then echo "PASS  the focus panels take --focus-line-strong (block + sequence)"
else echo "FAIL  the focus panels take --focus-line-strong (block + sequence): $fls"; fail=1; fi
# 5c D5: no slug or position-code element in the constructor rows (CSS selectors
# at a line start, or a class attribute; `item.slug` in script is data, not UI).
if grep -qE '^[[:space:]]*\.(slug|code|item-slug)\b|class="[^"]*\b(slug|code|item-slug)\b' \
     src/components/editor/AccordionHeader.svelte src/components/editor/ItemRow.svelte; then
  echo "FAIL  no slug or code badge in the constructor rows (5c D5)"; fail=1
else echo "PASS  no slug or code badge in the constructor rows (5c D5)"; fi

# The summary line is the parent process's (see the re-exec at the top).
exit $fail
