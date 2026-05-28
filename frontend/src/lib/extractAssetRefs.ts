// Mirrors backend/mathion/markdown.py:52-68 (extract_asset_filenames). Pulls
// Markdown image AND link targets via inline regex. Skips http://, https://,
// mailto:, # prefixes (case-sensitive — same as backend's tuple-startswith).
// Query/fragment NOT stripped. Reference-style links NOT extracted. Escaped
// brackets NOT respected (naive). Angle-bracket targets captured verbatim.
//
// _TITLE matches the optional inline title in three flavors: "double",
// 'single', or (paren) — exactly what backend's _TITLE regex does. The
// title segment is non-capturing; only the target group is captured.

const SKIP_PREFIXES = ['http://', 'https://', 'mailto:', '#'] as const;

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

function isSkipped(target: string): boolean {
  for (const prefix of SKIP_PREFIXES) {
    if (target.startsWith(prefix)) return true;
  }
  return false;
}

export function extractAssetRefs(md: string): Set<string> {
  const refs = new Set<string>();
  if (!md) return refs;
  for (const re of [IMG_REF, LINK_REF]) {
    // Reset between calls — module-level /g regexes carry lastIndex.
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(md)) !== null) {
      const target = m[1]!;
      if (!isSkipped(target)) refs.add(target);
    }
  }
  return refs;
}
