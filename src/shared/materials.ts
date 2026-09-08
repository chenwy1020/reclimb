/** Source coordinates use the complete upright PDF page, with a top-left origin. */
export interface SourceRegion { x:number; y:number; width:number; height:number; }
export interface SourceQuality {
 kind:'native-text'|'ocr-text'|'image-only'|'mixed'|'unknown';
 needsVerification:boolean;
 reasons:string[];
}
export interface PdfPageDetails {
 pageNumber:number;
 printedPageLabel?:string;
 width:number;
 height:number;
 quality:SourceQuality;
}
export interface PdfOutlineEntry { title:string; pageNumber:number; level:number; }
export interface PdfMetadata {
 pageCount:number;
 pages:PdfPageDetails[];
 outline:PdfOutlineEntry[];
 analyzedAt:string;
}
export interface SourceTranscription {
 id:string;
 projectId:string;
 materialId:string;
 fragmentId:string;
 pageNumber:number;
 region?:SourceRegion;
 version:number;
 text:string;
 status:'machine'|'confirmed';
 /** Missing on older archives; confirmation preserves the original authoring path. */
 origin?:'machine'|'manual';
 createdAt:string;
 confirmedAt?:string;
 model?:string;
 uncertainties:string[];
}
export interface SourceTextResult {text:string;warnings:string[];transcriptionIds:string[];}

/** Old workspaces locate PDF fragments by their unchanged physical-page locator. */
export function physicalPage(fragment: { pageNumber?: number; locator: string }): number | undefined {
  const page = fragment.pageNumber ?? Number(/^第\s+(\d+)\s+页(?:\s|$)/.exec(fragment.locator)?.[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : undefined;
}

export function sourceRegionKey(region?: SourceRegion): string {
  return region ? [region.x, region.y, region.width, region.height].map(value => value.toFixed(6)).join(':') : 'page';
}

type SourceFragment = { id: string; projectId: string; materialId: string; locator: string; pageNumber?: number; text: string; searchableText?: string; quality?: SourceQuality };
function confirmedForSource(fragment: SourceFragment, transcriptions: SourceTranscription[]) {
  const page = physicalPage(fragment);
  const candidates = transcriptions.filter(item => item.status === 'confirmed' && item.fragmentId === fragment.id && item.materialId === fragment.materialId && item.projectId === fragment.projectId && item.pageNumber === page);
  const latest = new Map<string, SourceTranscription>();
  for (const item of candidates) {
    const key = sourceRegionKey(item.region);
    const previous = latest.get(key);
    if (!previous || item.version > previous.version || (item.version === previous.version && item.createdAt > previous.createdAt)) latest.set(key, item);
  }
  const fullPage = latest.get('page');
  const regions = [...latest.values()].filter(item => item.region && (!fullPage || item.createdAt > fullPage.createdAt));
  return { fullPage, regions };
}

/** Machine output is never silently promoted into verified textbook content. */
export function sourceText(fragment: SourceFragment, transcriptions: SourceTranscription[] = []): SourceTextResult {
  const { fullPage, regions } = confirmedForSource(fragment, transcriptions);
  const used = fullPage ? [fullPage, ...regions] : regions;
  const text = [fullPage?.text ?? fragment.searchableText ?? fragment.text, ...regions.map(item => `已核对的局部转录（原页区域 ${sourceRegionKey(item.region)}）：\n${item.text}`)].join('\n\n');
  const warnings = fullPage ? [] : fragment.quality?.needsVerification ? [...fragment.quality.reasons] : [];
  if (regions.length && !fullPage) warnings.push('只有标注区域经过核对，页面其他提取文本仍需对照原页。');
  return { text, warnings: [...new Set(warnings)], transcriptionIds: used.map(item => item.id) };
}

/** Budget source content before sending it to a model; corrected formulas get priority. */
export function sourceExcerpt(fragment: SourceFragment, transcriptions: SourceTranscription[], limit: number): SourceTextResult {
  const budget = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const { fullPage, regions } = confirmedForSource(fragment, transcriptions);
  const warnings: string[] = [];
  const transcriptionIds: string[] = [];
  const pieces: string[] = [];
  let remaining = budget;
  const append = (label: string, content: string): number => {
    const prefix = (pieces.length ? '\n\n' : '') + label;
    if (remaining <= prefix.length || !content) return 0;
    let end = Math.min(content.length, remaining - prefix.length);
    if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1] ?? '')) end--;
    if (!end) return 0;
    const piece = prefix + content.slice(0, end);
    pieces.push(piece); remaining -= piece.length;
    return end;
  };
  const prioritized = [...regions, ...(fullPage ? [fullPage] : [])];
  let fullPageComplete = false;
  for (const item of prioritized) {
    const included = append(item.region ? `已核对的局部转录（区域 ${sourceRegionKey(item.region)}）：\n` : '已核对的整页转录：\n', item.text);
    if (included) transcriptionIds.push(item.id);
    if (included < item.text.length) warnings.push(included ? '已核对转录仅提供了选段，未包含完整版本。' : '另有已核对转录因长度限制未提供，本次不能据此推断其内容。');
    if (!item.region && included === item.text.length) fullPageComplete = true;
  }
  if (!fullPage) {
    const raw = fragment.searchableText ?? fragment.text;
    const included = append(regions.length ? '页面其余提取文本（公式仍需对照原页）：\n' : '', raw);
    if (included < raw.length) warnings.push('原始提取文本仅提供了选段，尚未覆盖整页。');
  }
  if (!fullPageComplete && fragment.quality?.needsVerification) warnings.push(...fragment.quality.reasons);
  if (regions.length && !fullPageComplete) warnings.push('只有已标注区域经过核对，页面其他部分未在本次得到完整验证。');
  return { text: pieces.join(''), warnings: [...new Set(warnings)], transcriptionIds };
}
