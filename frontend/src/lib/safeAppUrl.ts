// Sanitizer for interactive_app `script_url` before iframing. Wraps
// safeIframeUrl (which gates scheme / host / malformed input) and ADDS a
// mixed-content guard: an http:// app embedded on an https:// page is blocked
// by the browser as mixed content and silently fails to render. Because the
// student player auto-marks coverage on view and a cross-origin iframe load
// failure is NOT detectable from JS, an unrenderable http:// app would
// otherwise be credited as covered (phantom coverage). So we reject http://
// when the page itself is https://, while still allowing http on http dev.
//
// `pageProtocol` defaults to window.location.protocol; it is a parameter so
// unit tests can drive both deployment modes without stubbing window.
import { safeIframeUrl } from './safeIframeUrl';

export function safeAppUrl(
  value: string | null | undefined,
  pageProtocol: string = window.location.protocol,
): string | null {
  const safe = safeIframeUrl(value);
  if (safe === null) return null;
  // safeIframeUrl canonicalizes via `new URL(...).toString()`, so the protocol
  // here is reliably lowercase 'http:' or 'https:'.
  if (new URL(safe).protocol === 'http:' && pageProtocol === 'https:') return null;
  return safe;
}
