import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import AdmZip from 'adm-zip';
import { load, type CheerioAPI } from 'cheerio';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import type { PdfMetadata, PdfOutlineEntry, SourceQuality } from '../shared/materials';

export interface ParsedMaterial {
  title: string;
  kind: string;
  fragments: { locator: string; text: string; ordinal: number; pageNumber?: number; printedPageLabel?: string; quality?: SourceQuality; searchableText?: string }[];
  warnings: string[];
  summary: string;
  pdfMetadata?: PdfMetadata;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_FRAGMENT_CHARS = 4000;
const MAX_TEXT_CHARS = 20_000_000;
const MAX_ZIP_ENTRIES = 10_000;

function empty(title: string, kind: string): ParsedMaterial {
  return { title: title.trim() || '未命名材料', kind, fragments: [], warnings: [], summary: '' };
}
function clean(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/[\t ]+\n/g, '\n').trim();
}
function append(result: ParsedMaterial, text: string, locator: string): void {
  const normalized = clean(text);
  if (!normalized) return;
  let offset = 0;
  let part = 1;
  while (offset < normalized.length) {
    let end = Math.min(offset + MAX_FRAGMENT_CHARS, normalized.length);
    if (end < normalized.length) {
      const candidate = normalized.slice(offset, end);
      const breakAt = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf('。'), candidate.lastIndexOf('. '), candidate.lastIndexOf(' '));
      if (breakAt > MAX_FRAGMENT_CHARS / 2) end = offset + breakAt + 1;
      if (/[\uD800-\uDBFF]/.test(normalized[end - 1] ?? '')) end -= 1;
    }
    const segment = normalized.slice(offset, end).trim();
    if (segment) result.fragments.push({ locator: normalized.length > MAX_FRAGMENT_CHARS ? `${locator} · 片段 ${part}` : locator, text: segment, ordinal: result.fragments.length });
    offset = end;
    part += 1;
  }
}
function finish(result: ParsedMaterial): ParsedMaterial {
  const readable = result.fragments.filter(fragment => fragment.text.trim());
  if (!readable.length) result.warnings.push('未提取到可学习的文本，请检查材料是否空白、加密或需要 OCR。');
  const headings = [...new Set(result.fragments.map(fragment => fragment.locator.split(' · ')[0]))].slice(0, 10);
  result.summary = readable.length ? `内容索引：${headings.join('；')}。开篇摘录：${readable.slice(0, 2).map(fragment => fragment.text).join('\n').slice(0, 600)}` : '没有可用文本，请查看原页。';
  result.warnings = [...new Set(result.warnings)];
  return result;
}
function ensureTextSize(text: string): void {
  if (text.length > MAX_TEXT_CHARS) throw new Error('材料文本过长（上限 2000 万字符），请按章节拆分后导入。');
}

