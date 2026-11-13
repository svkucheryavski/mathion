// The browser's check on asset files dropped or picked: in the editor (its
// sidebar and its text area alike) and in a run's Assets tab (Settings D11b).
// One refused file stops them all, before anything uploads, so a drop of
// several says so.
import { ALLOWED_EXTENSIONS } from './runAssets';
import { overLimitSentence, overUploadLimit } from './uploadLimit.svelte';

function refusal(file: File): string | null {
  if (overUploadLimit(file.size)) return overLimitSentence(file.name);
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.has(ext)) return `${file.name}: extension not allowed.`;
  return null;
}

/** Every refused file's sentence, or null when all may upload. */
export function assetDropRefusal(files: File[]): string | null {
  const refused = files.map(refusal).filter((r): r is string => r !== null);
  if (refused.length === 0) return null;
  return files.length === 1 ? refused[0] : `Nothing was uploaded. ${refused.join(' ')}`;
}
