#!/bin/zsh
# Visual-refresh built-CSS gate — Slice-3 (tasks T1-T7 so far).
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
EXPECTED_CHECKS=185
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
WANT_FULL = [
    ('', '*,*:before,*:after', '8d5d6c83'), ('', '.mono,code,kbd', '84a226e9'),
    ('', ':focus-visible', '1684b043'), ('', ':root', '8872e5cb'),
    ('', 'a', '1cdc0f83'), ('', 'a', '7bb41747'), ('', 'a:hover', '36ec7417'),
    ('', 'body', '6015bdd1'), ('', 'body', '972a896c'), ('', 'button', 'd50dfcde'),
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
# them is guarded automatically instead of silently unguarded.
for _f in ('src/components/course/ItemMark.svelte', 'src/components/course/ItemIcon.svelte',
           'src/components/course/SequenceLink.svelte', 'src/components/course/MiniProjectLink.svelte'):
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

# --- .page-item: the calc() and the padding it adds back ---------------------
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
check "CourseCard .count (a RATIO) still 11.5px" \
      '\.count\.svelte-[a-z0-9]+\{([^}]*;)?font-size:11\.5px[;}]'

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
# .notice and .opts each have TWO rightful authors; everything else must be
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
    # Two rightful authors each: .opts is Single+Multi; .notice is
    # InteractiveAppItem + the out-of-scope InteractiveAppEditor.
    ('option groups',         r'\.opts\.svelte-[a-z0-9]+$', 2),
    ('notices',               r'\.notice\.svelte-[a-z0-9]+$', 2),
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
for want in 'gap:16px' 'padding:0' 'display:flex' 'flex-direction:column' 'align-items:stretch'; do
  n=$(grep -ohE "\.(page-item|video-item|interactive-app)\.svelte-[a-z0-9]+\{[^}]*\}" $CSS \
      | grep -F "$want" | sed 's/{.*//' | sort -u | wc -l | tr -d ' ')
  if [[ $n -eq 3 ]]; then echo "PASS  all 3 P/V/I articles carry $want"
  else echo "FAIL  $want found on $n of 3 P/V/I articles"; fail=1; fi
done
h2n=$(grep -ohE "\.(page-item|video-item|interactive-app)\.svelte-[a-z0-9]+ h2[^}]*font-size:16px" $CSS \
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
# .notice is NOT component-unique: InteractiveAppEditor.svelte authors it too
# (out of scope, and it legitimately keeps its italic). Anchor on the name-unique
# .interactive-app hash, or this judges the wrong component.
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
# (codex-r2-C). The check is an ALLOWLIST — anything not provably style-inert is
# rejected, so `use:`, `{@attach}`, `bind:this`, spreads and `<svelte:element>`
# all red rather than needing to be enumerated as they are invented.
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
// and REDS, which is the point: these two components are small and static, so
// anything new here deserves a human look before the gate keeps vouching for
// them.
//
// SCOPE, stated precisely because the old PASS text overclaimed (codex-r4): this
// is a check on DECLARATIVE markup. It cannot see runtime style mutation — an
// allowed `onpointerenter` (or an OnDirective handler) assigning
// `currentTarget.style.cssText` parses as an ordinary Attribute, leaves the CSS
// inventory untouched, and passes the initial no-style assertions
// because nothing has fired yet. Nor does it traverse the internals of an
// imported Component, so a helper could inject a stylesheet at runtime. Closing that
// would need a rendered-DOM check (a real browser, computed styles after
// interaction), which this slice does not have. What the gate DOES guarantee is
// that neither component styles its DOM declaratively outside its <style> block
// — the actual regression path for the double ring — and that any new markup
// construct or tag reds for review.
// Per FILE, so T6 keeps its tight pin while T7 gets the same protection: a
// construct legitimate in one of these is not thereby legitimate in another.
const BASE = ["Fragment", "Text", "Comment", "ExpressionTag", "RegularElement", "Component", "IfBlock"];
const SPEC = {
  "ItemMark.svelte":        { nodes: BASE,                     tags: ["span", "svg", "line", "polygon", "polyline", "circle"] },
  "ItemIcon.svelte":        { nodes: BASE,                     tags: ["button"] },
  "SequenceLink.svelte":    { nodes: BASE.concat("EachBlock"), tags: ["a", "span"] },
  "MiniProjectLink.svelte": { nodes: BASE,                     tags: ["a", "span"] },
};
const ATTR = new Set(["Attribute", "OnDirective", "ClassDirective"]);
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
  "ItemMark.svelte": ["span:item-mark","svg:","line:","line:","line:","polygon:","polyline:","line:","line:","line:","circle:","circle:","circle:","line:","polygon:"],
  "ItemIcon.svelte": ["button:icon","ItemMark:"],
  "SequenceLink.svelte": ["a:row","span:badge.mono","span:row-title","span:chain","ItemMark:","span:count.mono"],
  "MiniProjectLink.svelte": ["a:row.row-mp","span:row-glyph","ItemMark:","span:row-title","StatusPill:"],
};
// Every non-whitespace LITERAL text node these components emit, as
// `owner-signature:text` in document order. Text inside `{expr}` is not literal
// and never appears here; whitespace between elements trims away. The list is
// short on purpose -- these are marks-and-badges components, so any growth is a
// glyph or a label someone added in markup, which is exactly what T7 removed
// (`✓`) and what a replacement (`★`) would reinstate.
const TEXT = {
  "ItemMark.svelte": [],
  "ItemIcon.svelte": [],
  "SequenceLink.svelte": ["span:badge.mono:S", "span:count.mono:/"],
  "MiniProjectLink.svelte": ["span:row-title:Mini-project:"],
};
for (const f of process.argv.slice(1)) {
  const hits = [];
  const ast = parse(fs.readFileSync(f, "utf8"), { modern: true, filename: f });
  const spec = SPEC[f.split("/").pop()];
  if (!spec) { console.log(`FAIL  ${f} has no entry in SPEC — add one before the gate can vouch for it`); bad = 1; continue; }
  const NODE = new Set(spec.nodes), TAG = new Set(spec.tags);
  const sig = [];
  const txt = [];
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
      case "Comment": case "ExpressionTag": return;
      case "IfBlock": walk(n.consequent, owner); walk(n.alternate, owner); return;
      case "EachBlock": walk(n.body, owner); walk(n.fallback, owner); return;
      case "RegularElement": case "Component": {
        if (n.type === "RegularElement" && !TAG.has(n.name)) hits.push(`unreviewed element <${n.name}>`);
        for (const a of n.attributes || []) {
          const nm = a.name || "";
          if (!ATTR.has(a.type)) hits.push(`<${n.name}> ${a.type} ${nm}`.trim());
          else if (nm.toLowerCase() === "style") hits.push(`<${n.name}> style attribute`);
          else if (nm.startsWith("--")) hits.push(`<${n.name}> CSS-property prop ${nm}`);

        }
        const cls = [];
        for (const a of n.attributes || []) {
          if (a.type === "ClassDirective") cls.push("class:" + a.name);
          else if (a.type === "Attribute" && String(a.name).toLowerCase() === "class") {
            const parts = Array.isArray(a.value) ? a.value : [a.value];
            for (const v of parts) if (v && v.type === "Text") cls.push(...String(v.data).split(/\s+/).filter(Boolean));
          }
        }
        const me = n.name + ":" + cls.join(".");
        sig.push(me);
        walk(n.fragment, me);
        return;
      }
    }
  })(ast.fragment, "");
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
  else console.log(`PASS  ${base} declares no inline styling and no literal text beyond its pinned set`);
}
process.exit(bad);
' src/components/course/ItemMark.svelte src/components/course/ItemIcon.svelte \
  src/components/course/SequenceLink.svelte src/components/course/MiniProjectLink.svelte || fail=1
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
grep -qE '^[[:space:]]*\.chain[[:space:]]*[,{]' src/components/course/SequenceLink.svelte \
  || { echo "FAIL  .chain is not authored as a rule in SequenceLink.svelte"; fail=1 }
