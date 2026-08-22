import { describe, expect, test } from "bun:test";
import type {
  CommittedObject,
  CommittedSegment,
} from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { Session } from "../types/session";
import {
  assertMediaCursor,
  assertMediaObjectProfile,
  assertMediaSession,
  assertMediaSessionProfile,
  assertMediaTrack,
  assertMediaTrackProfile,
  isMediaSession,
  mediaObjectProfile,
  mediaSegmentDuration,
  mediaSegmentProgramDateTime,
} from "./validation";

const videoTrack = {
  profile: {
    bitrate: 4_500_000,
    codec: "avc1.640028",
    frameRate: 30,
    height: 1080,
    kind: "video",
    width: 1920,
  },
  trackId: "v1080",
} as const;

const audioTrack = {
  profile: {
    bitrate: 128_000,
    channels: 2,
    codec: "mp4a.40.2",
    kind: "audio",
    sampleRate: 48_000,
  },
  trackId: "a128",
} as const;

const validSession: Session = {
  createdAt: "2026-06-08T12:00:00.000Z",
  epoch: 0,
  olos: "1.0",
  profile: { id: "cmaf-llhls", partTarget: 0.333, segmentTarget: 1 },
  sessionId: "session_1",
  state: "live",
  tracks: [videoTrack, audioTrack],
};

function audio(
  trackId: string,
  profile: Record<string, unknown>
): Session["tracks"][number] {
  return {
    profile: { codec: "mp4a.40.2", kind: "audio", ...profile },
    trackId,
  };
}

