import { useEffect, useRef } from 'react';

/**
 * Android Back (and the browser's Back) closes an open sheet instead of leaving the page under it, where what the
 * sheet held (a choice, a half-typed item) was lost (/break, P3 close). Opening pushes a history entry; Back pops it
 * and closes the sheet on top. A sheet closed another way (its button, Escape, a save) takes its entry back off, so
 * the next Back still leaves the page in one press.
 *
 * One popstate listener for every sheet: a stack, so Back closes only the top one when sheets nest.
 */
const open: { id: number; close: () => void }[] = [];
// Pops this module made itself (a sheet closed another way going back over its entry): not the person's Back.
let ownPops = 0;
let nextId = 0;

window.addEventListener('popstate', () => {
  if (ownPops > 0) {
    ownPops -= 1;
    return;
  }
  open.pop()?.close();
});

const entryOf = (state: unknown): number | undefined =>
  typeof state === 'object' && state !== null && 'fpSheet' in state
    ? (state as { fpSheet: number }).fpSheet
    : undefined;

export function useBackToClose(active: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    const sheet = { id: (nextId += 1), close: () => close.current() };
    open.push(sheet);
    // The router's own state is kept, so the page under the sheet is the same page to it.
    window.history.pushState({ ...(window.history.state as object), fpSheet: sheet.id }, '');
    return () => {
      const at = open.indexOf(sheet);
      if (at < 0) return; // Back closed it: its entry is already gone.
      open.splice(at, 1);
      // Only while its entry is the current one: after a navigation the entry is not ours to take back.
      if (entryOf(window.history.state) === sheet.id) {
        ownPops += 1;
        window.history.back();
      }
    };
  }, [active]);
}
