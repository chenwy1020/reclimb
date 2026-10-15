import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, '.local-test-data', 'evaluation-tool', 'product-evaluation.cjs');
await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: [resolve(root, 'scripts/validation/product-evaluation.ts')],
  outfile: output,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external',
});
try {
  await createRequire(import.meta.url)(output).main(process.argv.slice(2));
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : '评测未完成') + '\n');
  process.exitCode = 1;
}
