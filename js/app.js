// NiClean Web Logic
// FFmpeg comes from UMD script (js/ffmpeg/ffmpeg.js) so the worker is same-origin
import { fetchFile } from '@ffmpeg/util';
import ExifReader from 'exifreader';
import { getImageInfoFromBlob, getVideoInfoFromBlob } from './media-info.js';

/** Unified metadata scan for images/videos using ExifReader; returns { text, lines, kb } or null */
async function scanMetadata(input) {
    try {
        const options = {
            expanded: true,      // Keeps groups like XMP/IPTC organized
            includeUnknown: true // Crucial for surfacing raw AI / JUMBF / C2PA-style blocks
        };

        const tags = (input instanceof ArrayBuffer || ArrayBuffer.isView(input))
            ? ExifReader.load(input, options)
            : await ExifReader.load(input, options);

        if (!tags || Object.keys(tags).length === 0) return null;

        // Flatten groups into a single list while avoiding some noisy filesystem/thumbnail data
        const flatLines = [];
        for (const [groupName, groupTags] of Object.entries(tags)) {
            if (!groupTags || typeof groupTags !== 'object') continue;
            // Skip the noisiest groups to keep logs readable
            if (['file', 'Thumbnail', 'MakerNotes'].includes(groupName)) continue;

            for (const [tagName, tagData] of Object.entries(groupTags)) {
                const value = tagData && 'description' in tagData
                    ? String(tagData.description)
                    : JSON.stringify(tagData && tagData.value);
                flatLines.push(`${groupName}.${tagName}: ${value}`);
            }
        }

        if (flatLines.length === 0) return null;

        flatLines.sort((a, b) => a.localeCompare(b));
        const text = flatLines.join('\n');
        const kb = (new TextEncoder().encode(text).length / 1024).toFixed(2);
        return { text, lines: flatLines.length, kb };
    } catch (e) {
        if (typeof console !== 'undefined') console.error('Ni Scan Error:', e);
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

let batchLogs = [];        // chronological log for both UI and export
let batchMetadataLogs = []; // per-file full metadata, appended after the main log in the export

// Helper to update the UI and internal log
const niLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${msg}`;
    batchLogs.push(entry);

    const div = document.createElement('div');
    div.innerHTML = entry.replace(/\n/g, '<br>');
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

        // Metadata scan before cleaning (images/videos; ExifReader where supported)
        let beforeMeta = '';
        if (isImage || isVideo) {
            try {
                const infoLines = [];
                if (isImage) {
                    const info = await getImageInfoFromBlob(file);
                    if (info && info.width && info.height) {
                        infoLines.push(`Dimensions: ${info.width}x${info.height} px`);
                    }
                    if (info && info.sizeKB) {
                        infoLines.push(`Approx size: ${info.sizeKB} KB`);
                    }
                } else if (isVideo) {
                    const info = await getVideoInfoFromBlob(file);
                    if (info && info.width && info.height) {
                        infoLines.push(`Dimensions: ${info.width}x${info.height} px`);
                    }
                    if (info && typeof info.duration === 'number' && info.duration > 0) {
                        infoLines.push(`Duration: ${info.duration.toFixed(2)} s`);
                    }
                    if (info && info.bitrateKbps) {
                        infoLines.push(`Approx bitrate: ${info.bitrateKbps} kbps`);
                    }
                    if (info && info.sizeKB) {
                        infoLines.push(`Approx size: ${info.sizeKB} KB`);
                    }
                }

                const scan = await scanMetadata(file);
                if (scan) {
                    niLog(`Running metadata scan… found ${scan.kb} KB (${scan.lines} lines) of metadata.`);
                    if (infoLines.length) {
                        beforeMeta = infoLines.join('\n') + '\n\n' + scan.text;
                    } else {
                        beforeMeta = scan.text;
                    }
                } else {
                    niLog(`Running metadata scan… no metadata or unsupported format.`);
                    if (infoLines.length) {
                        beforeMeta = infoLines.join('\n');
                    }
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
                const infoLines = [];
                if (isImage) {
                    const info = await getImageInfoFromBlob(outBlob);
                    if (info && info.width && info.height) {
                        infoLines.push(`Dimensions: ${info.width}x${info.height} px`);
                    }
                    if (info && info.sizeKB) {
                        infoLines.push(`Approx size: ${info.sizeKB} KB`);
                    }
                } else if (isVideo) {
                    const info = await getVideoInfoFromBlob(outBlob);
                    if (info && info.width && info.height) {
                        infoLines.push(`Dimensions: ${info.width}x${info.height} px`);
                    }
                    if (info && typeof info.duration === 'number' && info.duration > 0) {
                        infoLines.push(`Duration: ${info.duration.toFixed(2)} s`);
                    }
                    if (info && info.bitrateKbps) {
                        infoLines.push(`Approx bitrate: ${info.bitrateKbps} kbps`);
                    }
                    if (info && info.sizeKB) {
                        infoLines.push(`Approx size: ${info.sizeKB} KB`);
                    }
                }

                const buf = await outBlob.arrayBuffer();
                const scan = await scanMetadata(buf);
                if (scan) {
                    niLog(`Running scan… found ${scan.kb} KB (${scan.lines} lines) of metadata.`);
                    if (infoLines.length) {
                        afterMeta = infoLines.join('\n') + '\n\n' + scan.text;
                    } else {
                        afterMeta = scan.text;
                    }
                } else {
                    niLog(`Running scan… found 0 KB (0 lines) of metadata.`);
                    if (infoLines.length) {
                        afterMeta = infoLines.join('\n');
                    }
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

    // Optional: Download log file (main log first, then per-file full metadata before/after)
    if (includeLogCheckbox.checked) {
        let logText = batchLogs.join('\n');
        if (batchMetadataLogs.length > 0) {
            logText += '\n\n' + '='.repeat(60) + '\nFULL METADATA BEFORE & AFTER (PER FILE)\n' + '='.repeat(60);
            for (const entry of batchMetadataLogs) {
                logText += `\n\n--- BEFORE: ${entry.fileName} ---\n${entry.beforeMeta || '(none or unavailable)'}`;
                logText += `\n\n--- AFTER: ${entry.newName} ---\n${entry.afterMeta || '(none or unavailable)'}\n`;
            }
        }
        logText += '\n\nRecommendation: For extra verification, you can run the latest ExifTool CLI on your original and cleaned files (for example: exiftool -a -G -s filename.JPG) or use a trusted open-source viewer such as the advanced ExifReader demo to confirm that all metadata has been removed.';
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
