import {spawnSync} from 'node:child_process';
import {appendFileSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const contract = JSON.parse(readFileSync(new URL('./release-contract-v0410.json', import.meta.url), 'utf8'));

export function selectTestProfile(version, scope = 'auto') {
  if (!['auto', 'full'].includes(scope)) throw new Error('Test scope must be auto or full.');
  // This targeted exception expires with its exact release.
  const tests = scope === 'auto' && version === contract.version ? contract.targetTests : undefined;
  return {scope: tests ? 'targeted' : 'full', tests: tests ? [...tests] : []};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const profile = selectTestProfile(version, process.env.RECLIMB_TEST_SCOPE || 'auto');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `scope=${profile.scope}\n`, 'utf8');
  console.log(`Test scope for ${version}: ${profile.scope}${profile.tests.length ? ' (' + profile.tests.join(', ') + ')' : ''}`);
  // Keep the patch checks predictable on machines also running Electron and browser validation.
  const workers = profile.scope === 'targeted' ? ['--maxWorkers=1'] : [];
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...profile.tests, ...workers], {stdio: 'inherit'});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
