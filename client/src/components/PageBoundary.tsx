import { Component, Suspense, type ReactNode } from 'react';
import { logger } from '../lib/logger';
import { ErrorState } from './ErrorState';
import { Skeleton } from './Skeleton';

interface PageBoundaryProps {
  children: ReactNode;
}

/**
 * Wraps the routes so a code-split page can load on a slow connection: a skeleton while its chunk downloads, and if
 * the download fails (offline, flaky Wi-Fi, or a deploy replaced the chunk) the unreachable state with a reload
 * instead of a blank screen.
 */
export class PageBoundary extends Component<PageBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // Once per failed navigation, so a burst after a deploy (old chunk names gone) shows up.
  componentDidCatch(error: unknown) {
    logger.error('Page chunk failed to load', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  render() {
    if (this.state.failed) {
      return (
        <ErrorState
          unreachable
          className="mt-8"
          title="This page didn't load"
          message="We couldn't reach the server. Check your connection and try again."
          onRetry={() => window.location.reload()}
        />
      );
    }
    return (
      <Suspense fallback={<Skeleton className="mt-4 h-48 w-full rounded-[20px]" />}>
        {this.props.children}
      </Suspense>
    );
  }
}
