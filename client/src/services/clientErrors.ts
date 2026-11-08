import { request } from './api';

export interface ClientErrorReport {
  kind: 'error' | 'unhandledrejection' | 'render';
  message: string;
  stack?: string;
  route: string;
  at: string;
}

/** Best effort: a failed report must never become another reported error. */
export async function sendClientErrors(reports: ClientErrorReport[]): Promise<void> {
  try {
    await request('/client-errors', {
      method: 'POST',
      body: { reports },
      auth: false,
      keepalive: true,
    });
  } catch {
    // No retry: the visitor's next action takes priority over diagnostics on a flaky connection.
  }
}
