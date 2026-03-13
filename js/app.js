// NiClean Web Logic
// FFmpeg comes from UMD script (js/ffmpeg/ffmpeg.js) so the worker is same-origin
import { fetchFile } from '@ffmpeg/util';
import ExifReader from 'exifreader';

/** Unified metadata scan for images/videos using ExifReader; returns { text, lines, kb } or null */
async function scanMetadata(input) {
    try {
        let tags;
        const options = {
            expanded: true,      // keep Exif / IPTC / XMP / etc. separate
            includeUnknown: true // surface non-standard / JUMBF / C2PA-style blocks when possible
        };
        if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
            // Synchronous API for ArrayBuffer/TypedArray
            tags = ExifReader.load(input, options);
        } else {
            // Asynchronous API for File/Blob/URL
            tags = await ExifReader.load(input, options);
        }
        if (!tags || Object.keys(tags).length === 0) return null;

        // Drop thumbnail to avoid bloating logs
        delete tags.Thumbnail;

        // Flatten expanded groups (exif/xmp/iptc/...) into a single, consistently ordered list
        const flat = [];
        for (const groupName of Object.keys(tags)) {
            if (!tags[groupName] || typeof tags[groupName] !== 'object') continue;
            if (groupName === 'file') continue; // usually file system info, very noisy
            const group = tags[groupName];
            for (const tagName of Object.keys(group)) {
                const entry = group[tagName];
                const desc = entry && 'description' in entry
                    ? String(entry.description)
                    : JSON.stringify(entry && entry.value);
                // Use "Group.Tag" as the key so ordering is stable before/after
                flat.push({ key: `${groupName}.${tagName}`, line: `${tagName}: ${desc}` });
            }
        }

        if (!flat.length) return null;

        flat.sort((a, b) => a.key.localeCompare(b.key));
        const linesArr = flat.map(x => x.line);
        const text = linesArr.join('\n');
        const kb = (new TextEncoder().encode(text).length / 1024).toFixed(2);
        return { text, lines: linesArr.length, kb };
    } catch (e) {
        if (typeof console !== 'undefined' && console.error) console.error('scanMetadata:', e);
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

let batchLogs = [];     // what you see in the on-page log
let exportLogs = [];    // what goes into the downloadable .txt (may include metadata details)
let batchMetadataLogs = []; // per-file full metadata, used when building the export

// Helper to update the UI and internal log
const niLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${msg}`;
    batchLogs.push(entry);
    exportLogs.push(entry);
    
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
    exportLogs = [];
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

        // Metadata scan before cleaning (images/videos; ExifReader where supported)
        let beforeMeta = '';
        if (isImage || isVideo) {
            try {
                const scan = await scanMetadata(file);
                if (scan) {
                    niLog(`Running metadata scan… found ${scan.kb} KB (${scan.lines} lines) of metadata.`);
                    beforeMeta = scan.text;
                    if (includeLogCheckbox.checked) {
                        exportLogs.push(`\n--- METADATA BEFORE CLEANING: ${file.name} ---\n${beforeMeta || '(none or unavailable)'}`);
                    }
                } else {
                    niLog(`Running metadata scan… no metadata or unsupported format.`);
                }
            } catch (e) {
                niLog(`Running metadata scan… skipped (${e.message || 'error'}).`);
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
        const outBlob = new Blob([data.buffer], { type: mimeType });
        const url = URL.createObjectURL(outBlob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = newName;
        a.click();
        
        niLog(`Successfully cleaned: ${newName}`);

        // Metadata scan on cleaned output (images/videos; ExifReader where supported)
        let afterMeta = '';
        if (isImage || isVideo) {
            try {
                const buf = await outBlob.arrayBuffer();
                const scan = await scanMetadata(buf);
                if (scan) {
                    niLog(`Running scan… found ${scan.kb} KB (${scan.lines} lines) of metadata.`);
                    afterMeta = scan.text;
                    if (includeLogCheckbox.checked) {
                        exportLogs.push(`\n--- METADATA AFTER CLEANING: ${newName} ---\n${afterMeta || '(none or unavailable)'}`);
                    }
                } else {
                    niLog(`Running scan… found 0 KB (0 lines) of metadata.`);
                }
            } catch (e) {
                niLog(`Running scan… found 0 KB (0 lines) of metadata.`);
            }
        }

        if (includeLogCheckbox.checked) {
            batchMetadataLogs.push({ fileName: file.name, newName, beforeMeta, afterMeta });
        }

        // Clean up virtual FS memory for next file
        await ffmpeg.deleteFile('input');
    }

    // Optional: Download log file (with full metadata before/after interleaved as processing happens)
    if (includeLogCheckbox.checked) {
        let logText = exportLogs.join('\n');
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
