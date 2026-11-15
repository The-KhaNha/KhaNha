import { useEffect } from 'react';

/**
 * While a form has unsaved edits, a reload or closing the tab asks first (the browser's own prompt), where it once
 * dropped them without a word (/break, P3 close). In-app navigation is not covered: BrowserRouter has no blocker.
 */
export function useLeaveWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}
