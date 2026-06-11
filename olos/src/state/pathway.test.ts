import { describe, expect, test } from "bun:test";
import type { Pathway } from "../types/pathway";
import { resolvePathwayFailover } from "./pathway";

const primaryPathway: Pathway = {
  baseUrl: "https://primary.example.com",
  pathwayId: "primary",
  priority: 0,
  providerId: "provider_1",
  state: "active",
};

const backupPathway: Pathway = {
  baseUrl: "https://backup.example.com",
  pathwayId: "backup",
  priority: 1,
  providerId: "provider_2",
  state: "active",
};

const pathways = [primaryPathway, backupPathway];

describe("pathway failover", () => {
  test("marks a pathway degraded and selects the next active pathway", () => {
    expect(
      resolvePathwayFailover({
        pathwayId: "primary",
        pathways,
      })
    ).toEqual({
      activePathway: backupPathway,
      pathways: [{ ...primaryPathway, state: "degraded" }, backupPathway],
      status: "failed_over",
    });
  });

  test("supports explicit draining and disabled states", () => {
    expect(
      resolvePathwayFailover({
        pathwayId: "primary",
        pathways,
        state: "draining",
      }).pathways[0]?.state
    ).toBe("draining");

    expect(
      resolvePathwayFailover({
        pathwayId: "primary",
        pathways,
        state: "disabled",
      }).pathways[0]?.state
    ).toBe("disabled");
  });

  test("chooses the lowest priority active replacement", () => {
    const result = resolvePathwayFailover({
      pathwayId: "primary",
      pathways: [
        primaryPathway,
        { ...backupPathway, pathwayId: "backup_2", priority: 2 },
        { ...backupPathway, pathwayId: "backup_1", priority: 1 },
      ],
    });

    expect(result.status).toBe("failed_over");

    if (result.status === "failed_over") {
      expect(result.activePathway.pathwayId).toBe("backup_1");
    }
  });

  test("keeps pathway order stable for cursor updates", () => {
    const result = resolvePathwayFailover({
      pathwayId: "backup_1",
      pathways: [
        { ...backupPathway, pathwayId: "backup_2", priority: 2 },
        { ...backupPathway, pathwayId: "backup_1", priority: 1 },
        primaryPathway,
      ],
    });

    expect(result.pathways.map((pathway) => pathway.pathwayId)).toEqual([
      "backup_2",
      "backup_1",
      "primary",
    ]);

    if (result.status === "failed_over") {
      expect(result.activePathway).toEqual(primaryPathway);
    }
  });

  test("does not mutate the input pathways", () => {
    resolvePathwayFailover({
      pathwayId: "primary",
      pathways,
    });

    expect(pathways).toEqual([primaryPathway, backupPathway]);
  });

  test("returns provider unavailable when no active pathway remains", () => {
    expect(
      resolvePathwayFailover({
        pathwayId: "primary",
        pathways: [primaryPathway],
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.provider_unavailable",
          details: {
            pathwayId: "primary",
          },
          message: "no active pathway is available",
        },
      },
      pathways: [{ ...primaryPathway, state: "degraded" }],
      status: "unavailable",
    });
  });

  test("returns provider unavailable for an unknown pathway", () => {
    expect(
      resolvePathwayFailover({
        pathwayId: "unknown",
        pathways,
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.provider_unavailable",
          details: {
            pathwayId: "unknown",
          },
          message: "no active pathway is available",
        },
      },
      pathways,
      status: "unavailable",
    });
  });
});