export function parseText(text: string, title: string, kind = 'txt'): ParsedMaterial {
  ensureTextSize(text);
  const result = empty(title, kind);
  const lines = clean(text).split('\n');
  let heading = title;
  let paragraph = 0;
  let accumulated: string[] = [];
  const flush = () => {
    if (accumulated.some(line => line.trim())) {
      paragraph += 1;
      append(result, accumulated.join('\n'), `${heading} · 段落 ${paragraph}`);
    }
    accumulated = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    const chapter = /^(第[一二三四五六七八九十百千\d]+[章节篇部]|Chapter\s+\d+)\s*.{0,120}$/i.test(line.trim());
    if (marker || chapter) {
      flush();
      heading = marker ? marker[2] : line.trim();
      paragraph += 1;
      append(result, heading, `${heading} · 段落 ${paragraph}`);
    } else if (!line.trim()) flush();
    else accumulated.push(line);
  }
  flush();
  if (/!\[[^\]]*\]\(|<img\b/i.test(text)) result.warnings.push('材料包含图片引用；本次只提取文本，图片和图表内容需要查看原件。');
  if (/\$\$|\\\[|<math\b/i.test(text)) result.warnings.push('材料包含公式标记；公式仅按文本保留，需核对原件。');
  return finish(result);
}

function validZipPath(value: string): string {
  if (!value || value.includes('\0') || value.includes('\\') || /^(?:[A-Za-z][A-Za-z\d+.-]*:|\/)/.test(value)) throw new Error('压缩材料包含不安全路径。');
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('压缩材料路径越界。');
  return normalized;
}
function openZip(buffer: Buffer): AdmZip {
  let zip: AdmZip;
  try { zip = new AdmZip(buffer); } catch { throw new Error('材料不是有效的 DOCX/EPUB 压缩文件。'); }
  const entries = zip.getEntries();
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error('压缩材料文件数量过多，请拆分后导入。');
  let total = 0;
  for (const entry of entries) {
    validZipPath(entry.entryName);
    if (entry.entryName.split('/').includes('..')) throw new Error('压缩材料包含不安全路径。');
    total += entry.header.size;
    if (!Number.isSafeInteger(total) || total > MAX_EXPANDED_BYTES) throw new Error('压缩材料解压后超过 200 MB，已停止导入。');
    if ((entry.header.flags & 1) !== 0) throw new Error('不支持加密或 DRM 保护的材料。');
  }
  return zip;
}
function zipText(zip: AdmZip, name: string, required = true): string {
  const safeName = validZipPath(name);
  const entry = zip.getEntry(safeName);
  if (!entry || entry.isDirectory) {
    if (required) throw new Error(`材料缺少必要内容：${safeName}`);
    return '';
  }
  if (entry.header.size > MAX_TEXT_CHARS * 2) throw new Error('材料中的单个章节过大，请拆分后导入。');
  if (entry.header.size === 0) return '';
  const buffer = entry.getData();
  if (buffer.length !== entry.header.size || buffer.length > MAX_EXPANDED_BYTES) throw new Error('压缩材料大小校验失败。');
  const text = decodeText(buffer);
  ensureTextSize(text);
  if (/<!ENTITY\s/i.test(text)) throw new Error('材料包含不支持的 XML 实体声明，请另存为普通文档。');
  return text;
}
function localName(element: unknown): string {
  return element && typeof element === 'object' && 'name' in element ? String(element.name).split(':').pop() ?? '' : '';
}
function xmlElements($: CheerioAPI, name: string) {
  return $('*').filter((_, element) => localName(element) === name);
}
function attribute(element: unknown, name: string): string | undefined {
  if (!element || typeof element !== 'object' || !('attribs' in element)) return undefined;
  const attributes = element.attribs as Record<string, string>;
  const key = Object.keys(attributes).find(key => key.split(':').pop() === name);
  return key ? attributes[key] : undefined;
}

function parseDocx(buffer: Buffer, title: string): ParsedMaterial {
  const zip = openZip(buffer);
  const xml = zipText(zip, 'word/document.xml');
  const $ = load(xml, { xml: true });
  const result = empty(title, 'docx');
  const body = xmlElements($, 'body').first();
  if (!body.length) throw new Error('DOCX 缺少正文结构。');
  let section = title;
  let paragraph = 0;
  let tableIndex = 0;
  const paragraphNumbers = new Map<unknown, number>();
  xmlElements($, 'p').each((_, element) => { paragraphNumbers.set(element, ++paragraph); });
  const paragraphText = (element: Parameters<CheerioAPI>[0]) => {
    const parts: string[] = [];
    $(element).find('*').each((_, child) => {
      if ($(child).parents().toArray().some(parent => localName(parent) === 'del')) return;
      if (localName(child) === 't') parts.push($(child).text());
      if (localName(child) === 'tab') parts.push('\t');
      if (['br', 'cr'].includes(localName(child))) parts.push('\n');
    });
    return parts.join('');
  };
  body.children().each((_, element) => {
    if (localName(element) === 'p') {
      const text = paragraphText(element);
      const styleElement = $(element).find('*').toArray().find(child => localName(child) === 'pStyle');
      const style = attribute(styleElement, 'val') ?? '';
      const outline = $(element).find('*').toArray().find(child => localName(child) === 'outlineLvl');
      if (/heading|标题|^title$/i.test(style) || (outline && attribute(outline, 'val') !== '9')) section = clean(text) || section;
      append(result, text, `${section} · 段落 ${paragraphNumbers.get(element)}`);
    } else if (localName(element) === 'tbl') {
      tableIndex += 1;
      let rowIndex = 0;
      $(element).children().filter((_, child) => localName(child) === 'tr').each((_, row) => {
        rowIndex += 1;
        const cells = $(row).children().filter((_, child) => localName(child) === 'tc').toArray().map(cell => {
          return $(cell).find('*').filter((_, child) => localName(child) === 'p').toArray().map(child => paragraphText(child)).join('；');
        });
        append(result, cells.join(' | '), `${section} · 表格 ${tableIndex} 行 ${rowIndex}`);
      });
      result.warnings.push('表格已转换为按行排列的文本；合并单元格、布局与格式需对照原件。');
    } else if (!['sectPr'].includes(localName(element))) {
      result.warnings.push('文档含特殊正文结构，可能未完整提取；请对照原件。');
    }
  });
  if (xmlElements($, 'drawing').length || xmlElements($, 'pict').length || xmlElements($, 'object').length) result.warnings.push('文档包含图片、绘图或嵌入对象；本次未识别其中内容，请查看原件。');
  if (xmlElements($, 'oMath').length || xmlElements($, 'oMathPara').length) result.warnings.push('文档包含公式；公式未可靠转换，需要对照原件。');
  if (zip.getEntry('word/footnotes.xml') || zip.getEntry('word/endnotes.xml')) result.warnings.push('脚注或尾注尚未纳入正文提取，请查看原件。');
  if (xmlElements($, 'del').length || xmlElements($, 'ins').length) result.warnings.push('文档包含修订记录；已提取当前正文并跳过删除的文字，请对照原件确认。');
  return finish(result);
}

function readHtml(html: string, result: ParsedMaterial, chapterPrefix = ''): void {
  ensureTextSize(html);
  const $ = load(html);
  const root = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('[role="main"]').first().length ? $('[role="main"]').first() : $('body');
  if (root.find('img,svg,canvas,picture,video,object,embed').length) result.warnings.push('网页或章节包含图片、图表或媒体；本次只提取可读文本，需核对原件。');
  if (root.find('math').length || /\\\[|\$\$/.test(html)) result.warnings.push('章节包含公式；公式呈现可能不完整，需要对照原件。');
  $('script,style,noscript,template,iframe,object,embed,nav,footer,header,form,button,input,select,textarea,[hidden],[aria-hidden="true"]').remove();
  $('[style]').each((_, element) => {
    if (/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(element).attr('style') ?? '')) $(element).remove();
  });
  $('br').replaceWith('\n');
  let section = root.find('h1,h2,h3').first().text().trim() || result.title;
  let paragraph = 0;
  const blocks = root.find('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,tr,dt,dd').filter((_, element) => {
    if (localName(element) === 'tr') return true;
    return !$(element).parents('p,li,pre,blockquote,tr,dt,dd').length;
  });
  blocks.each((_, element) => {
    paragraph += 1;
    const tag = localName(element);
    const text = tag === 'tr' ? $(element).children('td,th').toArray().map(cell => $(cell).text().trim()).join(' | ') : $(element).text();
    if (/^h[1-6]$/.test(tag)) section = clean(text) || section;
    append(result, text, `${chapterPrefix}${section} · 段落 ${paragraph}`);
  });
  if (!blocks.length) append(result, root.text(), `${chapterPrefix}${section} · 段落 1`);
}

function resolveArchiveReference(baseFile: string, reference: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(reference.split('#')[0].split('?')[0]); }
  catch { throw new Error('EPUB 章节路径编码无效。'); }
  if (!decoded || /^(?:[A-Za-z][A-Za-z\d+.-]*:|[\\/])/.test(decoded)) throw new Error('EPUB 章节包含不安全路径或外部引用。');
  return validZipPath(path.posix.join(path.posix.dirname(baseFile), decoded));
}
function parseEpub(buffer: Buffer, title: string): ParsedMaterial {
  const zip = openZip(buffer);
  if (zip.getEntry('META-INF/encryption.xml') || zip.getEntry('META-INF/rights.xml')) throw new Error('该 EPUB 包含加密、DRM 或字体混淆信息；当前仅支持无加密 EPUB，请使用合法获取的无加密版本。');
  const container = load(zipText(zip, 'META-INF/container.xml'), { xml: true });
  const rootfile = xmlElements(container, 'rootfile').toArray().find(element => attribute(element, 'media-type') === 'application/oebps-package+xml') ?? xmlElements(container, 'rootfile').get(0);
  const packagePath = attribute(rootfile, 'full-path');
  if (!packagePath) throw new Error('EPUB 未声明正文目录。');
  const safePackagePath = validZipPath(packagePath);
  const $ = load(zipText(zip, safePackagePath), { xml: true });
  const bookTitle = xmlElements($, 'title').first().text().trim();
  const result = empty(bookTitle || title, 'epub');
  const manifest = new Map<string, { href: string; media: string }>();
  xmlElements($, 'item').each((_, element) => {
    const id = attribute(element, 'id');
    const href = attribute(element, 'href');
    if (id && href) manifest.set(id, { href, media: attribute(element, 'media-type') ?? '' });
  });
  const spine = xmlElements($, 'itemref').toArray();
  if (!spine.length) throw new Error('EPUB 缺少章节阅读顺序。');
  let chapter = 0;
  let totalText = 0;
  for (const itemref of spine) {
    const reference = manifest.get(attribute(itemref, 'idref') ?? '');
    if (!reference) throw new Error('EPUB 章节索引引用了不存在的内容。');
    const chapterPath = resolveArchiveReference(safePackagePath, reference.href);
    chapter += 1;
    if (!/html|xml/.test(reference.media) && !/\.x?html?$/i.test(chapterPath)) {
      result.warnings.push(`第 ${chapter} 章不是可提取文本的 HTML 内容，已跳过，请查看原件。`);
      continue;
    }
    const html = zipText(zip, chapterPath);
    totalText += html.length;
    if (totalText > MAX_TEXT_CHARS) throw new Error('EPUB 文本过长，请按章节拆分后导入。');
    const before = result.fragments.length;
    readHtml(html, result, `第 ${chapter} 章 · `);
    if (result.fragments.length === before) result.warnings.push(`第 ${chapter} 章未提取到文本，可能为图片章节。`);
  }
  return finish(result);
}

