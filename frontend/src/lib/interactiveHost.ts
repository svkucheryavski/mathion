// Builds the sandboxed host document for an interactive app. The app's JS
// SOURCE is INLINED into a classic <script> inside an opaque-origin iframe
// srcdoc (upload-model spec §4/§6). InteractiveFrame is the only caller; this
// module is the sole authority for the CSP + the </script> escaping.

// Neutralize EVERY sequence that could terminate the host <script>. `</script`
// (case-insensitive) is the only such sequence. Insert a backslash after `<`
// while PRESERVING the matched case: `\/`≡`/` inside the string/regex/comment
// literals where such a sequence legally occurs in a bundle, so the code stays
// equivalent. A naive '<\\/script' replacement would lowercase `</SCRIPT>` and
// corrupt a mixed-case literal; a first-occurrence-only .replace is a breakout.
export function escapeScriptClose(source: string): string {
  return source.replace(/<(\/script)/gi, '<\\$1');
}

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-src 'none'; child-src 'none'; " +
  "worker-src 'none'; object-src 'none'";

export function buildAppSrcdoc(scriptSource: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>html,body{margin:0;height:100%}#app-root{width:100%;height:100%}</style>
</head>
<body>
<div id="app-root"></div>
<script>${escapeScriptClose(scriptSource)}</script>
</body>
</html>`;
}
