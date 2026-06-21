import { describe, expect, test } from "bun:test";
import type { CoordinatorPipelineStore } from "./coordinator";
import { createMemoryCoordinatorStore } from "./coordinator";
import { createEmptyCoordinatorState } from "./coordinator-state.test-helper";
import { runStoredCoordinatorMutation } from "./mutate-coordinator-store";

interface Attempt {
  readonly state: string;
}

interface StoredMutationResult {
  readonly outcome: string;
}

describe("runStoredCoordinatorMutation", () => {
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
          return {
            status: "conflict",
            current: {
              etag: "2",
              state: alternate,
            },
          };
        }

        return {
          etag: "3",
          state: options.state,
          status: "saved",
        };
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
      decide: (attempt) => ({
        status: "save",
        state: attempt.state,
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
        state: "retrying",
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
        state: "retrying",
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
});
