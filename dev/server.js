#!/usr/bin/env node
/**
 * YuruMC dev server.
 *
 * Serves src/ like the production nginx does. Pages that exist in
 * templates/ are re-expanded on every request, so template edits show up
 * on refresh without running `npm run build` (run `npm run build-css` in
 * another terminal for Tailwind). Missing paths get the themed 404 page.
 *
 * Usage: node dev/server.js   (then open http://localhost:8080)
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandFile } from '../build.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const TEMPLATES = join(ROOT, 'templates');
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

/** Expand a template page if one exists for this path, else null. */
function page(rel) {
  return existsSync(join(TEMPLATES, rel)) ? expandFile(rel) : null;
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');

  const html = rel.endsWith('.html') ? page(rel) : null;
  if (html !== null) return send(res, 200, html, MIME['.html']);

  const file = join(SRC, rel);
  if (file.startsWith(SRC) && existsSync(file) && statSync(file).isFile()) {
    return send(res, 200, readFileSync(file), MIME[extname(file)] || 'application/octet-stream');
  }

  send(res, 404, page('error/404.html') || 'Not Found', MIME['.html']);
}).listen(PORT, () => {
  console.log(`YuruMC dev server: http://localhost:${PORT}  (append ?theme=dark|light to force a scheme)`);
});
