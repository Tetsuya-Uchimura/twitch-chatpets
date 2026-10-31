import dotenv from 'dotenv';
import path from 'node:path';
import { projectRoot as root } from './paths.js';
import { loadConfig } from './config.js';
import { acquireLock } from './store.js';
import { createApp } from './app.js';

dotenv.config({ path: path.join(root, '.env'), quiet: true });
let release;
let runtime;
try {
  const config = loadConfig();
  release = acquireLock(path.join(root, 'data'), { namespace: config.networkMode });
  runtime = createApp({ config, ...(process.argv.includes('--production') ? { publicDirectory: path.join(root, 'dist', 'public') } : {}) });
  const server = runtime.app.listen(config.port, config.bindHost, () => {
    runtime.start();
    console.log(`Chat Critters: http://127.0.0.1:${server.address().port} (${config.demo ? 'DEMO · zero API calls' : 'TWITCH · AI requires explicit enablement'})`);
  });
  server.on('error', () => { console.error('Server could not bind to localhost.'); runtime.stop(); release(); process.exitCode = 1; });
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    runtime.stop(); server.close(() => { release(); process.exit(0); });
    setTimeout(() => { release(); process.exit(0); }, 2000).unref();
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch {
  runtime?.stop(); release?.();
  // Configuration and SDK errors can contain secrets. Never log the raw exception.
  console.error('Startup failed. Check configuration, data file integrity, and the single-server lock. No AI request was started.');
  process.exitCode = 1;
}
