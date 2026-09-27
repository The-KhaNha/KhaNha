import 'dotenv/config';
import { afterAll, beforeAll } from 'vitest';
import { startApi, stopApi } from './api';
import { resolveTestTarget } from './target';

// Throws before any test, hook or request runs when the env points anywhere but an allowed target (target.ts).
// Loading the app above connects to nothing; the first database call is in a test or the beforeAll below.
resolveTestTarget();

beforeAll(startApi);
afterAll(stopApi);
