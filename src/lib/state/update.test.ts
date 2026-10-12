import { afterEach, describe, expect, it, vi } from 'vitest';

describe('reloading into a new build', () => {
  afterEach(() => vi.resetModules());

  it('reloads only after an update, and not while something is held', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const u = await import('./update');
    expect(u.reloadIfUpdated()).toBe(false);
    u.markUpdated();
    u.holdReload('qso', true);
    expect(u.reloadIfUpdated()).toBe(false);
    // A file of the old build failing to load reloads even so: nothing else would work.
    expect(u.reloadIfUpdated(true)).toBe(true);
    u.holdReload('qso', false);
    expect(u.reloadIfUpdated()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