describe("media session validation", () => {
  test("accepts a valid media session", () => {
    expect(() => assertMediaSession(validSession)).not.toThrow();
    expect(isMediaSession(validSession)).toBe(true);
  });

  test("still applies core session validation", () => {
    expect(() => assertMediaSession({ ...validSession, tracks: [] })).toThrow(
      "session.tracks must be a non-empty array"
    );
    expect(isMediaSession(null)).toBe(false);
  });

  test("rejects sessions on another profile", () => {
    expect(() =>
      assertMediaSession({ ...validSession, profile: { id: "telemetry" } })
    ).toThrow("session.profile.id must be cmaf-llhls");
  });

  test("rejects invalid timing targets", () => {
    expect(() =>
      assertMediaSession({
        ...validSession,
        profile: { ...validSession.profile, segmentTarget: 0 },
      })
    ).toThrow("session.profile.segmentTarget must be a positive number");
    expect(() =>
      assertMediaSessionProfile(
        { id: "cmaf-llhls", partTarget: 0.5, segmentTarget: 2, extra: 1 },
        "session.profile"
      )
    ).toThrow('session.profile contains unknown property "extra"');
    expect(() =>
      assertMediaSessionProfile(
        {
          discontinuitySequence: -1,
          id: "cmaf-llhls",
          partTarget: 0.5,
          segmentTarget: 2,
        },
        "session.profile"
      )
    ).toThrow(
      "session.profile.discontinuitySequence must be a non-negative integer"
    );
  });

  test("requires a media profile on every track", () => {
    expect(() =>
      assertMediaSession({ ...validSession, tracks: [{ trackId: "v1080" }] })
    ).toThrow("session.tracks[v1080].profile is required");
    expect(() => assertMediaTrack({ trackId: "v1080" })).toThrow(
      "session.tracks[v1080].profile is required"
    );
  });

  test("accepts optional audio track metrics and tracks without dimensions", () => {
    expect(() =>
      assertMediaSession({ ...validSession, tracks: [audioTrack] })
    ).not.toThrow();
    expect(() =>
      assertMediaSession({
        ...validSession,
        tracks: [audio("a128", {})],
      })
    ).not.toThrow();
  });

  test("accepts a grouped audio session", () => {
    expect(() =>
      assertMediaSession({
        ...validSession,
        tracks: [
          videoTrack,
          audio("a128", {
            defaultTrack: true,
            groupId: "aac",
            name: "English",
          }),
          audio("a64", { codec: "ec-3", groupId: "aac" }),
        ],
      })
    ).not.toThrow();
  });

  test("rejects audio group fields on non-audio tracks", () => {
    for (const field of ["defaultTrack", "groupId", "name"] as const) {
      expect(() =>
        assertMediaTrackProfile(
          {
            ...videoTrack.profile,
            [field]: field === "defaultTrack" ? true : "aac",
          },
          "session.tracks[v1080]"
        )
      ).toThrow(
        `session.tracks[v1080].profile.${field} is only allowed on audio tracks`
      );
    }
  });

  test("rejects invalid audio group fields", () => {
    expect(() =>
      assertMediaTrackProfile(
        { ...audioTrack.profile, groupId: "not a group" },
        "track"
      )
    ).toThrow("track.profile.groupId must be a non-empty URL-safe identifier");
    expect(() =>
      assertMediaTrackProfile(
        { ...audioTrack.profile, groupId: "aac", name: "" },
        "track"
      )
    ).toThrow("track.profile.name must be a non-empty string");
    expect(() =>
      assertMediaTrackProfile(
        { ...audioTrack.profile, defaultTrack: "yes", groupId: "aac" },
        "track"
      )
    ).toThrow("track.profile.defaultTrack must be a boolean");
  });

  test("rejects duplicate audio track names within a group", () => {
    expect(() =>
      assertMediaSession({
        ...validSession,
        tracks: [
          videoTrack,
          audio("a128", { groupId: "aac", name: "English" }),
          audio("a64", { codec: "ec-3", groupId: "aac", name: "English" }),
        ],
      })
    ).toThrow(
      "session.tracks must have distinct audio track names within a group"
    );
  });

  test("rejects names colliding with another track's default name", () => {
    // a64 declares no name, so its effective NAME is its track id — an
    // explicit NAME="a64" elsewhere in the group collides with it.
    expect(() =>
      assertMediaSession({
        ...validSession,
        tracks: [
          videoTrack,
          audio("a128", { groupId: "aac", name: "a64" }),
          audio("a64", { codec: "ec-3", groupId: "aac" }),
        ],
      })
    ).toThrow(
      "session.tracks must have distinct audio track names within a group"
    );
  });

  test("rejects track names quoted-strings cannot represent", () => {
    for (const name of ['English "TV"', "line\rreturn", "line\nfeed"]) {
      expect(() =>
        assertMediaSession({
          ...validSession,
          tracks: [videoTrack, audio("a128", { groupId: "aac", name })],
        })
      ).toThrow(
        "session.tracks[a128].profile.name must not contain double quotes or line breaks"
      );
    }
  });

  test("rejects multiple distinct audio groups", () => {
    expect(() =>
      assertMediaSession({
        ...validSession,
        tracks: [
          videoTrack,
          audio("a128", { groupId: "aac" }),
          audio("a64", { codec: "ec-3", groupId: "aac-alt" }),
        ],
      })
    ).toThrow("multiple audio groups are not supported");
  });

  test("rejects multiple default audio tracks", () => {
    expect(() =>
      assertMediaSession({
        ...validSession,
        tracks: [
          videoTrack,
          audio("a128", { defaultTrack: true, groupId: "aac" }),
          audio("a64", { codec: "ec-3", defaultTrack: true, groupId: "aac" }),
        ],
      })
    ).toThrow("session.tracks must not flag multiple default audio tracks");
  });

  test("rejects mixed grouped and ungrouped audio tracks", () => {
    expect(() =>
      assertMediaSession({
        ...validSession,
        tracks: [
          videoTrack,
          audio("a128", { groupId: "aac" }),
          audio("a64", { codec: "ec-3" }),
        ],
      })
    ).toThrow("session.tracks must not mix grouped and ungrouped audio tracks");
  });

  test("rejects invalid track profile fields", () => {
    const name = "session.tracks[v1080]";

    expect(() =>
      assertMediaTrackProfile({ ...videoTrack.profile, kind: "image" }, name)
    ).toThrow(`${name}.profile.kind must be one of:`);
    expect(() =>
      assertMediaTrackProfile({ ...videoTrack.profile, codec: "" }, name)
    ).toThrow(`${name}.profile.codec must be a non-empty string`);
    expect(() =>
      assertMediaTrackProfile({ ...videoTrack.profile, width: 0 }, name)
    ).toThrow(`${name}.profile.width must be a positive integer`);
    expect(() =>
      assertMediaTrackProfile({ ...videoTrack.profile, frameRate: 0 }, name)
    ).toThrow(`${name}.profile.frameRate must be a positive number`);
    expect(() =>
      assertMediaTrackProfile(
        { ...videoTrack.profile, height: undefined },
        name
      )
    ).toThrow(`${name}.profile must define width and height together`);
    expect(() =>
      assertMediaTrackProfile({ ...videoTrack.profile, width: undefined }, name)
    ).toThrow(`${name}.profile must define width and height together`);
    expect(() =>
      assertMediaTrackProfile({ ...videoTrack.profile, extra: 1 }, name)
    ).toThrow(`${name}.profile contains unknown property "extra"`);
  });
});

