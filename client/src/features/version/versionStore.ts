import { create } from 'zustand';

interface VersionState {
  /** The API answered 426 CLIENT_OUTDATED: this build is older than the server's minimum and must reload. */
  outdated: boolean;
  markOutdated: () => void;
  /** The supabase-js chunk failed to load (CLIENT_RELOAD_REQUIRED): only a page reload can load it again. */
  reloadRequired: boolean;
  markReloadRequired: () => void;
}

/** Not persisted: a reload fetches the new build (or the failed chunk), which starts in neither state. */
export const useVersionStore = create<VersionState>((set) => ({
  outdated: false,
  markOutdated: () => set({ outdated: true }),
  reloadRequired: false,
  markReloadRequired: () => set({ reloadRequired: true }),
}));
