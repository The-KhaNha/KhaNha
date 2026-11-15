#!/usr/bin/env node
// Fails when a built client bundle (client/dist) contains something that must never ship to a browser: a Supabase
// secret key, a service-role JWT, a private key, or a server-only env value inlined by Vite. gitleaks scans commits;
// this scans what the build produced, which is where a `VITE_`-prefixed mistake would first show up.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Each pattern names what it catches; a JWT is checked by decoding its role, so the anon key passes. */
export const PATTERNS = [
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{10,}/g },
  { name: 'service_role literal', re: /service_role/g },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'gateway secret key', re: /\b(sk|rzp)_(live|test)_[A-Za-z0-9]{8,}/g },
  {
    name: 'server-only env name',
    re: /\b(SUPABASE_SECRET_KEY|SEED_(STAFF|ADMIN|CUSTOMER)_PASSWORD)\b/g,
  },
];

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const SCANNED = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map', '.txt', '.webmanifest']);

/** The JWT's role claim, or undefined when it is not a decodable JWT. */
export function jwtRole(token) {
  try {
    const payload = Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
    return JSON.parse(payload).role;
  } catch {
    return undefined;
  }
}

/** Findings in one file's text: `{ name, sample }` per hit, with the sample redacted. */
export function findSecrets(text) {
  const findings = [];
  for (const { name, re } of PATTERNS) {
    for (const match of text.matchAll(re)) findings.push({ name, sample: redact(match[0]) });
  }
  for (const match of text.matchAll(JWT)) {
    if (jwtRole(match[0]) === 'service_role')
      findings.push({ name: 'service_role JWT', sample: redact(match[0]) });
  }
  return findings;
}

function redact(value) {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…(${value.length} chars)`;
}

export function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (SCANNED.has(path.slice(path.lastIndexOf('.')))) yield path;
  }
}

export function scanDir(distDir) {
  const results = [];
  for (const file of walk(distDir)) {
    for (const finding of findSecrets(readFileSync(file, 'utf8')))
      results.push({ file: relative(distDir, file), ...finding });
  }
  return results;
}

function main() {
  const clientDir = resolve(process.argv[2] ?? 'client');
  const distDir = join(clientDir, 'dist');
  const findings = scanDir(distDir);
  if (findings.length === 0) {
    console.log(`No secrets in ${relative(process.cwd(), distDir)}`);
    return;
  }
  console.error(`Secrets in the built bundle (${relative(process.cwd(), distDir)}):`);
  for (const { file, name, sample } of findings) console.error(`  ${file}: ${name} (${sample})`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
