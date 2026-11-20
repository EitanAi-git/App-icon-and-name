const IDENTITY_CACHE = 'identity'; // shared with sw.js
const DEFAULT_NAME = 'My App';
const url = (p) => new URL(p, document.baseURI).href;
const $ = (id) => document.getElementById(id);

const form = $('form');
const photoInput = $('photo');
const nameInput = $('name');
const status = $('status');
const installBtn = $('install');
let pendingPreviewUrl = null;

function setStatus(msg) { status.textContent = msg; }

async function loadIdentity() {
  const cache = await caches.open(IDENTITY_CACHE);
  const res = await cache.match(url('__identity/config.json'));
  return res ? res.json() : null;
}

async function applyIdentity() {
  const id = await loadIdentity();
  const name = id?.name || DEFAULT_NAME;
  let iconSrc = 'icons/default-512.png';
  if (id?.hasIcon) {
    const blob = await (await caches.open(IDENTITY_CACHE)).match(url('__identity/icon-512.png'));
    if (blob) iconSrc = URL.createObjectURL(await blob.blob());
  }
  document.title = name;
  $('preview-name').textContent = name;
  $('preview-icon').src = iconSrc;
  $('favicon').href = iconSrc;
  $('apple-icon').href = iconSrc;
  nameInput.value = id?.name || '';
}

// Center-crop the photo to a square and render it at `size` px as PNG.
function renderIcon(bitmap, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function ensureControlled() {
  if (!('serviceWorker' in navigator)) return;
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return;
  await new Promise((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
    setTimeout(resolve, 3000);
  });
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
  pendingPreviewUrl = URL.createObjectURL(file);
  $('preview-icon').src = pendingPreviewUrl;
});

nameInput.addEventListener('input', () => {
  $('preview-name').textContent = nameInput.value.trim() || DEFAULT_NAME;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim() || DEFAULT_NAME;
  const file = photoInput.files[0];
  const cache = await caches.open(IDENTITY_CACHE);
  const prev = await loadIdentity();
  let hasIcon = prev?.hasIcon || false;

  try {
    setStatus('Saving…');
    if (file) {
      const bitmap = await createImageBitmap(file);
      for (const size of [192, 512]) {
        const blob = await renderIcon(bitmap, size);
        await cache.put(url(`__identity/icon-${size}.png`),
          new Response(blob, { headers: { 'Content-Type': 'image/png' } }));
      }
      hasIcon = true;
    }
    const config = { name, hasIcon, version: Date.now() };
    await cache.put(url('__identity/config.json'),
      new Response(JSON.stringify(config), { headers: { 'Content-Type': 'application/json' } }));

    await ensureControlled();
    setStatus('Saved! Reloading so the app picks up the new icon and name…');
    // Reload so Chrome re-reads the (service-worker generated) manifest.
    setTimeout(() => location.reload(), 600);
  } catch (err) {
    console.error(err);
    setStatus('Could not use that image. Try a JPG or PNG.');
  }
});

$('reset').addEventListener('click', async () => {
  await caches.delete(IDENTITY_CACHE);
  setStatus('Reset to default. Reloading…');
  setTimeout(() => location.reload(), 400);
});

// Custom install button (Chrome's own install icon in the address bar also works).
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => setStatus('Installed!'));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(async () => {
    // First visit: once the worker takes control, reload once so the
    // manifest is served by it (needed for a customised icon at install time).
    if (!navigator.serviceWorker.controller && (await loadIdentity())) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    }
  });
}
applyIdentity();
