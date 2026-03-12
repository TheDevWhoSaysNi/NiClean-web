// NiClean Web Logic
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();
const logEl = document.getElementById('log');
const startBtn = document.getElementById('startBtn');
const fileInput = document.getElementById('fileInput');
const platformSelect = document.getElementById('platformSelect');
const includeLogCheckbox = document.getElementById('includeLog');

let batchLogs = [];

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
    // 1. Cloudflare Turnstile Check
    const turnstileResponse = turnstile.getResponse();
    if (!turnstileResponse) {
        niLog("Error: Please complete the human verification.");
        return;
    }

    const files = fileInput.files;
    if (files.length === 0) {
        niLog("Error: No files selected.");
        return;
    }

    startBtn.disabled = true;
    batchLogs = []; // Reset logs for new batch
    
    niLog("Loading FFmpeg.wasm from local public folder...");

    try {
        // Loading from local public/ffmpeg/ folder as planned
        await ffmpeg.load({
            coreURL: './public/ffmpeg/ffmpeg-core.js',
            wasmURL: './public/ffmpeg/ffmpeg-core.wasm',
            workerURL: './public/ffmpeg/ffmpeg-core.worker.js'
        });
    } catch (err) {
        niLog("Critical Error: Could not load FFmpeg. Check your COOP/COEP headers.");
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

        // Determine Extension and New Filename
        let targetExt = isVideo ? (platform === 'ios' ? 'mov' : 'mp4') : 'jpg';
        let newName = file.name;

        if (platform === 'android') newName = getAndroidName(targetExt);
        else if (platform === 'ios') newName = getIosName(ni, targetExt);

        // Load file into virtual FS
        await ffmpeg.writeFile('input', await fetchFile(file));

        // CLEAN & CONVERT
        // -map_metadata -1 removes all metadata
        if (isVideo) {
            niLog("Cleaning video metadata...");
            // -c copy is used to ensure zero quality loss and maximum speed
            await ffmpeg.exec(['-i', 'input', '-map_metadata', '-1', '-c:v', 'copy', '-c:a', 'copy', 'output.' + targetExt]);
        } else if (isImage) {
            niLog("Converting/Cleaning image...");
            await ffmpeg.exec(['-i', 'input', '-map_metadata', '-1', 'output.jpg']);
        }

        // Export result to user
        const data = await ffmpeg.readFile('output.' + targetExt);
        const url = URL.createObjectURL(new Blob([data.buffer], { type: isVideo ? 'video/mp4' : 'image/jpeg' }));
        
        const a = document.createElement('a');
        a.href = url;
        a.download = newName;
        a.click();
        
        niLog(`Successfully cleaned: ${newName}`);
        
        // Clean up virtual FS memory for next file
        await ffmpeg.deleteFile('input');
    }

    // Optional: Download log file
    if (includeLogCheckbox.checked) {
        const logBlob = new Blob([batchLogs.join('\n')], { type: 'text/plain' });
        const logUrl = URL.createObjectURL(logBlob);
        const logLink = document.createElement('a');
        logLink.href = logUrl;
        logLink.download = 'niclean_batch_log.txt';
        logLink.click();
    }

    niLog("All files processed. Ni!");
    startBtn.disabled = false;
    
    // Reset Turnstile for next batch
    turnstile.reset();
});
