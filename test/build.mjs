/**
 * Bundle the parser to plain ESM so node:test can import it.
 *
 * The parser is TypeScript and imports across modules; the tests are .mjs run
 * by node --test. Rather than add a test-time TS loader, esbuild produces one
 * file the tests import directly — the same bundler the extension already uses.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/parser/index.ts'],
  outfile: 'test/.parser.mjs',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  logLevel: 'warning',
});

await build({
  entryPoints: ['src/storage/export.ts'],
  outfile: 'test/.export.mjs',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  logLevel: 'warning',
});
