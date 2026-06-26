import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

export interface SpawnFfmpegOptions {
  outDir: string;
  partSeconds: number;
  port: number;
}

export function spawnFfmpeg(options: SpawnFfmpegOptions): ChildProcess {
  const args = [
    "-hide_banner",
    "-listen",
    "1",
    "-i",
    `rtmp://0.0.0.0:${options.port}/live`,
    "-c:v",
    "copy",
    "-c:a",
    "copy",
    "-f",
    "hls",
    "-hls_time",
    String(options.partSeconds),
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_segment_filename",
    `${options.outDir}/part-%05d.m4s`,
    // `temp_file` makes ffmpeg write to *.tmp then rename atomically, so the
    // streamer never reads a partial file.
    // `independent_segments` matches our assumption that every part starts on
    // a keyframe (OBS keyframe interval must equal `partSeconds`).
    // `split_by_time` is the safety net: if the publisher's keyframe cadence
    // drifts, split anyway rather than blocking until the next keyframe.
    "-hls_flags",
    "+temp_file+independent_segments+split_by_time",
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "event",
    `${options.outDir}/playlist.m3u8`,
  ];

  return spawn("ffmpeg", args, { stdio: "inherit" });
}
