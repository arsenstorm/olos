// ffmpeg encoder spawn — feeds raw RGBA frames (one barcode per frame) into
// a continuous LL-HLS fMP4 segmenter. Output files appear at
// `outDir/part-NNNNN.m4s` at `segmentSeconds` cadence; `init.mp4` lands once
// the first part flushes.

import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { HEIGHT, WIDTH } from "./barcode";

export interface EncoderOptions {
  crf: number;
  fps: number;
  outDir: string;
  segmentSeconds: number;
}

export function spawnEncoder(options: EncoderOptions): ChildProcess {
  return spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${WIDTH}x${HEIGHT}`,
      "-framerate",
      String(options.fps),
      "-i",
      "pipe:0",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-crf",
      String(options.crf),
      "-g",
      String(Math.max(1, Math.round(options.fps * options.segmentSeconds))),
      "-f",
      "hls",
      "-hls_time",
      String(options.segmentSeconds),
      "-hls_segment_type",
      "fmp4",
      "-hls_fmp4_init_filename",
      "init.mp4",
      "-hls_segment_filename",
      join(options.outDir, "part-%05d.m4s"),
      "-hls_flags",
      "+temp_file+independent_segments+split_by_time",
      "-hls_list_size",
      "0",
      "-hls_playlist_type",
      "event",
      join(options.outDir, "playlist.m3u8"),
    ],
    { stdio: ["pipe", "inherit", "inherit"] }
  );
}
