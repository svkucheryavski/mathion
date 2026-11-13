import { it, expect, afterEach } from 'vitest';
import { assetDropRefusal } from '../lib/assetDrop';
import { uploadLimit, resetUploadLimit } from '../lib/uploadLimit.svelte';

afterEach(() => resetUploadLimit());

function sized(name: string, mb: number): File {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: mb * 1024 * 1024 });
  return f;
}

// Review t4-r12: the editor's drops and the sidebar's share one pre-pass.
it('passes files of an allowed type within the limit', () => {
  uploadLimit.mb = 50;
  expect(assetDropRefusal([sized('a.png', 1), sized('B.PDF', 50)])).toBeNull();
});

it('one refused file says its own sentence', () => {
  uploadLimit.mb = 50;
  expect(assetDropRefusal([sized('big.png', 60)])).toBe('big.png is over the 50 MB limit.');
  expect(assetDropRefusal([sized('tool.exe', 1)])).toBe('tool.exe: extension not allowed.');
  expect(assetDropRefusal([sized('noext', 1)])).toBe('noext: extension not allowed.');
});

it('a refused file among several: nothing was uploaded, then every reason', () => {
  uploadLimit.mb = 50;
  expect(assetDropRefusal([sized('ok.png', 1), sized('big.png', 60), sized('tool.exe', 1)]))
    .toBe('Nothing was uploaded. big.png is over the 50 MB limit. tool.exe: extension not allowed.');
});

it('no size check while the limit is unknown, the type check stays', () => {
  expect(assetDropRefusal([sized('huge.png', 5000)])).toBeNull();
  expect(assetDropRefusal([sized('tool.exe', 1)])).toBe('tool.exe: extension not allowed.');
});
