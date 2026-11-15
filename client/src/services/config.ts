import type { Config } from '../types/api';
import { request } from './api';

// Several hooks read the config at once (an order page, the order list, the staff board): one request serves them.
let inFlight: Promise<Config> | null = null;

export function fetchConfig(): Promise<Config> {
  inFlight ??= request<Config>('/config', { auth: false }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
