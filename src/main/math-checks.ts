import { z } from 'zod';

/** These are data formats, never expressions or executable model-provided code. */
const rational = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[+-]?(?:\d+\/[+-]?\d+|\d+(?:\.\d*)?|\.\d+)$/, '只接受整数、分数或有限小数文本');
const coefficients = z
  .array(rational)
  .min(1)
  .max(33)
  .describe(
    '按常数项、x 一次项、x² 等依次升幂排列，包括缺失项 0。例如 x²−x³/4 为 ["0","0","1","-1/4"]；不是降幂。',
  );
const common = {
  id: z.string().min(1).max(100),
  claim: z.string().min(1).max(2000),
  assumptions: z.array(z.string().min(1).max(1000)).max(12),
};

export const mathCheckRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...common,
      kind: z.literal('rational'),
      operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
      operands: z.array(rational).min(2).max(128),
      expected: rational,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('finite_extremum'),
      operation: z.enum(['min', 'max']),
      values: z.array(rational).min(1).max(128),
      expected: rational,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('compare'),
      left: rational,
      right: rational,
      expected: z.enum(['lt', 'eq', 'gt']),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('polynomial_evaluate'),
      coefficients,
      at: rational,
      expected: rational,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('polynomial_derivative'),
      coefficients,
      expectedCoefficients: coefficients,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('polynomial_identity'),
      leftCoefficients: coefficients,
      rightCoefficients: coefficients,
      expected: z.boolean(),
    })
    .strict(),
]);
export const mathCheckRequestsSchema = z.array(mathCheckRequestSchema).max(32);
export type MathCheckRequest = z.infer<typeof mathCheckRequestSchema>;
export type MathCheckValue = string | string[] | boolean;
export interface MathCheckResult {
  id: string;
  kind: string;
  claim: string;
  assumptions: string[];
  status: 'passed' | 'failed' | 'unsupported' | 'invalid';
  /** Bounded schema-validated formal input, so a correct calculation of the wrong polynomial is visible. */
  input?: MathCheckRequest;
  actual?: MathCheckValue;
  expected?: MathCheckValue;
  scope: string;
  reason?: string;
}

const SCOPE =
  '仅核对提交的形式化计算；不核对自然语言主张与原题的对应关系，也不证明所列前提成立。有限列表极值不代表所有路径或连续区间极值。';
const KINDS = new Set([
  'rational',
  'finite_extremum',
  'compare',
  'polynomial_evaluate',
  'polynomial_derivative',
  'polynomial_identity',
]);
const MAX_INPUT_DIGITS = 80;
const MAX_INTERMEDIATE_DIGITS = 4096;
type Rational = { n: bigint; d: bigint };
class CheckError extends Error {
  constructor(
    public status: 'invalid' | 'unsupported',
    message: string,
  ) {
    super(message);
  }
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
function gcd(left: bigint, right: bigint): bigint {
  let a = abs(left),
    b = abs(right);
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}
function bounded(value: bigint): void {
  if (abs(value).toString().length > MAX_INTERMEDIATE_DIGITS)
    throw new CheckError('unsupported', '中间结果超过本机核对的 4096 位整数上限。');
}
function normalized(n: bigint, d: bigint): Rational {
  if (d === 0n) throw new CheckError('invalid', '分母或除数不能为零。');
  // Bound intermediates before normalization too; cancellation cannot conceal an oversized operation.
  bounded(n);
  bounded(d);
  if (n === 0n) return { n: 0n, d: 1n };
  const divisor = gcd(n, d) * (d < 0n ? -1n : 1n);
  return { n: n / divisor, d: d / divisor };
}
function parseRational(text: string): Rational {
  if ((text.match(/\d/g)?.length ?? 0) > MAX_INPUT_DIGITS)
    throw new CheckError('unsupported', '单个有理数最多包含 80 位十进制数字。');
  if (text.includes('/')) {
    const [numerator, denominator] = text.split('/');
    return normalized(BigInt(numerator), BigInt(denominator));
  }
  if (!text.includes('.')) return normalized(BigInt(text), 1n);
  const negative = text.startsWith('-');
  const [integer, fractional] = text.replace(/^[+-]/, '').split('.');
  return normalized(
    BigInt((integer || '0') + fractional) * (negative ? -1n : 1n),
    10n ** BigInt(fractional.length),
  );
}
function format(value: Rational): string {
  return value.d === 1n ? value.n.toString() : `${value.n}/${value.d}`;
}
function add(left: Rational, right: Rational): Rational {
  return normalized(left.n * right.d + right.n * left.d, left.d * right.d);
}
function multiply(left: Rational, right: Rational): Rational {
  return normalized(left.n * right.n, left.d * right.d);
}
function compare(left: Rational, right: Rational): 'lt' | 'eq' | 'gt' {
  const a = left.n * right.d,
    b = right.n * left.d;
  bounded(a);
  bounded(b);
  return a < b ? 'lt' : a > b ? 'gt' : 'eq';
}
function polynomial(values: string[]): Rational[] {
  const result = values.map(parseRational);
  while (result.length > 1 && result.at(-1)!.n === 0n) result.pop();
  return result;
}
function samePolynomial(left: Rational[], right: Rational[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value.n === right[index].n && value.d === right[index].d)
  );
}
function evaluate(request: MathCheckRequest): {
  actual: MathCheckValue;
  expected: MathCheckValue;
  passed: boolean;
} {
  if (request.kind === 'compare') {
    const actual = compare(parseRational(request.left), parseRational(request.right));
    return { actual, expected: request.expected, passed: actual === request.expected };
  }
  if (request.kind === 'polynomial_identity') {
    const actual = samePolynomial(
      polynomial(request.leftCoefficients),
      polynomial(request.rightCoefficients),
    );
    return { actual, expected: request.expected, passed: actual === request.expected };
  }
  if (request.kind === 'polynomial_derivative') {
    const original = polynomial(request.coefficients);
    const derivative =
      original.length === 1
        ? [{ n: 0n, d: 1n }]
        : original.slice(1).map((value, index) => multiply(value, { n: BigInt(index + 1), d: 1n }));
    const expected = polynomial(request.expectedCoefficients);
    return {
      actual: derivative.map(format),
      expected: expected.map(format),
      passed: samePolynomial(derivative, expected),
    };
  }
  let value: Rational;
  if (request.kind === 'polynomial_evaluate') {
    const terms = polynomial(request.coefficients),
      at = parseRational(request.at);
    value = { n: 0n, d: 1n };
    for (let i = terms.length - 1; i >= 0; i--) value = add(multiply(value, at), terms[i]);
  } else if (request.kind === 'finite_extremum') {
    const values = request.values.map(parseRational);
    value = values[0];
    for (const candidate of values.slice(1)) {
      if (compare(candidate, value) === (request.operation === 'min' ? 'lt' : 'gt'))
        value = candidate;
    }
  } else {
    const operands = request.operands.map(parseRational);
    value = operands[0];
    for (const operand of operands.slice(1)) {
      if (request.operation === 'add') value = add(value, operand);
      else if (request.operation === 'subtract')
        value = add(value, { n: -operand.n, d: operand.d });
      else if (request.operation === 'multiply') value = multiply(value, operand);
      else value = multiply(value, normalized(operand.d, operand.n));
    }
  }
  const expected = parseRational(request.expected);
  return {
    actual: format(value),
    expected: format(expected),
    passed: compare(value, expected) === 'eq',
  };
}

