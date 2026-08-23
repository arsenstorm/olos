import { describe, expect, test } from "bun:test";
import type { Session } from "../types/session";
import { assertSession, isSession } from "./session";

const validSession: Session = {
  createdAt: "2026-06-08T12:00:00.000Z",
  epoch: 0,
  olos: "1.0",
  profile: { id: "cmaf-llhls", partTarget: 0.333, segmentTarget: 1 },
  sessionId: "session_1",
  state: "live",
  tracks: [
    {
      profile: {
        bitrate: 4_500_000,
        codec: "avc1.640028",
        frameRate: 30,
        height: 1080,
        kind: "video",
        width: 1920,
      },
      trackId: "v1080",
    },
    {
      profile: {
        bitrate: 128_000,
        channels: 2,
        codec: "mp4a.40.2",
        kind: "audio",
        sampleRate: 48_000,
      },
      trackId: "a128",
    },
  ],
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
      assertSession({ ...validSession, profile: { id: "" } })
    ).toThrow("session.profile.id must be a non-empty string");
  });

  test("rejects missing or non-object profiles", () => {
    const { profile, ...session } = validSession;

    expect(profile).toBeDefined();
    expect(() => assertSession(session)).toThrow(
      "session.profile must be an object"
    );
    expect(() => assertSession({ ...validSession, profile: [] })).toThrow(
      "session.profile must be an object"
    );
  });

  test("passes profile contents through untouched", () => {
    expect(() =>
      assertSession({
        ...validSession,
        profile: { id: "custom", nested: { anything: [1, 2] } },
        tracks: [{ profile: { schema: "telemetry/v1" }, trackId: "t1" }],
      })
    ).not.toThrow();
  });

  test("rejects invalid timing fields", () => {
    expect(() => assertSession({ ...validSession, epoch: -1 })).toThrow(
      "session.epoch must be a non-negative integer"
    );

    expect(() =>
      assertSession({ ...validSession, createdAt: "not-a-date" })
    ).toThrow("session.createdAt must be a valid timestamp");
  });

  test("rejects empty tracks", () => {
    expect(() => assertSession({ ...validSession, tracks: [] })).toThrow(
      "session.tracks must be a non-empty array"
    );
  });

  test("rejects duplicate track IDs", () => {
    expect(() =>
      assertSession({
        ...validSession,
        tracks: [validSession.tracks[0], validSession.tracks[0]],
      })
    ).toThrow("session.tracks must not contain duplicate IDs");
  });

  test("accepts tracks without profiles and with content types", () => {
    expect(() =>
      assertSession({
        ...validSession,
        tracks: [{ contentType: "application/json", trackId: "events" }],
      })
    ).not.toThrow();
  });

  test("accepts dotted identifiers", () => {
    expect(() =>
      assertSession({
        ...validSession,
        sessionId: "cam.front",
        tracks: [{ trackId: "cam.front.v1080" }],
      })
    ).not.toThrow();
  });

  test("rejects invalid track fields", () => {
    expect(() =>
      assertSession({
        ...validSession,
        tracks: [{ ...validSession.tracks[0], trackId: "../v" }],
      })
    ).toThrow(
      "session.tracks[].trackId must be a non-empty URL-safe identifier"
    );

    expect(() =>
      assertSession({
        ...validSession,
        tracks: [{ ...validSession.tracks[0], profile: "video" }],
      })
    ).toThrow("session.tracks[].profile must be an object");

    expect(() =>
      assertSession({
        ...validSession,
        tracks: [{ ...validSession.tracks[0], contentType: "video" }],
      })
    ).toThrow("session.tracks[].contentType must be a valid content type");

    expect(() =>
      assertSession({
        ...validSession,
        tracks: [{ ...validSession.tracks[0], codec: "avc1" }],
      })
    ).toThrow('session.tracks[] contains unknown property "codec"');
  });
});
