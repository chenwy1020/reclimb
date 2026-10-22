import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const { sourceFiles } = await import(pathToFileURL(resolve('scripts/source-files.mjs')).href);
const { selectTestProfile } = await import(pathToFileURL(resolve('scripts/validation/test-profile.mjs')).href);

it('aligns the current version with the full 0.8 product, knowledge and IPC package contract', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const contract = JSON.parse(readFileSync('scripts/release/release-contract-v081.json', 'utf8'));
  expect(pkg.version).toBe('0.8.1');
  expect(lock.version).toBe(pkg.version);
  expect(lock.packages[''].version).toBe(pkg.version);
  expect(readFileSync('src/renderer/App.tsx', 'utf8')).toContain(`重登 · ${pkg.version}`);
  expect(contract).toEqual({
    version: '0.8.1', suiteTag: 'v081', expectedChecks: 10,
    smokeScript: 'smoke-v070.mjs', desktopReportName: 'desktop-verification-v070.json',
    expectedProductChecks: 9, productSmokeScript: 'smoke-product-review.mjs',
    productReportName: 'verification.json', ipcValidationChecks: 13,
    ipcReportName: 'ipc-validation.json', testScope: 'full', targetTests: [],
  });
  expect(JSON.parse(readFileSync('scripts/release/release-contract-v080.json', 'utf8'))).toEqual({
    ...contract, version: '0.8.0', suiteTag: 'v080',
  });
  expect(selectTestProfile(pkg.version)).toEqual({ scope: 'full', tests: [] });
  expect(pkg.scripts['verify:package']).toBe('powershell -ExecutionPolicy Bypass -File scripts/release/verify-package-v080.ps1 -Version 0.8.1');
  expect(pkg.scripts['test:desktop']).toContain(contract.smokeScript);
  expect(pkg.scripts['test:desktop']).toContain(contract.productSmokeScript);
});

it('ships the new verifier alongside all historical release contracts', () => {
  const files = sourceFiles();
  for (const file of [
    'scripts/release/release-contract-v081.json',
    'scripts/release/release-contract-v080.json', 'scripts/release/verify-package-v080.ps1',
    'scripts/release/release-contract-v071.json', 'scripts/release/verify-package-v071.ps1',
    'scripts/desktop/smoke-product-review.mjs', 'scripts/desktop/smoke-ipc-validation.mjs',
  ]) {
    expect(existsSync(file), file).toBe(true);
    expect(files, file).toContain(file);
  }
});
