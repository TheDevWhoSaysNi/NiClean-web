// NiClean Web Logic
// FFmpeg comes from UMD script (js/ffmpeg/ffmpeg.js) so the worker is same-origin
import { fetchFile } from '@ffmpeg/util';
import wasm_exif from '@saschazar/wasm-exif';
import ISOBoxer from 'codem-isoboxer';

// Lazy-init EXIF module (images only); ExifTool.wasm had WASM load issues from CDN
let exifModulePromise = null;
function getExifModule() {
    if (!exifModulePromise) exifModulePromise = wasm_exif();
    return exifModulePromise;
}
// Video container metadata tag names (MP4/MOV ilst); surfaces encoder, comment, AI tool names, etc.
const VIDEO_META_TAG_NAMES = {
    '\u00a9too': 'Encoder / Tool',
    '\u00a9cmt': 'Comment',
    '\u00a9nam': 'Title',
    '\u00a9aut': 'Author',
    '\u00a9cpy': 'Copyright',
    '\u00a9day': 'Date',
    '\u00a9des': 'Description',
    '\u00a9gen': 'Genre',
    '\u00a9wrt': 'Writer',
    '\u00a9swr': 'Software',
    '\u00a9xyz': 'Location',
    '----': 'Custom'
};

/** Find first child box with given type (walk .boxes; fetch may not support all types e.g. ilst) */
function findBox(container, type) {
    if (!container || !container.boxes) return null;
    const t = String(type);
    for (const b of container.boxes) {
        if ((b.type || '').trim() === t) return b;
    }
    return null;
}

/** Extract container metadata from MP4/MOV buffer (moov/udta/meta/ilst); returns { text, lines, kb } or null */
function scanVideoMetadata(buffer) {
    if (!buffer || !(buffer.byteLength || buffer.length)) return null;
    try {
        const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
        const root = ISOBoxer.parseBuffer(ab);
        if (!root) return null;
        const moov = (root.boxes && findBox(root, 'moov')) || (root.fetch && root.fetch('moov'));
        if (!moov) return null;
        const lines = [];
        const mvhd = findBox(moov, 'mvhd') || (moov.fetch && moov.fetch('mvhd'));
        if (mvhd) {
            let timescale = mvhd.timescale;
            let duration = mvhd.duration;
            if ((timescale == null || duration == null) && (mvhd._raw || mvhd.data)) {
                const raw = mvhd._raw || mvhd.data;
                const view = raw instanceof DataView ? raw : new DataView(raw.buffer, raw.byteOffset || 0, raw.byteLength || raw.length);
                if (view.byteLength >= 12) {
                    const ver = view.getUint32(0, false);
                    if (ver === 0) {
                        timescale = timescale ?? view.getUint32(4, false);
                        duration = duration ?? view.getUint32(8, false);
                    } else if (view.byteLength >= 20) {
                        timescale = timescale ?? view.getUint32(4, false);
                        duration = duration ?? Number(view.getBigUint64(8, false));
                    }
                }
            }
            if (timescale && duration) {
                const sec = (Number(duration) / timescale).toFixed(2);
                lines.push(`Duration: ${sec} s (timescale ${timescale})`);
            }
        }
        const udta = findBox(moov, 'udta') || (moov.fetch && moov.fetch('udta'));
        const meta = udta ? (findBox(udta, 'meta') || (udta.fetch && udta.fetch('meta'))) : null;
        const ilst = meta ? (findBox(meta, 'ilst') || (meta.fetch && meta.fetch('ilst'))) : null;
        if (ilst && ilst.boxes && ilst.boxes.length) {
            for (const tagBox of ilst.boxes) {
                const tagType = (tagBox.type || '').trim();
                if (!tagType) continue;
                const name = VIDEO_META_TAG_NAMES[tagType] || `Tag ${JSON.stringify(tagType)}`;
                const dataBox = findBox(tagBox, 'data') || (tagBox.fetch && tagBox.fetch('data'));
                let value = '(no data)';
                if (dataBox) {
                    const raw = dataBox._raw || dataBox.data;
                    if (raw && (raw.byteLength || raw.length) > 16) {
                        const buf = raw.buffer ? new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength || raw.length) : new Uint8Array(raw);
                        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
                        const type = view.getUint32(8, false);
                        if (type === 1) {
                            try {
                                value = new TextDecoder('utf-8').decode(buf.subarray(16)).replace(/\0+$/, '').trim();
                            } catch (_) {
                                value = '(decode error)';
                            }
                        } else {
                            value = `(binary, type ${type})`;
                        }
                    }
                }
                lines.push(`${name}: ${String(value).trim() || '(empty)'}`);
            }
        }
        if (lines.length === 0) return null;
        const text = lines.join('\n');
        const kb = (text.length / 1024).toFixed(2);
        return { text, lines: lines.length, kb };
    } catch (e) {
        if (typeof console !== 'undefined' && console.error) console.error('scanVideoMetadata:', e);
        return null;
    }
}

