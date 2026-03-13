// Helper utilities for deriving basic media info directly from image/video content (not metadata).

export function getImageInfoFromBlob(blob) {
    return new Promise((resolve) => {
        try {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                const width = img.naturalWidth;
                const height = img.naturalHeight;
                URL.revokeObjectURL(url);
                resolve({
                    width,
                    height,
                    sizeKB: (blob.size / 1024).toFixed(2)
                });
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(null);
            };
            img.src = url;
        } catch (_) {
            resolve(null);
        }
    });
}

export function getVideoInfoFromBlob(blob) {
    return new Promise((resolve) => {
        try {
            const url = URL.createObjectURL(blob);
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
                const width = video.videoWidth;
                const height = video.videoHeight;
                const duration = video.duration || 0;
                URL.revokeObjectURL(url);
                video.remove();
                const sizeBytes = blob.size || 0;
                const bitrateKbps = duration > 0 ? ((sizeBytes * 8) / duration / 1000).toFixed(2) : '0.00';
                resolve({
                    width,
                    height,
                    duration,
                    bitrateKbps,
                    sizeKB: (sizeBytes / 1024).toFixed(2)
                });
            };
            video.onerror = () => {
                URL.revokeObjectURL(url);
                video.remove();
                resolve(null);
            };
            video.src = url;
        } catch (_) {
            resolve(null);
        }
    });
}

