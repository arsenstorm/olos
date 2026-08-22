import { describe, expect, test } from "bun:test";
import { createCoordinatorManifestArtifacts } from "../hls/manifest-artifacts";
import { renderMediaPlaylist } from "../hls/media-playlist";
import { createObservedUpload } from "../state/observed-upload";
import { createPublicationKillSwitch } from "../state/publication-control";
import type { ProfileData } from "../types/profile";
import type { Session } from "../types/session";
import type { ObjectKind } from "../types/storage-object";
import { commitCoordinatorUpload } from "./coordinator-commit";
import {
  createCoordinatorPipeline,
  planCoordinatorRetention,
} from "./coordinator-lifecycle";
import { createMemoryCoordinatorStore } from "./coordinator-memory-store";
import { mutateCoordinatorPipeline } from "./coordinator-mutation";
import {
  issueCoordinatorSlot,
  revokeCoordinatorUpload,
} from "./coordinator-slot";
import {
  cloneCoordinatorPipelineSnapshot,
  createNextCoordinatorPipelineEtag,
  parseCoordinatorPipelineSnapshot,
  serializeCoordinatorPipelineSnapshot,
} from "./coordinator-snapshot";
import {
  createCoordinatorStateWithCommittedSegment,
  createCoordinatorStateWithIssuedSegment,
  createEmptyCoordinatorState,
  testCoordinatorSession as session,
} from "./coordinator-state.test-helper";
import type {
  CoordinatorPipelineState,
  CoordinatorUploadCommit,
} from "./coordinator-types";
import {
  conflictingStoreResult,
  savedStoreResult,
} from "./test-store.test-helper";

const mediaOrigin = "https://media.example.com";

