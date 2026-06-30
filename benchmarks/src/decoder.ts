// Decodes the first frame of an fMP4 (init + segment, concatenated) and
// reads its barcode. The sync variant blocks via spawnSync (kept for the
// self-check). The async variant pipes ffmpeg via spawn so the JS event loop
// keeps moving, which lets a small decoder pool fan out concurrent decodes
// without stalling the producer/consumer.

import { spawn, spawnSync } from "node:child_process";
import { decodeFrame, FRAME_BYTES } from "./barcode";

const FFMPEG_ARGS = [
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  "pipe:0",
  "-frames:v",
  "1",
  "-f",
  "rawvideo",
  "-pix_fmt",
  "rgba",
  "-",
];

export function decodeFirstFrame(mp4: Uint8Array): number {
  const result = spawnSync("ffmpeg", FFMPEG_ARGS, {
    input: Buffer.from(mp4),
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = result.stdout;
  if (!out || out.length < FRAME_BYTES) {
    return Number.NaN;
  }
  return decodeFrame(new Uint8Array(out.buffer, out.byteOffset, FRAME_BYTES));
}

export function decodeFirstFrameAsync(mp4: Uint8Array): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", FFMPEG_ARGS, {
      stdio: ["pipe", "pipe", "ignore"],
    });

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    proc.stdout?.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      totalBytes += chunk.length;
    });
    proc.on("error", () => resolve(Number.NaN));
    proc.on("close", () => {
      if (totalBytes < FRAME_BYTES) {
        resolve(Number.NaN);
        return;
      }
      const buf = Buffer.concat(chunks, totalBytes);
      resolve(
        decodeFrame(new Uint8Array(buf.buffer, buf.byteOffset, FRAME_BYTES))
      );
    });

    proc.stdin?.end(Buffer.from(mp4));
  });
}
