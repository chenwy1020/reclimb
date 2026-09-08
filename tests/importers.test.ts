import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { parseArticle, parseMaterial, parseText } from '../src/importers';

let directory: string;
beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), 'reclimb-importers-')); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
async function archive(name: string, entries: Record<string, string>) {
  const zip = new AdmZip();
  for (const [name, text] of Object.entries(entries)) zip.addFile(name, Buffer.from(text));
  const target = path.join(directory, name);
  await writeFile(target, zip.toBuffer());
  return target;
}
function epubEntries() {
  return {
    'mimetype': 'application/epub+zip',
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf': '<package><metadata><dc:title xmlns:dc="urn:dc">论证课</dc:title></metadata><manifest><item id="first" href="z.xhtml" media-type="application/xhtml+xml"/><item id="second" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>',
    'OPS/z.xhtml': '<html><body><h1>先学前提</h1><p>前提支持结论。</p></body></html>',
    'OPS/a.xhtml': '<html><body><h1>再看结论</h1><p>结论需要根据。</p></body></html>',
  };
}
function tinyPdf(pages: (string | null)[]): Buffer {
  const bodies: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const pageIds: number[] = [];
  for (const text of pages) {
    const pageId = bodies.length + 1;
    pageIds.push(pageId);
    const commands = text ? `BT /F1 14 Tf 40 240 Td (${text}) Tj ET` : '';
    bodies.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${pageId + 1} 0 R >>`);
    bodies.push(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`);
  }
  bodies[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  let document = '%PDF-1.4\n';
  const offsets = [0];
  bodies.forEach((body, index) => { offsets.push(Buffer.byteLength(document)); document += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(document);
}

describe('material import', () => {
  it('preserves headings, deterministic source locations and bounded text fragments', () => {
    const source = '# 概率\n\n独立事件的概率。\n\n## 条件概率\n\n' + '比较给定条件后的结果。'.repeat(500);
    const first = parseText(source, '概率教材', 'md');
    expect(first.fragments[0].locator).toContain('概率');
    expect(first.fragments.map(f => f.ordinal)).toEqual(first.fragments.map((_, i) => i));
    expect(first.fragments.every(f => f.text.length <= 4000)).toBe(true);
    expect(first.fragments.map(f => f.locator)).toEqual(parseText(source, '概率教材', 'md').fragments.map(f => f.locator));
    expect(first.fragments.map(f => f.text).join('')).toContain('独立事件的概率。');
  });

  it('does not claim empty content was understood', () => {
    const result = parseText(' \n\n ', '空白');
    expect(result.fragments).toEqual([]);
    expect(result.warnings.join('')).toMatch(/未.*文本|空白|无.*文本/);
  });

  it('extracts DOCX headings, real paragraph positions and tables while flagging drawings', async () => {
    const target = await archive('lesson.docx', {
      'word/document.xml': '<w:document xmlns:w="urn:w"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>论证基础</w:t></w:r></w:p><w:p><w:r><w:t>先写出前提。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>前提</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>根据</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>',
    });
    const result = await parseMaterial(target);
    expect(result.fragments.map(f => f.text).join('\n')).toContain('前提 | 根据');
    expect(result.fragments.find(f => f.text.includes('先写出'))?.locator).toMatch(/论证基础.*段落 2/);
    expect(result.fragments.every(f => !/第\s*\d+\s*页/.test(f.locator))).toBe(true);
    expect(result.warnings.join('')).toMatch(/图|绘图/);
  });

  it('follows EPUB spine reading order, rather than filename order', async () => {
    const result = await parseMaterial(await archive('lesson.epub', epubEntries()));
    const combined = result.fragments.map(f => f.text).join('\n');
    expect(result.title).toBe('论证课');
    expect(combined.indexOf('先学前提')).toBeLessThan(combined.indexOf('再看结论'));
    expect(result.fragments[0].locator).toContain('第 1 章');
  });

  it('rejects encrypted EPUBs explicitly', async () => {
    const target = await archive('encrypted.epub', { ...epubEntries(), 'META-INF/encryption.xml': '<encryption><EncryptedData/></encryption>' });
    await expect(parseMaterial(target)).rejects.toThrow(/加密|DRM/);
  });

  it('rejects EPUB spine references that escape the archive root', async () => {
    const entries = epubEntries();
    entries['OPS/book.opf'] = entries['OPS/book.opf'].replace('z.xhtml', '../../outside.xhtml');
    await expect(parseMaterial(await archive('escape.epub', entries))).rejects.toThrow(/路径|越界|不安全/);
  });

  it('preserves multiline subtitles with actual time ranges and strips cue markup', async () => {
    const target = path.join(directory, 'course.srt');
    await writeFile(target, '1\n00:00:01,250 --> 00:00:04,000\n<b>第一句。</b>\n第二句。\n\n2\n00:00:05,000 --> 00:00:07,500\n第三句。');
    const result = await parseMaterial(target);
    expect(result.fragments).toHaveLength(2);
    expect(result.fragments[0].locator).toContain('00:00:01.250–00:00:04.000');
    expect(result.fragments[0].text).toBe('第一句。\n第二句。');
  });

  it('accepts WebVTT cue identifiers, metadata and time settings', async () => {
    const target = path.join(directory, 'course.vtt');
    await writeFile(target, 'WEBVTT\n\nNOTE 不应成为教材\n这是一段注释\n\nintro\n00:01.000 --> 00:03.500 align:start\n<v Lecturer>条件改变判断。</v>');
    const result = await parseMaterial(target);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0].text).toBe('条件改变判断。');
    expect(result.fragments[0].locator).toContain('00:01.000–00:03.500');
  });

  it('removes executable and navigation HTML without fetching outside resources', async () => {
    const result = await parseArticle('<html><head><title>公开课程</title><script>sendSecret()</script></head><body><nav>导航广告</nav><article><h1>论证</h1><p>检查前提。<script>doEvil()</script></p><img src="https://invalid.test/x.png"><iframe src="https://invalid.test"></iframe><p hidden>隐藏指令</p></article></body></html>', 'https://example.org/article');
    const text = result.fragments.map(f => f.text).join('\n');
    expect(text).toContain('检查前提。');
    expect(text).not.toMatch(/sendSecret|doEvil|导航广告|隐藏指令|<script/);
    expect(result.warnings.join('')).toMatch(/图/);
    expect(result.fragments[0].locator).toContain('论证');
  });

  it('keeps actual PDF page numbers and flags pages with no extracted text', async () => {
    const target = path.join(directory, 'pages.pdf');
    await writeFile(target, tinyPdf(['Probability connects evidence to belief.', null]));
    const result = await parseMaterial(target);
    expect(result.fragments[0].locator).toBe('第 1 页');
    expect(result.fragments[0].text).toContain('Probability');
    expect(result.warnings.join('')).toMatch(/第 2 页/);
    expect(result.warnings.join('')).toMatch(/扫描|文本/);
  });
});