describe("coordinator pipeline", () => {
  test("saves and loads coordinator state snapshots", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createEmptyCoordinatorState();
    const saved = await store.save({
      sessionId: session.sessionId,
      state,
    });

    const savedState = savedStoreResult(saved, "expected saved state");

    const loaded = await store.load(session.sessionId);

    expect(savedState.etag).toBe("1");
    expect(loaded).toEqual({
      etag: savedState.etag,
      state: savedState.state,
    });
  });

  test("rejects stale coordinator state writes", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createEmptyCoordinatorState();
    const first = await store.save({
      sessionId: session.sessionId,
      state,
    });

    const firstSave = savedStoreResult(first, "expected first save");

    const next = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 1 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "init",
      maxBytes: 2048,
      sequenceNumber: 0,
      trackId: "v1080",
      slotId: "slot_init",
      state,
    });
    const second = await store.save({
      expectedEtag: firstSave.etag,
      sessionId: session.sessionId,
      state: next.state,
    });

    const secondSave = savedStoreResult(second, "expected second save");

    const stale = await store.save({
      expectedEtag: firstSave.etag,
      sessionId: session.sessionId,
      state,
    });

    expect(secondSave.etag).toBe("2");
    expect(stale.status).toBe("conflict");
    const staleConflict = conflictingStoreResult(
      stale,
      "expected stale write conflict"
    );

    expect(staleConflict.current?.etag).toBe("2");
    expect(staleConflict.current?.state.slots).toHaveLength(1);
  });

  test("rejects duplicate coordinator state inserts", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createEmptyCoordinatorState();
    const first = await store.save({
      sessionId: session.sessionId,
      state,
    });
    const duplicate = await store.save({
      sessionId: session.sessionId,
      state,
    });

    const firstSave = savedStoreResult(first, "expected first save");

    expect(duplicate.status).toBe("conflict");
    const duplicateConflict = conflictingStoreResult(
      duplicate,
      "expected duplicate insert conflict"
    );

    expect(duplicateConflict.current?.etag).toBe(firstSave.etag);
  });

  test("rejects coordinator state updates for missing sessions", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createEmptyCoordinatorState();
    const result = await store.save({
      expectedEtag: "1",
      sessionId: session.sessionId,
      state,
    });

    expect(result.status).toBe("conflict");
  });

  test("returns independent coordinator state snapshots", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createEmptyCoordinatorState();
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const first = await store.load(session.sessionId);
    const second = await store.load(session.sessionId);

    if (first === undefined || second === undefined) {
      throw new Error("expected stored state");
    }

    expect(first.state).not.toBe(second.state);
    expect(first.state.session).not.toBe(second.state.session);
  });

  test("clones coordinator snapshots for external stores", () => {
    const snapshot = {
      etag: "1",
      state: createEmptyCoordinatorState(),
    };
    const cloned = cloneCoordinatorPipelineSnapshot(snapshot);

    expect(cloned).toEqual(snapshot);
    expect(cloned).not.toBe(snapshot);
    expect(cloned.state).not.toBe(snapshot.state);
    expect(cloned.state.session).not.toBe(snapshot.state.session);
  });

  test("serializes and parses coordinator snapshots", () => {
    const snapshot = {
      etag: "1",
      state: createEmptyCoordinatorState(),
    };
    const serialized = serializeCoordinatorPipelineSnapshot(snapshot);
    const parsed = parseCoordinatorPipelineSnapshot(serialized);

    expect(parsed).toEqual(snapshot);
    expect(parsed).not.toBe(snapshot);
    expect(parsed.state).not.toBe(snapshot.state);
  });

  test("parses coordinator snapshots without publisher leases", () => {
    const state = createEmptyCoordinatorState();
    const parsed = parseCoordinatorPipelineSnapshot({
      etag: "1",
      state: {
        commits: state.commits,
        initCommits: state.initCommits,
        deliveryBaseUrl: state.deliveryBaseUrl,
        session: state.session,
        slots: state.slots,
      },
    });

    expect(parsed.state.publisherLeases).toEqual([]);
  });

  test("rejects malformed stored coordinator snapshots", () => {
    const stateWithCursor = createCoordinatorStateWithCommittedSegment();

    expect(() =>
      parseCoordinatorPipelineSnapshot({
        etag: "",
        state: createEmptyCoordinatorState(),
      })
    ).toThrow("coordinator pipeline snapshot etag must be a non-empty string");
    expect(() =>
      parseCoordinatorPipelineSnapshot({
        etag: "1",
        state: {
          ...createEmptyCoordinatorState(),
          commits: undefined,
        },
      })
    ).toThrow("coordinator pipeline state commits must be an array");
    expect(() =>
      parseCoordinatorPipelineSnapshot({
        etag: "1",
        state: {
          ...createEmptyCoordinatorState(),
          deliveryBaseUrl: undefined,
        },
      })
    ).toThrow("coordinator pipeline state deliveryBaseUrl");
    expect(() =>
      parseCoordinatorPipelineSnapshot({
        etag: "1",
        state: {
          ...createEmptyCoordinatorState(),
          initCommits: [{}],
        },
      })
    ).toThrow(
      "coordinator pipeline state initCommits must contain valid commit at index 0"
    );
    expect(() =>
      parseCoordinatorPipelineSnapshot({
        etag: "1",
        state: {
          ...createEmptyCoordinatorState(),
          commits: [{}],
        },
      })
    ).toThrow(
      "coordinator pipeline state commits must contain valid commit at index 0"
    );
    expect(() =>
      parseCoordinatorPipelineSnapshot({
        etag: "1",
        state: {
          ...createEmptyCoordinatorState(),
          slots: ["not-a-slot"],
        },
      })
    ).toThrow(
      "coordinator pipeline state slots must contain valid uploadSlot at index 0"
    );
    expect(() =>
      parseCoordinatorPipelineSnapshot({
        etag: "1",
        state: {
          ...createEmptyCoordinatorState(),
          cursor: "not-a-cursor",
        },
      })
    ).toThrow("coordinator pipeline state cursor must be an object");
    expect(() =>
      parseCoordinatorPipelineSnapshot({
        etag: "1",
        state: {
          ...createEmptyCoordinatorState(),
          publisherLeases: [""],
        },
      })
    ).toThrow(
      "coordinator pipeline state publisherLeases must contain an object at index 0"
    );
    expect(() =>
      parseCoordinatorPipelineSnapshot({
        etag: "1",
        state: {
          ...stateWithCursor,
          cursor: {
            ...stateWithCursor.cursor,
            epoch: 9,
          },
        },
      })
    ).toThrow("cursor.epoch must match committedWindow.epoch");

    expect(() =>
      parseCoordinatorPipelineSnapshot({
        etag: "1",
        state: {
          ...createEmptyCoordinatorState(),
          publisherLeases: [
            {
              expiresAt: "not-a-date",
              issuedAt: "2026-01-01T00:00:00.000Z",
              lastSeenAt: "2026-01-01T00:00:00.000Z",
              sessionId: "session_1",
            },
          ],
        },
      })
    ).toThrow(
      "coordinator pipeline publisher lease.expiresAt must be a valid timestamp"
    );

    expect(() =>
      parseCoordinatorPipelineSnapshot({
        etag: "1",
        state: {
          ...createEmptyCoordinatorState(),
          publisherLeases: [
            {
              expiresAt: "2026-01-01T00:00:00.000Z",
              issuedAt: "2026-01-01T00:00:00.000Z",
              lastSeenAt: "2026-01-01T00:00:00.000Z",
              publisherInstanceId: "publisher_1",
              sessionId: "session 1",
            },
          ],
        },
      })
    ).toThrow(
      "coordinator pipeline publisher lease.sessionId must be a non-empty URL-safe identifier"
    );
  });

  test("creates monotonic coordinator etags", () => {
    expect(createNextCoordinatorPipelineEtag()).toBe("1");
    expect(createNextCoordinatorPipelineEtag("1")).toBe("2");
    expect(() => createNextCoordinatorPipelineEtag("not-an-etag")).toThrow(
      "coordinator pipeline etag must be a non-negative integer"
    );
  });

  test("mutates stored coordinator state", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createEmptyCoordinatorState();
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    const result = await mutateCoordinatorPipeline({
      mutate: (current) =>
        issueCoordinatorSlot({
          contentType: "video/mp4",
          profile: { duration: 1 },
          expiresAt: "2026-01-01T00:00:05.000Z",
          kind: "init",
          maxBytes: 2048,
          sequenceNumber: 0,
          trackId: "v1080",
          slotId: "slot_init",
          state: current,
        }).state,
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("saved");
    if (result.status !== "saved") {
      throw new Error("expected saved mutation");
    }

    expect(result.etag).toBe("2");
    expect(result.state.slots).toHaveLength(1);
  });

  test("does not mutate missing coordinator sessions", async () => {
    const store = createMemoryCoordinatorStore();
    const result = await mutateCoordinatorPipeline({
      mutate: (state) => state,
      sessionId: "missing_session",
      store,
    });

    expect(result).toEqual({ status: "not_found" });
  });

  test("rejects invalid coordinator mutation attempt limits", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createEmptyCoordinatorState();
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    await expect(
      mutateCoordinatorPipeline({
        maxAttempts: 0,
        mutate: (current) => current,
        sessionId: session.sessionId,
        store,
      })
    ).rejects.toThrow("maxAttempts must be a positive integer");
    await expect(
      mutateCoordinatorPipeline({
        maxAttempts: 1.5,
        mutate: (current) => current,
        sessionId: session.sessionId,
        store,
      })
    ).rejects.toThrow("maxAttempts must be a positive integer");
  });

  test("retries coordinator store conflicts with the latest state", async () => {
    const store = createMemoryCoordinatorStore();
    const state = createEmptyCoordinatorState();
    await store.save({
      sessionId: session.sessionId,
      state,
    });

    let attempts = 0;
    const result = await mutateCoordinatorPipeline({
      mutate: async (current) => {
        attempts += 1;

        if (attempts === 1) {
          const snapshot = await store.load(session.sessionId);

          if (snapshot === undefined) {
            throw new Error("expected current snapshot");
          }

          await store.save({
            expectedEtag: snapshot.etag,
            sessionId: session.sessionId,
            state: {
              ...current,
              slots: [
                ...current.slots,
                issueCoordinatorSlot({
                  contentType: "video/mp4",
                  profile: { duration: 1 },
                  expiresAt: "2026-01-01T00:00:05.000Z",
                  kind: "init",
                  maxBytes: 2048,
                  sequenceNumber: 0,
                  trackId: "v1080",
                  slotId: "slot_init",
                  state: current,
                }).slot,
              ],
            },
          });
        }

        return issueCoordinatorSlot({
          contentType: "video/mp4",
          profile: { duration: 2 },
          expiresAt: "2026-01-01T00:00:05.000Z",
          kind: "segment",
          maxBytes: 100_000,
          sequenceNumber: 3810,
          trackId: "v1080",
          slotId: "slot_3810",
          state: current,
        }).state;
      },
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("saved");
    if (result.status !== "saved") {
      throw new Error("expected saved retry");
    }

    expect(attempts).toBe(2);
    expect(result.state.slots.map((slot) => slot.slotId)).toEqual([
      "slot_init",
      "slot_3810",
    ]);
  });

  test("issues slots, commits verified uploads, and advances trusted state", () => {
    let state = createEmptyCoordinatorState();

    const initIssue = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 1 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "init",
      maxBytes: 2048,
      sequenceNumber: 0,
      trackId: "v1080",
      slotId: "slot_init",
      state,
    });
    state = initIssue.state;

    const initCommit = commitCoordinatorUpload({
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/init",
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "s3_primary",
        size: 1024,
      }),
      slotId: "slot_init",
      state,
    });

    if (initCommit.status !== "committed") {
      throw new Error("expected init commit");
    }

    expect(initCommit.cursor).toBeUndefined();
    state = initCommit.state;

    const segmentIssue = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 2 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      sequenceNumber: 3810,
      trackId: "v1080",
      slotId: "slot_3810",
      state,
    });
    state = segmentIssue.state;

    const segmentCommit = commitCoordinatorUpload({
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      profile: { independent: true },
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/s3810",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_3810",
      state,
    });

    if (segmentCommit.status !== "committed") {
      throw new Error("expected segment commit");
    }

    expect(segmentCommit.cursor?.window).toEqual({
      firstSequenceNumber: 3810,
      lastSequenceNumber: 3810,
    });
    expect(segmentCommit.state.commits).toHaveLength(1);
    expect(segmentCommit.state.initCommits).toHaveLength(1);
    expect(segmentCommit.state.slots.at(-1)?.state).toBe("committed");

    const duplicateCommit = commitCoordinatorUpload({
      commitId: "commit_3810_retry",
      committedAt: "2026-01-01T00:00:02.500Z",
      profile: { independent: true },
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/s3810",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_3810",
      state: segmentCommit.state,
    });

    expect(duplicateCommit.status).toBe("idempotent");
    expect(duplicateCommit.state.commits).toHaveLength(1);
  });

  test("prunes commits that fall behind the manifest window", () => {
    let state = createEmptyCoordinatorState();

    const initIssue = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 1 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "init",
      maxBytes: 2048,
      sequenceNumber: 0,
      trackId: "v1080",
      slotId: "slot_init",
      state,
    });
    state = initIssue.state;

    const initCommit = commitCoordinatorUpload({
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/init",
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "s3_primary",
        size: 1024,
      }),
      slotId: "slot_init",
      state,
    });
    if (initCommit.status !== "committed") {
      throw new Error("expected init commit");
    }
    state = initCommit.state;

    const retired: string[] = [];
    for (let msn = 3810; msn < 3818; msn += 1) {
      const slotId = `slot_${msn}`;
      const issued = issueCoordinatorSlot({
        contentType: "video/mp4",
        profile: { duration: 2 },
        expiresAt: "2026-01-01T00:00:30.000Z",
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: msn,
        trackId: "v1080",
        slotId,
        state,
      });
      state = issued.state;

      const committed = commitCoordinatorUpload({
        commitId: `commit_${msn}`,
        committedAt: `2026-01-01T00:00:${String(msn - 3805).padStart(2, "0")}.000Z`,
        profile: { independent: true },
        maxSegments: 3,
        object: createObservedUpload({
          contentType: "video/mp4",
          objectKey: `objects/v1080/s${msn}`,
          observedAt: `2026-01-01T00:00:${String(msn - 3805).padStart(2, "0")}.000Z`,
          providerId: "s3_primary",
          size: 98_304,
        }),
        slotId,
        state,
      });
      if (committed.status !== "committed") {
        throw new Error(`expected commit at ${msn}`);
      }
      for (const object of committed.retiredObjects ?? []) {
        retired.push(object.slotId);
      }
      state = committed.state;
    }

    expect(state.commits).toHaveLength(3);
    expect(state.commits.map((commit) => commit.sequenceNumber)).toEqual([
      3815, 3816, 3817,
    ]);
    expect(state.cursor?.committedWindow.firstSequenceNumber).toBe(3815);
    expect(state.cursor?.committedWindow.lastSequenceNumber).toBe(3817);
    expect(retired).toEqual([
      "slot_3810",
      "slot_3811",
      "slot_3812",
      "slot_3813",
      "slot_3814",
    ]);
  });

  test("rejects duplicate uploads that conflict with the existing commit", () => {
    let state = createEmptyCoordinatorState();
    const issued = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 2 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      sequenceNumber: 3810,
      trackId: "v1080",
      slotId: "slot_3810",
      state,
    });
    state = issued.state;

    const committed = commitCoordinatorUpload({
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      profile: { independent: true },
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/s3810",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_3810",
      state,
    });

    if (committed.status !== "committed") {
      throw new Error("expected segment commit");
    }

    const duplicate = commitCoordinatorUpload({
      commitId: "commit_3810_retry",
      committedAt: "2026-01-01T00:00:02.500Z",
      profile: { independent: false },
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/s3810",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_3810",
      state: committed.state,
    });

    expect(duplicate.status).toBe("rejected");
    if (duplicate.status !== "rejected") {
      throw new Error("expected rejected duplicate commit");
    }

    expect(duplicate.error.error).toEqual({
      code: "olos.duplicate_commit_conflict",
      details: {
        candidateCommitId: "commit_3810_retry",
        existingCommitId: "commit_3810",
        slotId: "slot_3810",
      },
      message: "duplicate commit conflicts with the existing commit",
    });
    expect(duplicate.state.commits).toHaveLength(1);
  });

  test("rejects uploads when the commit policy rejects the candidate", () => {
    const state = createCoordinatorStateWithIssuedSegment();

    const rejected = commitCoordinatorUpload({
      commitId: "commit_3810",
      commitPolicy: () => ({
        error: {
          error: {
            code: "olos.invalid_state",
            details: { slotId: "slot_3810" },
            message: "policy rejected commit",
          },
        },
        status: "rejected",
      }),
      committedAt: "2026-01-01T00:00:02.000Z",
      profile: { independent: true },
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/s3810",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_3810",
      state,
    });

    expect(rejected.status).toBe("rejected");
    if (rejected.status !== "rejected") {
      throw new Error("expected commit policy rejection");
    }

    expect(rejected.error.error).toEqual({
      code: "olos.invalid_state",
      details: { slotId: "slot_3810" },
      message: "policy rejected commit",
    });
    expect(rejected.state).toBe(state);
    expect(rejected.state.commits).toHaveLength(0);
  });

  test("commits uploads within configured late tolerance", () => {
    let state = createEmptyCoordinatorState();
    const issued = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 1 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "init",
      maxBytes: 2048,
      sequenceNumber: 0,
      trackId: "v1080",
      slotId: "slot_init",
      state,
    });
    state = issued.state;

    const committed = commitCoordinatorUpload({
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:05.500Z",
      lateToleranceMs: 1000,
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/init",
        observedAt: "2026-01-01T00:00:05.500Z",
        providerId: "s3_primary",
        size: 1024,
      }),
      slotId: "slot_init",
      state,
    });

    expect(committed.status).toBe("committed");
  });

  test("rejects revocation for unknown upload slots", () => {
    const state = createEmptyCoordinatorState();

    const rejected = revokeCoordinatorUpload({
      slotId: "slot_missing",
      state,
    });

    expect(rejected.status).toBe("rejected");
    if (rejected.status !== "rejected") {
      throw new Error("expected unknown slot revocation rejection");
    }

    expect(rejected.error.error).toEqual({
      code: "olos.unknown_slot",
      details: { slotId: "slot_missing" },
      message: "upload slot was not found",
    });
    expect(rejected.state).toBe(state);
  });

  test("revokes committed uploads before they are announced", () => {
    // An out-of-order part (part 1 before part 0) is recorded but stays out
    // of the cursor under the contiguous-prefix rule, so it is unannounced.
    let state = createEmptyCoordinatorState();
    const issued = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 0.5 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "part",
      maxBytes: 25_000,
      partNumber: 1,
      sequenceNumber: 3810,
      trackId: "v1080",
      slotId: "slot_3810_1",
      state,
    });
    state = issued.state;

    const committed = commitCoordinatorUpload({
      commitId: "commit_3810_1",
      committedAt: "2026-01-01T00:00:02.000Z",
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/s3810/p1",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 24_000,
      }),
      slotId: "slot_3810_1",
      state,
    });

    if (committed.status !== "committed") {
      throw new Error("expected unannounced part commit");
    }

    expect(committed.cursor).toBeUndefined();

    const revoked = revokeCoordinatorUpload({
      slotId: "slot_3810_1",
      state: committed.state,
    });

    expect(revoked.status).toBe("revoked");
    if (revoked.status !== "revoked") {
      throw new Error("expected revoked upload");
    }

    expect(revoked.slot.state).toBe("revoked");
    expect(revoked.state.commits).toEqual([]);
    expect(revoked.state.cursor).toBeUndefined();
    expect(
      createCoordinatorManifestArtifacts({
        allowedDeliveryOrigins: [mediaOrigin],
        state: revoked.state,
      })
    ).toEqual({ artifacts: [] });
  });

  test("rejects revocation after upload reaches the trusted cursor", () => {
    let state = createEmptyCoordinatorState();

    state = commitSlot(state, {
      commitId: "commit_init",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/init",
      profile: { duration: 1 },
      maxBytes: 2048,
      sequenceNumber: 0,
      objectKey: "objects/v1080/init",
      slotId: "slot_init",
      size: 1024,
    });
    state = commitSlot(state, {
      commitId: "commit_3810",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/s3810",
      profile: { duration: 2, independent: true },
      maxBytes: 100_000,
      sequenceNumber: 3810,
      objectKey: "objects/v1080/s3810",
      slotId: "slot_3810",
      size: 98_304,
    });

    const rejected = revokeCoordinatorUpload({
      slotId: "slot_3810",
      state,
    });

    expect(rejected.status).toBe("rejected");
    if (rejected.status !== "rejected") {
      throw new Error("expected rejected revocation");
    }

    expect(rejected.error.error).toEqual({
      code: "olos.invalid_state",
      details: {
        slotId: "slot_3810",
        state: "committed",
      },
      message:
        "upload slots reflected in the live cursor cannot be silently revoked",
    });
    expect(rejected.state).toBe(state);
  });

  test("rejects revocation after a low-latency part reaches the trusted cursor", () => {
    let state = createEmptyCoordinatorState();

    state = commitSlot(state, {
      commitId: "commit_init",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/init",
      profile: { duration: 1 },
      maxBytes: 2048,
      sequenceNumber: 0,
      objectKey: "objects/v1080/init",
      slotId: "slot_init",
      size: 1024,
    });
    state = commitSlot(state, {
      commitId: "commit_3810",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/s3810",
      profile: { duration: 2, independent: true },
      maxBytes: 100_000,
      sequenceNumber: 3810,
      objectKey: "objects/v1080/s3810",
      slotId: "slot_3810",
      size: 98_304,
    });
    state = commitSlot(state, {
      commitId: "commit_3811_0",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/s3811/p0",
      profile: { duration: 0.5, independent: true },
      kind: "part",
      maxBytes: 25_000,
      sequenceNumber: 3811,
      objectKey: "objects/v1080/s3811/p0",
      partNumber: 0,
      slotId: "slot_3811_0",
      size: 24_000,
    });

    const rejected = revokeCoordinatorUpload({
      slotId: "slot_3811_0",
      state,
    });

    expect(rejected.status).toBe("rejected");
    if (rejected.status !== "rejected") {
      throw new Error("expected rejected revocation");
    }

    expect(rejected.error.error).toEqual({
      code: "olos.invalid_state",
      details: {
        slotId: "slot_3811_0",
        state: "committed",
      },
      message:
        "upload slots reflected in the live cursor cannot be silently revoked",
    });
    expect(rejected.state).toBe(state);
  });

  test("publishes low-latency parts before the full segment is committed", () => {
    let state = createEmptyCoordinatorState();

    state = commitSlot(state, {
      commitId: "commit_init",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/init",
      profile: { duration: 1 },
      maxBytes: 2048,
      sequenceNumber: 0,
      objectKey: "objects/v1080/init",
      slotId: "slot_init",
      size: 1024,
    });
    state = commitSlot(state, {
      commitId: "commit_3810",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/s3810",
      profile: { duration: 2, independent: true },
      maxBytes: 100_000,
      sequenceNumber: 3810,
      objectKey: "objects/v1080/s3810",
      slotId: "slot_3810",
      size: 98_304,
    });
    state = commitSlot(state, {
      commitId: "commit_3811_0",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/s3811/p0",
      profile: { duration: 0.5, independent: true },
      kind: "part",
      maxBytes: 25_000,
      sequenceNumber: 3811,
      objectKey: "objects/v1080/s3811/p0",
      partNumber: 0,
      slotId: "slot_3811_0",
      size: 24_000,
    });
    state = commitSlot(state, {
      commitId: "commit_3811_1",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/s3811/p1",
      profile: { duration: 0.5 },
      kind: "part",
      maxBytes: 25_000,
      sequenceNumber: 3811,
      objectKey: "objects/v1080/s3811/p1",
      partNumber: 1,
      slotId: "slot_3811_1",
      size: 24_000,
    });

    const cursor = state.cursor;

    if (cursor === undefined) {
      throw new Error("expected low-latency cursor");
    }

    expect(cursor.window).toEqual({
      firstSequenceNumber: 3810,
      lastSequenceNumber: 3811,
      lastPartNumber: 1,
    });

    const playlist = renderMediaPlaylist(cursor.committedWindow, {
      allowedDeliveryOrigins: [mediaOrigin],
      partTarget: 0.5,
      trackId: "v1080",
      segmentTarget: 2,
      targetLatency: 3,
    });

    expect(playlist).toContain("#EXT-X-PART-INF:PART-TARGET=0.500");
    expect(playlist).toContain(
      '#EXT-X-PART:DURATION=0.500,INDEPENDENT=YES,URI="https://media.example.com/objects/v1080/s3811/p0"'
    );
    expect(playlist).toContain(
      '#EXT-X-PART:DURATION=0.500,URI="https://media.example.com/objects/v1080/s3811/p1"'
    );
    expect(
      state.slots
        .filter((slot) => slot.sequenceNumber === 3811)
        .map((slot) => slot.kind)
    ).toEqual(["part", "part"]);
  });

  test("tolerates out-of-order part commits without retiring future objects", () => {
    let state = createEmptyCoordinatorState();

    state = commitSlot(state, {
      commitId: "commit_init",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/init",
      profile: { duration: 1 },
      maxBytes: 2048,
      sequenceNumber: 0,
      objectKey: "objects/v1080/init",
      slotId: "slot_init",
      size: 1024,
    });
    state = commitSlot(state, {
      commitId: "commit_3810",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/s3810",
      profile: { duration: 2, independent: true },
      maxBytes: 100_000,
      sequenceNumber: 3810,
      objectKey: "objects/v1080/s3810",
      slotId: "slot_3810",
      size: 98_304,
    });

    // Land part 3 of segment 3811 first — out-of-order. Cursor must stay at
    // 3810, the part must remain in state.commits, and nothing may surface as
    // a retired object (the backing R2 object is needed once 0–2 arrive).
    const partCommits: Array<{ partNumber: number; slotId: string }> = [
      { partNumber: 3, slotId: "slot_3811_3" },
      { partNumber: 0, slotId: "slot_3811_0" },
      { partNumber: 1, slotId: "slot_3811_1" },
      { partNumber: 2, slotId: "slot_3811_2" },
    ];

    for (const [index, { partNumber, slotId }] of partCommits.entries()) {
      const issued = issueCoordinatorSlot({
        contentType: "video/mp4",
        profile: { duration: 0.5 },
        expiresAt: "2026-01-01T00:00:30.000Z",
        kind: "part",
        maxBytes: 25_000,
        sequenceNumber: 3811,
        partNumber,
        trackId: "v1080",
        slotId,
        state,
      });
      state = issued.state;

      const committed = commitCoordinatorUpload({
        commitId: `commit_3811_${partNumber}`,
        committedAt: `2026-01-01T00:00:0${3 + index}.000Z`,
        profile: { independent: partNumber === 0 },
        object: createObservedUpload({
          contentType: "video/mp4",
          objectKey: `objects/v1080/s3811/p${partNumber}`,
          observedAt: `2026-01-01T00:00:0${3 + index}.000Z`,
          providerId: "s3_primary",
          size: 24_000,
        }),
        slotId,
        state,
      });
      if (committed.status !== "committed") {
        throw new Error(`expected commit at part ${partNumber}`);
      }
      expect(committed.retiredObjects ?? []).toEqual([]);
      state = committed.state;

      if (partNumber === 3) {
        // Cursor stays at the last visible segment until 0-2 arrive.
        expect(state.cursor?.window).toEqual({
          firstSequenceNumber: 3810,
          lastSequenceNumber: 3810,
        });
      }
    }

    // After the contiguous prefix forms, all four parts are visible.
    expect(state.cursor?.window).toEqual({
      firstSequenceNumber: 3810,
      lastSequenceNumber: 3811,
      lastPartNumber: 3,
    });
    expect(
      state.commits.filter((commit) => commit.sequenceNumber === 3811).length
    ).toBe(4);
  });

  test("derives manifest artifacts from the current cursor", () => {
    let state = createEmptyCoordinatorState();

    state = commitSlot(state, {
      commitId: "commit_init",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/init",
      profile: { duration: 1 },
      maxBytes: 2048,
      sequenceNumber: 0,
      objectKey: "objects/v1080/init",
      slotId: "slot_init",
      size: 1024,
    });

    expect(
      createCoordinatorManifestArtifacts({
        allowedDeliveryOrigins: [mediaOrigin],
        state,
      })
    ).toEqual({ artifacts: [] });

    state = commitSlot(state, {
      commitId: "commit_3810",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/s3810",
      profile: { duration: 2, independent: true },
      maxBytes: 100_000,
      sequenceNumber: 3810,
      objectKey: "objects/v1080/s3810",
      slotId: "slot_3810",
      size: 98_304,
    });

    const manifests = createCoordinatorManifestArtifacts({
      allowedDeliveryOrigins: [mediaOrigin],
      state,
    });

    expect(manifests.cursor?.window).toEqual({
      firstSequenceNumber: 3810,
      lastSequenceNumber: 3810,
    });
    expect(manifests.artifacts.map((artifact) => artifact.path)).toEqual([
      "/v1/live/session_1/master.m3u8",
      "/v1/live/session_1/v1080/media.m3u8",
    ]);
    expect(manifests.artifacts[1]?.body).toContain(
      "https://media.example.com/objects/v1080/s3810"
    );
  });

  test("plans retention from coordinator state", () => {
    let state = createEmptyCoordinatorState();

    state = commitSlot(state, {
      commitId: "commit_init",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/init",
      profile: { duration: 1 },
      maxBytes: 2048,
      sequenceNumber: 0,
      objectKey: "objects/v1080/init",
      slotId: "slot_init",
      size: 1024,
    });
    state = commitSlot(state, {
      commitId: "commit_3810",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/s3810",
      profile: { duration: 2, independent: true },
      maxBytes: 100_000,
      sequenceNumber: 3810,
      objectKey: "objects/v1080/s3810",
      slotId: "slot_3810",
      size: 98_304,
    });
    state = commitSlot(state, {
      commitId: "commit_3811",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/s3811",
      profile: { duration: 2, independent: true },
      maxBytes: 100_000,
      sequenceNumber: 3811,
      objectKey: "objects/v1080/s3811",
      slotId: "slot_3811",
      size: 98_304,
    });
    state = commitSlot(state, {
      commitId: "commit_3812",
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/objects/v1080/s3812",
      profile: { duration: 2, independent: true },
      maxBytes: 100_000,
      maxSegments: 2,
      sequenceNumber: 3812,
      objectKey: "objects/v1080/s3812",
      slotId: "slot_3812",
      size: 98_304,
    });

    state = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 2 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      sequenceNumber: 3813,
      trackId: "v1080",
      slotId: "slot_3813",
      state,
    }).state;

    const plan = planCoordinatorRetention({
      now: "2026-01-01T00:00:06.000Z",
      state,
    });

    expect(plan.cursor?.window).toEqual({
      firstSequenceNumber: 3811,
      lastSequenceNumber: 3812,
    });
    expect(plan.expiredSlots.map((slot) => slot.slotId)).toEqual(["slot_3813"]);
    // commit-time pruning already retired commit_3810 via the commit response;
    // planCoordinatorRetention only surfaces commits still resident in state.
    expect(plan.retiredObjects).toEqual([]);
  });

  test("rejects uploads for unknown slots", () => {
    const state = createEmptyCoordinatorState();
    const result = commitCoordinatorUpload({
      commitId: "commit_unknown",
      committedAt: "2026-01-01T00:00:02.000Z",
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/unknown",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_unknown",
      state,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected upload");
    }

    expect(result.error.error.code).toBe("olos.unknown_slot");
  });

  test("rejects uploads smaller than slot minimum bytes", () => {
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 2 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      sequenceNumber: 3810,
      minBytes: 100_000,
      trackId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;

    const result = commitCoordinatorUpload({
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/s3810",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 50,
      }),
      slotId: "slot_3810",
      state,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected upload");
    }

    expect(result.error.error).toEqual({
      code: "olos.object_too_small",
      details: {
        minBytes: 100_000,
        objectKey: "objects/v1080/s3810",
        size: 50,
        slotId: "slot_3810",
      },
      message: "mediaObject.size must be at least minBytes",
    });
  });

  test("applies app-owned commit policy before new commits", () => {
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 2 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      sequenceNumber: 3810,
      trackId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;
    const result = commitCoordinatorUpload({
      commitId: "commit_3810",
      commitPolicy: ({ slot }) => ({
        error: {
          error: {
            code: "olos.quota_exceeded",
            details: { trackId: slot.trackId },
            message: "publisher quota exceeded",
          },
        },
        status: "rejected",
      }),
      committedAt: "2026-01-01T00:00:02.000Z",
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/s3810",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_3810",
      state,
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected commit");
    }

    expect(result.error.error).toEqual({
      code: "olos.quota_exceeded",
      details: { trackId: "v1080" },
      message: "publisher quota exceeded",
    });
    expect(result.state.commits).toHaveLength(0);
  });

  test("blocks publication while the kill switch is active", () => {
    const policy = createPublicationKillSwitch("incident");
    const state = createEmptyCoordinatorState();

    expect(() =>
      issueCoordinatorSlot({
        contentType: "video/mp4",
        profile: { duration: 1 },
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "init",
        maxBytes: 2048,
        sequenceNumber: 0,
        publicationControl: policy,
        trackId: "v1080",
        slotId: "slot_init",
        state,
      })
    ).toThrow("publication operation is disabled");

    const issued = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 1 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "init",
      maxBytes: 2048,
      sequenceNumber: 0,
      trackId: "v1080",
      slotId: "slot_init",
      state,
    });
    const committed = commitCoordinatorUpload({
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:02.000Z",
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/init",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 1024,
      }),
      publicationControl: policy,
      slotId: "slot_init",
      state: issued.state,
    });

    expect(committed.status).toBe("rejected");
    if (committed.status !== "rejected") {
      throw new Error("expected rejected commit");
    }

    expect(committed.error.error).toMatchObject({
      code: "olos.security_policy_violation",
      details: {
        operation: "commit_upload",
        reason: "incident",
      },
    });
    expect(committed.state.cursor).toBeUndefined();
  });

  // CORE-SLOT-006 (§4.2): slot identifiers are unique within a session.
  test("rejects duplicate slot ids when issuing slots", () => {
    const state = issueCoordinatorSlot({
      contentType: "video/mp4",
      profile: { duration: 2 },
      expiresAt: "2026-01-01T00:00:05.000Z",
      kind: "segment",
      maxBytes: 100_000,
      sequenceNumber: 3810,
      trackId: "v1080",
      slotId: "slot_3810",
      state: createEmptyCoordinatorState(),
    }).state;

    expect(() =>
      issueCoordinatorSlot({
        contentType: "video/mp4",
        profile: { duration: 2 },
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3811,
        trackId: "v1080",
        slotId: "slot_3810",
        state,
      })
    ).toThrow("slotId must be unique");
  });

  test("resolves identical retries idempotently past the commit deadline", () => {
    // §4.5.1 orders duplicate resolution before the deadline check and
    // §4.5.2 excludes committedAt from the comparison: an identical retry
    // arriving after expiresAt + lateTolerance still succeeds idempotently.
    const state = createCoordinatorStateWithCommittedSegment();

    const lateRetry = commitCoordinatorUpload({
      commitId: "commit_3810_late_retry",
      committedAt: "2026-01-01T00:01:00.000Z",
      profile: { independent: true },
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/s3810",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_3810",
      state,
    });

    expect(lateRetry.status).toBe("idempotent");
    if (lateRetry.status !== "idempotent") {
      throw new Error("expected idempotent late retry");
    }

    expect(lateRetry.commit.commitId).toBe("commit_3810");
    expect(lateRetry.state).toBe(state);

    // A late duplicate whose content differs is still a conflict, not a
    // fresh commit sneaking past the deadline.
    const lateConflict = commitCoordinatorUpload({
      commitId: "commit_3810_late_conflict",
      committedAt: "2026-01-01T00:01:00.000Z",
      profile: { independent: false },
      object: createObservedUpload({
        contentType: "video/mp4",
        objectKey: "objects/v1080/s3810",
        observedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        size: 98_304,
      }),
      slotId: "slot_3810",
      state,
    });

    expect(lateConflict.status).toBe("rejected");
    if (lateConflict.status !== "rejected") {
      throw new Error("expected rejected late conflicting duplicate");
    }

    expect(lateConflict.error.error.code).toBe(
      "olos.duplicate_commit_conflict"
    );
  });

  test("records an out-of-order first commit for a track without rendering it", () => {
    let state = createMultiTrackState();
    state = mustCommitTrack(
      commitTrackSlot(state, {
        kind: "init",
        sequenceNumber: 0,
        trackId: "v1080",
        slotId: "slot_v_init",
      })
    );
    state = mustCommitTrack(
      commitTrackSlot(state, {
        kind: "init",
        sequenceNumber: 0,
        trackId: "a128",
        slotId: "slot_a_init",
      })
    );
    state = mustCommitTrack(
      commitTrackSlot(state, {
        kind: "segment",
        sequenceNumber: 0,
        trackId: "v1080",
        slotId: "slot_v_s0",
      })
    );

    const windowBefore = state.cursor?.window;

    // Audio's first-ever media commit is part 1 of msn 1 — part 0 has not
    // landed. §5.3: the coordinator accepts and records it; §5.2: it must
    // not be rendered, so audio stays absent from the committed window.
    const outOfOrder = commitTrackSlot(state, {
      profile: { duration: 0.5 },
      kind: "part",
      sequenceNumber: 1,
      partNumber: 1,
      trackId: "a128",
      slotId: "slot_a_s1_p1",
    });

    expect(outOfOrder.status).toBe("committed");
    state = mustCommitTrack(outOfOrder);
    expect(state.commits.map((commit) => commit.slotId)).toContain(
      "slot_a_s1_p1"
    );
    expect(state.cursor?.window).toEqual(windowBefore);
    expect(Object.keys(state.cursor?.committedWindow.tracks ?? {})).toEqual([
      "v1080",
    ]);

    // Part 0 completes the contiguous prefix — audio becomes visible.
    state = mustCommitTrack(
      commitTrackSlot(state, {
        profile: { duration: 0.5 },
        kind: "part",
        sequenceNumber: 1,
        partNumber: 0,
        trackId: "a128",
        slotId: "slot_a_s1_p0",
      })
    );

    expect(
      state.cursor?.committedWindow.tracks.a128?.segments.map((segment) => [
        segment.sequenceNumber,
        segment.parts?.map((part) => part.partNumber),
      ])
    ).toEqual([[1, [0, 1]]]);
  });

  test("retires a leading track's trimmed commits while another track stalls", () => {
    let state = createMultiTrackState();
    state = mustCommitTrack(
      commitTrackSlot(state, {
        kind: "init",
        sequenceNumber: 0,
        trackId: "v1080",
        slotId: "slot_v_init",
      })
    );
    state = mustCommitTrack(
      commitTrackSlot(state, {
        kind: "init",
        sequenceNumber: 0,
        trackId: "a128",
        slotId: "slot_a_init",
      })
    );
    // Audio commits msn 0, then stalls while video runs ahead to msn 9.
    state = mustCommitTrack(
      commitTrackSlot(state, {
        kind: "segment",
        maxSegments: 5,
        sequenceNumber: 0,
        trackId: "a128",
        slotId: "slot_a_s0",
      })
    );

    const retired: string[] = [];
    for (let msn = 0; msn <= 9; msn += 1) {
      const committed = commitTrackSlot(state, {
        kind: "segment",
        maxSegments: 5,
        sequenceNumber: msn,
        trackId: "v1080",
        slotId: `slot_v_s${msn}`,
      });
      if (committed.status !== "committed") {
        throw new Error(`expected video commit at ${msn}`);
      }
      retired.push(
        ...(committed.retiredObjects ?? []).map((object) => object.slotId)
      );
      state = committed.state;
    }

    // Video's trimmed msn 0-4 retire despite audio pinning the window-global
    // first media sequence at 0; their commits and slots are pruned.
    expect(retired).toEqual([
      "slot_v_s0",
      "slot_v_s1",
      "slot_v_s2",
      "slot_v_s3",
      "slot_v_s4",
    ]);
    expect(
      state.commits
        .filter((commit) => commit.trackId === "v1080")
        .map((commit) => commit.sequenceNumber)
    ).toEqual([5, 6, 7, 8, 9]);
    expect(state.slots.map((slot) => slot.slotId)).not.toContain("slot_v_s0");

    // The stalled audio track keeps its visible commit and slot.
    expect(
      state.commits
        .filter((commit) => commit.trackId === "a128")
        .map((commit) => commit.sequenceNumber)
    ).toEqual([0]);
    expect(state.slots.map((slot) => slot.slotId)).toContain("slot_a_s0");
    expect(
      state.cursor?.committedWindow.tracks.a128?.segments.map(
        (segment) => segment.sequenceNumber
      )
    ).toEqual([0]);
    expect(
      state.cursor?.committedWindow.tracks.v1080?.segments.map(
        (segment) => segment.sequenceNumber
      )
    ).toEqual([5, 6, 7, 8, 9]);
  });
});

