// Production static hosting of the built client (vite build → dist/) with an SPA fallback to index.html.
// Hashed assets under /assets/ are cached for a year; everything else revalidates.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};

async function fileSize(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

export function createStaticHandler(rootDir: string): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const root = resolve(rootDir);
  const indexPath = join(root, 'index.html');

  function send(req: IncomingMessage, res: ServerResponse, path: string, size: number, cache: string): void {
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(path);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  function notFound(res: ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not found');
  }

  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      notFound(res);
      return;
    }
    if (pathname.includes('\0')) {
      notFound(res);
      return;
    }
    const candidate = normalize(join(root, pathname));
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      notFound(res);
      return;
    }
    const target = pathname.endsWith('/') ? join(candidate, 'index.html') : candidate;
    const size = await fileSize(target);
    if (size !== null) {
      const immutable = pathname.startsWith('/assets/');
      send(req, res, target, size, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      return;
    }
    // SPA fallback: extension-less paths are client routes.
    if (!extname(pathname)) {
      const indexSize = await fileSize(indexPath);
      if (indexSize !== null) {
        send(req, res, indexPath, indexSize, 'no-cache');
        return;
      }
    }
    notFound(res);
  };
}
