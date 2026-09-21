#!/usr/bin/env node
/* A static server over the repo root, so the service worker and the manifest
   are reachable. `npm run serve` → http://localhost:5173. The same handler the
   mobile pass uses, factored out so both agree about MIME types — a manifest
   served as text/plain is ignored silently, which is a long afternoon. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.css':  'text/css; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8'
};

/* opts.index lets the mobile pass point the root at a different index.html
   (the pre-fix snapshot, for the before/after grid) without moving any files. */
export function serve({ root = ROOT, index = null, port = 0, host = '127.0.0.1' } = {}){
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    const send = (code, type, body) => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store',
                            'Service-Worker-Allowed': '/' });
      res.end(body);
    };
    if (rel === '/' || rel === '/index.html') {
      const file = index || path.join(root, 'index.html');
      if (!fs.existsSync(file)) return send(404, MIME['.txt'], 'no index.html');
      return send(200, MIME['.html'], fs.readFileSync(file));
    }
    const file = path.join(root, rel.replace(/^\/+/, ''));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
      return send(404, MIME['.txt'], 'not found');
    send(200, MIME[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
  });
  return new Promise(resolve => srv.listen(port, host,
    () => resolve({ srv, port: srv.address().port, url: `http://${host}:${srv.address().port}/` })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await serve({ port: +(process.env.PORT || 5173) });
  console.log('Ply on ' + url + '  (ctrl-c to stop)');
}
