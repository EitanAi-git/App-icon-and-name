// Service worker: serves a *customised* manifest and icons from Cache Storage,
// so the installed app picks up the name and photo you chose.
const VERSION = '1.3.0'; // keep in sync with APP_VERSION in app.js
const SHELL_CACHE = `shell-${VERSION}`;
const IDENTITY_CACHE = 'identity'; // shared with app.js
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/default-192.png',
  'icons/default-512.png',
];

const scopeUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) =>
    c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== SHELL_CACHE && key !== IDENTITY_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function getIdentity() {
  const cache = await caches.open(IDENTITY_CACHE);
  const res = await cache.match(scopeUrl('__identity/config.json'));
  return res ? res.json() : null;
}

async function manifestResponse(request) {
  let base;
  try {
    base = await (await fetch(request.url.split('?')[0], { cache: 'no-store' })).json();
  } catch {
    base = await (await caches.match(scopeUrl('manifest.webmanifest'))).json();
  }
  const id = await getIdentity();
  if (id) {
    base.name = id.name;
    base.short_name = id.name;
    if (id.hasIcon) {
      const v = id.version;
      base.icons = [
        { src: `icons/custom-192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `icons/custom-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `icons/custom-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ];
    }
  }
  return new Response(JSON.stringify(base), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' },
  });
}

async function customIconResponse(url) {
  const size = url.pathname.endsWith('custom-192.png') ? 192 : 512;
  const cache = await caches.open(IDENTITY_CACHE);
  const hit = await cache.match(scopeUrl(`__identity/icon-${size}.png`));
  return hit || caches.match(scopeUrl(`icons/default-${size}.png`));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/manifest.webmanifest')) {
    event.respondWith(manifestResponse(event.request));
    return;
  }
  if (/\/icons\/custom-(192|512)\.png$/.test(url.pathname)) {
    event.respondWith(customIconResponse(url));
    return;
  }
  // App shell: network first, fall back to cache (works offline).
  event.respondWith((async () => {
    try {
      // 'no-cache' revalidates with the server so updates show up right away.
      const res = await fetch(event.request, { cache: 'no-cache' });
      if (res.ok && url.href.startsWith(self.registration.scope)) {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy));
      }
      return res;
    } catch {
      return (await caches.match(event.request, { ignoreSearch: true })) || Response.error();
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'version') event.source.postMessage({ type: 'version', version: VERSION });
});
