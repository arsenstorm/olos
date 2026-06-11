import type { Epoch, OlosId } from "./ids";

export type LatencyProfile =
  | "object-standard"
  | "object-ll"
  | "object-experimental"
  | "origin-ll"
  | "relay-bridge";

export type RenditionKind = "audio" | "video" | "text" | "metadata";

export type SessionState =
  | "created"
  | "starting"
  | "live"
  | "ending"
  | "ended"
  | "aborted"
  | "expired";

export interface Rendition {
  bitrate?: number;
  channels?: number;
  codec: string;
  frameRate?: number;
  height?: number;
  kind: RenditionKind;
  renditionId: OlosId;
  sampleRate?: number;
  width?: number;
}

export interface Session {
  createdAt: string;
  epoch: Epoch;
  latencyProfile: LatencyProfile;
  olos: "1.0";
  partTarget: number;
  renditions: Rendition[];
  segmentTarget: number;
  sessionId: OlosId;
  state: SessionState;
  tenantId: OlosId;
}
