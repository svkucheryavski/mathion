// Client-side heuristic scan of an uploaded interactive-app JS file. ADVISORY
// warnings to catch honest packaging mistakes (ES-module entry, missing
// #app-root mount, network calls) — NOT a security control (the sandbox + CSP
// are). String scans are evadable and false-positive-prone, so every hit is a
// non-blocking warning. See the upload-model spec §8.
export function scanAppSource(source: string): string[] {
  const warnings: string[] = [];
  if (/\b(import|export)\b/.test(source)) {
    warnings.push('Looks like an ES module — must be a single classic/IIFE bundle.');
  }
  if (!source.includes('app-root')) {
    warnings.push("Doesn't reference `#app-root` — make sure your app mounts into it.");
  }
  if (/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\(|https?:\/\//.test(source)) {
    warnings.push('Network requests (fetch, XHR, WebSocket, EventSource, beacons) and external/CDN scripts are blocked by the CSP — the app must be self-contained.');
  }
  return warnings;
}
