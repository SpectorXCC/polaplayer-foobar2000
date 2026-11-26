import type { LyricLine } from '@applemusic-like-lyrics/core';
import type { RawLyricsModel } from '../types';

export function toAmllLines(raw: RawLyricsModel | null | undefined, durationSec: number): LyricLine[] {
  if (!raw || !raw.synced || !Array.isArray(raw.lines) || raw.lines.length === 0) {
    return [];
  }

  const durMs = Number.isFinite(durationSec) ? Math.max(0, Math.round(durationSec * 1000)) : 0;
  const events = new Map<number, { text: Set<string>; translations: Set<string>; roman: Set<string> }>();
  const parts = (value?: string) => String(value || '').split('\n').map(line => line.trim()).filter(Boolean);
  for (const line of raw.lines) {
    if (!line || !Number.isFinite(line.t)) continue;
    const time = Math.max(0, Math.round(line.t! * 1000));
    let event = events.get(time);
    if (!event) {
      event = { text: new Set(), translations: new Set(), roman: new Set() };
      events.set(time, event);
    }
    for (const text of parts(line.text)) {
      if (text !== '\u2022 \u2022 \u2022') event.text.add(text);
    }
    for (const translation of parts(line.translatedLyric)) event.translations.add(translation);
    for (const roman of parts(line.romanLyric)) event.roman.add(roman);
  }

  const starts = [...events.keys()].sort((a, b) => a - b);
  const out: LyricLine[] = [];
  starts.forEach((startTime, index) => {
    const event = events.get(startTime)!;
    const [main, ...extra] = event.text;
    if (!main) return;
    const endTime = starts[index + 1] ?? (durMs > startTime ? durMs : startTime + 5000);
    const translations = new Set([...extra, ...event.translations]);
    translations.delete(main);
    out.push({
      words: [{ word: main, startTime, endTime }],
      translatedLyric: [...translations].join('\n'),
      romanLyric: [...event.roman].join('\n'),
      startTime,
      endTime,
      isBG: false,
      isDuet: false
    });
  });

  return out;
}
