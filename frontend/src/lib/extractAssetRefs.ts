// Mirrors backend/mathion/markdown.py (extract_asset_filenames). Pulls
// Markdown image AND link targets via inline regex. Skips http://, https://,
// mailto:, #, // prefixes (case-sensitive — same as backend's tuple-startswith),
// and a root-relative link that is not /assets/ or /api/ (VR-B).
// Query/fragment NOT stripped. Reference-style links NOT extracted. Escaped
// brackets NOT respected (naive). An angle-bracket target is unwrapped and
// backslash escapes are removed (VR-B).
//
// _TITLE matches the optional inline title in three flavors: "double",
// 'single', or (paren) — exactly what backend's _TITLE regex does. The
// title segment is non-capturing; only the target group is captured.

const SKIP_PREFIXES = ['http://', 'https://', 'mailto:', '#', '//'] as const;
const FILE_PATHS = ['/assets/', '/api/'] as const;
const ESCAPE = /\\([!-/:-@[-`{-~])/g;

// Build the title sub-pattern once; reused by both image and link regexes.
const _TITLE = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?`;

const IMG_REF = new RegExp(
  String.raw`!\[[^\]]*\]\(\s*([^)\s]+)` + _TITLE + String.raw`\s*\)`,
  'g',
);

// Negative lookbehind ensures `![...]` isn't double-counted as a link.
const LINK_REF = new RegExp(
  String.raw`(?<!!)\[[^\]]*\]\(\s*([^)\s]+)` + _TITLE + String.raw`\s*\)`,
  'g',
);

function isSkipped(target: string, isLink: boolean): boolean {
  if (SKIP_PREFIXES.some((p) => target.startsWith(p))) return true;
  return isLink && target.startsWith('/') && !FILE_PATHS.some((p) => target.startsWith(p));
}

export function extractAssetRefs(md: string): Set<string> {
  const refs = new Set<string>();
  if (!md) return refs;
  for (const [re, isLink] of [[IMG_REF, false], [LINK_REF, true]] as const) {
    // Reset between calls — module-level /g regexes carry lastIndex.
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(md)) !== null) {
      let target = m[1]!;
      if (target.length > 1 && target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
      target = target.replace(ESCAPE, '$1');
      if (target && !isSkipped(target, isLink)) refs.add(target);
    }
  }
  return refs;
}
