import type { MenuResponse } from '../types/api';
import { request } from './api';

let prefetched: Promise<MenuResponse> | null = null;

const requestMenu = () => request<MenuResponse>('/menu', { auth: false });

/**
 * Starts the menu request while the app is still booting (main.tsx, when the visitor lands on /menu), instead of after
 * the first render: on a slow phone that is the difference between the store cover arriving inside the LCP budget or
 * not. The next fetchMenu() takes this response; it is handed out once, so later calls always ask the server again.
 */
export function prefetchMenu(): void {
  prefetched ??= requestMenu();
  // Nobody may be waiting yet: the first fetchMenu() reports a failure, not the browser as an unhandled rejection.
  prefetched.catch(() => {});
}

export function fetchMenu(): Promise<MenuResponse> {
  const pending = prefetched;
  prefetched = null;
  return pending ?? requestMenu();
}
