import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.resolve(root, '../.testrun/caption-matrix');
mkdirSync(output, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.ts'), publicDir: path.join(root, 'public') });
const styles = ['hormozi', 'bounce', 'fade', 'glow', 'typewriter', 'glitch', 'neon', 'colorful', 'minimal'];
const samples = {
  hi: ['आज', 'की', 'सबसे', 'महत्वपूर्ण', 'बात', 'है।', 'न', 'कहना', 'भी', 'ज़रूरी', 'है।'],
  en: ['Make', 'every', 'extraordinary', 'moment', 'count.', 'Keep', 'your', 'captions', 'clear.'],
};
const results = [];
for (const language of ['hi', 'en']) {
  for (const style of styles) {
    for (const [size, width, height] of [['9x16', 1080, 1920], ['1x1', 1080, 1080], ['16x9', 1920, 1080]]) {
      const captionsData = JSON.stringify(samples[language].map((text, index) => ({ text, startMs: 100 + index * 420, endMs: 500 + index * 420, timestampMs: null, confidence: null })));
      const inputProps = { captionsData, captionStyle: style, accentColor: '#9CF778', backgroundColor: '#D5DEDA', durationInFrames: 150, fadeEdge: false, showWatermark: false, showProgressBar: false };
      const composition = { ...await selectComposition({ serveUrl, id: 'CaptionPreview', inputProps }), width, height };
      const name = `${language}-${style}-${size}.png`;
      await renderStill({ serveUrl, composition, inputProps, output: path.join(output, name), frame: 35, imageFormat: 'png', logLevel: 'error' });
      results.push({ language, style, size, name, status: 'rendered' });
      console.log(`RENDER_OK ${name}`);
    }
  }
}
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(results, null, 2));
console.log(`CAPTION_MATRIX_OK ${results.length} real frames`);
