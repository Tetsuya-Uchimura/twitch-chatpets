import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';

const image = process.argv[2] || 'chat-critters:local';
const prefix = 'nib-smoke-' + randomUUID(), volume = prefix + '-data';
const containers = [], sentinel = 'container-smoke-key-must-not-leak';
const report = { checks: [], apiRequests: 0 };
function docker(args, { failure = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 });
  if (!failure && (result.error || result.status !== 0)) throw new Error(`Docker command failed: ${args[0]}`);
  return result;
}
async function waitFor(check) {
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    try { if (await check()) return; } catch { /* Container may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Container readiness deadline exceeded.');
}
async function start(suffix) {
  const name = prefix + suffix; containers.push(name);
  docker(['run', '-d', '--name', name, '--init', '--publish', '127.0.0.1::3000',
    '--mount', `type=volume,source=${volume},target=/app/data`, '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--env', 'DEMO_MODE=true', '--env', 'OPENAI_API_ENABLED=false', '--env', `OPENAI_API_KEY=${sentinel}`, image]);
  const address = docker(['port', name, '3000/tcp']).stdout.trim();
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const base = 'http://' + address;
  await waitFor(async () => (await fetch(base + '/healthz', { signal: AbortSignal.timeout(2000) })).ok);
  return { name, base };
}
async function state(base) {
  const response = await fetch(base + '/api/state'); assert.equal(response.status, 200);
  const raw = await response.text(); assert.ok(!raw.includes(sentinel));
  const value = JSON.parse(raw); assert.equal(value.demo, true); assert.equal(value.ai.totalRequests, 0);
  return value;
}
function requestStatus(base, headers) {
  // Raw HTTP preserves the Host/Sec-Fetch headers that fetch may normalize or override.
  return new Promise((resolve, reject) => {
    const request = http.get(base + '/api/state', { headers }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
}
try {
  docker(['volume', 'create', volume]);
  const first = await start('-first');
  assert.equal((await state(first.base)).ai.enabled, false);
  const page = await (await fetch(first.base + '/?overlay=1')).text(); assert.match(page, /id="world"/);
  assert.equal((await fetch(first.base + '/app.js')).status, 200);
  const probe = `const fs=require('node:fs');console.log(JSON.stringify({uid:process.getuid(),secrets:fs.existsSync('/app/.env'),tests:fs.existsSync('/app/tests'),clientSource:fs.existsSync('/app/src/client'),dev:fs.existsSync('/app/node_modules/@playwright/test')}))`;
  const contents = JSON.parse(docker(['exec', first.name, 'node', '-e', probe]).stdout);
  assert.equal(contents.uid, 1000); assert.equal(contents.secrets, false); assert.equal(contents.tests, false); assert.equal(contents.dev, false);
  assert.equal(contents.clientSource, false);
  report.checks.push('production assets, non-root user, no copied environment/test/development files, zero AI calls');
  for (const headers of [{ Origin: 'https://example.invalid' }, { Host: 'example.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal(await requestStatus(first.base, headers), 403, 'Reject ' + Object.keys(headers)[0]);
  }
  const settings = await fetch(first.base + '/api/stage/settings', { method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: first.base }, body: JSON.stringify({ tempo: 123 }) });
  assert.equal(settings.status, 200); assert.equal((await state(first.base)).stageSettings.tempo, 123);
  report.checks.push('loopback publication, localhost Host and same-origin API controls');
  const blocked = prefix + '-blocked'; containers.push(blocked);
  assert.equal(docker(['run', '--name', blocked, '--network', 'none',
    '--mount', `type=volume,source=${volume},target=/app/data`, '--env', 'DEMO_MODE=true', image], { failure: true }).status, 1);
  assert.equal((await state(first.base)).stageSettings.tempo, 123);
  report.checks.push('second container cannot share the active budget ledger');
  await waitFor(() => docker(['inspect', '--format', '{{.State.Health.Status}}', first.name]).stdout.trim() === 'healthy');
  docker(['stop', '--time', '10', first.name]);
  const next = await start('-restart');
  assert.equal((await state(next.base)).stageSettings.tempo, 123);
  report.checks.push('Docker health check, graceful stop, lock release and settings survive recreation');
  fs.mkdirSync('artifacts/container-smoke', { recursive: true });
  fs.writeFileSync('artifacts/container-smoke/report.json', JSON.stringify(report, null, 2));
  console.log('Container passed: ' + report.checks.join('; ') + '.');
} finally {
  for (const name of containers) docker(['rm', '--force', name], { failure: true });
  docker(['volume', 'rm', volume], { failure: true });
}
