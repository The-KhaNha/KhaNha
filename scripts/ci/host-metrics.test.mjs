// infra/host/host-metrics.sh against fixture meminfo files, with a fake aws on the PATH that records its arguments
// (P8 PR 08): the percentages and the namespace the host-memory alarm reads. And every file in infra/host travels in
// the deploy document, or the host never gets it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const hostDir = fileURLToPath(new URL('../../infra/host/', import.meta.url));
const computeTf = fileURLToPath(
  new URL('../../infra/terraform/modules/compute/main.tf', import.meta.url),
);

function run(meminfo) {
  const dir = mkdtempSync(join(tmpdir(), 'host-metrics-'));
  writeFileSync(join(dir, 'aws'), `#!/bin/sh\nprintf '%s\\n' "$@" > "$STATE/args"\n`);
  chmodSync(join(dir, 'aws'), 0o755);
  writeFileSync(join(dir, 'meminfo'), meminfo);
  const result = spawnSync('bash', [join(hostDir, 'host-metrics.sh'), 'production'], {
    encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, STATE: dir, MEMINFO: join(dir, 'meminfo') },
  });
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(join(dir, 'args'), 'utf8').trim().split('\n');
}

test('publishes used memory and used swap, in percent, to the environment namespace', () => {
  const args = run(
    [
      'MemTotal:        1000000 kB',
      'MemFree:          100000 kB',
      'MemAvailable:     250000 kB',
      'SwapTotal:       2000000 kB',
      'SwapFree:        1500000 kB',
    ].join('\n'),
  );
  assert.deepEqual(args, [
    'cloudwatch',
    'put-metric-data',
    '--namespace',
    'KhaNha/production',
    '--metric-data',
    'MetricName=HostMemoryUsedPercent,Value=75.0,Unit=Percent',
    'MetricName=HostSwapUsedPercent,Value=25.0,Unit=Percent',
  ]);
});

test('a host without swap reports 0% swap, not a division by zero', () => {
  const args = run(
    ['MemTotal: 1000 kB', 'MemAvailable: 900 kB', 'SwapTotal: 0 kB', 'SwapFree: 0 kB'].join('\n'),
  );
  assert.equal(args.at(-2), 'MetricName=HostMemoryUsedPercent,Value=10.0,Unit=Percent');
  assert.equal(args.at(-1), 'MetricName=HostSwapUsedPercent,Value=0.0,Unit=Percent');
});

test('every file in infra/host is in the deploy document', () => {
  const tf = readFileSync(computeTf, 'utf8');
  for (const file of readdirSync(hostDir)) {
    assert.ok(tf.includes(`"${file}"`), `${file} is not in modules/compute local.host_files`);
  }
});
