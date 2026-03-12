// The Dev Who Says Ni - NiClean Web Logic
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();
const logEl = document.getElementById('log');
const startBtn = document.getElementById('startBtn');
const fileInput = document.getElementById('fileInput');
const platformSelect = document.getElementById('platformSelect');

// Helper to update the "Ni" Log
const niLog = (msg) => {
    const entry = document.createElement('div');
    entry.innerHTML = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
};

// Android naming: YYYYMMDD_HHMMSSSSS
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
    if (files.length === 0) return niLog("Error: No files selected.");

    startBtn.disabled = true;
    niLog("Loading FFmpeg.wasm...");

    // Load FFmpeg from CDN (Ensure COOP/COEP headers are set on Suncoast Servers)
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    niLog(`Starting batch: ${files.length} files detected.`);

    // THE NI LOOP
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

        // STRIP & CONVERT
        // -map_metadata -1 nukes all metadata
        // -c:v copy / -c:a copy skips re-encoding for speed if formats match
        if (isVideo) {
            niLog("Cleaning video metadata...");
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
    }

    niLog("All files processed. Ni!");
    startBtn.disabled = false;
});
