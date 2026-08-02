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

  test("accepts optional audio rendition metrics", () => {
    expect(() =>
      assertSession({
        ...validSession,
        renditions: [
          {
            bitrate: 128_000,
            channels: 2,
            codec: "mp4a.40.2",
            kind: "audio",
            renditionId: "a128",
            sampleRate: 48_000,
          },
        ],
      })
    ).not.toThrow();
  });

  test("accepts renditions without dimensions", () => {
    expect(() =>
      assertSession({
        ...validSession,
        renditions: [
          {
            codec: "mp4a.40.2",
            kind: "audio",
            renditionId: "a128",
          },
        ],
      })
    ).not.toThrow();
  });

  test("accepts a grouped audio session", () => {
    expect(() =>
      assertSession({
        ...validSession,
        renditions: [
          validSession.renditions[0],
          {
            codec: "mp4a.40.2",
            defaultRendition: true,
            groupId: "aac",
            kind: "audio",
            name: "English",
            renditionId: "a128",
          },
          {
            codec: "ec-3",
            groupId: "aac",
            kind: "audio",
            renditionId: "a64",
          },
        ],
      })
    ).not.toThrow();
  });

  test("rejects audio group fields on non-audio renditions", () => {
    for (const field of ["defaultRendition", "groupId", "name"] as const) {
      expect(() =>
        assertSession({
          ...validSession,
          renditions: [
            {
              ...validSession.renditions[0],
              [field]: field === "defaultRendition" ? true : "aac",
            },
          ],
        })
      ).toThrow(
        `session.renditions[].${field} is only allowed on audio renditions`
      );
    }
  });

  test("rejects invalid audio group fields", () => {
    const audioRendition = validSession.renditions[1];

    expect(() =>
      assertSession({
        ...validSession,
        renditions: [{ ...audioRendition, groupId: "not a group" }],
      })
    ).toThrow(
      "session.renditions[].groupId must be a non-empty URL-safe identifier"
    );

    expect(() =>
      assertSession({
        ...validSession,
        renditions: [{ ...audioRendition, groupId: "aac", name: "" }],
      })
    ).toThrow("session.renditions[].name must be a non-empty string");

    expect(() =>
      assertSession({
        ...validSession,
        renditions: [
          { ...audioRendition, defaultRendition: "yes", groupId: "aac" },
        ],
      })
    ).toThrow("session.renditions[].defaultRendition must be a boolean");
  });

  test("rejects duplicate audio rendition names within a group", () => {
    expect(() =>
      assertSession({
        ...validSession,
        renditions: [
          validSession.renditions[0],
          {
            codec: "mp4a.40.2",
            groupId: "aac",
            kind: "audio",
            name: "English",
            renditionId: "a128",
          },
          {
            codec: "ec-3",
            groupId: "aac",
            kind: "audio",
            name: "English",
            renditionId: "a64",
          },
        ],
      })
    ).toThrow(
      "session.renditions must have distinct audio rendition names within a group"
    );
  });

  test("rejects names colliding with another rendition's default name", () => {
    // a64 declares no name, so its effective NAME is its rendition id — an
    // explicit NAME="a64" elsewhere in the group collides with it.
    expect(() =>
      assertSession({
        ...validSession,
        renditions: [
          validSession.renditions[0],
          {
            codec: "mp4a.40.2",
            groupId: "aac",
            kind: "audio",
            name: "a64",
            renditionId: "a128",
          },
          {
            codec: "ec-3",
            groupId: "aac",
            kind: "audio",
            renditionId: "a64",
          },
        ],
      })
    ).toThrow(
      "session.renditions must have distinct audio rendition names within a group"
    );
  });

  test("rejects rendition names quoted-strings cannot represent", () => {
    for (const name of ['English "TV"', "line\rreturn", "line\nfeed"]) {
      expect(() =>
        assertSession({
          ...validSession,
          renditions: [
            validSession.renditions[0],
            {
              codec: "mp4a.40.2",
              groupId: "aac",
              kind: "audio",
              name,
              renditionId: "a128",
            },
          ],
        })
      ).toThrow(
        "session.renditions[].name must not contain double quotes or line breaks"
      );
    }
  });

  test("rejects multiple distinct audio groups", () => {
    expect(() =>
      assertSession({
        ...validSession,
        renditions: [
          validSession.renditions[0],
          { ...validSession.renditions[1], groupId: "aac" },
          {
            codec: "ec-3",
            groupId: "aac-alt",
            kind: "audio",
            renditionId: "a64",
          },
        ],
      })
    ).toThrow("multiple audio groups are not supported");
  });

  test("rejects multiple default audio renditions", () => {
    expect(() =>
      assertSession({
        ...validSession,
        renditions: [
          validSession.renditions[0],
          {
            ...validSession.renditions[1],
            defaultRendition: true,
            groupId: "aac",
          },
          {
            codec: "ec-3",
            defaultRendition: true,
            groupId: "aac",
            kind: "audio",
            renditionId: "a64",
          },
        ],
      })
    ).toThrow(
      "session.renditions must not flag multiple default audio renditions"
    );
  });

  test("rejects mixed grouped and ungrouped audio renditions", () => {
    expect(() =>
      assertSession({
        ...validSession,
        renditions: [
          validSession.renditions[0],
          { ...validSession.renditions[1], groupId: "aac" },
          {
            codec: "ec-3",
            kind: "audio",
            renditionId: "a64",
          },
        ],
      })
    ).toThrow(
      "session.renditions must not mix grouped and ungrouped audio renditions"
    );
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

    expect(() =>
      assertSession({
        ...validSession,
        renditions: [
          {
            ...validSession.renditions[0],
            height: undefined,
          },
        ],
      })
    ).toThrow("session.renditions[] must define width and height together");

    expect(() =>
      assertSession({
        ...validSession,
        renditions: [
          {
            ...validSession.renditions[0],
            width: undefined,
          },
        ],
      })
    ).toThrow("session.renditions[] must define width and height together");
  });
});
