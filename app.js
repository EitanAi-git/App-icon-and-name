const APP_VERSION = '1.3.1'; // bump on every change (also VERSION in sw.js)
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

// True when opened as the installed app (not in a normal browser tab).
const isInstalledApp =
  matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay), (display-mode: fullscreen)').matches ||
  navigator.standalone === true;

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
  // iOS "Add to Home Screen" reads these tags, so they always carry your choice.
  $('apple-icon').href = iconSrc;
  $('apple-title').content = name;
  nameInput.value = id?.name || '';

  // Only the installed app shows your photo and name; the website keeps the default look.
  const shownName = isInstalledApp ? name : DEFAULT_NAME;
  const shownIcon = isInstalledApp ? iconSrc : 'icons/default-512.png';
  document.title = shownName;
  $('preview-name').textContent = shownName;
  $('preview-icon').src = shownIcon;
  $('favicon').href = isInstalledApp ? iconSrc : 'icons/default-192.png';
  $('mode-note').textContent = isInstalledApp
    ? ''
    : 'This website keeps the default look. Opening the installed app shows your photo.';

  // Installed app: open straight to the photo, full screen.
  if (isInstalledApp && id?.hasIcon) {
    const cache = await caches.open(IDENTITY_CACHE);
    const res = (await cache.match(url('__identity/photo.jpg'))) ||
      (await cache.match(url('__identity/icon-512.png')));
    if (res) {
      $('viewer-img').src = URL.createObjectURL(await res.blob());
      $('viewer-img').alt = name;
      showViewer(true);
    }
  }
}

function showViewer(on) {
  $('viewer').hidden = !on;
  $('card').hidden = on;
}

// Load the photo already shrunk so its shorter side is `size` px.
// Drawing a full-size phone photo (e.g. 4000x3000+) onto a canvas can come
// out black on Android, so the browser's decoder does the shrinking instead.
function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(src); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('decode failed')); };
    img.src = src;
  });
}

async function loadScaled(file, img, size, fit = 'cover') {
  // naturalWidth/Height already account for the photo's rotation (EXIF).
  const w = img.naturalWidth, h = img.naturalHeight;
  const scale = size / (fit === 'cover' ? Math.min(w, h) : Math.max(w, h));
  if (scale >= 1) return img;
  try {
    return await createImageBitmap(file, {
      resizeWidth: Math.round(w * scale),
      resizeHeight: Math.round(h * scale),
      resizeQuality: 'high',
      imageOrientation: 'from-image',
    });
  } catch {
    return img;
  }
}

// Center-crop to a square and render at `size` px.
function drawSquare(source, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const side = Math.min(w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return canvas;
}

// True if the canvas is (almost) entirely black or transparent.
function looksBlank(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.length; i += 4 * 97) {
    if (data[i + 3] > 10 && data[i] + data[i + 1] + data[i + 2] > 30) return false;
  }
  return true;
}

// The full photo (not cropped), longest side at most `maxSide` px, as JPEG.
async function renderPhoto(file, img, maxSide) {
  const src = await loadScaled(file, img, maxSide, 'contain');
  const canvas = document.createElement('canvas');
  canvas.width = src.naturalWidth || src.width;
  canvas.height = src.naturalHeight || src.height;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, canvas.width, canvas.height);
  if (looksBlank(canvas) && src !== img) {
    // Same fallback as the icon: draw from the <img> directly.
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

async function renderIcon(file, img, size) {
  let canvas = drawSquare(await loadScaled(file, img, size), size);
  // Fallback: shrink in steps from the <img> if the first attempt came out black.
  if (looksBlank(canvas)) {
    let src = img;
    let cur = Math.max(img.naturalWidth, img.naturalHeight);
    while (cur / 2 > size * 2) {
      cur = Math.round(cur / 2);
      const step = document.createElement('canvas');
      const k = cur / Math.max(img.naturalWidth, img.naturalHeight);
      step.width = Math.round(img.naturalWidth * k);
      step.height = Math.round(img.naturalHeight * k);
      step.getContext('2d').drawImage(src, 0, 0, step.width, step.height);
      src = step;
    }
    canvas = drawSquare(src, size);
  }
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
      const img = await loadImageElement(file);
      for (const size of [192, 512]) {
        const blob = await renderIcon(file, img, size);
        await cache.put(url(`__identity/icon-${size}.png`),
          new Response(blob, { headers: { 'Content-Type': 'image/png' } }));
      }
      const photo = await renderPhoto(file, img, 2048);
      await cache.put(url('__identity/photo.jpg'),
        new Response(photo, { headers: { 'Content-Type': 'image/jpeg' } }));
      hasIcon = true;
    }
    const config = { name, hasIcon, version: Date.now() };
    await cache.put(url('__identity/config.json'),
      new Response(JSON.stringify(config), { headers: { 'Content-Type': 'application/json' } }));

    await ensureControlled();
    setStatus(isInstalledApp
      ? 'Saved! Reloading to show your photo…'
      : 'Saved! Open the installed app to see your photo and name. Reloading…');
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

function showVersion(swVersion) {
  const mode = isInstalledApp ? 'installed app' : 'browser tab';
  $('version').textContent = `Version ${APP_VERSION} · worker ${swVersion || '…'} · ${mode}`;
}
showVersion();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'version') showVersion(e.data.version);
  });
  navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage('version'));
  // A new worker took over (the site was updated): reload once to use the new files.
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) { reloading = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(async (reg) => {
    reg.update();
    // First visit: once the worker takes control, reload once so the
    // manifest is served by it (needed for a customised icon at install time).
    if (!navigator.serviceWorker.controller && (await loadIdentity())) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    }
  });
}
applyIdentity();
