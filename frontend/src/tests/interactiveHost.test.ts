import { it, expect } from 'vitest';
import { escapeScriptClose, buildAppSrcdoc } from '../lib/interactiveHost';

it('escapes EVERY </script>, case-preserving', () => {
  const src = "a</script>b</SCRIPT>c</ScRiPt>d";
  const out = escapeScriptClose(src);
  // No raw closing tag survives (case-insensitive) — none may terminate the host <script>.
  expect(/<\/script/i.test(out)).toBe(false);
  // Case is preserved (a lowercasing replace would corrupt mixed-case string literals).
  expect(out).toContain('<\\/script>');
  expect(out).toContain('<\\/SCRIPT>');
  expect(out).toContain('<\\/ScRiPt>');
});

it('does not alter a source without a closing tag', () => {
  const src = "const x = '<script-ish but not closing>';";
  expect(escapeScriptClose(src)).toBe(src);
});

// The exact CSP the Global Constraints mandate (verbatim). Asserting the whole
// string — not a few substrings — makes a dropped/reordered directive (e.g. a
// missing `worker-src`/`object-src`) FAIL rather than slip through.
const EXPECTED_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-src 'none'; child-src 'none'; " +
  "worker-src 'none'; object-src 'none'";

it('buildAppSrcdoc inlines the escaped source with #app-root and the exact CSP', () => {
  const doc = buildAppSrcdoc("console.log('hi')");
  expect(doc).toContain('id="app-root"');
  expect(doc).toContain("console.log('hi')");
  expect(doc).toContain(`content="${EXPECTED_CSP}"`);  // full policy, verbatim
  expect(doc).not.toContain("'unsafe-eval'");
  // Exactly ONE raw </script> — the host terminator. The app source is escaped,
  // so any </script> it contained cannot appear raw (discriminates a first-
  // occurrence-only / case-lowercasing escape that would leak a second one).
  expect(doc.match(/<\/script/gi)?.length).toBe(1);   // no trailing `>` → also counts a `</script `-style variant
});

it('an app source containing </script> yields exactly one raw terminator', () => {
  const doc = buildAppSrcdoc("var s = '</script><script>evil()</script>';");
  expect(doc.match(/<\/script/gi)?.length).toBe(1);   // no trailing `>` → also counts a `</script `-style variant
});
