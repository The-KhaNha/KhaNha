import { create } from 'zustand';

interface VersionState {
  /** The API answered 426 CLIENT_OUTDATED: this build is older than the server's minimum and must reload. */
  outdated: boolean;
  markOutdated: () => void;
}

/** Not persisted: a reload fetches the new build, which starts not outdated. */
export const useVersionStore = create<VersionState>((set) => ({
  outdated: false,
  markOutdated: () => set({ outdated: true }),
}));
