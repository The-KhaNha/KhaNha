import fallbacks from '../config/fallbacks.json';
import { sendClientErrors, type ClientErrorReport } from '../services/clientErrors';

// The server's bounds (LIMITS.clientErrors, parity-tested): a report past them would fail the whole batch, silently.
const { reportsMax, messageMax, stackMax, routeMax } = fallbacks.validation.clientErrors;

export const CHUNK_FAILURE =
  /chunk.{0,80}(?:load|fail)|(?:fetch|loading) dynamically imported module|importing a module script failed/i;

const sample = Math.random();
let percent: number | undefined;
let count = 0;
let queue: ClientErrorReport[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let installed = false;
const seen = new WeakMap<object, ClientErrorReport>();

// Bound the scan, then scrub before cutting fields: truncation must not expose half a secret. A JWT and an email only
// start at the head of a run, which keeps a long run linear; the character before the head is captured and put back,
// not matched by lookbehind, which Safari before 16.4 cannot compile (regexSupport.test.ts). A token after its name
// may be URL-encoded (`refresh_token%3D…`), and an email's local part may hold `%` or `'`, which still end a run: an
// encoded email deep in an encoded URL starts after the last `%`.
const SECRET =
  /[?#][^\s"')]*|\b[\w.-]{0,64}(?:password|token|email|phone|key|secret|signature|checksum|vpa|code|authorization|cookie)[\w.-]{0,64}["'\]]*\s*(?:[:=]|%3D)[^\r\n]*|(^|[^\w-])eyJ[\w-]+(?:\.[\w-]*){0,2}|sb_[a-z]+_[\w-]+|\bBearer\s+[\w.~+/=-]+|(^|[^\w.+-])[\w.+%'-]{1,64}(?:@|%40)[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}|\+?\(?\d(?:[\s.()/-]{0,3}\d){9,14}/gi;
const scrub = (text: string) =>
  text
    .slice(0, 8000)
    .replace(
      SECRET,
      (_match, jwtHead: string | undefined, emailHead: string | undefined) =>
        `${jwtHead ?? emailHead ?? ''}[Redacted]`,
    );

function flush() {
  clearTimeout(timer);
  timer = undefined;
  if (percent === undefined) return;
  const reports = queue;
  queue = [];
  if (sample * 100 < percent && reports.length) void sendClientErrors(reports);
}

function schedule() {
  if (percent !== undefined && queue.length && timer === undefined) timer = setTimeout(flush, 250);
}

export function setSamplePercent(value: number) {
  percent = Number.isFinite(value) ? value : 0;
  if (sample * 100 >= percent) queue = [];
  schedule();
}

export function reportError(error: unknown, kind: ClientErrorReport['kind']) {
  try {
    const object = typeof error === 'object' && error !== null ? error : undefined;
    const previous = object && seen.get(object);
    // React's development build also dispatches a window error for a caught render failure.
    if (previous) {
      if (kind === 'render') previous.kind = kind;
      return;
    }
    if (count >= reportsMax || (percent !== undefined && sample * 100 >= percent)) return;
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 8000);
    if (CHUNK_FAILURE.test(message)) return;
    const report: ClientErrorReport = {
      kind,
      message: scrub(message).slice(0, messageMax),
      stack: error instanceof Error ? scrub(error.stack ?? '').slice(0, stackMax) : undefined,
      route: scrub(window.location.pathname).slice(0, routeMax),
      at: new Date().toISOString(),
    };
    // JSON escaping and multibyte characters count too; five reports remain below keepalive's 64 KB limit.
    while (new Blob([JSON.stringify(report)]).size > 4096) {
      if (report.stack) report.stack = report.stack.slice(0, Math.floor(report.stack.length / 2));
      else report.message = report.message.slice(0, Math.floor(report.message.length / 2));
    }
    if (object) seen.set(object, report);
    count++;
    queue.push(report);
    schedule();
  } catch {
    // A rejection may carry an object with throwing getters or toString; diagnostics must not break the page.
  }
}

export function installErrorReporter(): void {
  if (installed) return;
  installed = true;
  const onError = (event: ErrorEvent) => reportError(event.error ?? event.message, 'error');
  const onRejection = (event: PromiseRejectionEvent) =>
    reportError(event.reason, 'unhandledrejection');
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('pagehide', flush);
}
