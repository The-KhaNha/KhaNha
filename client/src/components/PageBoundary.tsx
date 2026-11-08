import { Component, Suspense, type ReactNode } from 'react';
import { logger } from '../lib/logger';
import { CHUNK_FAILURE, reportError } from '../lib/errorReporter';
import { ErrorState } from './ErrorState';
import { Skeleton } from './Skeleton';

interface PageBoundaryProps {
  children: ReactNode;
  scope?: 'page' | 'app';
}

/**
 * Wraps the routes so a code-split page can load on a slow connection: a skeleton while its chunk downloads, and if
 * the download fails, the unreachable state with a reload. Render bugs are reported separately. App scope catches
 * shell crashes and leaves suspense to the page so it never replaces the shell with a page skeleton.
 */
export class PageBoundary extends Component<
  PageBoundaryProps,
  { failed: boolean; chunk: boolean }
> {
  state = { failed: false, chunk: false };

  static getDerivedStateFromError(error: unknown) {
    const chunk = error instanceof Error && CHUNK_FAILURE.test(error.message.slice(0, 8000));
    return { failed: true, chunk };
  }

  // Once per failed navigation, so a burst after a deploy (old chunk names gone) shows up.
  componentDidCatch(error: unknown) {
    if (this.state.chunk) logger.error('Page chunk failed to load');
    else reportError(error, 'render');
  }

  render() {
    if (this.state.failed) {
      return (
        <ErrorState
          unreachable={this.state.chunk}
          className={this.props.scope === 'app' ? 'mx-auto mt-8 max-w-md' : 'mt-8'}
          title={this.state.chunk ? "This page didn't load" : 'Something went wrong'}
          message={
            this.state.chunk
              ? "We couldn't reach the server. Check your connection and try again."
              : 'Please reload the page and try again.'
          }
          retryLabel={this.state.chunk ? 'Try Again' : 'Reload'}
          onRetry={() => window.location.reload()}
        />
      );
    }
    if (this.props.scope === 'app') return this.props.children;
    // Padding, not a margin: on a full-screen route nothing sits above the fallback, and its margin would collapse
    // through <body>, moving the whole page 16px down and back while the chunk loads.
    return (
      <Suspense
        fallback={
          <div className="pt-4">
            <Skeleton className="h-48 w-full rounded-tile" />
          </div>
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}
