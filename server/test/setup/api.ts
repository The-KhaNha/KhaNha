import { once } from 'node:events';
import type { Server } from 'node:http';
import request from 'supertest';
import { createApp } from '../../src/app';

// Why not request(createApp()): supertest then listens on every interface (::) but connects to 127.0.0.1, and on
// macOS another local process bound to 127.0.0.1 on the same random port wins that connection. Tests then get a
// stranger's reply (seen as foreign 404 and "Invalid authentication" bodies, ~1 run in 10). One server per test
// file, bound to 127.0.0.1 itself, cannot collide that way. guard.ts starts and stops it around every file.
let server: Server | undefined;

export async function startApi(): Promise<void> {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
}

export async function stopApi(): Promise<void> {
  const running = server;
  server = undefined;
  if (running) await new Promise<void>((resolve) => running.close(() => resolve()));
}

/** Supertest against this test file's API server: `api().get('/api/menu')`. */
export function api() {
  if (!server)
    throw new Error('The test API server is not running (test/setup/guard.ts starts it).');
  return request(server);
}
