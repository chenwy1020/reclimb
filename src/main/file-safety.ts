import { basename, extname } from 'node:path';
const SUPPORTED = new Set([
  '.pdf',
  '.docx',
  '.epub',
  '.txt',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.srt',
  '.vtt',
]);
export function safeMaterialFilename(name: string): string {
  const base = basename(name),
    ext = extname(base).toLowerCase();
  if (!SUPPORTED.has(ext)) throw new Error('不支持的原件格式');
  const stem =
    base
      .slice(0, -ext.length)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 180 - ext.length) || 'material';
  return stem + ext;
}
export function canOpenOriginal(name: string): boolean {
  const ext = extname(name).toLowerCase();
  return SUPPORTED.has(ext) && !['.html', '.htm'].includes(ext);
}
