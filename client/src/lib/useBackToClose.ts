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
// Entries of sheets closed while a sheet above them was still open: they stay in the history below it, so Back
// must step over them instead of landing on one and needing a second press.
const abandoned = new Set<number>();

// Pushes held while one of our own pops is in flight (see the effect).
const waiting: (() => void)[] = [];

window.addEventListener('popstate', () => {
  if (ownPops > 0) {
    ownPops -= 1;
    if (ownPops === 0) waiting.splice(0).forEach((push) => push());
  } else open.pop()?.close();
  const landed = entryOf(window.history.state);
  if (landed !== undefined && abandoned.delete(landed)) {
    ownPops += 1;
    window.history.back();
  }
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
    const push = () =>
      window.history.pushState({ ...(window.history.state as object), fpSheet: sheet.id }, '');
    // StrictMode (development, the e2e server) unmounts and remounts a sheet at once: the unmount's back() is still
    // in flight, and Chrome fixes its target when called, so a push now would be popped with the page's entry and
    // the first Back would leave the page. Push once that pop has landed instead.
    if (ownPops > 0) {
      waiting.push(push);
      // A pop that never arrives (its traversal cancelled by a navigation) must not hold every later sheet: release
      // after a moment and stop waiting for it.
      window.setTimeout(() => {
        if (!waiting.includes(push)) return;
        ownPops = 0;
        waiting.splice(0).forEach((held) => held());
      }, 500);
    } else push();
    return () => {
      const held = waiting.indexOf(push);
      if (held >= 0) waiting.splice(held, 1);
      const at = open.indexOf(sheet);
      if (at < 0) return; // Back closed it: its entry is already gone.
      if (held >= 0) {
        open.splice(at, 1);
        return; // never pushed: nothing to take back
      }
      open.splice(at, 1);
      // Now, in the close itself: a later back() could abort a navigation that follows the close.
      const current = entryOf(window.history.state);
      // Only while its entry is the current one: after a navigation the entry is not ours to take back.
      if (current === sheet.id) {
        ownPops += 1;
        window.history.back();
      } else if (current !== undefined) abandoned.add(sheet.id);
    };
  }, [active]);
}
