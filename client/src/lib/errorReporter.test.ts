import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendClientErrors = vi.hoisted(() => vi.fn(async (_reports: unknown) => {}));
vi.mock('../services/clientErrors', () => ({ sendClientErrors }));
let reporter: typeof import('./errorReporter');
beforeEach(async () => {
  vi.spyOn(window, 'addEventListener');
  vi.useFakeTimers();
  vi.resetModules();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  sendClientErrors.mockClear();
  reporter = await import('./errorReporter');
});
afterEach(() => {
  for (const [type, listener] of vi.mocked(window.addEventListener).mock.calls)
    window.removeEventListener(type, listener);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const flush = () => window.dispatchEvent(new Event('pagehide'));
const sent = () => JSON.stringify(sendClientErrors.mock.calls);
const loggerSource = readFileSync(`${process.cwd()}/../server/src/utils/logger.ts`, 'utf8');
const paths = loggerSource.split('export const REDACT_PATHS = [')[1]!.split('];')[0]!;
const sensitivePaths = [...paths.matchAll(/'([^']+)'/g)].map((match) => match[1]!);

describe('browser error reporter', () => {
  it('bounds work on a long rejection containing repeated chunk-like words', () => {
    reporter.setSamplePercent(100);
    const start = performance.now();
    reporter.reportError(new Error('chunk '.repeat(10000)), 'error');
    expect(performance.now() - start).toBeLessThan(50);
  });
  it.each([
    'chunk load failed',
    'Failed to fetch dynamically imported module: /assets/page.js',
    'Importing a module script failed.',
    'error loading dynamically imported module',
  ])('does not report a chunk failure from the global handler (%s)', (message) => {
    reporter.installErrorReporter();
    reporter.setSamplePercent(100);
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError(message) }));
    flush();
    expect(sendClientErrors).not.toHaveBeenCalled();
  });
  it('buffers startup errors until config arrives, batches and caps at five per page load', async () => {
    reporter.installErrorReporter();
    for (let i = 0; i < 8; i++) reporter.reportError(new Error(`bug ${i}`), 'error');
    await vi.runAllTimersAsync();
    expect(sendClientErrors).not.toHaveBeenCalled();
    reporter.setSamplePercent(100);
    await vi.runAllTimersAsync();
    expect(sendClientErrors).toHaveBeenCalledOnce();
    expect(sendClientErrors.mock.calls[0]?.[0]).toHaveLength(5);
    reporter.reportError(new Error('sixth'), 'error');
    flush();
    expect(sendClientErrors).toHaveBeenCalledOnce();
  });

  it('samples once, respects zero and updates without drawing again', () => {
    reporter.installErrorReporter();
    reporter.setSamplePercent(0);
    reporter.reportError('off', 'error');
    flush();
    expect(sendClientErrors).not.toHaveBeenCalled();
    reporter.setSamplePercent(50);
    reporter.reportError('excluded', 'error');
    flush();
    expect(sendClientErrors).not.toHaveBeenCalled();
    reporter.setSamplePercent(100);
    reporter.reportError('included', 'error');
    flush();
    expect(sendClientErrors).toHaveBeenCalledOnce();
    expect(Math.random).toHaveBeenCalledOnce();
  });

  it('discards buffered and scheduled reports when sampling is disabled', async () => {
    reporter.installErrorReporter();
    reporter.reportError('before config', 'error');
    reporter.setSamplePercent(0);
    flush();
    reporter.setSamplePercent(100);
    reporter.reportError('before disable', 'error');
    reporter.setSamplePercent(0);
    await vi.runAllTimersAsync();
    reporter.setSamplePercent(100);
    flush();
    expect(sendClientErrors).not.toHaveBeenCalled();
  });

  it('reports message-only global errors with a bounded pathname and ISO timestamp', () => {
    reporter.installErrorReporter();
    reporter.setSamplePercent(100);
    window.history.replaceState({}, '', `/${'a'.repeat(250)}?private=query#hidden`);
    try {
      window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
      flush();
      expect(sendClientErrors.mock.calls[0]?.[0]).toEqual([
        {
          kind: 'error',
          message: 'Script error.',
          route: `/${'a'.repeat(199)}`,
          at: new Date().toISOString(),
        },
      ]);
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });

  it('handles global errors and rejections, and promotes a caught render error without duplication', () => {
    reporter.installErrorReporter();
    reporter.installErrorReporter();
    reporter.setSamplePercent(100);
    const error = new Error('render crash');
    window.dispatchEvent(new ErrorEvent('error', { error }));
    reporter.reportError(error, 'render');
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: 'rejected promise' });
    window.dispatchEvent(rejection);
    flush();
    expect(sendClientErrors.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ kind: 'render', message: 'render crash' }),
      expect.objectContaining({ kind: 'unhandledrejection', message: 'rejected promise' }),
    ]);
    flush();
    expect(sendClientErrors).toHaveBeenCalledOnce();
  });

  it('drops URL queries and fragments and scrubs token, key, email and phone shapes before sending', () => {
    reporter.installErrorReporter();
    reporter.setSamplePercent(100);
    window.history.replaceState({}, '', '/menu?private=query#access_token=secret');
    const secrets = [
      'eyJhbGci.payload.signature',
      'sb_secret_example',
      'Bearer arbitrary',
      'person@example.com',
      'person%40example.com',
      '+91 (987) 654-3210',
      'refresh_token=refresh-secret',
    ];
    reporter.reportError(
      new Error(secrets.join(' ') + ' https://example.test/path?private=hidden#hash'),
      'error',
    );
    flush();
    for (const secret of [...secrets, 'private=', 'hidden', 'access_token='])
      expect(sent()).not.toContain(secret);
    expect(sent()).toContain('"route":"/menu"');
    window.history.replaceState({}, '', '/');
  });

  it.each(sensitivePaths)('scrubs the value under REDACT_PATHS field %s', (key) => {
    reporter.installErrorReporter();
    reporter.setSamplePercent(100);
    reporter.reportError(new Error(`${key}=private-value with spaces; and-more`), 'error');
    flush();
    expect(sent()).not.toContain('private-value');
    expect(sent()).not.toContain('and-more');
  });

  it('keeps Unicode and escaped reports within 4 KB and the endpoint field limits', () => {
    reporter.installErrorReporter();
    reporter.setSamplePercent(100);
    reporter.reportError(new Error('🚨"\\'.repeat(5000)), 'error');
    flush();
    const reports = sendClientErrors.mock.calls[0]?.[0];
    expect(Array.isArray(reports)).toBe(true);
    for (const report of reports as { message: string; stack?: string }[]) {
      expect(new Blob([JSON.stringify(report)]).size).toBeLessThanOrEqual(4096);
      expect(report.message.length).toBeLessThanOrEqual(500);
      expect(report.stack?.length ?? 0).toBeLessThanOrEqual(3500);
    }
  });

  it('never throws for a hostile rejection reason', () => {
    reporter.setSamplePercent(100);
    expect(() =>
      reporter.reportError(
        {
          toString() {
            throw new Error('bad string');
          },
        },
        'error',
      ),
    ).not.toThrow();
  });

  it('scrubs complete Authorization and Cookie header values, including spaces and semicolons', () => {
    reporter.installErrorReporter();
    reporter.setSamplePercent(100);
    reporter.reportError(
      new Error(
        'Authorization: Bearer opaque-credential\nCookie: session=private-session; prefs=private-preferences',
      ),
      'error',
    );
    flush();
    expect(sent()).not.toContain('opaque-credential');
    expect(sent()).not.toContain('private-session');
    expect(sent()).not.toContain('private-preferences');
  });
});
