import { MAX_IMAGE_BYTES, rasterInfo } from '../shared/raster-image';
import { inkPagesSchema, type InkPage } from '../shared/handwriting';
import { newId, type LocalDraft } from './draft';
/** Files are decoded locally for readability; original raster bytes are saved unchanged. */
export async function readImagePage(file: File): Promise<InkPage> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('每张图片不能超过 6 MB，请在 iPad 中分次截图。');
  const bytes = new Uint8Array(await file.arrayBuffer()),
    info = rasterInfo(bytes);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const dataUrl = 'data:' + info.mime + ';base64,' + btoa(binary);
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth !== info.width || image.naturalHeight !== info.height)
        reject(new Error('图片方向或尺寸无法可靠读取，请使用 iPad 截图。'));
      else resolve();
    };
    image.onerror = () => reject(new Error('这张图片无法打开，请重新选择截图。'));
    image.src = dataUrl;
  });
  return {
    id: newId(),
    width: 768,
    height: 1024,
    strokes: [],
    image: { dataUrl, width: info.width, height: info.height },
  };
}
export function appendImagePages(draft: LocalDraft, images: InkPage[]): void {
  // Empty placeholder pages are not submitted alongside screenshot-only answers.
  const kept = draft.pages.filter((page) => page.image || page.strokes.length),
    result = inkPagesSchema.safeParse([...kept, ...images]);
  if (!result.success) throw new Error('每份原稿最多 12 页，图片合计不能超过 16 MB。请分次提交。');
  draft.pages = result.data;
  draft.pageId = images[0]?.id ?? draft.pages[0].id;
}
