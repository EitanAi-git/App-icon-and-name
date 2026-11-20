# App Icon and Name

An installable web app (PWA) where **you choose the icon and the name**.
Upload a photo, type a name, hit **Save** — the photo becomes the app icon and
the name is the label shown under it once installed.

## Publish with GitHub Pages

1. Repo **Settings → Pages**.
2. *Source*: **Deploy from a branch**, pick the branch with these files and `/ (root)`.
3. Open `https://<your-user>.github.io/App-icon-and-name/`.

## Install

- **Chrome (desktop):** click the install icon in the address bar, or
  ⋮ menu → *Cast, save and share* → *Install page as app*.
- **Android Chrome:** ⋮ menu → *Add to Home screen* → *Install*.
- Or use the **Install app** button on the page when it appears.

**Tip:** customize *before* installing — the install then uses your photo and name right away.

## Changing it after install

Save a new photo/name, then open the installed app. Chrome re-checks the app's
manifest and asks you to confirm the new name/icon (it may take a launch or
two, and Chrome throttles these checks). If it doesn't update, uninstall and
reinstall.

## How it works

- `manifest.webmanifest` is the default manifest.
- When you save, `app.js` center-crops the photo into 192px and 512px PNGs and
  stores them plus the name in the browser's Cache Storage.
- `sw.js` (the service worker) intercepts requests for the manifest and returns
  a version with your name and icons (`icons/custom-*.png`, also served from the cache).

Only the **installed app** shows your photo and name: it opens straight to
your photo, full screen (tap **Edit** to change it). The website in a normal browser tab keeps the default look.

Everything stays in your browser — nothing is uploaded anywhere.
