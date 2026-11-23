/** Reloads the page. A module of its own so tests can mock it: `window.location` cannot be redefined in a VM pool. */
export function reloadPage(): void {
  window.location.reload();
}
