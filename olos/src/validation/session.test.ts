import { describe, expect, test } from "bun:test";
import type { Session } from "../types/session";
import { assertSession, isSession } from "./session";

const validSession: Session = {
  createdAt: "2026-06-08T12:00:00.000Z",
  epoch: 0,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: 0.333,
  renditions: [
    {
      bitrate: 4_500_000,
      codec: "avc1.640028",
      frameRate: 30,
      height: 1080,
      kind: "video",
      renditionId: "v1080",
      width: 1920,
    },
    {
      bitrate: 128_000,
      channels: 2,
      codec: "mp4a.40.2",
      kind: "audio",
      renditionId: "a128",
      sampleRate: 48_000,
    },
  ],
  segmentTarget: 1,
  sessionId: "session_1",
  state: "live",
  tenantId: "tenant_1",
};

describe("session validation", () => {
  test("accepts a valid session", () => {
    expect(() => assertSession(validSession)).not.toThrow();
    expect(isSession(validSession)).toBe(true);
  });

  test("rejects non-object values", () => {
    expect(() => assertSession(null)).toThrow("session must be an object");
    expect(isSession(null)).toBe(false);
  });

  test("rejects unsupported wire versions", () => {
    expect(() => assertSession({ ...validSession, olos: "2.0" })).toThrow(
      "session.olos must be 1.0"
    );
  });

  test("rejects unsafe identifiers", () => {
    expect(() =>
      assertSession({ ...validSession, sessionId: "../secret" })
    ).toThrow("session.sessionId must be a non-empty URL-safe identifier");
  });

  test("rejects invalid enum values", () => {
    expect(() => assertSession({ ...validSession, state: "paused" })).toThrow(
      "session.state must be one of:"
    );

    expect(() =>
      assertSession({ ...validSession, latencyProfile: "slow" })
    ).toThrow("session.latencyProfile must be one of:");
  });

  test("rejects invalid timing fields", () => {
    expect(() => assertSession({ ...validSession, epoch: -1 })).toThrow(
      "session.epoch must be a non-negative integer"
    );

    expect(() => assertSession({ ...validSession, segmentTarget: 0 })).toThrow(
      "session.segmentTarget must be a positive number"
    );

    expect(() =>
      assertSession({ ...validSession, createdAt: "not-a-date" })
    ).toThrow("session.createdAt must be a valid timestamp");
  });

  test("rejects empty renditions", () => {
    expect(() => assertSession({ ...validSession, renditions: [] })).toThrow(
      "session.renditions must be a non-empty array"
    );
  });

  test("rejects duplicate rendition IDs", () => {
    expect(() =>
      assertSession({
        ...validSession,
        renditions: [validSession.renditions[0], validSession.renditions[0]],
      })
    ).toThrow("session.renditions must not contain duplicate IDs");
  });

  test("rejects invalid rendition fields", () => {
    expect(() =>
      assertSession({
        ...validSession,
        renditions: [{ ...validSession.renditions[0], renditionId: "../v" }],
      })
    ).toThrow(
      "session.renditions[].renditionId must be a non-empty URL-safe identifier"
    );

    expect(() =>
      assertSession({
        ...validSession,
        renditions: [{ ...validSession.renditions[0], kind: "image" }],
      })
    ).toThrow("session.renditions[].kind must be one of:");

    expect(() =>
      assertSession({
        ...validSession,
        renditions: [{ ...validSession.renditions[0], codec: "" }],
      })
    ).toThrow("session.renditions[].codec must be a non-empty string");

    expect(() =>
      assertSession({
        ...validSession,
        renditions: [{ ...validSession.renditions[0], width: 0 }],
      })
    ).toThrow("session.renditions[].width must be a positive integer");
  });
});
