// Links in authored content (Polish 2 D58, D59). A link to another site, or to
// one of Mathion's own files (/assets/… course files, /api/… run files), opens
// in a new tab, so a student mid-quiz keeps unsubmitted answers. A Mathion
// page, an #anchor, mailto: and tel: stay in the tab.
//
// The test is by origin, not by prefix: a teacher may paste a Mathion address
// from the address bar, and it stays in the tab. The URL parser lowercases the
// scheme, so HTTPS://… is caught, and a //host href resolves to the page's
// scheme and takes the same test. An href that does not parse is left alone.
//
// Trust boundary (F8/L1/M7): the HTML is sanitised server-side (backend
// markdown.py, nh3), which already adds rel="noopener noreferrer"; this sets it
// again as defence in depth. Teachers remain the authoring trust boundary.
// Same-origin file URLs are not rewritten, only opened in a new tab.
export function opensInNewTab(href: string): boolean {
  let u: URL;
  try {
    u = new URL(href, document.baseURI);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.origin !== location.origin) return true;
  return /^\/(assets|api)\//.test(u.pathname);
}

// An attachment factory: `{@attach externalLinks(html)}` on the element that
// renders `{@html html}`. Passing the HTML makes the attachment run again
// whenever the content changes.
export function externalLinks(_html: string) {
  return (el: HTMLElement): void => {
    for (const a of el.querySelectorAll('a[href]')) {
      if (!opensInNewTab(a.getAttribute('href') ?? '')) continue;
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  };
}
