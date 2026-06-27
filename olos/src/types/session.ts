import type {
  LATENCY_PROFILES,
  RENDITION_KINDS,
  SESSION_STATES,
} from "../config/session";
import type { Epoch, OlosId } from "./ids";

export type LatencyProfile = (typeof LATENCY_PROFILES)[number];
export type RenditionKind = (typeof RENDITION_KINDS)[number];
export type SessionState = (typeof SESSION_STATES)[number];

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
}
