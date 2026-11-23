import { beforeEach, describe, expect, it } from 'vitest';
import { useVersionStore } from './versionStore';

describe('versionStore', () => {
  beforeEach(() => useVersionStore.setState({ outdated: false }));

  it('markOutdated sets outdated', () => {
    useVersionStore.getState().markOutdated();
    expect(useVersionStore.getState().outdated).toBe(true);
  });
});
