import { describe, it, expect, vi } from 'vitest';
import { handleStaleIdFallback } from '../lib/handleStaleIdFallback';

function setup() {
  const pushToast = vi.fn();
  const navigate = vi.fn();
  return { pushToast, navigate };
}

describe('handleStaleIdFallback', () => {
  it('staleBid=true: toast "Block not found." (info) + navigate to /edit/v/{vid} with replace+force', () => {
    const { pushToast, navigate } = setup();
    handleStaleIdFallback(
      { staleBid: true, staleSid: false },
      { courseSlug: 'cs101', vid: '10', bid: null },
      { pushToast, navigate },
    );
    expect(pushToast).toHaveBeenCalledWith('Block not found.', 'info');
    expect(navigate).toHaveBeenCalledWith('/courses/cs101/edit/v/10', { replace: true, force: true });
  });

  it('staleSid=true (block intact): toast "Sequence not found." + navigate to block URL', () => {
    const { pushToast, navigate } = setup();
    handleStaleIdFallback(
      { staleBid: false, staleSid: true },
      { courseSlug: 'cs101', vid: '10', bid: '100' },
      { pushToast, navigate },
    );
    expect(pushToast).toHaveBeenCalledWith('Sequence not found.', 'info');
    expect(navigate).toHaveBeenCalledWith('/courses/cs101/edit/v/10/blocks/100', { replace: true, force: true });
  });

  it('staleBid=true AND staleSid=true: staleBid wins — toast block, navigate to version', () => {
    const { pushToast, navigate } = setup();
    handleStaleIdFallback(
      { staleBid: true, staleSid: true },
      { courseSlug: 'cs101', vid: '10', bid: null },
      { pushToast, navigate },
    );
    expect(pushToast).toHaveBeenCalledWith('Block not found.', 'info');
    expect(pushToast).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/courses/cs101/edit/v/10', { replace: true, force: true });
  });

  it('both false: no-op (no toast, no navigate)', () => {
    const { pushToast, navigate } = setup();
    handleStaleIdFallback(
      { staleBid: false, staleSid: false },
      { courseSlug: 'cs101', vid: '10', bid: '100' },
      { pushToast, navigate },
    );
    expect(pushToast).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
