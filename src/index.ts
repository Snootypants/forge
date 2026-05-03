import { runCli } from './cli.ts';

runCli(process.argv.slice(2)).then(code => {
  if (code !== 0) process.exit(code);
}).catch(err => {
  console.error('[forge] Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
