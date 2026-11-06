/// <reference types="vite/client" />
// The 73 overridable colours as the panel's Branding read sends them (D8),
// taken from the generated backend list, so the tests use the real names,
// order, defaults and headings.
import source from '../../../../backend/mathion/theme_vars.py?raw';
import type { PanelThemeVar } from '../../lib/superuser';

export const THEME_VARS: PanelThemeVar[] = [...source.matchAll(/ThemeVar\('([^']+)', '([^']+)', '([^']+)'\)/g)]
  .map(([, name, value, heading]) => ({ name, default: value, heading }));
