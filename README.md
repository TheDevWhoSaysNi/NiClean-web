# NiClean Web

A privacy-first, client-side metadata cleaner for photos and videos. This tool is built by **TheDevWhoSaysNi** to ensure that sensitive information (like GPS coordinates and camera serials) is stripped from your media before you share it.

**Live Site:** [niclean.suncoastservers.com](https://niclean.suncoastservers.com)

## Why NiClean?
* **Privacy First:** All processing happens in your browser using WebAssembly. No files are ever uploaded to any server.
* **Zero Bandwidth:** Since the heavy lifting is done by your own CPU, the site uses virtually no server bandwidth.
* **Platform Standardized:** Automatically renames and formats files for iPhone or Android standards.
* **Open Source:** Built using `FFmpeg.wasm`.

## How it Works
The site is hosted on **GitHub** and deployed via **Cloudflare Pages**. It uses a custom `_headers` file to enable the security headers (`COOP/COEP`) required for multi-threaded FFmpeg processing in the browser.

## Instructions for Forking
If you want to run your own version of NiClean:

1.  **Fork the repo** to your own GitHub account.
2.  **Download the binaries:** Ensure the `public/ffmpeg/` folder contains `ffmpeg-core.js` and `ffmpeg-core.wasm` (v0.12.6).
3.  **Setup Cloudflare Pages:**
    * Connect your fork to Cloudflare Pages.
    * Set the **Build Command** and **Output Directory** to be empty.
    * Cloudflare will automatically detect the `_headers` file to make FFmpeg work.
4.  **Turnstile:** Get your own Site Key from the Cloudflare Turnstile dashboard and update it in `index.html`.

## Ni
Ni!