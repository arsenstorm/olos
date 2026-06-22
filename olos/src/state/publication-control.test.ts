import { describe, expect, test } from "bun:test";
import {
  assertPublicationAllowed,
  createPublicationKillSwitch,
  resolvePublicationControl,
} from "./publication-control";

describe("publication control", () => {
  test("allows publication operations by default", () => {
    expect(resolvePublicationControl({ operation: "issue_slot" })).toEqual({
      status: "allowed",
    });
  });

  test("blocks selected publication operations", () => {
    const allowed = resolvePublicationControl({
      operation: "issue_slot",
      policy: { disabledOperations: ["process_provider_event"] },
    });
    const blocked = resolvePublicationControl({
      operation: "process_provider_event",
      policy: {
        disabledOperations: ["process_provider_event"],
        reason: "incident",
      },
    });

    expect(allowed.status).toBe("allowed");
    expect(blocked).toEqual({
      error: {
        error: {
          code: "olos.security_policy_violation",
          details: {
            operation: "process_provider_event",
            reason: "incident",
          },
          message: "publication operation is disabled",
        },
      },
      operation: "process_provider_event",
      status: "blocked",
    });
  });

  test("creates a kill switch for the publication pipeline", () => {
    const policy = createPublicationKillSwitch("budget");

    expect(policy.disabledOperations).toEqual([
      "issue_slot",
      "commit_upload",
      "process_provider_event",
      "advance_cursor",
    ]);
    expect(policy.reason).toBe("budget");
  });

  test("asserts publication control decisions", () => {
    expect(() =>
      assertPublicationAllowed({
        operation: "commit_upload",
        policy: { disabledOperations: ["process_provider_event"] },
      })
    ).not.toThrow();
    expect(() =>
      assertPublicationAllowed({
        operation: "process_provider_event",
        policy: { disabledOperations: ["process_provider_event"] },
      })
    ).toThrow("publication operation is disabled");
  });
});
