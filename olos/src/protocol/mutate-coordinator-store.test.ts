import { describe, expect, test } from "bun:test";
import { createMemoryCoordinatorStore } from "./coordinator-memory-store";
import {
  createCoordinatorStateWithIssuedSegment,
  createEmptyCoordinatorState,
} from "./coordinator-state.test-helper";
import type {
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
} from "./coordinator-types";
import {
  positiveMutationAttempts,
  runStoredCoordinatorMutation,
  runStoredCoordinatorMutationWithAdapters,
  runStoredCoordinatorMutationWithAdaptersAndResponse,
} from "./mutate-coordinator-store";

interface Attempt {
  readonly state: string;
}

interface StoredMutationResult {
  readonly outcome: string;
}

describe("runStoredCoordinatorMutation", () => {
  test("accepts shared default and validation for max attempts", () => {
    expect(positiveMutationAttempts(undefined)).toBe(2);
    expect(positiveMutationAttempts(3)).toBe(3);
    expect(() => positiveMutationAttempts(0)).toThrow(
      "maxAttempts must be a positive integer"
    );
    expect(() => positiveMutationAttempts(-1)).toThrow(
      "maxAttempts must be a positive integer"
    );
    expect(() => positiveMutationAttempts(1.5)).toThrow(
      "maxAttempts must be a positive integer"
    );
  });

  test("supports maxAttempts via stored response mutation helper", async () => {
    const store = createMemoryCoordinatorStore();
    const saved = await store.save({
      sessionId: "session_1",
      state: createEmptyCoordinatorState(),
    });

    expect(saved.status).toBe("saved");

    const result = await runStoredCoordinatorMutationWithAdaptersAndResponse<
      Attempt,
      Attempt,
      StoredMutationResult
    >({
      decide: (attempt) => ({
        attempt,
        state: createEmptyCoordinatorState(),
        status: "save",
      }),
      mapSaved: (savedAttempt) => ({
        outcome: `saved:${savedAttempt.etag}`,
      }),
      maxAttempts: undefined,
      mutate: () => ({
        state: "terminal",
      }),
      onConflictOrExhausted: () => ({
        outcome: "conflict",
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      sessionId: "session_1",
      store,
    });

    expect(result).toEqual({ outcome: "saved:2" });
  });

  test("validates maxAttempts in stored response mutation helper", async () => {
    try {
      await runStoredCoordinatorMutationWithAdaptersAndResponse<
        Attempt,
        Attempt,
        StoredMutationResult
      >({
        decide: () => ({
          result: { outcome: "terminal" },
          status: "terminal",
        }),
        mapSaved: () => ({
          outcome: "unexpected-saved",
        }),
        maxAttempts: 0,
        mutate: () => ({
          state: "unused",
        }),
        onConflictOrExhausted: () => ({
          outcome: "conflict",
        }),
        onMissing: () => ({
          outcome: "not_found",
        }),
        sessionId: "missing",
        store: {
          load: async () => undefined,
          save: async () => ({
            status: "conflict",
          }),
        },
      });
      throw new Error("expected maxAttempts validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "maxAttempts must be a positive integer"
      );
    }
  });

  test("returns missing when the session is not found", async () => {
    const store: CoordinatorPipelineStore = {
      load: async () => undefined,
      save: async () => ({
        status: "conflict",
      }),
    };

    const result = await runStoredCoordinatorMutation<
      Attempt,
      Attempt,
      StoredMutationResult
    >({
      attempts: 2,
      decide: (attempt) => ({
        result: {
          outcome: attempt.state,
        },
        status: "terminal",
      }),
      mutate: () => ({
        state: "unused",
      }),
      onConflict: () => ({
        outcome: "conflict",
      }),
      onExhausted: () => ({
        outcome: "exhausted",
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      onSaved: (saved) => ({
        outcome: `saved:${saved.etag}`,
      }),
      sessionId: "missing",
      store,
    });

    expect(result).toEqual({ outcome: "not_found" });
  });

  test("rejects malformed current snapshots before mutating", async () => {
    const store: CoordinatorPipelineStore = {
      load: async () => ({
        etag: "1",
        state: {
          ...createEmptyCoordinatorState(),
          commits: [{}],
        } as unknown as CoordinatorPipelineState,
      }),
      save: async () => ({
        status: "conflict",
      }),
    };

    await expect(
      runStoredCoordinatorMutation<Attempt, Attempt, StoredMutationResult>({
        attempts: 1,
        decide: () => ({
          result: {
            outcome: "should-not-save",
          },
          status: "terminal",
        }),
        mutate: () => ({
          state: "invalid",
        }),
        onConflict: () => ({
          outcome: "conflict",
        }),
        onExhausted: () => ({
          outcome: "exhausted",
        }),
        onMissing: () => ({
          outcome: "not_found",
        }),
        onSaved: () => ({
          outcome: "saved",
        }),
        sessionId: "session_1",
        store,
      })
    ).rejects.toThrow(
      "coordinator pipeline state commits must contain valid commit at index 0"
    );
  });

  test("rejects malformed conflict snapshots before retrying", async () => {
    const snapshot = {
      etag: "1",
      state: createEmptyCoordinatorState(),
    };
    const store: CoordinatorPipelineStore = {
      load: async () => snapshot,
      save: async () => ({
        current: {
          etag: "2",
          state: {
            ...createEmptyCoordinatorState(),
            cursor: "not-a-cursor",
          } as unknown as CoordinatorPipelineState,
        },
        status: "conflict",
      }),
    };

    await expect(
      runStoredCoordinatorMutation<Attempt, Attempt, StoredMutationResult>({
        attempts: 2,
        decide: (attempt) => ({
          attempt,
          state: createEmptyCoordinatorState(),
          status: "save",
        }),
        mutate: () => ({
          state: "retrying",
        }),
        onConflict: () => ({
          outcome: "conflict",
        }),
        onExhausted: () => ({
          outcome: "exhausted",
        }),
        onMissing: () => ({
          outcome: "not_found",
        }),
        onSaved: () => ({
          outcome: "saved",
        }),
        sessionId: "session_1",
        store,
      })
    ).rejects.toThrow("coordinator pipeline state cursor must be an object");
  });

  test("returns terminal attempt result without saving", async () => {
    const store = createMemoryCoordinatorStore();
    const saved = await store.save({
      sessionId: "session_1",
      state: createEmptyCoordinatorState(),
    });

    expect(saved.status).toBe("saved");

    let savedCalls = 0;
    const result = await runStoredCoordinatorMutation<
      Attempt,
      Attempt,
      StoredMutationResult
    >({
      attempts: 3,
      decide: () => ({
        result: {
          outcome: "short-circuit",
        },
        status: "terminal",
      }),
      mutate: () => ({
        state: "terminal",
      }),
      onConflict: () => ({
        outcome: "conflict",
      }),
      onExhausted: () => ({
        outcome: "exhausted",
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      onSaved: () => {
        savedCalls += 1;
        return { outcome: "unexpected-save" };
      },
      sessionId: "session_1",
      store,
    });

    expect(result).toEqual({ outcome: "short-circuit" });
    expect(savedCalls).toBe(0);
  });

  test("retries when saves conflict with a current snapshot", async () => {
    const alternate = createEmptyCoordinatorState();
    const store: CoordinatorPipelineStore = {
      load: async () => ({
        etag: "1",
        state: createEmptyCoordinatorState(),
      }),
      save: (options) => {
        if (options.expectedEtag === "1") {
          return Promise.resolve({
            current: {
              etag: "2",
              state: alternate,
            },
            status: "conflict",
          });
        }

        return Promise.resolve({
          etag: "3",
          state: options.state,
          status: "saved",
        });
      },
    };

    let mutations = 0;
    const result = await runStoredCoordinatorMutation<
      Attempt,
      Attempt,
      StoredMutationResult
    >({
      attempts: 2,
      decide: (attempt) => ({
        attempt,
        state: createEmptyCoordinatorState(),
        status: "save",
      }),
      mutate: () => {
        mutations += 1;

        return {
          state: mutations === 1 ? "initial" : "after-conflict",
        };
      },
      onConflict: () => ({
        outcome: "conflict",
      }),
      onExhausted: () => ({
        outcome: "exhausted",
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      onSaved: (saved) => ({
        outcome: `saved:${saved.etag}`,
      }),
      sessionId: "session_1",
      store,
    });

    expect(result).toEqual({ outcome: "saved:3" });
    expect(mutations).toBe(2);
  });

  test("mutates the current conflict snapshot on retry", async () => {
    const initialState = createEmptyCoordinatorState();
    const currentState = createCoordinatorStateWithIssuedSegment();
    const seenSlotCounts: number[] = [];
    const store: CoordinatorPipelineStore = {
      load: async () => ({
        etag: "1",
        state: initialState,
      }),
      save: (options) => {
        if (options.expectedEtag === "1") {
          return Promise.resolve({
            current: {
              etag: "2",
              state: currentState,
            },
            status: "conflict",
          });
        }

        return Promise.resolve({
          etag: "3",
          state: options.state,
          status: "saved",
        });
      },
    };

    const result = await runStoredCoordinatorMutation<
      Attempt,
      Attempt,
      StoredMutationResult
    >({
      attempts: 2,
      decide: (attempt) => ({
        attempt,
        state: createEmptyCoordinatorState(),
        status: "save",
      }),
      mutate: (state) => {
        seenSlotCounts.push(state.slots.length);

        return {
          state: `slots:${state.slots.length}`,
        };
      },
      onConflict: () => ({
        outcome: "conflict",
      }),
      onExhausted: () => ({
        outcome: "exhausted",
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      onSaved: (_saved, attempt) => ({
        outcome: `saved:${attempt.state}`,
      }),
      sessionId: "session_1",
      store,
    });

    expect(result).toEqual({
      outcome: `saved:slots:${currentState.slots.length}`,
    });
    expect(seenSlotCounts).toEqual([
      initialState.slots.length,
      currentState.slots.length,
    ]);
  });

  test("returns exhausted result when save conflicts repeat", async () => {
    const snapshot = {
      etag: "1",
      state: createEmptyCoordinatorState(),
    };
    const store: CoordinatorPipelineStore = {
      load: async () => snapshot,
      save: async () => ({
        current: snapshot,
        status: "conflict",
      }),
    };

    let exhaustedCalls = 0;
    const result = await runStoredCoordinatorMutation<
      Attempt,
      Attempt,
      StoredMutationResult
    >({
      attempts: 2,
      decide: (attempt) => ({
        attempt,
        state: createEmptyCoordinatorState(),
        status: "save",
      }),
      mutate: () => ({
        state: "retrying",
      }),
      onConflict: () => ({
        outcome: "conflict",
      }),
      onExhausted: (snapshot) => {
        exhaustedCalls += 1;
        expect(snapshot.etag).toBe("1");

        return {
          outcome: "exhausted",
        };
      },
      onMissing: () => ({
        outcome: "not_found",
      }),
      onSaved: () => ({
        outcome: "saved",
      }),
      sessionId: "session_1",
      store,
    });

    expect(result).toEqual({ outcome: "exhausted" });
    expect(exhaustedCalls).toBe(1);
  });

  test("returns conflict result for a conflict save without a current snapshot", async () => {
    const snapshot = {
      etag: "1",
      state: createEmptyCoordinatorState(),
    };
    const store: CoordinatorPipelineStore = {
      load: async () => snapshot,
      save: async () => ({
        status: "conflict",
      }),
    };
    let conflictCalls = 0;
    const result = await runStoredCoordinatorMutation<
      Attempt,
      Attempt,
      StoredMutationResult
    >({
      attempts: 2,
      decide: (attempt) => ({
        attempt,
        state: createEmptyCoordinatorState(),
        status: "save",
      }),
      mutate: () => ({
        state: "retrying",
      }),
      onConflict: () => {
        conflictCalls += 1;

        return {
          outcome: "conflict",
        };
      },
      onExhausted: () => ({
        outcome: "exhausted",
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      onSaved: () => ({
        outcome: "saved",
      }),
      sessionId: "session_1",
      store,
    });

    expect(result).toEqual({ outcome: "conflict" });
    expect(conflictCalls).toBe(1);
  });

  test("maps terminal results through adapter helper", async () => {
    const store = createMemoryCoordinatorStore();
    const saved = await store.save({
      sessionId: "session_1",
      state: createEmptyCoordinatorState(),
    });

    expect(saved.status).toBe("saved");

    let terminalMapCalls = 0;
    const result = await runStoredCoordinatorMutationWithAdapters<
      Attempt,
      Attempt,
      StoredMutationResult
    >({
      attempts: 3,
      decide: (attempt) => {
        terminalMapCalls += 1;

        return {
          result: {
            outcome: `terminal:${attempt.state}`,
          },
          status: "terminal",
        };
      },
      mapSaved: () => ({
        outcome: "unexpected-saved",
      }),
      mutate: () => ({
        state: "terminal",
      }),
      onConflict: () => ({
        outcome: "conflict",
      }),
      onExhausted: () => ({
        outcome: "exhausted",
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      sessionId: "session_1",
      store,
    });

    expect(result).toEqual({ outcome: "terminal:terminal" });
    expect(terminalMapCalls).toBe(1);
  });

  test("maps saved attempts through adapter helper", async () => {
    const store = createMemoryCoordinatorStore();
    const saved = await store.save({
      sessionId: "session_1",
      state: createCoordinatorStateWithIssuedSegment(),
    });

    expect(saved.status).toBe("saved");

    let savedMapCalls = 0;
    const result = await runStoredCoordinatorMutationWithAdapters<
      { readonly state: CoordinatorPipelineState },
      { readonly state: CoordinatorPipelineState },
      StoredMutationResult
    >({
      attempts: 2,
      decide: (attempt) => ({
        attempt,
        state: attempt.state,
        status: "save",
      }),
      mapSaved: (savedAttempt) => {
        savedMapCalls += 1;

        return {
          outcome: `saved:${savedAttempt.etag}`,
        };
      },
      mutate: () => ({
        state: createCoordinatorStateWithIssuedSegment(),
      }),
      onConflict: () => ({
        outcome: "conflict",
      }),
      onExhausted: () => ({
        outcome: "exhausted",
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      sessionId: "session_1",
      store,
    });

    expect(result).toEqual({ outcome: "saved:2" });
    expect(savedMapCalls).toBe(1);
  });

  test("shares conflict handling between conflict and exhaustion paths", async () => {
    const snapshot = {
      etag: "1",
      state: createEmptyCoordinatorState(),
    };
    const conflictStore: CoordinatorPipelineStore = {
      load: async () => snapshot,
      save: async () => ({
        status: "conflict",
      }),
    };
    const exhaustionStore: CoordinatorPipelineStore = {
      load: async () => snapshot,
      save: async () => ({
        current: snapshot,
        status: "conflict",
      }),
    };

    let conflictCalls = 0;
    let exhaustedCalls = 0;

    const sharedHandler = (
      snapshotValue: CoordinatorPipelineSnapshot | undefined,
      attempt?: Attempt | undefined
    ): StoredMutationResult => {
      if (attempt === undefined) {
        expect(snapshotValue?.etag).toBe("1");
        exhaustedCalls += 1;

        return {
          outcome: "exhausted",
        };
      }

      expect(snapshotValue).toBeUndefined();
      conflictCalls += 1;

      return {
        outcome: "conflict",
      };
    };

    const conflictResult =
      await runStoredCoordinatorMutationWithAdaptersAndResponse<
        Attempt,
        Attempt,
        StoredMutationResult
      >({
        decide: (attempt) => ({
          attempt,
          state: createEmptyCoordinatorState(),
          status: "save",
        }),
        mapSaved: () => ({
          outcome: "unexpected-saved",
        }),
        maxAttempts: 2,
        mutate: () => ({
          state: "retrying",
        }),
        onConflictOrExhausted: sharedHandler,
        onMissing: () => ({
          outcome: "not_found",
        }),
        sessionId: "session_1",
        store: conflictStore,
      });

    const exhaustedResult =
      await runStoredCoordinatorMutationWithAdaptersAndResponse<
        Attempt,
        Attempt,
        StoredMutationResult
      >({
        decide: (attempt) => ({
          attempt,
          state: createEmptyCoordinatorState(),
          status: "save",
        }),
        mapSaved: () => ({
          outcome: "unexpected-saved",
        }),
        maxAttempts: 2,
        mutate: () => ({
          state: "retrying",
        }),
        onConflictOrExhausted: sharedHandler,
        onMissing: () => ({
          outcome: "not_found",
        }),
        sessionId: "session_1",
        store: exhaustionStore,
      });

    expect(conflictResult).toEqual({ outcome: "conflict" });
    expect(exhaustedResult).toEqual({ outcome: "exhausted" });
    expect(conflictCalls).toBe(1);
    expect(exhaustedCalls).toBe(1);
  });
});
