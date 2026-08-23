import {
  CMAF_LLHLS_PROFILE_ID,
  type MediaSession,
  type MediaTrack,
} from "@arsenstorm/olos/media";
import {
  createRuntimeSession,
  transitionRuntimeSession,
} from "@arsenstorm/olos/runtime";

export type IngestFetch = (
  input: Request | URL | string,
  init?: RequestInit
) => Promise<Response>;

export interface SessionClientOptions {
  baseUrl: string;
  mediaOrigin: string;
  sessionId: string;
  trackId: string;
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
    deliveryBaseUrl: options.mediaOrigin,
    fetch: ingestFetch,
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
): MediaSession {
  return {
    createdAt: new Date().toISOString(),
    epoch: 1,
    olos: "1.0",
    profile: {
      id: CMAF_LLHLS_PROFILE_ID,
      partTarget: sessionOptions.partTarget,
      segmentTarget: sessionOptions.segmentTarget,
    },
    sessionId: options.sessionId,
    state: "live",
    tracks: [
      videoTrack(options, sessionOptions),
      ...audioTracks(options, sessionOptions.audioCodec),
    ],
  };
}

function videoTrack(
  options: SessionClientOptions,
  { bitrate, height, videoCodec, width }: CreateSessionOptions
): MediaTrack {
  return {
    profile: {
      bitrate: bitrate ?? 5_000_000,
      codec: videoCodec ?? "avc1.640028",
      frameRate: 30,
      height: height ?? 1080,
      kind: "video",
      width: width ?? 1920,
    },
    trackId: options.trackId,
  };
}

// An ungrouped audio track is codec metadata only: it renders no
// EXT-X-MEDIA line and no standalone media playlist, it just muxes its
// codec into every variant's CODECS attribute (spec 8.3.1). That is what
// muxed audio/video segments need in order to declare both tracks.
function audioTracks(
  options: SessionClientOptions,
  audioCodec: string | undefined
): MediaTrack[] {
  if (audioCodec === undefined) {
    return [];
  }
  return [
    {
      profile: { codec: audioCodec, kind: "audio" },
      trackId: `${options.trackId}_audio`,
    },
  ];
}
