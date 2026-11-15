export type WordToken = { text: string; fromMs: number; toMs: number };
export type CaptionPage = { tokens: WordToken[]; startMs: number; endMs: number };
export type CaptionPlatform = "tiktok" | "reels" | "shorts";

export const graphemes = (text: string): string[] => Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text.normalize("NFC")),
    (part) => part.segment,
);

export function captionGeometry(width: number, height: number, platform: CaptionPlatform) {
    const portrait = height > width * 1.25;
    const scale = Math.min(width / 1080, height / 1920);
    const bottom = portrait ? { tiktok: 340, reels: 320, shorts: 280 }[platform] * height / 1920 : height * 0.1;
    const right = portrait ? { tiktok: 150, reels: 140, shorts: 110 }[platform] * width / 1080 : width * 0.065;
    const left = portrait ? 60 * width / 1080 : width * 0.065;
    return { bottom, right, left, top: height * 0.07, scale, maxWidth: width - left - right };
}

export function normalizeCaptionTokens(captions: unknown, durationMs: number): WordToken[] {
    if (!Array.isArray(captions)) return [];
    const tokens: WordToken[] = captions.flatMap((caption) => {
        if (!caption || typeof caption.text !== "string" || !Number.isFinite(caption.startMs)) return [];
        const text = caption.text.normalize("NFC").trim();
        const fromMs = Math.max(0, caption.startMs);
        const rawEnd = Number.isFinite(caption.endMs) ? caption.endMs : fromMs + 200;
        if (!text || fromMs >= durationMs || rawEnd < 0) return [];
        return [{ text, fromMs, toMs: Math.min(durationMs, Math.max(fromMs + 40, rawEnd)) }];
    }).sort((a, b) => a.fromMs - b.fromMs);
    return tokens.map((token, index) => ({
        ...token,
        // A word highlight must not overlap the following word's highlight.
        toMs: Math.max(token.fromMs + 1, Math.min(token.toMs, tokens[index + 1]?.fromMs ?? durationMs)),
    }));
}

export function buildCaptionPages(tokens: WordToken[], opts: { maxWords: number; maxChars: number; gapMs: number; maxPageMs: number }): CaptionPage[] {
    const pages: CaptionPage[] = [];
    let page: CaptionPage | null = null;
    let chars = 0;
    for (const token of tokens) {
        if (!token.text.trim() || !Number.isFinite(token.fromMs) || !Number.isFinite(token.toMs)) continue;
        const word = { ...token, text: token.text.trim(), toMs: Math.max(token.fromMs + 1, token.toMs) };
        const length = graphemes(word.text).length;
        if (page && (page.tokens.length >= opts.maxWords || chars + length + 1 > opts.maxChars || word.toMs - page.startMs > opts.maxPageMs || word.fromMs - page.endMs > opts.gapMs || /[.!?…。।॥]["'’”]?$/.test(page.tokens.at(-1)!.text))) {
            pages.push(page);
            page = null;
            chars = 0;
        }
        page ??= { tokens: [], startMs: word.fromMs, endMs: word.toMs };
        page.tokens.push(word);
        page.endMs = Math.max(page.endMs, word.toMs);
        chars += length + 1;
    }
    if (page) pages.push(page);
    return pages;
}

export function pageEndMs(page: CaptionPage, next: CaptionPage | undefined, durationMs: number): number {
    const held = page.endMs + 180;
    const nextStart = next?.startMs ?? durationMs;
    const end = next && nextStart - held >= 0 && nextStart - held < 240 ? nextStart : Math.min(held, nextStart);
    // Never extend minimum holds over the next page or the clip boundary.
    return Math.min(durationMs, nextStart, Math.max(page.startMs + 1, end));
}

export function activeTokenIndex(page: CaptionPage, nowMs: number): number {
    let active = -1;
    for (let index = 0; index < page.tokens.length; index++) {
        if (page.tokens[index].fromMs > nowMs) break;
        active = index;
    }
    return active;
}

export function fitFontSize(tokens: WordToken[], baseSize: number, maxWidth: number, uppercase: boolean): number {
    const widest = Math.max(1, ...tokens.map((token) => graphemes(token.text).length));
    return Math.max(12, Math.min(baseSize, maxWidth / (widest * (uppercase ? 0.68 : 0.6))));
}

export function fitCaptionLines(tokens: WordToken[], baseSize: number, maxWidth: number, measure: (text: string, size: number) => number): { fontSize: number; lines: WordToken[][] } {
    if (!tokens.length) return { fontSize: baseSize, lines: [] };
    let size = baseSize;
    let best: WordToken[][] = [tokens];
    for (let attempt = 0; attempt < 40; attempt++) {
        let bestWidth = measure(tokens.map((token) => token.text).join(" "), size);
        best = [tokens];
        for (let split = 1; split < tokens.length; split++) {
            const lines = [tokens.slice(0, split), tokens.slice(split)];
            const widths = lines.map((line) => measure(line.map((token) => token.text).join(" "), size));
            const widest = Math.max(...widths);
            if (widest < bestWidth) { bestWidth = widest; best = lines; }
        }
        if (bestWidth <= maxWidth) return { fontSize: size, lines: best };
        size *= 0.9;
    }
    return { fontSize: size, lines: best };
}
