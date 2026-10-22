import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import http from 'node:http';
export function isPublicAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(ip) === 4) {
    const n = ip.split('.').map(Number);
    return !(
      n[0] === 0 ||
      n[0] === 10 ||
      n[0] === 127 ||
      n[0] >= 224 ||
      (n[0] === 169 && n[1] === 254) ||
      (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
      (n[0] === 192 && n[1] === 168) ||
      (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
      (n[0] === 198 && (n[1] === 18 || n[1] === 19))
    );
  }
  if (isIP(ip) === 6) {
    return /^2[0-9a-f]{3}:/.test(ip) && !ip.startsWith('2001:db8:');
  }
  return false;
}
export async function fetchPublicArticle(
  input: string,
  redirects = 0,
): Promise<{ html: string; url: string }> {
  const url = new URL(input);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new Error('仅支持不带账号信息的公开HTTP/HTTPS文章地址');
  if (redirects > 4) throw new Error('文章跳转次数过多');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error('公开文章导入不能访问本机、局域网或保留地址');
  const selected = addresses[0];
  const result = await new Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    bytes: Buffer;
  }>((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get(
      url,
      {
        headers: {
          'User-Agent': 'Reclimb-Learning/0.1 (+public-article-import)',
          Accept: 'text/html,text/plain',
          'Accept-Encoding': 'identity',
        },
        lookup: ((_: string, opts: any, cb: any) =>
          opts?.all ? cb(null, [selected]) : cb(null, selected.address, selected.family)) as any,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) {
            req.destroy(new Error('文章超过5MB，请下载为文档后导入'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            bytes: Buffer.concat(chunks),
          }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(15000, () => req.destroy(new Error('文章加载超时，请稍后重试或粘贴文字')));
    req.on('error', reject);
  });
  if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.location)
    return fetchPublicArticle(new URL(result.headers.location, url).toString(), redirects + 1);
  if (result.status !== 200)
    throw new Error(
      '无法读取公开文章（' + result.status + '）。需要登录或动态加载的内容可复制文字后导入。',
    );
  const ct = String(result.headers['content-type'] ?? '');
  if (ct && !/text\/(html|plain)|application\/xhtml/i.test(ct))
    throw new Error('链接返回的不是文章页面，请下载对应文档后导入。');
  const charset = ct.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ?? 'utf-8';
  let html: string;
  try {
    html = new TextDecoder(charset).decode(result.bytes);
  } catch {
    html = result.bytes.toString('utf8');
  }
  return { html, url: url.toString() };
}
