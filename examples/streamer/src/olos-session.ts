import {
  createRuntimeSession,
  transitionRuntimeSession,
} from "@arsenstorm/olos/runtime";
import type { Session } from "@arsenstorm/olos/types";

export type IngestFetch = (
  input: Request | URL | string,
  init?: RequestInit
) => Promise<Response>;

export interface SessionClientOptions {
  baseUrl: string;
  mediaOrigin: string;
  renditionId: string;
  sessionId: string;
}

export interface CreateSessionOptions {
  // Codecs and dimensions are read back out of the init segment rather than
  // declared up front: the streamer copies the encoder's bitstream, so only
  // the media itself knows the real profile, level, and track layout.
  audioCodec?: string;
  // BANDWIDTH must be at least the peak segment bitrate, or the player
  // reports "Segment exceeds specified bandwidth for variant" (CoreMedia
  // -12318). Set it from the encoder's configured bitrate.
  bitrate?: number;
  height?: number;
  partTarget: number;
  segmentTarget: number;
  videoCodec?: string;
  width?: number;
}

export async function createSession(
  options: SessionClientOptions,
  ingestFetch: IngestFetch,
  sessionOptions: CreateSessionOptions
): Promise<void> {
  await createRuntimeSession({
    baseUrl: options.baseUrl,
    fetch: ingestFetch,
    mediaBaseUrl: options.mediaOrigin,
    session: buildSession(options, sessionOptions),
  });
}

export async function endSession(
  options: SessionClientOptions,
  ingestFetch: IngestFetch
): Promise<void> {
  await transitionRuntimeSession({
    baseUrl: options.baseUrl,
    fetch: ingestFetch,
    sessionId: options.sessionId,
    state: "ending",
  });
}

function buildSession(
  options: SessionClientOptions,
  sessionOptions: CreateSessionOptions
): Session {
  return {
    createdAt: new Date().toISOString(),
    epoch: 1,
    latencyProfile: "object-ll",
    olos: "1.0",
    partTarget: sessionOptions.partTarget,
    renditions: [
      videoRendition(options, sessionOptions),
      ...audioRenditions(options, sessionOptions.audioCodec),
    ],
    segmentTarget: sessionOptions.segmentTarget,
    sessionId: options.sessionId,
    state: "live",
  };
}

type Rendition = Session["renditions"][number];

function videoRendition(
  options: SessionClientOptions,
  { bitrate, height, videoCodec, width }: CreateSessionOptions
): Rendition {
  return {
    bitrate: bitrate ?? 5_000_000,
    codec: videoCodec ?? "avc1.640028",
    frameRate: 30,
    height: height ?? 1080,
    kind: "video",
    renditionId: options.renditionId,
    width: width ?? 1920,
  };
}

// An ungrouped audio rendition is codec metadata only: it renders no
// EXT-X-MEDIA line and no standalone media playlist, it just muxes its
// codec into every variant's CODECS attribute (spec 8.3.1). That is what
// muxed audio/video segments need in order to declare both tracks.
function audioRenditions(
  options: SessionClientOptions,
  audioCodec: string | undefined
): Rendition[] {
  if (audioCodec === undefined) {
    return [];
  }
  return [
    {
      codec: audioCodec,
      kind: "audio",
      renditionId: `${options.renditionId}_audio`,
    },
  ];
}
