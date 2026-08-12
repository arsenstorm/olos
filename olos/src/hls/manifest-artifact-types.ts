import type { CreateDeliveryCachePolicyOptions } from "../state/cache-policy";
import type { Cursor } from "../types/cursor";
import type { Session } from "../types/session";
import type {
  HlsBlockingReloadRequest,
  WaitForHlsBlockingReloadOptions,
  waitForHlsBlockingReload,
} from "./blocking-reload";
import type { RenderMasterPlaylistOptions } from "./master-playlist";
import type { RenderMediaPlaylistOptions } from "./media-playlist";
export const HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl";
export const HLS_TEXT_ERROR_CONTENT_TYPE = "text/plain; charset=utf-8";

/**
 * A rendered HLS playlist ready for delivery: the playlist text, the
 * `application/vnd.apple.mpegurl` content type, and the request path it
 * should be served under.
 */
export interface HlsManifestArtifact {
  body: string;
  contentType: typeof HLS_CONTENT_TYPE;
  /** Root-relative request path, e.g. `/v1/live/{sessionId}/master.m3u8`. */
  path: string;
}

/**
 * Transport-agnostic HTTP response for a manifest artifact: the playlist body
 * plus `content-type` and `cache-control` headers. Convert it to a Fetch
 * `Response` with `createHlsManifestWebResponse`.
 */
export interface HlsManifestArtifactResponse {
  body: string;
  headers: Record<string, string>;
  status: 200;
}

/** A manifest artifact paired with its prebuilt HTTP response. */
export interface HlsManifestResponseArtifact extends HlsManifestArtifact {
  response: HlsManifestArtifactResponse;
}

/**
 * Cache policy overrides for manifest responses. Inherits the delivery cache
 * policy options with the target fixed to `manifest`.
 */
export interface CreateHlsManifestArtifactResponseOptions
  extends Omit<CreateDeliveryCachePolicyOptions, "target"> {}

/**
 * Options for `createHlsManifestArtifacts`: the media playlist rendering
 * options (applied to every rendition) plus the delivery paths for the
 * generated playlists.
 */
export interface CreateHlsManifestArtifactsOptions
  extends Omit<RenderMediaPlaylistOptions, "renditionId"> {
  /**
   * Path for the master playlist. Defaults to
   * `/v1/live/{sessionId}/master.m3u8`.
   */
  masterPath?: string;
  /**
   * Maps a rendition to its media playlist path. Defaults to
   * `/v1/live/{sessionId}/{renditionId}/media.m3u8`. Paths must be safe
   * root-relative paths.
   */
  mediaPlaylistPath?: RenderMasterPlaylistOptions["mediaPlaylistPath"];
}

/**
 * Options for `createCoordinatorManifestArtifacts`: the manifest options plus
 * the coordinator state to render from.
 */
export interface CreateCoordinatorManifestArtifactsOptions
  extends CreateHlsManifestArtifactsOptions {
  state: {
    /** Latest coordinator cursor; omit when no commits have landed yet. */
    cursor?: Cursor;
    session: Session;
  };
}

/**
 * Result of `createCoordinatorManifestArtifacts`: the rendered playlists and
 * the cursor they were rendered from. `artifacts` is empty and `cursor` is
 * absent when the coordinator state has no cursor yet.
 */
export interface CoordinatorManifestArtifacts {
  artifacts: readonly HlsManifestArtifact[];
  /** The cursor the artifacts reflect; absent when nothing was rendered. */
  cursor?: Cursor;
}

/** Options for `resolveBlockingHlsManifestArtifactResponse`. */
export interface ResolveBlockingHlsManifestArtifactResponseOptions {
  /** The cursor to start resolving against. */
  cursor: Cursor;
  /** Rendering options used to build the playlists once the wait resolves. */
  manifest: CreateHlsManifestArtifactsOptions;
  /**
   * The playlist request URL, including any `_HLS_msn` / `_HLS_part` query
   * parameters. Its pathname selects which artifact to serve.
   */
  requestUrl: string;
  /** Cache policy overrides for the manifest response. */
  response?: CreateHlsManifestArtifactResponseOptions;
  session: Session;
  /** Maximum time to hold the blocking reload open, in milliseconds. */
  timeoutMs: number;
  /** Resolves with a newer cursor once the session advances. */
  waitForCursor: WaitForHlsBlockingReloadOptions["waitForCursor"];
}

/**
 * Outcome of `resolveBlockingHlsManifestArtifactResponse`: `ready` or
 * `timeout` with a servable response and the cursor it was rendered from,
 * `not_found` when the request path matches no artifact, or `invalid` for a
 * malformed request URL or blocking reload parameters.
 */
export type BlockingHlsManifestArtifactResponseResolution =
  | {
      cursor: Cursor;
      response: HlsManifestArtifactResponse;
      status: "ready" | "timeout";
    }
  | {
      status: "not_found";
    }
  | {
      message: string;
      status: "invalid";
    };

/**
 * The error subset of a blocking manifest resolution (`invalid` or
 * `not_found`), accepted by `createHlsManifestErrorWebResponse`.
 */
export type HlsManifestErrorResolution = Extract<
  BlockingHlsManifestArtifactResponseResolution,
  { status: "invalid" | "not_found" }
>;

export type InvalidParsedBlockingReloadRequest = Extract<
  BlockingHlsManifestArtifactResponseResolution,
  { status: "invalid" }
>;

export type ParsedBlockingReloadRequest =
  | HlsBlockingReloadRequest
  | InvalidParsedBlockingReloadRequest;

export type ServableBlockingReloadWait = Extract<
  Awaited<ReturnType<typeof waitForHlsBlockingReload>>,
  { status: "ready" | "timeout" }
>;
