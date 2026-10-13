#!/usr/bin/env node

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
NonStop Router - High-Availability LLM Failover Gateway & Prompt Cache

Usage:
  npx nonstop-router [options]

Options:
  -p, --port <number>   Port to run on (default: 4000 or PORT env)
  --host <string>       Host interface to bind to (default: 127.0.0.1)
  --no-open             Disable automatic dashboard opening in browser
  -v, --version         Show version
  -h, --help            Show this help message

Documentation & Repository:
  https://github.com/skr-electronics-lab/nonstop-router
`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  const pkg = require('../package.json');
  console.log(`nonstop-router v${pkg.version}`);
  process.exit(0);
}

const portIdx = args.findIndex(a => a === '--port' || a === '-p');
if (portIdx !== -1 && args[portIdx + 1]) {
  process.env.PORT = args[portIdx + 1];
}

const hostIdx = args.findIndex(a => a === '--host');
if (hostIdx !== -1 && args[hostIdx + 1]) {
  process.env.HOST = args[hostIdx + 1];
}

if (args.includes('--no-open')) {
  process.env.NO_OPEN = '1';
}

import('../dist/server/index.js').catch((err) => {
  console.error('Failed to start NonStop Router:', err);
  console.error('If this is the first run, build the project with: npm run build');
  process.exit(1);
});