it('decodes Chinese PDF fonts using only bundled local character maps', async () => {
  const commands = 'BT /F1 14 Tf 40 240 Td <69827387> Tj ET';
  const pdf = `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj\n4 0 obj << /Length ${commands.length} >> stream\n${commands}\nendstream\nendobj\n5 0 obj << /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >> endobj\n6 0 obj << /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 /FontDescriptor << /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >> >> endobj\ntrailer << /Root 1 0 R /Size 7 >>\n%%EOF`;
  const target = path.join(directory, 'chinese.pdf');
  await writeFile(target, pdf);
  const result = await parseMaterial(target);
  expect(result.fragments.map(fragment => fragment.text).join('')).toContain('概率');
});

it('rejects oversized archive metadata before decompressing the entry', async () => {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from('<document/>'));
  const buffer = zip.toBuffer();
  const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  buffer.writeUInt32LE(201 * 1024 * 1024, central + 24);
  const target = path.join(directory, 'oversized.docx');
  await writeFile(target, buffer);
  await expect(parseMaterial(target)).rejects.toThrow(/200 MB/);
});

it('rejects unknown formats and unsupported legacy text encodings clearly', async () => {
  const unsupported = path.join(directory, 'legacy.doc');
  await writeFile(unsupported, 'not a docx');
  await expect(parseMaterial(unsupported)).rejects.toThrow(/格式/);
  const encoded = path.join(directory, 'legacy.txt');
  await writeFile(encoded, Buffer.from([0xb8, 0xc5, 0xc2, 0xca]));
  await expect(parseMaterial(encoded)).rejects.toThrow(/UTF-8/);
});