function context(
  input: unknown,
): Pick<MathCheckResult, 'id' | 'kind' | 'claim' | 'assumptions' | 'scope'> {
  const object = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    id: typeof object.id === 'string' ? object.id.slice(0, 100) : 'invalid-input',
    kind: typeof object.kind === 'string' ? object.kind.slice(0, 100) : 'unknown',
    claim: typeof object.claim === 'string' ? object.claim.slice(0, 2000) : '',
    assumptions: Array.isArray(object.assumptions)
      ? object.assumptions
          .slice(0, 12)
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.slice(0, 1000))
      : [],
    scope: SCOPE,
  };
}

export function runMathCheck(input: unknown): MathCheckResult {
  const base = context(input);
  if (base.kind !== 'unknown' && !KINDS.has(base.kind))
    return {
      ...base,
      status: 'unsupported',
      reason: '不支持此类核对；当前仅支持有理数运算、有限列表极值和有理系数单变量多项式。',
    };
  const parsed = mathCheckRequestSchema.safeParse(input);
  if (!parsed.success) {
    const overLimit = parsed.error.issues.some((issue) => issue.code === 'too_big');
    return {
      ...base,
      status: overLimit ? 'unsupported' : 'invalid',
      reason: overLimit
        ? '输入超过核对范围：每批 32 项、每列表 128 项、多项式最高 32 次，并限制文本长度。'
        : '核对数据格式不符，或包含未声明字段；数字必须使用整数、分数或有限小数文本，不接受表达式代码。',
    };
  }
  try {
    const { actual, expected, passed } = evaluate(parsed.data);
    return {
      ...base,
      input: parsed.data,
      status: passed ? 'passed' : 'failed',
      actual,
      expected,
      reason: passed ? '形式化计算与所列预期一致。' : '形式化计算与所列预期不一致。',
    };
  } catch (error) {
    return {
      ...base,
      input: parsed.data,
      status: error instanceof CheckError ? error.status : 'invalid',
      reason: error instanceof CheckError ? error.message : '无法按受限有理数格式完成核对。',
    };
  }
}

export function runMathChecks(inputs: unknown): MathCheckResult[] {
  if (!Array.isArray(inputs))
    return [{ ...context(null), status: 'invalid', reason: '核对请求必须是数组。' }];
  if (inputs.length > 32)
    return [
      { ...context(null), status: 'unsupported', reason: '每批最多核对 32 项，未执行超限请求。' },
    ];
  const ids = inputs.map(context).map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    return [
      {
        ...context(null),
        status: 'invalid',
        reason: '同一批核对的主张 ID 必须不同，以免混淆核对依据。',
      },
    ];
  return inputs.map(runMathCheck);
}
