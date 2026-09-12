import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {expect, it} from 'vitest';

const profileModule = await import(pathToFileURL(resolve('scripts/test-profile.mjs')).href);
it('uses a bounded targeted profile only for the reviewed 0.4.5 patch', () => {
 const profile = profileModule.selectTestProfile('0.4.5');
 expect(profile.scope).toBe('targeted');
 expect(profile.tests).toEqual(expect.arrayContaining(['tests/teaching.test.ts','tests/service.test.ts','tests/call-runner-repair.test.ts','tests/test-profile.test.ts','tests/delivery-v045.test.ts']));
 expect(new Set(profile.tests).size).toBe(profile.tests.length);
});
it.each(['0.4.4', '0.4.6', '0.5.0', '1.0.0'])('defaults %s to the full accumulated suite', version => {
 expect(profileModule.selectTestProfile(version)).toEqual({scope: 'full', tests: []});
});
it('allows an explicit full run on a patch and rejects unknown selection modes', () => {
 expect(profileModule.selectTestProfile('0.4.5', 'full')).toEqual({scope: 'full', tests: []});
 expect(() => profileModule.selectTestProfile('0.4.5', 'skip')).toThrow('scope');
});
it('lets Windows CI request all accumulated tests without changing npm test', () => {
 const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
 expect(workflow).toContain('workflow_dispatch:');
 expect(workflow).toContain('options: [auto, full]');
 expect(workflow).toContain('node scripts/test-profile.mjs');
 expect(workflow).toContain('npm run test:desktop:full');
 expect(workflow).toContain("steps.tests.outputs.scope == 'full'");
 expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts.test).toBe('vitest run');
});
