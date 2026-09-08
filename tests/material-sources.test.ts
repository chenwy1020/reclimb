import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningStore } from '../src/main/store';
import { parseMaterial, deriveSearchableTexts } from '../src/importers';
import { analyzePdfMaterial, getPdfBytes, validateTranscriptionInput, createSourceTranscription, confirmSourceTranscription, createManualTranscription } from '../src/main/material-sources';
import { sourceText, sourceExcerpt } from '../src/shared/materials';
import { sourcePdf } from './fixtures/source-pdf';

let dir: string;
let store: LearningStore;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reclimb-sources-'));
  store = await LearningStore.open(dir);
  await mkdir(join(dir, 'materials'));
  file = join(dir, 'materials', 'original.pdf');
  await writeFile(file, sourcePdf({ outline: true }));
  store.put('projects', { id: 'p', title: '数学', goal: '理解变分', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01' });
  store.put('materials', { id: 'm', projectId: 'p', title: '原件', kind: 'pdf', originalName: 'original.pdf', storedPath: file, importedAt: '2026-01-01', warnings: [], fragmentCount: 1, summary: '原摘要' });
  store.put('fragments', { id: 'f', materialId: 'm', projectId: 'p', text: 'r = { g G C([o, i], E) : g(o) = o, 9(1) = e }.\nLicensed to learner. Prepared on 2020-01-01.', locator: '第 1 页', ordinal: 0 });
});
afterEach(async () => { store?.close(); await rm(dir, { recursive: true, force: true }); });

describe('original PDF and derived metadata', () => {
  it('detects image-backed invisible OCR even with plenty of extracted text and preserves actual/printed pages and outline', async () => {
    const parsed = await parseMaterial(file);
    expect(parsed.pdfMetadata?.pages[0]).toMatchObject({ pageNumber: 1, printedPageLabel: '4', quality: { kind: 'ocr-text', needsVerification: true } });
    expect(parsed.pdfMetadata?.outline).toEqual([{ title: 'Chapter 1: Critical points', pageNumber: 1, level: 1 }]);
    expect(parsed.fragments[0]).toMatchObject({ pageNumber: 1, printedPageLabel: '4', quality: { kind: 'ocr-text' } });
    expect(parsed.fragments[0].text).toContain('9(1)');
    expect(parsed.warnings.join('')).toMatch(/OCR|隐藏/);
  });
  it('distinguishes native text and image-only pages without claiming text is mathematically verified', async () => {
    await writeFile(file, sourcePdf({ image: false, invisible: false }));
    expect((await parseMaterial(file)).pdfMetadata?.pages[0].quality.kind).toBe('native-text');
    await writeFile(file, sourcePdf({ text: '' }));
    const scanned = await parseMaterial(file);
    expect(scanned.pdfMetadata?.pages[0].quality).toMatchObject({ kind: 'image-only', needsVerification: true });
    expect(scanned.fragments).toHaveLength(1);
    expect(scanned.fragments[0]).toMatchObject({ text: '', pageNumber: 1, locator: '第 1 页' });
  });
  it('refreshes old source metadata and searchable text without changing any raw text, IDs, ordinals or locators', async () => {
    const before = store.get('fragments', 'f')!;
    const metadata = await analyzePdfMaterial(store, 'm');
    const after = store.get('fragments', 'f')!;
    expect(after).toMatchObject(before);
    expect(after.quality?.kind).toBe('ocr-text');
    expect(after.searchableText).toContain('9(1)');
    expect(after.searchableText).not.toContain('Licensed to');
    expect(store.get('materials', 'm')?.pdfMetadata).toEqual(metadata);
    const summary = store.get('materials', 'm')?.summary ?? '';
    expect(summary).toContain('Chapter 1: Critical points');
    expect(summary).not.toContain('Licensed to');
    expect(summary).not.toBe('原摘要');
    expect(summary).toMatch(/非完整摘要|不代表完整/);
    expect(store.list('fragments')).toHaveLength(1);
  });
  it('builds a reading index from PDF bookmarks and cleaned text instead of copied licensing headers', async () => {
    await writeFile(file, sourcePdf({ text: 'Licensed to learner. Prepared on 2020.', outline: true, secondPageText: 'The path energy is a function on the path space.' }));
    const parsed = await parseMaterial(file);
    expect(parsed.fragments[0].text).toContain('Licensed to');
    expect(parsed.summary).toContain('Chapter 1: Critical points');
    expect(parsed.summary).toContain('The path energy');
    expect(parsed.summary).not.toContain('Licensed to');
    expect(parsed.summary).toMatch(/非完整摘要|不代表完整/);
  });
  it('cleans repeated page headers and license lines only in derived text, keeping meaningful mathematical lines', () => {
    const pages = ['MINIMAX METHODS\nTheorem 1 and proof.\nLicensed to learner. Prepared on 2020-01-01.', 'MINIMAX METHODS\nTheorem 2 and proof.', 'MINIMAX METHODS\nTheorem 3 and proof.'];
    const derived = deriveSearchableTexts(pages);
    expect(derived).toEqual(['Theorem 1 and proof.', 'Theorem 2 and proof.', 'Theorem 3 and proof.']);
    expect(pages[0]).toContain('Licensed to');
    expect(deriveSearchableTexts(['x = 0\nA proof', 'x = 0\nB proof', 'x = 0\nC proof'])[0]).toContain('x = 0');
  });
  it('adds bindable empty source fragments for formerly missing pages while retaining existing source IDs and raw text', async () => {
    await writeFile(file, sourcePdf({ text: '', secondPageText: 'The actual second page text.' }));
    store.put('fragments', { ...store.get('fragments', 'f')!, locator: '第 2 页', text: 'Old raw source text', ordinal: 0 });
    store.put('capabilities', { id: 'cap', projectId: 'p', title: '数学', description: '保持引用', sourceIds: ['f'], prerequisites: [], order: 0 });
    await analyzePdfMaterial(store, 'm');
    expect(store.get('fragments', 'f')).toMatchObject({ id: 'f', text: 'Old raw source text', locator: '第 2 页', pageNumber: 2, ordinal: 1 });
    const empty = store.list('fragments').find(fragment => fragment.pageNumber === 1)!;
    expect(empty).toMatchObject({ text: '', ordinal: 0, quality: { kind: 'image-only' } });
    expect(empty.id).not.toBe('f');
    expect(store.get('materials', 'm')?.fragmentCount).toBe(2);
    expect(store.get('capabilities', 'cap')?.sourceIds).toEqual(['f']);
    await analyzePdfMaterial(store, 'm');
    expect(store.list('fragments')).toHaveLength(2);
    expect(store.get('fragments', empty.id)?.pageNumber).toBe(1);
  });
  it('returns original bytes only for a known local PDF within the workspace', async () => {
    expect(Buffer.from(getPdfBytes(store, 'm')).subarray(0, 4).toString()).toBe('%PDF');
    expect(() => getPdfBytes(store, 'missing')).toThrow();
    store.put('materials', { ...store.get('materials', 'm')!, storedPath: join(dir, '..', 'outside.pdf') });
    expect(() => getPdfBytes(store, 'm')).toThrow(/资料目录|原件|路径/);
  });
});