/** Run EXIF scan on image buffer; returns { text, lines, kb } or null on skip/fail */
async function scanExif(buffer) {
    if (!buffer || !buffer.length) return null;
    try {
        const mod = await getExifModule();
        const result = await Promise.resolve(mod.exif(buffer, buffer.length));
        if (result == null) return null;
        const obj = typeof result === 'object' ? result : { value: result };
        const text = JSON.stringify(obj, null, 2);
        const lines = text.split(/\n/).length;
        const kb = (text.length / 1024).toFixed(2);
        return { text, lines, kb };
    } catch (e) {
        if (typeof console !== 'undefined' && console.error) console.error('scanExif:', e);
        return null;
    }
}

// FFmpeg from UMD (js/ffmpeg/ffmpeg.js) so worker 814.ffmpeg.js is same-origin
const FFmpegClass = (window.FFmpegWASM && window.FFmpegWASM.FFmpeg);
if (!FFmpegClass) throw new Error('FFmpeg UMD not loaded. Ensure js/ffmpeg/ffmpeg.js runs before app.js.');
const ffmpeg = new FFmpegClass();

// Core JS is same-origin so worker's importScripts() works; WASM stays on CDN (large)
const FFMPEG_VERSION = '0.12.1';
const CORE_JS_SAME_ORIGIN = (() => {
    const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
    return base + 'js/ffmpeg/ffmpeg-core.js';
})();
const WASM_CDN_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_VERSION}/dist/umd/ffmpeg-core.wasm`;
const logEl = document.getElementById('log');
const startBtn = document.getElementById('startBtn');
const fileInput = document.getElementById('fileInput');
const platformSelect = document.getElementById('platformSelect');
const includeLogCheckbox = document.getElementById('includeLog');

let batchLogs = [];
/** When "Include processing log" is checked, per-file ExifTool before/after for the download log */
let batchMetadataLogs = [];

// Helper to update the UI and internal log
const niLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${msg}`;
    batchLogs.push(entry);
    
    const div = document.createElement('div');
    div.innerHTML = entry;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
};

// Enable Start button when at least one file is selected
const updateStartButtonState = () => {
    const hasFiles = fileInput.files && fileInput.files.length > 0;
    startBtn.disabled = !hasFiles;
    startBtn.style.opacity = hasFiles ? "1" : "0.3";
    startBtn.style.cursor = hasFiles ? "pointer" : "not-allowed";
};

fileInput.addEventListener('change', updateStartButtonState);

// Generic Android naming: YYYYMMDD_HHMMSSSSS
const getAndroidName = (ext) => {
    const now = new Date();
    const datePart = now.toISOString().split('T')[0].replace(/-/g, '');
    const timePart = now.getHours().toString().padStart(2, '0') +
                     now.getMinutes().toString().padStart(2, '0') +
                     now.getSeconds().toString().padStart(2, '0') +
                     now.getMilliseconds().toString().padStart(3, '0');
    return `${datePart}_${timePart}.${ext}`;
};

// iPhone naming: IMG_XXXX.ext
const getIosName = (index, ext) => {
    const num = (index + 1).toString().padStart(4, '0');
    return `IMG_${num}.${ext}`;
};

