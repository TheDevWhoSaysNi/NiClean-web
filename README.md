# NiClean Web

A privacy-first, client-side metadata cleaner for photos and videos. This tool is built by **TheDevWhoSaysNi** to ensure that sensitive information (like GPS coordinates and camera serials) is stripped from your media before you share it.

**Live Site:** [niclean.suncoastservers.com](https://niclean.suncoastservers.com)

## Why NiClean?
* **Privacy First:** All processing happens in your browser using WebAssembly. No files are ever uploaded to any server.
* **Zero Bandwidth:** Since the heavy lifting is done by your own CPU, the site uses virtually no server bandwidth.
* **Platform Standardized:** Automatically renames and formats files for iPhone or Android standards.
* **Open Source:** Built using `FFmpeg.wasm`.

## How it Works
The site is hosted on **GitHub** and deployed via **Cloudflare Pages**. It uses a custom `_headers` file (COOP/COEP are optional and currently commented out so the CDN worker can load).

## Instructions for Forking
If you want to run your own version of NiClean:

1.  **Fork the repo** to your own GitHub account.
2.  **FFmpeg.wasm:** The `js/ffmpeg/` folder contains the UMD build (ffmpeg.js, 814.ffmpeg.js worker, ffmpeg-core.js) so the worker and core load same-origin and avoid cross-origin/atob errors. The WASM binary is loaded from jsDelivr CDN. `@ffmpeg/util` from esm.sh. Core v0.12.1.
3.  **Setup Cloudflare Pages:**
    * Connect your fork to Cloudflare Pages.
    * Set the **Build Command** and **Output Directory** to be empty.
    * Cloudflare will automatically detect the `_headers` file to make FFmpeg work.
4.  **Turnstile:** Get your own Site Key from the Cloudflare Turnstile dashboard and update it in `index.html`.

## Ni
Ni!