describe("media cursor validation", () => {
  const cursor: Cursor = {
    committedWindow: {
      epoch: 0,
      firstSequenceNumber: 1,
      lastSequenceNumber: 1,
      tracks: {},
    },
    deliveryBaseUrl: "https://media.example.com",
    epoch: 0,
    olos: "1.0",
    profile: validSession.profile,
    sessionId: "session_1",
    state: "live",
    updatedAt: "2026-06-08T12:00:01.000Z",
    window: { firstSequenceNumber: 1, lastSequenceNumber: 1 },
  };

  test("accepts cursors carrying the media session profile", () => {
    expect(() => assertMediaCursor(cursor)).not.toThrow();
  });

  test("rejects cursors on another profile", () => {
    expect(() =>
      assertMediaCursor({ ...cursor, profile: { id: "telemetry" } })
    ).toThrow("cursor.profile.id must be cmaf-llhls");
  });
});

describe("media object profile validation", () => {
  test("accepts empty and full object profiles", () => {
    expect(() => assertMediaObjectProfile({}, "slot.profile")).not.toThrow();
    expect(() =>
      assertMediaObjectProfile(
        {
          discontinuityBefore: true,
          duration: 2,
          independent: true,
          programDateTime: "2026-06-08T12:00:00.000Z",
        },
        "slot.profile"
      )
    ).not.toThrow();
  });

  test("requires a duration on demand", () => {
    expect(() =>
      assertMediaObjectProfile({}, "slot.profile", { requireDuration: true })
    ).toThrow("slot.profile.duration must be a positive number");
    expect(() =>
      assertMediaObjectProfile({ duration: 0 }, "slot.profile")
    ).toThrow("slot.profile.duration must be a positive number");
  });

  test("rejects malformed optional fields", () => {
    expect(() =>
      assertMediaObjectProfile({ independent: "false" }, "commit.profile")
    ).toThrow("commit.profile.independent must be a boolean");
    expect(() =>
      assertMediaObjectProfile({ discontinuityBefore: "yes" }, "commit.profile")
    ).toThrow("commit.profile.discontinuityBefore must be a boolean");
    expect(() =>
      assertMediaObjectProfile({ programDateTime: "soon" }, "commit.profile")
    ).toThrow("commit.profile.programDateTime must be a valid timestamp");
    expect(() =>
      assertMediaObjectProfile({ bitrate: 1 }, "commit.profile")
    ).toThrow('commit.profile contains unknown property "bitrate"');
    expect(() => assertMediaObjectProfile("2", "commit.profile")).toThrow(
      "commit.profile must be an object"
    );
  });
});

describe("media segment helpers", () => {
  const object: CommittedObject = {
    commitId: "commit_1",
    deliveryUrl: "/objects/v1080/s1.m4s",
    objectKey: "objects/v1080/s1.m4s",
    slotId: "slot_1",
  };

  function part(partNumber: number, profile?: Record<string, unknown>) {
    return {
      ...object,
      commitId: `commit_1_${partNumber}`,
      partNumber,
      ...(profile === undefined ? {} : { profile }),
    };
  }

  test("reads an empty profile when none is present", () => {
    expect(mediaObjectProfile(object)).toEqual({});
    expect(mediaObjectProfile({ ...object, profile: { duration: 2 } })).toEqual(
      { duration: 2 }
    );
  });

  test("prefers the full segment's declared duration", () => {
    const segment: CommittedSegment = {
      parts: [part(0, { duration: 0.5 }), part(1, { duration: 0.5 })],
      segment: { ...object, profile: { duration: 2 } },
      sequenceNumber: 1,
    };

    expect(mediaSegmentDuration(segment)).toBe(2);
  });

  test("sums part durations for parts-only segments", () => {
    expect(
      mediaSegmentDuration({
        parts: [part(0, { duration: 0.5 }), part(1, { duration: 0.25 })],
        sequenceNumber: 1,
      })
    ).toBe(0.75);
  });

  test("throws when no duration is available", () => {
    expect(() =>
      mediaSegmentDuration({ segment: object, sequenceNumber: 1 })
    ).toThrow("committed segment has no media duration");
    expect(() =>
      mediaSegmentDuration({
        parts: [part(0, { duration: 0.5 }), part(1)],
        sequenceNumber: 1,
      })
    ).toThrow("committed part has no media duration");
  });

  test("reads the program date-time from the segment, then part 0", () => {
    expect(
      mediaSegmentProgramDateTime({
        parts: [part(0, { programDateTime: "2026-06-08T12:00:00.000Z" })],
        segment: {
          ...object,
          profile: { programDateTime: "2026-06-08T12:00:01.000Z" },
        },
        sequenceNumber: 1,
      })
    ).toBe("2026-06-08T12:00:01.000Z");
    expect(
      mediaSegmentProgramDateTime({
        parts: [part(0, { programDateTime: "2026-06-08T12:00:00.000Z" })],
        sequenceNumber: 1,
      })
    ).toBe("2026-06-08T12:00:00.000Z");
    expect(
      mediaSegmentProgramDateTime({ segment: object, sequenceNumber: 1 })
    ).toBeUndefined();
  });
});
