import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.resolve(root, '../.testrun/caption-motion');
mkdirSync(output, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.ts'), publicDir: path.join(root, 'public') });
const styles = ['hormozi', 'bounce', 'fade', 'glow', 'typewriter', 'glitch', 'neon', 'colorful', 'minimal'];
const captionsData = JSON.stringify(['यह', 'बात', 'ज़रूरी', 'है।', 'Make', 'it', 'count.'].map((text, index) => ({ text, startMs: index * 240, endMs: (index + 1) * 240, timestampMs: null, confidence: null })));
const results = [];
for (const style of styles) {
    const inputProps = { captionsData, captionStyle: style, accentColor: '#9CF778', backgroundColor: '#D5DEDA', durationInFrames: 60, fadeEdge: false, showWatermark: false, showProgressBar: false, audioReactive: true, hasAudio: false, motionBlur: style === 'hormozi' };
    const composition = { ...await selectComposition({ serveUrl, id: 'CaptionedClip', inputProps }), width: 720, height: 1280 };
    const name = `${style}.mp4`;
    await renderMedia({ serveUrl, composition, inputProps, outputLocation: path.join(output, name), codec: 'h264', concurrency: 2, logLevel: 'error' });
    results.push({ style, name, frames: 60 });
    console.log(`MOTION_RENDER_OK ${name}`);
}
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(results, null, 2));
console.log('CAPTION_MOTION_OK nine encoded animations');