const multiTrackSession: Session = {
  ...session,
  tracks: [
    ...session.tracks,
    {
      profile: { bitrate: 128_000, codec: "mp4a.40.2", kind: "audio" },
      trackId: "a128",
    },
  ],
};

// Read-gated mode keeps object addresses deterministic, matching the
// single-track helper in coordinator-state.test-helper.ts.
function createMultiTrackState(): CoordinatorPipelineState {
  return createCoordinatorPipeline({
    deliveryBaseUrl: mediaOrigin,
    publicationMode: "read-gated",
    session: multiTrackSession,
  });
}

interface TrackCommitOptions {
  kind: ObjectKind;
  maxSegments?: number;
  partNumber?: number;
  profile?: ProfileData;
  sequenceNumber: number;
  slotId: string;
  trackId: string;
}

function commitTrackSlot(
  state: CoordinatorPipelineState,
  options: TrackCommitOptions
): CoordinatorUploadCommit {
  const issued = issueCoordinatorSlot({
    contentType: "video/mp4",
    expiresAt: "2026-01-01T00:00:30.000Z",
    kind: options.kind,
    maxBytes: 100_000,
    sequenceNumber: options.sequenceNumber,
    partNumber: options.partNumber,
    profile: options.profile ?? { duration: 2 },
    trackId: options.trackId,
    slotId: options.slotId,
    state,
  });

  return commitCoordinatorUpload({
    commitId: `commit_${options.slotId}`,
    committedAt: "2026-01-01T00:00:02.000Z",
    maxSegments: options.maxSegments,
    object: createObservedUpload({
      contentType: "video/mp4",
      objectKey: issued.slot.objectKey,
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: 10_000,
    }),
    slotId: options.slotId,
    state: issued.state,
  });
}

