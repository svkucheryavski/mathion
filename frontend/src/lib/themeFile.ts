// Branding D9, D10: the colours a theme sets, merged over Mathion's defaults,
// and the downloaded theme file, built in the browser from the panel's read
// (a link to a panel address would put the token in the download history).
import type { PanelColours, PanelThemeVar } from './superuser';

export const THEME_FILE_NAME = 'theme.css';

/** D9: the download's one comment; theme-default.css's own notes are the team's. */
const HEADER = "Mathion colours. Change the values you want and upload the whole file on the Branding page. "
  + "A line left at Mathion's value changes nothing; a line you delete goes back to Mathion's colour. "
  + 'Only colours can be changed here.';

/**
 * Every overridable colour, in order: the change where there is one, else
 * Mathion's default. A name that is no longer a theme colour is left out, and
 * a var() to one is dead (D10 "after a release"), so its default is used.
 */
export function mergedColours(vars: PanelThemeVar[], changes: Record<string, string>): Record<string, string> {
  const names = new Set(vars.map((v) => v.name));
  const out: Record<string, string> = {};
  for (const v of vars) {
    const change = changes[v.name];
    const target = change?.match(/^var\((--[\w-]+)\)$/)?.[1];
    out[v.name] = change === undefined || (target !== undefined && !names.has(target)) ? v.default : change;
  }
  return out;
}

/** D9: the header comment, then one :root block, each family under its heading. */
export function themeFileText(colours: PanelColours): string {
  const merged = mergedColours(colours.vars, colours.changes);
  const lines = [`/* ${HEADER} */`, '', ':root {'];
  let heading: string | null = null;
  for (const v of colours.vars) {
    if (v.heading !== heading) {
      if (heading !== null) lines.push('');
      lines.push(`  /* ${v.heading} */`);
      heading = v.heading;
    }
    lines.push(`  ${v.name}: ${merged[v.name]};`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

/** D9: save the current theme as theme.css; a download, so no new tab. */
export function downloadTheme(colours: PanelColours): void {
  const url = URL.createObjectURL(new Blob([themeFileText(colours)], { type: 'text/css' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = THEME_FILE_NAME;
  document.body.append(a);
  a.click();
  a.remove();
  // Safari may still be reading the Blob just after the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The server's sentences mark names with backticks; split them so names show as code. */
export function ticked(sentence: string): { text: string; code: boolean }[] {
  return sentence.split('`').map((text, i) => ({ text, code: i % 2 === 1 })).filter((p) => p.text !== '');
}
