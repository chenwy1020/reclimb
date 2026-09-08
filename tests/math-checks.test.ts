import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mathCheckRequestsSchema, runMathCheck, runMathChecks } from '../src/main/math-checks';

const context = { id: 'claim-1', claim: '核对给定式子的计算结果', assumptions: ['自变量和系数均按题设给定'] };

describe('bounded exact local mathematics', () => {
  it('checks the minimax counterexample exactly and rejects the incorrect positive value at five', () => {
    const request = { ...context, kind: 'polynomial_evaluate', coefficients: ['0', '0', '1', '-1/4'] };
    expect(runMathCheck({ ...request, at: '3', expected: '9/4' })).toMatchObject({ status: 'passed', actual: '9/4' });
    expect(runMathCheck({ ...request, at: '5', expected: '-25/4' })).toMatchObject({ status: 'passed', actual: '-25/4' });
    expect(runMathCheck({ ...request, at: '5', expected: '25/4' })).toMatchObject({ status: 'failed', actual: '-25/4', expected: '25/4' });
  });

  it('uses exact decimal and fraction arithmetic without binary floating point', () => {
    expect(runMathCheck({ ...context, kind: 'rational', operation: 'add', operands: ['0.1', '0.2'], expected: '3/10' })).toMatchObject({ status: 'passed', actual: '3/10' });
    expect(runMathCheck({ ...context, kind: 'rational', operation: 'multiply', operands: ['-6/-8', '-0.20', '5'], expected: '-3/4' })).toMatchObject({ status: 'passed', actual: '-3/4' });
    expect(runMathCheck({ ...context, kind: 'rational', operation: 'subtract', operands: ['2', '1/2', '3/2'], expected: '0' })).toMatchObject({ status: 'passed', actual: '0' });
    expect(runMathCheck({ ...context, kind: 'rational', operation: 'divide', operands: ['-3/4', '-3/2'], expected: '1/2' })).toMatchObject({ status: 'passed', actual: '1/2' });
  });

  it('finds only the extrema of a supplied finite nonempty list', () => {
    const request = { ...context, kind: 'finite_extremum', values: ['-9/4', '0', '-2', '3/2'] };
    expect(runMathCheck({ ...request, operation: 'min', expected: '-9/4' })).toMatchObject({ status: 'passed', actual: '-9/4' });
    expect(runMathCheck({ ...request, operation: 'max', expected: '3/2' })).toMatchObject({ status: 'passed', actual: '3/2' });
    expect(runMathCheck({ ...request, operation: 'min', values: [], expected: '0' }).status).toBe('invalid');
  });

  it('compares arbitrarily close supported rational values exactly', () => {
    expect(runMathCheck({ ...context, kind: 'compare', left: '9007199254740993', right: '9007199254740992', expected: 'gt' })).toMatchObject({ status: 'passed', actual: 'gt' });
    expect(runMathCheck({ ...context, kind: 'compare', left: '-2/3', right: '-4/6', expected: 'eq' })).toMatchObject({ status: 'passed', actual: 'eq' });
  });

  it('differentiates ascending rational coefficients and canonicalizes zero polynomials', () => {
    expect(runMathCheck({ ...context, kind: 'polynomial_derivative', coefficients: ['0', '0', '1', '-1/4'], expectedCoefficients: ['0', '2', '-3/4'] })).toMatchObject({ status: 'passed', actual: ['0', '2', '-3/4'] });
    expect(runMathCheck({ ...context, kind: 'polynomial_derivative', coefficients: ['17/5', '0'], expectedCoefficients: ['0', '0'] })).toMatchObject({ status: 'passed', actual: ['0'] });
  });

  it('checks polynomial identities by coefficients, including zero-map equivalence but not finite samples', () => {
    expect(runMathCheck({ ...context, kind: 'polynomial_identity', leftCoefficients: ['0', '0', '0'], rightCoefficients: ['-0/7'], expected: true })).toMatchObject({ status: 'passed', actual: true });
    expect(runMathCheck({ ...context, kind: 'polynomial_identity', leftCoefficients: ['0', '-1', '1'], rightCoefficients: ['0'], expected: true })).toMatchObject({ status: 'failed', actual: false });
    expect(runMathCheck({ ...context, kind: 'polynomial_identity', leftCoefficients: ['1/2', '2/4', '0'], rightCoefficients: ['0.5', '0.5'], expected: true })).toMatchObject({ status: 'passed', actual: true });
  });

  it('retains the formal claim and premises and explicitly limits what passed means', () => {
    const check = { ...context, claim: '本计算不证明路径族包含这条路径', assumptions: ['系数确实对应原题表达式'], kind: 'polynomial_evaluate', coefficients: ['0', '1'], at: '3', expected: '3' };
    const result = runMathCheck(check);
    expect(result).toMatchObject({ id: check.id, claim: check.claim, assumptions: check.assumptions, status: 'passed' });
    expect(result.scope).toMatch(/对应|前提/);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('rejects zero denominators and division by zero rather than returning an infinity', () => {
    expect(runMathCheck({ ...context, kind: 'compare', left: '1/0', right: '0', expected: 'gt' }).status).toBe('invalid');
    expect(runMathCheck({ ...context, kind: 'rational', operation: 'divide', operands: ['1', '0'], expected: '0' }).status).toBe('invalid');
  });

  it('rejects executable expressions, nonfinite values and silently rounded numeric JSON inputs', () => {
    for (const left of ['Math.random()', 'process.exit()', '1+2', 'NaN', 'Infinity', 0.1]) {
      expect(runMathCheck({ ...context, kind: 'compare', left, right: '0', expected: 'eq' }).status).toBe('invalid');
    }
  });

  it('distinguishes unsupported operations and size limits from mathematical counterexamples', () => {
    expect(runMathCheck({ ...context, kind: 'integrate', expression: 'sin(x)' }).status).toBe('unsupported');
    expect(runMathCheck({ ...context, kind: 'polynomial_evaluate', coefficients: Array(34).fill('1'), at: '1', expected: '34' }).status).toBe('unsupported');
    expect(runMathCheck({ ...context, kind: 'compare', left: '1'.repeat(201), right: '1', expected: 'gt' }).status).toBe('unsupported');
    expect(runMathCheck({ ...context, kind: 'rational', operation: 'multiply', operands: Array(128).fill('9'.repeat(80)), expected: '1' }).status).toBe('unsupported');
  });

  it('does not silently drop extra unverified claims and bounds batches before calculation', () => {
    expect(runMathCheck({ ...context, kind: 'compare', left: '1', right: '2', expected: 'lt', provesAllPaths: true }).status).toBe('invalid');
    expect(runMathChecks(Array(33).fill({ ...context, kind: 'compare', left: '1', right: '1', expected: 'eq' }))).toMatchObject([{ status: 'unsupported' }]);
    expect(runMathChecks({ checks: [] })).toMatchObject([{ status: 'invalid' }]);
    expect(runMathChecks([])).toEqual([]);
  });

  it('publishes a bounded schema and evaluates a batch without hiding a failed claim', () => {
    const requests = [{ ...context, kind: 'compare', left: '1', right: '2', expected: 'lt' }, { ...context, id: 'claim-2', kind: 'compare', left: '1', right: '2', expected: 'gt' }];
    expect(mathCheckRequestsSchema.safeParse(requests).success).toBe(true);
    expect(runMathChecks(requests).map(result => result.status)).toEqual(['passed', 'failed']);
  });

  it('explains ascending coefficient order to the provider and retains the exact validated polynomial being checked', () => {
    const schemaText = JSON.stringify(z.toJSONSchema(mathCheckRequestsSchema));
    expect(schemaText).toContain('升幂');
    expect(schemaText).toContain('常数项');
    expect(schemaText).toContain('缺失项');
    const request = { ...context, kind: 'polynomial_evaluate', coefficients: ['0', '0', '1', '-1/4'], at: '3', expected: '9/4' };
    expect(runMathCheck(request)).toMatchObject({ status: 'passed', input: request });
    const wrongPolynomial = { ...request, coefficients: ['2', '3', '0', '-1/12'] };
    expect(runMathCheck(wrongPolynomial)).toMatchObject({ status: 'failed', input: wrongPolynomial, actual: '35/4' });
    expect(runMathCheck({ ...request, arbitraryCode: 'process.exit()' }).input).toBeUndefined();
  });
});
