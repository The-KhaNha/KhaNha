import { RefreshCw } from 'lucide-react';
import { Button } from '../../components/Button';
import { useVersionStore } from './versionStore';

/** Shown on every screen once the API says this build is too old; a reload loads the current one. */
export function OutdatedBanner() {
  const outdated = useVersionStore((s) => s.outdated);
  if (!outdated) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 bg-ink pt-[env(safe-area-inset-top)] text-white"
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2">
        <p className="text-sm font-semibold">New version available</p>
        <Button
          variant="tint"
          onClick={() => window.location.reload()}
          iconLeft={<RefreshCw className="h-4 w-4" aria-hidden />}
        >
          Refresh
        </Button>
      </div>
    </div>
  );
}
