import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/caption-layout.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const layout = module.exports;
const token = (text, fromMs = 0, toMs = 400) => ({ text, fromMs, toMs });

test('Hindi conjuncts remain whole graphemes', () => {
  assert.deepEqual(layout.graphemes('है'), ['है']);
  assert.equal(layout.graphemes('ज़रूरी').join(''), 'ज़रूरी'.normalize('NFC'));
});
test('caption normalization rejects invalid timestamps and stays within the video', () => {
  const words = layout.normalizeCaptionTokens([{ text: 'hi', startMs: -50, endMs: 600 }, { text: 'there', startMs: 500, endMs: 9000 }, { text: 'bad', startMs: NaN }, { text: 'outside', startMs: 2000, endMs: 2400 }], 1000);
  assert.deepEqual(words.map(w => [w.fromMs, w.toMs]), [[0, 500], [500, 1000]]);
});
test('all sizes use in-frame safe regions and scale caption typography', () => {
  for (const [width, height] of [[1080, 1920], [1080, 1080], [1920, 1080], [720, 1280]]) {
    for (const platform of ['tiktok', 'reels', 'shorts']) {
      const g = layout.captionGeometry(width, height, platform);
      assert.ok(g.maxWidth > width * 0.65 && g.maxWidth < width);
      assert.ok(g.bottom > 0 && g.bottom < height * 0.2);
      assert.ok(g.scale > 0 && g.scale <= 1);
    }
  }
});
test('danda and pause boundaries create separate Hindi pages', () => {
  const pages = layout.buildCaptionPages([token('बात', 0, 400), token('है।', 410, 800), token('न', 810, 1000), token('कहना', 2200, 2500)], { maxWords: 4, maxChars: 26, gapMs: 420, maxPageMs: 3200 });
  assert.deepEqual(pages.map(p => p.tokens.map(t => t.text)), [['बात', 'है।'], ['न'], ['कहना']]);
});
test('short page holds never overlap the next page or clip boundary', () => {
  const page = { tokens: [token('fast', 0, 50)], startMs: 0, endMs: 50 };
  assert.equal(layout.pageEndMs(page, { startMs: 100 }, 1000), 100);
  assert.equal(layout.pageEndMs(page, undefined, 80), 80);
  assert.ok(layout.pageEndMs(page, { startMs: 950 }, 1000) < 950);
});
test('highlight follows speech and is never on a future word', () => {
  const page = { tokens: [token('one', 100, 300), token('two', 400, 600)], startMs: 100, endMs: 600 };
  assert.equal(layout.activeTokenIndex(page, 50), -1);
  assert.equal(layout.activeTokenIndex(page, 350), 0);
  assert.equal(layout.activeTokenIndex(page, 500), 1);
});
test('measured two-line layout fits every word without breaking graphemes', () => {
  const words = ['आज', 'की', 'सबसे', 'महत्वपूर्ण', 'बात'].map(t => token(t));
  const measure = (text, size) => layout.graphemes(text).length * size * 0.7;
  const result = layout.fitCaptionLines(words, 68, 430, measure);
  assert.ok(result.lines.length <= 2);
  assert.ok(result.lines.every(line => measure(line.map(t => t.text).join(' '), result.fontSize) <= 430));
  assert.deepEqual(result.lines.flat(), words);
});
test('long names shrink rather than overflow or silently disappear', () => {
  const words = [token('SUPERCALIFRAGILISTICEXPIALIDOCIOUS')];
  const result = layout.fitCaptionLines(words, 68, 300, (text, size) => text.length * size * 0.7);
  assert.ok(result.fontSize < 30);
  assert.equal(result.lines[0][0].text, words[0].text);
});
