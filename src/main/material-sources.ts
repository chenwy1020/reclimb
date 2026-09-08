import { readFileSync, realpathSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, sep } from 'node:path';
import { parsePdf, deriveSearchableTexts, derivePdfSummary, withLocalPdf } from '../importers';
import { physicalPage, sourceRegionKey, type PdfMetadata, type PdfPageDetails, type SourceRegion, type SourceTranscription } from '../shared/materials';
import type { Fragment, Material } from '../shared/types';
import type { LearningStore } from './store';

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 100_000;

function pdfMaterial(store: LearningStore, materialId: string): Material {
  const material = store.get('materials', materialId);
  if (!material || material.kind !== 'pdf') throw new Error('未找到对应的 PDF 原件。');
  return material;
}

export function getPdfBytes(store: LearningStore, materialId: string): Uint8Array {
  const material = pdfMaterial(store, materialId);
  try {
    const directory = realpathSync(store.dataDirectory);
    const target = realpathSync(material.storedPath);
    const pathFromWorkspace = relative(directory, target);
    if (!pathFromWorkspace || isAbsolute(pathFromWorkspace) || pathFromWorkspace === '..' || pathFromWorkspace.startsWith(`..${sep}`)) throw new Error('原件路径不在应用资料目录内。');
    const info = statSync(target);
    if (!info.isFile() || info.size > MAX_PDF_BYTES) throw new Error('PDF 原件无效或超过 50 MB。');
    const bytes = readFileSync(target);
    if (bytes.length > MAX_PDF_BYTES || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('原件不是可读取的 PDF。');
    return new Uint8Array(bytes);
  } catch (error) {
    if (error instanceof Error && /原件|资料目录/.test(error.message)) throw error;
    throw new Error('无法读取资料目录中的 PDF 原件，请确认原件仍然存在。');
  }
}

/** Explicit local refresh. Historical text, IDs and locators remain unchanged. */
export async function analyzePdfMaterial(store: LearningStore, materialId: string): Promise<PdfMetadata> {
  const material = pdfMaterial(store, materialId);
  const parsed = await parsePdf(getPdfBytes(store, materialId), material.title);
  const metadata = parsed.pdfMetadata!;
  // A restore/removal while PDF decoding was running must not resurrect prior records.
  const current = store.get('materials', materialId);
  if (!current || current.storedPath !== material.storedPath || current.projectId !== material.projectId) throw new Error('材料在读取时发生变化，请重新打开原页。');
  const fragments = store.list('fragments', material.projectId).filter(fragment => fragment.materialId === materialId);
  const presentPages = new Set(fragments.map(physicalPage));
  for (const page of metadata.pages) if (!presentPages.has(page.pageNumber)) {
    fragments.push({ id: randomUUID(), projectId: material.projectId, materialId, locator: `第 ${page.pageNumber} 页`, pageNumber: page.pageNumber, text: '', ordinal: fragments.length });
  }
  // IDs, not order numbers, are the durable references. Missing pages get new IDs;
  // order numbers are refreshed so navigation follows physical pages after insertion.
  fragments.sort((a, b) => (physicalPage(a) ?? Number.MAX_SAFE_INTEGER) - (physicalPage(b) ?? Number.MAX_SAFE_INTEGER) || a.ordinal - b.ordinal);
  const searchable = deriveSearchableTexts(fragments.map(fragment => fragment.text));
  const summary = derivePdfSummary(fragments.map((fragment, index) => ({ ...fragment, pageNumber: physicalPage(fragment), searchableText: searchable[index] })), metadata);
  store.transaction(() => {
    store.put('materials', { ...current, fragmentCount: fragments.length, summary, pdfMetadata: metadata, warnings: [...new Set([...current.warnings, ...parsed.warnings])] });
    fragments.forEach((fragment, index) => {
      const pageNumber = physicalPage(fragment);
      const page = metadata.pages.find(item => item.pageNumber === pageNumber);
      store.put('fragments', { ...fragment, ordinal: index, searchableText: searchable[index], ...(page ? { pageNumber, printedPageLabel: page.printedPageLabel, quality: page.quality } : {}) });
    });
  });
  return metadata;
}

function validRegion(region?: SourceRegion): SourceRegion | undefined {
  if (region === undefined) return undefined;
  if (!region || typeof region !== 'object') throw new Error('请选择有效的原页区域。');
  const { x, y, width, height } = region;
  if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value)) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) throw new Error('原页区域必须位于本页范围内。');
  return { x, y, width, height };
}

function binding(store: LearningStore, fragmentId: string, pageNumber: number): { fragment: Fragment; material: Material } {
  const fragment = store.get('fragments', fragmentId);
  if (!fragment) throw new Error('找不到这段原文，请重新选择来源。');
  const material = pdfMaterial(store, fragment.materialId);
  if (fragment.projectId !== material.projectId) throw new Error('原文与材料不属于同一个学习项目。');
  if (!Number.isSafeInteger(pageNumber) || pageNumber <= 0 || physicalPage(fragment) !== pageNumber || (material.pdfMetadata && pageNumber > material.pdfMetadata.pageCount)) throw new Error('转录页码与所选原文不一致。');
  return { fragment, material };
}

function validateClientImage(imageDataUrl?: string): void {
  if (imageDataUrl === undefined) return;
  if (typeof imageDataUrl !== 'string' || imageDataUrl.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 100) throw new Error('原页图片过大，请缩小所选区域。');
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageDataUrl);
  if (!match) throw new Error('原页图片必须为 PNG 或 JPEG。');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_IMAGE_BYTES || (match[1] === 'png' ? !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)) throw new Error('原页图片格式无效。');
}