startBtn.addEventListener('click', async () => {
    const files = fileInput.files;
    if (files.length === 0) {
        niLog("Ni! Error: No files selected.");
        return;
    }

    startBtn.disabled = true;
    batchLogs = [];
    batchMetadataLogs = [];

    niLog(`Loading FFmpeg v${FFMPEG_VERSION} from CDN...`);

    try {
        await ffmpeg.load({
            coreURL: CORE_JS_SAME_ORIGIN,
            wasmURL: WASM_CDN_URL
        });
        niLog(`Engine loaded. Starting batch...`);
    } catch (err) {
        niLog("Critical Error: FFmpeg failed to load.");
        console.error(err);
        startBtn.disabled = false;
        return;
    }

    niLog(`Starting batch: ${files.length} files detected.`);

    // Loop to handle individual files one at a time to minimize resource usage on smaller computers
    for (let ni = 0; ni < files.length; ni++) {
        const file = files[ni];
        const platform = platformSelect.value;
        const isVideo = file.type.startsWith('video');
        const isImage = file.type.startsWith('image');

        niLog(`Processing (${ni + 1}/${files.length}): ${file.name}`);

        // EXIF scan (images only; wasm-exif is JPEG/TIFF); before cleaning
        let beforeMeta = '';
        if (isImage) {
            try {
                const buf = new Uint8Array(await file.arrayBuffer());
                const scan = await scanExif(buf);
                if (scan) {
                    niLog(`Running ExifTool… found ${scan.kb} KB (${scan.lines} lines) of metadata.`);
                    beforeMeta = scan.text;
                } else {
                    niLog(`Running ExifTool… no metadata or unsupported format.`);
                }
            } catch (e) {
                niLog(`Running ExifTool… skipped (${e.message || 'error'}).`);
            }
        } else if (isVideo) {
            try {
                const buf = await file.arrayBuffer();
                const scan = scanVideoMetadata(buf);
                if (scan) {
                    niLog(`Running ExifTool… found ${scan.kb} KB (${scan.lines} lines) of metadata.`);
                    beforeMeta = scan.text;
                } else {
                    niLog(`Running ExifTool… no metadata or unsupported format.`);
                }
            } catch (e) {
                niLog(`Running ExifTool… skipped (${e.message || 'error'}).`);
            }
        }

        // Determine internal processing extension (always lowercase for FFmpeg)
        let targetExt = isVideo ? (platform === 'ios' ? 'mov' : 'mp4') : 'jpg';
        let newName = file.name;

        // Decide how the downloaded filename should look
        if (platform === 'android') {
            // Android: lowercase extensions (.jpg / .mp4)
            const nameExt = targetExt.toLowerCase();
            newName = getAndroidName(nameExt);
        } else if (platform === 'ios') {
            // iPhone: uppercase extensions (.JPG / .MOV)
            const nameExt = targetExt.toUpperCase();
            newName = getIosName(ni, nameExt);
        } // "original" keeps the exact original filename (including its extension and casing)

        // Load file into virtual FS
        await ffmpeg.writeFile('input', await fetchFile(file));

        // CLEAN & CONVERT: -map_metadata -1 strips metadata; -fflags/-flags +bitexact avoids Lavc/Lavf encoder tags
        if (isVideo) {
            niLog("Cleaning video metadata...");
            await ffmpeg.exec([
                '-i', 'input',
                '-map_metadata', '-1',
                '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
                '-c:v', 'copy', '-c:a', 'copy',
                'output.' + targetExt
            ]);
        } else if (isImage) {
            niLog("Converting/Cleaning image...");
            await ffmpeg.exec([
                '-i', 'input',
                '-map_metadata', '-1',
                '-fflags', '+bitexact', '-flags:v', '+bitexact',
                'output.' + targetExt
            ]);
        }

        // Export result to user
        const data = await ffmpeg.readFile('output.' + targetExt);
        const mimeType = isVideo
            ? (targetExt.toLowerCase() === 'mov' ? 'video/quicktime' : 'video/mp4')
            : 'image/jpeg';
        const url = URL.createObjectURL(new Blob([data.buffer], { type: mimeType }));
        
        const a = document.createElement('a');
        a.href = url;
        a.download = newName;
        a.click();
        
        niLog(`Successfully cleaned: ${newName}`);

        // Metadata scan on cleaned output: EXIF for images, container for video
        let afterMeta = '';
        if (isImage) {
            try {
                const buf = new Uint8Array(data.buffer);
                const scan = await scanExif(buf);
                if (scan) {
                    niLog(`Running scan… found ${scan.kb} KB (${scan.lines} lines) of metadata.`);
                    afterMeta = scan.text;
                } else {
                    niLog(`Running scan… found 0 KB (0 lines) of metadata.`);
                }
            } catch (_) {
                niLog(`Running scan… found 0 KB (0 lines) of metadata.`);
            }
        } else if (isVideo) {
            try {
                const scan = scanVideoMetadata(data.buffer);
                if (scan) {
                    niLog(`Running scan… found ${scan.kb} KB (${scan.lines} lines) of metadata.`);
                    afterMeta = scan.text;
                } else {
                    niLog(`Running scan… found 0 KB (0 lines) of metadata.`);
                }
            } catch (_) {
                niLog(`Running scan… found 0 KB (0 lines) of metadata.`);
            }
        }

        if (includeLogCheckbox.checked) {
            batchMetadataLogs.push({ fileName: file.name, newName, beforeMeta, afterMeta });
        }

        // Clean up virtual FS memory for next file
        await ffmpeg.deleteFile('input');
    }

    // Optional: Download log file (with full ExifTool before/after if checkbox was checked)
    if (includeLogCheckbox.checked) {
        let logText = batchLogs.join('\n');
        if (batchMetadataLogs.length > 0) {
            logText += '\n\n' + '='.repeat(60) + '\nFULL METADATA (EXIF) BEFORE & AFTER\n' + '='.repeat(60);
            for (const entry of batchMetadataLogs) {
                logText += `\n\n--- BEFORE: ${entry.fileName} ---\n${entry.beforeMeta || '(none or unavailable)'}`;
                logText += `\n\n--- AFTER: ${entry.newName} ---\n${entry.afterMeta || '(none or unavailable)'}\n`;
            }
        }
        const logBlob = new Blob([logText], { type: 'text/plain' });
        const logUrl = URL.createObjectURL(logBlob);
        const logLink = document.createElement('a');
        logLink.href = logUrl;
        logLink.download = 'niclean_batch_log.txt';
        logLink.click();
    }

    niLog("All files processed. Done!");
    fileInput.value = '';
    updateStartButtonState();
});
