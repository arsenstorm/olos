import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export const PARTS_PER_SEGMENT = 4;
const PART_FILE = /^part-(\d+)\.m4s$/;

export interface AvailablePart {
  file: string;
  index: number;
}

export interface SegmentBatch {
  mediaSequenceNumber: number;
  parts: readonly AvailablePart[];
}

// Pull the longest contiguous run of available parts that all belong to the
// same segment, starting at `nextPartIndex`. Returns undefined when there's
// no progress to make (gap, or no parts ≥ nextPartIndex).
export function collectNextSegmentBatch(
  availableParts: readonly AvailablePart[],
  nextPartIndex: number
): SegmentBatch | undefined {
  let expected = nextPartIndex;
  const targetMsn = Math.floor(expected / PARTS_PER_SEGMENT);
  const parts: AvailablePart[] = [];
  for (const part of availableParts) {
    if (part.index < expected) {
      continue;
    }
    if (part.index !== expected) {
      break;
    }
    if (Math.floor(part.index / PARTS_PER_SEGMENT) !== targetMsn) {
      break;
    }
    parts.push(part);
    expected += 1;
  }
  if (parts.length === 0) {
    return;
  }
  return { mediaSequenceNumber: targetMsn, parts };
}

export async function assembleSegment(
  outDir: string,
  mediaSequenceNumber: number
): Promise<Uint8Array> {
  const firstIndex = mediaSequenceNumber * PARTS_PER_SEGMENT;
  const chunks: Uint8Array[] = await Promise.all(
    Array.from({ length: PARTS_PER_SEGMENT }, (_, part) =>
      readFile(
        join(outDir, `part-${String(firstIndex + part).padStart(5, "0")}.m4s`)
      )
    )
  );
  let length = 0;
  for (const chunk of chunks) {
    length += chunk.length;
  }
  const segment = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    segment.set(chunk, offset);
    offset += chunk.length;
  }
  return segment;
}

export function collectAvailableParts(
  files: readonly string[]
): AvailablePart[] {
  const parts: AvailablePart[] = [];
  for (const file of files) {
    const match = PART_FILE.exec(file);
    if (match) {
      parts.push({ file, index: Number(match[1]) });
    }
  }
  parts.sort((a, b) => a.index - b.index);
  return parts;
}

export async function deleteSegmentParts(
  outDir: string,
  mediaSequenceNumber: number
): Promise<void> {
  const firstIndex = mediaSequenceNumber * PARTS_PER_SEGMENT;
  for (let part = 0; part < PARTS_PER_SEGMENT; part += 1) {
    const file = `part-${String(firstIndex + part).padStart(5, "0")}.m4s`;
    await unlinkIfPresent(join(outDir, file));
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Already gone — fine, ffmpeg might never have written it on shutdown.
  }
}