describe('versioned source transcription', () => {
  it('creates a source-bound manual confirmed version directly without a machine step and retains old versions and raw text', () => {
    const original = store.get('fragments', 'f')!;
    const first = createManualTranscription(store, { fragmentId: 'f', pageNumber: 1, text: '  I(x) = x² − x³/4  ', confirmed: true });
    expect(first).toMatchObject({ origin: 'manual', status: 'confirmed', version: 1, projectId: 'p', materialId: 'm', fragmentId: 'f', pageNumber: 1, text: 'I(x) = x² − x³/4', uncertainties: [] });
    expect(first.confirmedAt).toBe(first.createdAt);
    expect(first.model).toBeUndefined();
    expect(store.list('sourceTranscriptions')).toHaveLength(1);
    const second = createManualTranscription(store, { fragmentId: 'f', pageNumber: 1, text: 'I(5) = −25/4', confirmed: true });
    expect(second.version).toBe(2);
    expect(second.id).not.toBe(first.id);
    expect(store.get('sourceTranscriptions', first.id)).toEqual(first);
    expect(store.get('fragments', 'f')).toEqual(original);
    expect(sourceText(original, store.list('sourceTranscriptions'))).toMatchObject({ text: second.text, transcriptionIds: [second.id] });
  });

  it('requires explicit manual confirmation and rejects wrong pages, empty text and invalid regions without writing', () => {
    const base = { fragmentId: 'f', pageNumber: 1, text: '手工核对内容', confirmed: true as const };
    expect(() => createManualTranscription(store, { ...base, confirmed: false } as unknown as Parameters<typeof createManualTranscription>[1])).toThrow(/确认|核对/);
    expect(() => createManualTranscription(store, { ...base, pageNumber: 2 })).toThrow(/页/);
    expect(() => createManualTranscription(store, { ...base, text: '  ' })).toThrow(/内容/);
    expect(() => createManualTranscription(store, { ...base, region: { x: -0.1, y: 0, width: 1, height: 1 } })).toThrow(/区域/);
    expect(store.list('sourceTranscriptions')).toHaveLength(0);
  });

  it('continues machine history per selected region and preserves origin when a manual version is reconfirmed', () => {
    const region = { x: 0, y: 0, width: 0.5, height: 0.5 };
    const machine = createSourceTranscription(store, { fragmentId: 'f', pageNumber: 1, region, text: '错误识别' });
    const manual = createManualTranscription(store, { fragmentId: 'f', pageNumber: 1, region, text: '人工校正', confirmed: true });
    expect(machine.origin).toBe('machine');
    expect(manual).toMatchObject({ version: 2, origin: 'manual', region });
    const confirmedAgain = confirmSourceTranscription(store, manual.id, '人工再次校正');
    expect(confirmedAgain).toMatchObject({ version: 3, origin: 'manual', status: 'confirmed' });
    expect(store.get('sourceTranscriptions', machine.id)).toEqual(machine);
    expect(store.get('sourceTranscriptions', manual.id)).toEqual(manual);
  });

  it('prioritizes a confirmed crop ahead of long OCR text and reports only versions present in a bounded excerpt', () => {
    const fragment = { ...store.get('fragments', 'f')!, pageNumber: 1, text: '旧OCR原文'.repeat(1000), searchableText: '旧OCR原文'.repeat(1000), quality: { kind: 'ocr-text' as const, needsVerification: true, reasons: ['公式需核对'] } };
    const base = { id: 't', projectId: 'p', materialId: 'm', fragmentId: 'f', pageNumber: 1, region: { x: 0, y: 0, width: 0.5, height: 0.5 }, version: 2, text: 'CORRECT_FORMULA', status: 'confirmed' as const, createdAt: '2026-01-02', confirmedAt: '2026-01-02', uncertainties: [] };
    const excerpt = sourceExcerpt(fragment, [base], 300);
    expect(excerpt.text.length).toBeLessThanOrEqual(300);
    expect(excerpt.text).toContain('CORRECT_FORMULA');
    expect(excerpt.transcriptionIds).toEqual(['t']);
    expect(excerpt.warnings.join('')).toMatch(/其他|只有|选区|区域/);
    const lengthy = sourceExcerpt(fragment, [{ ...base, text: 'CONFIRMED'.repeat(1000) }, { ...base, id: 'later-area', region: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } }], 200);
    expect(lengthy.text.length).toBeLessThanOrEqual(200);
    expect(lengthy.transcriptionIds).toEqual(['t']);
    expect(lengthy.warnings.join('')).toMatch(/选段|截|完整/);
    expect(sourceExcerpt(fragment, [{ ...base, status: 'machine' }], 300).transcriptionIds).toEqual([]);
  });
  it('rejects foreign page/region bindings and canonicalizes image pixels from the saved source', async () => {
    await analyzePdfMaterial(store, 'm');
    await expect(validateTranscriptionInput(store, { fragmentId: 'f', pageNumber: 2 })).rejects.toThrow(/页/);
    await expect(validateTranscriptionInput(store, { fragmentId: 'f', pageNumber: 1, region: { x: 0.9, y: 0, width: 0.2, height: 1 } })).rejects.toThrow(/区域/);
    const ready = await validateTranscriptionInput(store, { fragmentId: 'f', pageNumber: 1, region: { x: 0, y: 0, width: 0.5, height: 0.5 } });
    expect(ready.imageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(ready.page.pageNumber).toBe(1);
    await expect(validateTranscriptionInput(store, { fragmentId: 'f', pageNumber: 1, imageDataUrl: 'data:text/html;base64,PHNjcmlwdD4=' })).rejects.toThrow(/图片/);
  });
  it('keeps machine and confirmed versions, never changes raw text, and adopts only confirmed source-bound content', async () => {
    await analyzePdfMaterial(store, 'm');
    const fragment = store.get('fragments', 'f')!;
    const machine = createSourceTranscription(store, { fragmentId: 'f', pageNumber: 1, text: '\\Gamma = \\{g\\in C([0,1],E)\\}', uncertainties: ['末尾条件需核对'], model: 'vision-test' });
    expect(sourceText(fragment, [machine]).text).toBe(fragment.searchableText);
    const confirmed = confirmSourceTranscription(store, machine.id, '\\Gamma = \\{g\\in C([0,1],E) \\mid g(0)=0, g(1)=e\\}');
    expect(confirmed).toMatchObject({ status: 'confirmed', version: 2, fragmentId: 'f' });
    expect(confirmed.id).not.toBe(machine.id);
    expect(store.get('sourceTranscriptions', machine.id)?.status).toBe('machine');
    expect(store.get('fragments', 'f')?.text).toBe(fragment.text);
    expect(sourceText(fragment, [machine, confirmed])).toMatchObject({ text: confirmed.text, transcriptionIds: [confirmed.id] });
    expect(sourceText(fragment, [{ ...confirmed, projectId: 'other' }]).transcriptionIds).toEqual([]);
    expect(() => createSourceTranscription(store, { fragmentId: 'f', pageNumber: 3, text: 'not this page' })).toThrow(/页/);
  });
});