function parseSubtitles(text: string, title: string, kind: string): ParsedMaterial {
  const result = empty(title, kind);
  const blocks = clean(text).split(/\n[ \t]*\n/);
  let malformed = 0;
  for (const block of blocks) {
    if (/^(?:WEBVTT|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block)) continue;
    const lines = block.split('\n');
    const index = lines.findIndex(line => line.includes('-->'));
    if (index === -1) { if (block.trim()) malformed += 1; continue; }
    const timing = /((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{2,}:)?\d{2}:\d{2}[.,]\d{3})/.exec(lines[index]);
    if (!timing) { malformed += 1; continue; }
    const $ = load(lines.slice(index + 1).join('\n'));
    $('script,style').remove();
    const content = $('body').text();
    append(result, content, `${timing[1].replace(',', '.')}–${timing[2].replace(',', '.')}`);
  }
  if (malformed) result.warnings.push(`${malformed} 个字幕片段没有可识别的时间范围，未纳入学习文本，请核对原件。`);
  result.warnings.push('字幕只包含转写文本；画面、板书、语气和未转写信息需要回到原课程核对。');
  return finish(result);
}

/** The loader never fetches external resources and works in the packaged main process. */
export async function withLocalPdf<T>(buffer: Uint8Array, read: (document: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // The packaged main process is CommonJS; tests may load this module as ESM.
  const resolveModule = createRequire(typeof __filename === 'string' ? __filename : path.resolve('package.json'));
  const resources = path.dirname(resolveModule.resolve('pdfjs-dist/package.json'));
  const localResource = (directory: string) => path.join(resources, directory).replaceAll('\\', '/') + '/';
  const task = getDocument({ data: new Uint8Array(buffer), cMapUrl: localResource('cmaps'), cMapPacked: true, standardFontDataUrl: localResource('standard_fonts'), wasmUrl: localResource('wasm'), enableXfa: false, useWorkerFetch: false, disableFontFace: true, useSystemFonts: true, maxImageSize: 40_000_000, verbosity: 0 });
  let document;
  try { document = await task.promise; }
  catch (error) { await task.destroy(); throw new Error(error instanceof Error && error.name === 'PasswordException' ? 'PDF 已加密，请使用合法获取的无密码版本。' : 'PDF 无法解析，文件可能损坏或采用不支持的格式。'); }
  try {
    if (document.numPages > 1500) throw new Error('PDF 超过 1500 页，请按章节拆分后导入。');
    return await read(document);
  } finally { await task.destroy(); }
}

/** These are derived search aids, never replacements for the extracted source. */
export function deriveSearchableTexts(texts: string[]): string[] {
  const normalized = texts.map(text => text.replace(/\r\n?/g, '\n').split('\n'));
  const boundaryCounts = new Map<string, number>();
  const headerCandidate = (line: string) => line.length >= 5 && line.length <= 120 && !/[=∈∉≤≥{}\\$]/.test(line) && (/^[A-Z][A-Z\s\d:.,’'()\-]+$/.test(line) || /^第[一二三四五六七八九十百\d]+[章节]\s+[^。！？]{2,50}$/.test(line));
  const key = (line: string) => line.trim().replace(/\s+/g, ' ');
  for (const lines of normalized) for (const line of new Set([...lines.slice(0, 2), ...lines.slice(-2)].map(key).filter(headerCandidate))) boundaryCounts.set(line, (boundaryCounts.get(line) ?? 0) + 1);
  const repeated = new Set([...boundaryCounts].filter(([, count]) => count >= 3 && count >= texts.length * 0.6).map(([line]) => line));
  return normalized.map(lines => clean(lines.filter((line, index) => {
    const value = key(line);
    if (/^Licensed\s+to\b/i.test(value) || /^License\s+or\s+copyright\s+restrictions\b/i.test(value) || /^Redistribution\s+subject\s+to\b/i.test(value)) return false;
    return !((index < 2 || index >= lines.length - 2) && repeated.has(value));
  }).join('\n')));
}

/** A transparent local index/excerpt, never a claim to have summarized the book. */
export function derivePdfSummary(fragments: { text: string; searchableText?: string; pageNumber?: number }[], metadata: Pick<PdfMetadata, 'outline'>): string {
  const entries = metadata.outline.slice(0, 24);
  const index = entries.length ? entries.map(entry => `${entry.title}（实际页 ${entry.pageNumber}）`).join('；') : '尚无可靠章节目录，可按实际页码阅读';
  const contentEntry = entries.find(entry => !/^(?:cover|title|copyright|contents|table of contents|preface|acknowledg\w*|封面|扉页|版权|目录|前言|序言|致谢)(?:\b|$)/i.test(entry.title.trim()));
  const sourceText = (fragment: { text: string; searchableText?: string }) => fragment.searchableText ?? deriveSearchableTexts([fragment.text])[0];
  const candidate = (contentEntry ? fragments.find(fragment => (fragment.pageNumber ?? 0) >= contentEntry.pageNumber && sourceText(fragment).trim()) : undefined) ?? fragments.find(fragment => sourceText(fragment).trim());
  const excerpt = candidate ? sourceText(candidate).slice(0, 600) : '';
  return `本地阅读索引（非完整摘要）：${index}。\n${excerpt ? `清理页眉后的原文摘录：${excerpt}` : '尚无可用文本，请查看原页；本地索引不代表已理解材料内容。'}`;
}

async function pageQuality(page: PDFPageProxy, text: string): Promise<SourceQuality> {
  const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const operatorList = await page.getOperatorList();
  let images = 0; let fullPageImage = false; let invisibleText = 0; let mode = 0;
  let matrix = [1, 0, 0, 1, 0, 0];
  const states: { matrix: number[]; mode: number }[] = [];
  const pageArea = Math.abs((page.view[2] - page.view[0]) * (page.view[3] - page.view[1]));
  for (let index = 0; index < operatorList.fnArray.length; index++) {
    const fn = operatorList.fnArray[index]; const args = operatorList.argsArray[index];
    if (fn === OPS.save) states.push({ matrix: [...matrix], mode });
    else if (fn === OPS.restore) { const state = states.pop(); if (state) { matrix = state.matrix; mode = state.mode; } }
    else if (fn === OPS.transform) {
      const [a,b,c,d,e,f] = matrix; const [g,h,i,j,k,l] = args as number[];
      matrix = [a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];
    } else if (fn === OPS.setTextRenderingMode) mode = Number(args[0]);
    else if ((fn === OPS.showText || fn === OPS.showSpacedText || fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) && mode % 4 === 3) invisibleText++;
    else if ([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup].includes(fn)) {
      images++;
      if (Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) >= pageArea * 0.7) fullPageImage = true;
    }
  }
  if (!text.trim()) return { kind: images ? 'image-only' : 'unknown', needsVerification: true, reasons: [images ? '本页以图片呈现，未提取到可用文本；请阅读原页或按需转录。' : '本页没有可用文本，可能为空白页或提取失败。'] };
  if (invisibleText > 0 && images > 0) return { kind: 'ocr-text', needsVerification: true, reasons: [`本页包含${fullPageImage ? '整页图像与' : '图片与'}隐藏文字层，属于 OCR 文本；公式、字母和上下标尚未核对。`] };
  if (fullPageImage) return { kind: 'mixed', needsVerification: true, reasons: ['本页包含整页图像和文字，文字可能来自 OCR；请核对原页中的公式与符号。'] };
  if (invisibleText > 0) return { kind: 'unknown', needsVerification: true, reasons: ['本页包含隐藏文字层，提取文本需对照原页核对。'] };
  return { kind: images ? 'mixed' : 'native-text', needsVerification: images > 0, reasons: images ? ['本页含图片或图表，文本提取不包含完整图像信息。'] : [] };
}

async function pdfOutline(document: PDFDocumentProxy): Promise<PdfOutlineEntry[]> {
  const result: PdfOutlineEntry[] = [];
  const visit = async (items: NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>, level: number): Promise<void> => {
    if (level > 8 || result.length >= 500) return;
    for (const item of items.slice(0, 500)) {
      try {
        const dest = typeof item.dest === 'string' ? await document.getDestination(item.dest) : item.dest;
        if (dest?.length) {
          const index = typeof dest[0] === 'number' ? dest[0] : await document.getPageIndex(dest[0]);
          if (Number.isInteger(index) && index >= 0 && index < document.numPages && item.title.trim()) result.push({ title: item.title.trim().slice(0, 240), pageNumber: index + 1, level });
        }
      } catch { /* An invalid bookmark is not a reliable source location. */ }
      if (item.items?.length) await visit(item.items, level + 1);
      if (result.length >= 500) break;
    }
  };
  await visit((await document.getOutline()) ?? [], 1);
  return result;
}

export async function parsePdf(buffer: Uint8Array, title: string): Promise<ParsedMaterial> {
  return withLocalPdf(buffer, async document => {
    const result = empty(title, 'pdf');
    const labels = await document.getPageLabels();
    result.pdfMetadata = { pageCount: document.numPages, pages: [], outline: await pdfOutline(document), analyzedAt: new Date().toISOString() };
    const hasBookmarks = result.pdfMetadata.outline.length > 0;
    let totalText = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const parts: string[] = [];
      let lastY: number | undefined;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5] as number;
        if (lastY !== undefined && Math.abs(y - lastY) > 3 && parts.length && !parts[parts.length - 1].endsWith('\n')) parts.push('\n');
        parts.push(item.str);
        if (item.hasEOL) parts.push('\n');
        else parts.push(' ');
        lastY = y;
      }
      const text = clean(parts.join(''));
      totalText += text.length;
      if (totalText > MAX_TEXT_CHARS) throw new Error('PDF 文本过长，请按章节拆分后导入。');
      const viewport = page.getViewport({ scale: 1 });
      let quality: SourceQuality;
      try { quality = await pageQuality(page, text); }
      catch { quality = { kind: 'unknown', needsVerification: true, reasons: ['本页图像结构无法可靠检查，请对照原页核对文本和公式。'] }; }
      const printedPageLabel = labels?.[pageNumber - 1] || undefined;
      result.pdfMetadata.pages.push({ pageNumber, printedPageLabel, width: viewport.width, height: viewport.height, quality });
      const firstNewFragment = result.fragments.length;
      append(result, text, `第 ${pageNumber} 页`);
      // A source ID is still necessary to view or transcribe a page with no text layer.
      if (result.fragments.length === firstNewFragment) result.fragments.push({ locator: `第 ${pageNumber} 页`, text: '', ordinal: firstNewFragment });
      for (const fragment of result.fragments.slice(firstNewFragment)) Object.assign(fragment, { pageNumber, printedPageLabel, quality });
      if (quality.needsVerification) result.warnings.push(`第 ${pageNumber} 页：${quality.reasons.join(' ')}`);
      if (text.length < 20) result.warnings.push(`第 ${pageNumber} 页${text ? '文本很少' : '未提取到文本'}，可能是扫描、图片页或空白页。`);
      if (!hasBookmarks) {
        const heading = text.split('\n').slice(0, 5).map(line => line.trim().replace(/\s+/g, ' ')).find(line => /^(?:Chapter\s+\d+\b|第[一二三四五六七八九十百\d]+[章篇部])(?:[ :：.\-]|\s)/i.test(line) && line.length < 140);
        if (heading) result.pdfMetadata.outline.push({ title: heading, pageNumber, level: 1 });
      }
      page.cleanup();
    }
    const searchable = deriveSearchableTexts(result.fragments.map(fragment => fragment.text));
    result.fragments.forEach((fragment, index) => { fragment.searchableText = searchable[index]; });
    result.warnings.push('PDF 已按实际页码提取文本；多栏阅读顺序、图表、公式和排版无法保证完整，请对照原件。');
    finish(result);
    result.summary = derivePdfSummary(result.fragments, result.pdfMetadata);
    return result;
  });
}

