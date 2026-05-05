import path from 'node:path';
import { fileURLToPath } from 'node:url';
export { runCli } from './cli.ts';
import { runCli } from './cli.ts';

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && path.resolve(entry) === fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(code => {
    if (code !== 0) process.exit(code);
  }).catch(err => {
    console.error('[forge] Fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