grep -qE '^[[:space:]]*\.row-glyph[[:space:]]*[,{]' src/components/course/MiniProjectLink.svelte \
  || { echo "FAIL  .row-glyph is not authored as a rule in MiniProjectLink.svelte"; fail=1 }
for cls in chain row-glyph; do
  owners=(${(f)"$(grep -rlE "^[[:space:]]*\.${cls}[[:space:]]*[,{]" src --include='*.svelte')"})
  if [[ ${#owners[@]} -eq 1 ]]; then
    echo "PASS  .${cls} is authored by exactly one component (${owners[1]:t})"
  else
    echo "FAIL  .${cls} is authored by ${#owners[@]} components: $owners"; fail=1
  fi
done
sq=(${(f)"$(grep -ohE '\.chain\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
mp=(${(f)"$(grep -ohE '\.row-glyph\.svelte-[a-z0-9]+' $CSS | grep -ohE 'svelte-[a-z0-9]+' | sort -u)"})
if [[ ${#sq[@]} -ne 1 || ${#mp[@]} -ne 1 || ${sq[1]} == ${mp[1]} ]]; then
  echo "FAIL  T7 anchors not dist-unique/distinct (.chain=${#sq[@]}: $sq, .row-glyph=${#mp[@]}: $mp)"; fail=1
else
  echo "PASS  T7 anchors resolve to one distinct hash each (.chain ${sq[1]}, .row-glyph ${mp[1]})"
  python3 - ${sq[1]} ${mp[1]} ${CSS[@]} <<'T7EOF'
import sys
sq_h, mp_h = sys.argv[1], sys.argv[2]
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
                out.extend(rules(body, anc + (' '.join(sel.split()),)))
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
ROW   = ('display:flex;align-items:center;gap:10px;padding:8px 12px;'
         'border-bottom:1px solid var(--border-soft);color:var(--text)')
HOVER = 'background:var(--primary-soft);text-decoration:none'
# `flex:1 1 auto`, NOT `flex:1`. The shorthand `flex:1` means basis ZERO, and
# with `.chain` on an auto basis (28n-6 px) the row goes negative past ~24 items
# on a 760px card / ~9 on a 340px one -- at which point flex-grow stops applying
# and the title resolves to 0px with its text across the marks. The auto basis
# shares the shrink instead. A revert to `flex:1` reads as a harmless cleanup in
# review, which is why the basis is pinned here rather than left to the comment.
TITLE = 'flex:1 1 auto;min-width:0;font-size:13.5px;font-weight:600;color:var(--text)'
SPECS = [
    ('SequenceLink', sq_h, [
        ('', '.row.%s' % sq_h, ROW),
        ('', '.row.%s:hover' % sq_h, HOVER),
        # ref 1573 -- the twin of T8a's B{order} badge.
        ('', '.badge.%s' % sq_h,
             'font-size:11px;font-weight:500;color:var(--primary);'
             'background:var(--primary-soft);padding:2px 6px;border-radius:var(--radius-pill)'),
        ('', '.row-title.%s' % sq_h, TITLE),
        # flex-wrap is the long-chain ruling: wrap and grow, no cap, no ellipsis.
        ('', '.chain.%s' % sq_h, 'display:flex;gap:6px;flex-wrap:wrap'),
        # 11.5px because this is a progress RATIO, not a positional counter.
        ('', '.count.%s' % sq_h, 'font-size:11.5px;color:var(--muted)'),
    ]),
    ('MiniProjectLink', mp_h, [
        ('', '.row.%s' % mp_h, ROW),
        ('', '.row.%s:hover' % mp_h, HOVER),
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
        for x in sorted(set(got) - set(exp)): print('        unexpected: %s %s' % x)
        for x in sorted(set(exp) - set(got)): print('        missing:    %s %s' % x)
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
for label, sel in (('.row', '.row.%s'), ('.row-title', '.row-title.%s')):
    a = {k: v for k, v in ((s, b) for s, b, _ in ALL) if k == sel % sq_h}
    b = {k: v for k, v in ((s, b) for s, b, _ in ALL) if k == sel % mp_h}
    if a and b and decls(list(a.values())[0]) == decls(list(b.values())[0]):
        print('PASS  both row kinds declare an identical %s — the list reads as one list' % label)
    else:
        bad = 1
        print('FAIL  the two row kinds disagree on %s' % label)

sys.exit(bad)
T7EOF
  [[ $? -eq 0 ]] || fail=1
fi

# The summary line is the parent process's (see the re-exec at the top).
exit $fail
