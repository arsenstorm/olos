// LL-HLS playlist parsing for the consumer. The bench publishes parts
// without segment commits, so every visible MSN appears as N consecutive
// `#EXT-X-PART` lines. Position in the list determines (msn, partNumber):
// the first PARTS_PER_SEGMENT parts are MEDIA-SEQUENCE, the next group is
// +1, etc.

import {
  EXT_X_PART_URI,
  MAP_URI,
  MEDIA_SEQUENCE,
  PARTS_PER_SEGMENT,
} from "./config";

export interface ParsedPlaylist {
  initUri?: string;
  mediaSequence: number;
  partUris: Map<string, string>;
  segmentUris: string[];
}

export function fragmentKey(msn: number, partNumber: number): string {
  return `${msn}/${partNumber}`;
}

export function parsePlaylist(body: string): ParsedPlaylist {
  const mediaSequence = Number(MEDIA_SEQUENCE.exec(body)?.[1] ?? 0);
  const initUri = MAP_URI.exec(body)?.[1];
  const segmentUris: string[] = [];
  const partUris = new Map<string, string>();
  let partIndex = 0;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("https://")) {
      segmentUris.push(line);
      continue;
    }
    const partMatch = EXT_X_PART_URI.exec(line);
    if (partMatch?.[1] !== undefined) {
      const msn = mediaSequence + Math.floor(partIndex / PARTS_PER_SEGMENT);
      const partNumber = partIndex % PARTS_PER_SEGMENT;
      partUris.set(fragmentKey(msn, partNumber), partMatch[1]);
      partIndex += 1;
    }
  }

  return { initUri, mediaSequence, partUris, segmentUris };
}

export async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch ${url} → ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