function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new Error('无法按 UTF-8 或带 BOM 的 UTF-16 读取文本，请另存为 UTF-8 后导入。'); }
}

export async function parseMaterial(filePath: string): Promise<ParsedMaterial> {
  const metadata = await stat(filePath);
  if (!metadata.isFile()) throw new Error('请选择材料文件。');
  if (metadata.size > MAX_FILE_BYTES) throw new Error('单份材料不能超过 50 MB，请拆分后导入。');
  const extension = path.extname(filePath).toLowerCase().slice(1);
  if (!['txt', 'md', 'markdown', 'pdf', 'docx', 'epub', 'srt', 'vtt', 'html', 'htm'].includes(extension)) throw new Error('暂不支持这种格式，请使用 PDF、DOCX、EPUB、TXT、Markdown、SRT 或 VTT。');
  const buffer = await readFile(filePath);
  if (buffer.length > MAX_FILE_BYTES) throw new Error('单份材料不能超过 50 MB。');
  const title = path.basename(filePath, path.extname(filePath));
  if (extension === 'docx') return parseDocx(buffer, title);
  if (extension === 'epub') return parseEpub(buffer, title);
  if (extension === 'pdf') return parsePdf(buffer, title);
  const text = decodeText(buffer);
  ensureTextSize(text);
  if (extension === 'srt' || extension === 'vtt') return parseSubtitles(text, title, extension);
  if (extension === 'html' || extension === 'htm') {
    const result = empty(title, 'html');
    readHtml(text, result);
    return finish(result);
  }
  return parseText(text, title, extension === 'markdown' ? 'md' : extension);
}

export async function parseArticle(html: string, url: string): Promise<ParsedMaterial> {
  const parsedUrl = new URL(url);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('文章地址必须是 HTTP 或 HTTPS 网页。');
  ensureTextSize(html);
  const $ = load(html);
  const title = $('article h1,main h1,h1').first().text().trim() || $('title').first().text().trim() || parsedUrl.hostname;
  const result = empty(title, 'article');
  readHtml(html, result);
  result.warnings.push('已保存导入时的网页文本；后续网页修改不会自动更新本地材料。');
  return finish(result);
}






