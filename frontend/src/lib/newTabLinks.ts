// Slice-5d: links in rendered question text and explanations open in a new tab,
// so a click never leaves the editor. The server's sanitiser already adds
// rel="noopener noreferrer" (backend markdown.py). Pass the HTML so the
// attachment runs again whenever it changes.
export function newTabLinks(_html: string) {
  return (el: HTMLElement): void => {
    for (const a of el.querySelectorAll('a[href]')) a.setAttribute('target', '_blank');
  };
}