function mustCommitTrack(
  result: CoordinatorUploadCommit
): CoordinatorPipelineState {
  if (result.status !== "committed") {
    throw new Error(`expected committed upload, received ${result.status}`);
  }

  return result.state;
}

interface CommitSlotOptions {
  commitId: string;
  contentType: string;
  deliveryUrl: string;
  kind?: ObjectKind;
  maxBytes: number;
  maxSegments?: number;
  objectKey: string;
  partNumber?: number;
  profile?: ProfileData;
  sequenceNumber: number;
  size: number;
  slotId: string;
}

function commitSlot(
  state: CoordinatorPipelineState,
  options: CommitSlotOptions
): CoordinatorPipelineState {
  const issued = issueCoordinatorSlot({
    contentType: options.contentType,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: options.kind ?? (options.slotId === "slot_init" ? "init" : "segment"),
    maxBytes: options.maxBytes,
    sequenceNumber: options.sequenceNumber,
    partNumber: options.partNumber,
    profile: options.profile,
    trackId: "v1080",
    slotId: options.slotId,
    state,
  });
  const committed = commitCoordinatorUpload({
    commitId: options.commitId,
    committedAt: "2026-01-01T00:00:02.000Z",
    maxSegments: options.maxSegments,
    object: createObservedUpload({
      contentType: options.contentType,
      objectKey: issued.slot.objectKey,
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: options.size,
    }),
    slotId: options.slotId,
    state: issued.state,
  });

  if (committed.status !== "committed") {
    throw new Error("expected committed slot");
  }

  return committed.state;
}
