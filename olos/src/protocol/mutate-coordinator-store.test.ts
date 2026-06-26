import { describe, expect, test } from "bun:test";
import type {
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
} from "./coordinator";
import { createMemoryCoordinatorStore } from "./coordinator";
import {
  createCoordinatorStateWithIssuedSegment,
  createEmptyCoordinatorState,
} from "./coordinator-state.test-helper";
import {
  positiveMutationAttempts,
  runStoredCoordinatorMutation,
  runStoredCoordinatorMutationWithAdapters,
  runStoredCoordinatorMutationWithAdaptersAndConflict,
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
      CoordinatorPipelineState,
      StoredMutationResult
    >({
      maxAttempts: undefined,
      sessionId: "session_1",
      store,
      decide: (_attempt) => ({
        status: "save",
        state: createEmptyCoordinatorState(),
      }),
      mutate: () => ({
        state: "terminal",
      }),
      mapSaved: (savedAttempt) => ({
        outcome: `saved:${savedAttempt.etag}`,
      }),
      onConflictOrExhausted: () => ({
        outcome: "conflict",
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
    });

    expect(result).toEqual({ outcome: "saved:2" });
  });

  test("validates maxAttempts in stored response mutation helper", async () => {
    try {
      await runStoredCoordinatorMutationWithAdaptersAndResponse<
        Attempt,
        CoordinatorPipelineState,
        StoredMutationResult
      >({
        maxAttempts: 0,
        sessionId: "missing",
        store: {
          load: async () => undefined,
          save: async () => ({
            status: "conflict",
          }),
        },
        decide: () => ({
          status: "terminal",
          result: createEmptyCoordinatorState(),
        }),
        mutate: () => ({
          state: "unused",
        }),
        mapSaved: () => ({
          outcome: "unexpected-saved",
        }),
        onConflictOrExhausted: () => ({
          outcome: "conflict",
        }),
        onMissing: () => ({
          outcome: "not_found",
        }),
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
      StoredMutationResult
    >({
      attempts: 2,
      mutate: () => ({
        state: "unused",
      }),
      sessionId: "missing",
      store,
      decide: (attempt) => ({
        status: "terminal",
        result: {
          outcome: attempt.state,
        },
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      onSaved: (saved) => ({
        outcome: `saved:${saved.etag}`,
      }),
      onConflict: () => ({
        outcome: "conflict",
      }),
      onExhausted: () => ({
        outcome: "exhausted",
      }),
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
      runStoredCoordinatorMutation<Attempt, StoredMutationResult>({
        attempts: 1,
        mutate: () => ({
          state: "invalid",
        }),
        sessionId: "session_1",
        store,
        decide: () => ({
          status: "terminal",
          result: {
            outcome: "should-not-save",
          },
        }),
        onMissing: () => ({
          outcome: "not_found",
        }),
        onSaved: () => ({
          outcome: "saved",
        }),
        onConflict: () => ({
          outcome: "conflict",
        }),
        onExhausted: () => ({
          outcome: "exhausted",
        }),
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
        status: "conflict",
        current: {
          etag: "2",
          state: {
            ...createEmptyCoordinatorState(),
            cursor: "not-a-cursor",
          } as unknown as CoordinatorPipelineState,
        },
      }),
    };

    await expect(
      runStoredCoordinatorMutation<Attempt, StoredMutationResult>({
        attempts: 2,
        mutate: () => ({
          state: "retrying",
        }),
        sessionId: "session_1",
        store,
        decide: () => ({
          status: "save",
          state: createEmptyCoordinatorState(),
        }),
        onMissing: () => ({
          outcome: "not_found",
        }),
        onSaved: () => ({
          outcome: "saved",
        }),
        onConflict: () => ({
          outcome: "conflict",
        }),
        onExhausted: () => ({
          outcome: "exhausted",
        }),
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
      StoredMutationResult
    >({
      attempts: 3,
      mutate: () => ({
        state: "terminal",
      }),
      sessionId: "session_1",
      store,
      decide: () => ({
        status: "terminal",
        result: {
          outcome: "short-circuit",
        },
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      onSaved: () => {
        savedCalls += 1;
        return { outcome: "unexpected-save" };
      },
      onConflict: () => ({
        outcome: "conflict",
      }),
      onExhausted: () => ({
        outcome: "exhausted",
      }),
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
            status: "conflict",
            current: {
              etag: "2",
              state: alternate,
            },
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
      StoredMutationResult
    >({
      attempts: 2,
      mutate: () => {
        mutations += 1;

        return {
          state: mutations === 1 ? "initial" : "after-conflict",
        };
      },
      decide: () => ({
        status: "save",
        state: createEmptyCoordinatorState(),
      }),
      onConflict: () => ({
        outcome: "conflict",
      }),
      sessionId: "session_1",
      store,
      onSaved: (saved) => ({
        outcome: `saved:${saved.etag}`,
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      onExhausted: () => ({
        outcome: "exhausted",
      }),
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
            status: "conflict",
            current: {
              etag: "2",
              state: currentState,
            },
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
      StoredMutationResult
    >({
      attempts: 2,
      mutate: (state) => {
        seenSlotCounts.push(state.slots.length);

        return {
          state: `slots:${state.slots.length}`,
        };
      },
      decide: () => ({
        status: "save",
        state: createEmptyCoordinatorState(),
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
        status: "conflict",
        current: snapshot,
      }),
    };

    let exhaustedCalls = 0;
    const result = await runStoredCoordinatorMutation<
      Attempt,
      StoredMutationResult
    >({
      attempts: 2,
      mutate: () => ({
        state: "retrying",
      }),
      sessionId: "session_1",
      store,
      decide: () => ({
        status: "save",
        state: createEmptyCoordinatorState(),
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      onSaved: () => ({
        outcome: "saved",
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
      StoredMutationResult
    >({
      attempts: 2,
      mutate: () => ({
        state: "retrying",
      }),
      sessionId: "session_1",
      store,
      decide: () => ({
        status: "save",
        state: createEmptyCoordinatorState(),
      }),
      onMissing: () => ({
        outcome: "not_found",
      }),
      onSaved: () => ({
        outcome: "saved",
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
      mutate: () => ({
        state: "terminal",
      }),
      sessionId: "session_1",
      store,
      decide: (attempt) => ({
        status: "terminal",
        result: attempt,
      }),
      mapTerminal: (attempt) => {
        terminalMapCalls += 1;

        return {
          outcome: `terminal:${attempt.state}`,
        };
      },
      onMissing: () => ({
        outcome: "not_found",
      }),
      mapSaved: () => ({
        outcome: "unexpected-saved",
      }),
      onConflict: () => ({
        outcome: "conflict",
      }),
      onExhausted: () => ({
        outcome: "exhausted",
      }),
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
      never,
      StoredMutationResult
    >({
      attempts: 2,
      mutate: () => ({
        state: createCoordinatorStateWithIssuedSegment(),
      }),
      sessionId: "session_1",
      store,
      decide: (attempt) => ({
        status: "save",
        state: attempt.state,
      }),
      mapSaved: (savedAttempt) => {
        savedMapCalls += 1;

        return {
          outcome: `saved:${savedAttempt.etag}`,
        };
      },
      onMissing: () => ({
        outcome: "not_found",
      }),
      onConflict: () => ({
        outcome: "conflict",
      }),
      onExhausted: () => ({
        outcome: "exhausted",
      }),
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
        status: "conflict",
        current: snapshot,
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
      await runStoredCoordinatorMutationWithAdaptersAndConflict<
        Attempt,
        Attempt,
        StoredMutationResult
      >({
        attempts: 2,
        mutate: () => ({
          state: "retrying",
        }),
        sessionId: "session_1",
        store: conflictStore,
        decide: () => ({
          status: "save",
          state: createEmptyCoordinatorState(),
        }),
        mapSaved: () => ({
          outcome: "unexpected-saved",
        }),
        onMissing: () => ({
          outcome: "not_found",
        }),
        onConflictOrExhausted: sharedHandler,
      });

    const exhaustedResult =
      await runStoredCoordinatorMutationWithAdaptersAndConflict<
        Attempt,
        Attempt,
        StoredMutationResult
      >({
        attempts: 2,
        mutate: () => ({
          state: "retrying",
        }),
        sessionId: "session_1",
        store: exhaustionStore,
        decide: () => ({
          status: "save",
          state: createEmptyCoordinatorState(),
        }),
        mapSaved: () => ({
          outcome: "unexpected-saved",
        }),
        onMissing: () => ({
          outcome: "not_found",
        }),
        onConflictOrExhausted: sharedHandler,
      });

    expect(conflictResult).toEqual({ outcome: "conflict" });
    expect(exhaustedResult).toEqual({ outcome: "exhausted" });
    expect(conflictCalls).toBe(1);
    expect(exhaustedCalls).toBe(1);
  });
});
