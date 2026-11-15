import { readdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = (await readdir('dist/assets')).filter((f) => /\.(js|css)$/.test(f));
const revision = createHash('sha256')
  .update((await readFile('dist/index.html')).toString() + files.join('|'))
  .digest('hex')
  .slice(0, 12);
const assets = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/fonts/Inter-400.ttf',
  '/fonts/Inter-500.ttf',
  '/fonts/Inter-600.ttf',
  '/fonts/Inter-700.ttf',
  ...files.map((f) => '/assets/' + f),
];
await writeFile(
  'dist/sw.js',
  `const CACHE='rafiq-shell-${revision}';const SHELL=${JSON.stringify(assets)};self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('rafiq-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/downloads/'))return;if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));return;}if(SHELL.includes(u.pathname))event.respondWith(caches.match(event.request).then(c=>c||fetch(event.request)));});`,
);
console.log('Service worker built: static app assets only; no customer records or API cache.');