/** Pixels are regenerated from the bound local PDF, so client uploads cannot forge a source. */
export async function validateTranscriptionInput(store: LearningStore, input: { fragmentId: string; pageNumber: number; region?: SourceRegion; imageDataUrl?: string }): Promise<{ fragment: Fragment; material: Material; page: PdfPageDetails; region?: SourceRegion; imageDataUrl: string }> {
  const bound = binding(store, input.fragmentId, input.pageNumber);
  const region = validRegion(input.region);
  validateClientImage(input.imageDataUrl);
  const data = getPdfBytes(store, bound.material.id);
  return withLocalPdf(data, async document => {
    if (input.pageNumber > document.numPages) throw new Error('原件中不存在这个页码。');
    const page = await document.getPage(input.pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const selected = region ?? { x: 0, y: 0, width: 1, height: 1 };
    // Render just the selected area, capped at 1800 px per side, without allocating the whole page.
    const scale = Math.min(4, 1800 / Math.max(natural.width * selected.width, natural.height * selected.height));
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.ceil(viewport.width * selected.width));
    const height = Math.max(1, Math.ceil(viewport.height * selected.height));
    if (!Number.isFinite(width * height) || width * height > 4_000_000) throw new Error('原页图片尺寸异常，请选择较小区域。');
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    await page.render({ canvas: null, canvasContext: context as unknown as CanvasRenderingContext2D, viewport, transform: [1, 0, 0, 1, -selected.x * viewport.width, -selected.y * viewport.height], background: '#ffffff' }).promise;
    const png = canvas.encodeSync('png');
    if (png.length > MAX_IMAGE_BYTES) throw new Error('原页图片过大，请缩小所选区域。');
    const labels = await document.getPageLabels();
    const details = bound.material.pdfMetadata?.pages.find(item => item.pageNumber === input.pageNumber) ?? { pageNumber: input.pageNumber, printedPageLabel: labels?.[input.pageNumber - 1] || undefined, width: natural.width, height: natural.height, quality: { kind: 'unknown' as const, needsVerification: true, reasons: ['本页文字尚未核对。'] } };
    binding(store, input.fragmentId, input.pageNumber);
    return { ...bound, page: details, region, imageDataUrl: `data:image/png;base64,${png.toString('base64')}` };
  });
}

function transcriptText(text: string): string {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TRANSCRIPT_CHARS) throw new Error('转录内容不能为空，且不能超过 10 万字符。');
  return text.trim();
}

type TranscriptionInput = { fragmentId: string; pageNumber: number; region?: SourceRegion; text: string; uncertainties?: string[]; model?: string };

function newSourceTranscription(store: LearningStore, input: TranscriptionInput, origin: 'machine' | 'manual'): SourceTranscription {
  const { fragment, material } = binding(store, input.fragmentId, input.pageNumber);
  const region = validRegion(input.region);
  const text = transcriptText(input.text);
  if (input.uncertainties !== undefined && (!Array.isArray(input.uncertainties) || input.uncertainties.length > 100 || input.uncertainties.some(item => typeof item !== 'string' || item.length > 2000))) throw new Error('转录疑点格式无效。');
  if (input.model !== undefined && (typeof input.model !== 'string' || input.model.length > 300)) throw new Error('转录服务名称无效。');
  const versions = store.list('sourceTranscriptions', fragment.projectId).filter(item => item.fragmentId === fragment.id && item.pageNumber === input.pageNumber && sourceRegionKey(item.region) === sourceRegionKey(region));
  return { id: randomUUID(), projectId: fragment.projectId, materialId: material.id, fragmentId: fragment.id, pageNumber: input.pageNumber, region, version: Math.max(0, ...versions.map(item => item.version)) + 1, text, status: 'machine', origin, createdAt: new Date().toISOString(), model: input.model, uncertainties: input.uncertainties ?? [] };
}

export function createSourceTranscription(store: LearningStore, input: TranscriptionInput): SourceTranscription {
  const transcription = newSourceTranscription(store, input, 'machine');
  store.put('sourceTranscriptions', transcription);
  return transcription;
}

/** Human-entered source text is a new version; no vision service or fictitious machine record is required. */
export function createManualTranscription(store: LearningStore, input: { fragmentId: string; pageNumber: number; text: string; region?: SourceRegion; confirmed: true }): SourceTranscription {
  if (input.confirmed !== true) throw new Error('请先确认手工转录已经对照原页核对。');
  const version = newSourceTranscription(store, { fragmentId: input.fragmentId, pageNumber: input.pageNumber, region: input.region, text: input.text }, 'manual');
  const confirmed: SourceTranscription = { ...version, status: 'confirmed', confirmedAt: version.createdAt };
  store.put('sourceTranscriptions', confirmed);
  return confirmed;
}

export function confirmSourceTranscription(store: LearningStore, id: string, text?: string): SourceTranscription {
  const previous = store.get('sourceTranscriptions', id);
  if (!previous) throw new Error('找不到待核对的转录版本。');
  const { fragment, material } = binding(store, previous.fragmentId, previous.pageNumber);
  if (previous.projectId !== fragment.projectId || previous.materialId !== material.id) throw new Error('转录与原文的来源关联不一致。');
  return store.transaction(() => {
    const next = newSourceTranscription(store, { ...previous, text: transcriptText(text ?? previous.text) }, previous.origin ?? 'machine');
    const confirmed: SourceTranscription = { ...next, status: 'confirmed', confirmedAt: new Date().toISOString() };
    store.put('sourceTranscriptions', confirmed);
    return confirmed;
  });
}
