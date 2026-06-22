import type { OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { Pathway, PathwayState } from "../types/pathway";
import { assertPathway } from "../validation/pathway";

export interface ResolvePathwayFailoverOptions {
  pathwayId: OlosId;
  pathways: readonly Pathway[];
  state?: Extract<PathwayState, "degraded" | "disabled" | "draining">;
}

export type PathwayFailoverResolution =
  | {
      activePathway: Pathway;
      pathways: Pathway[];
      status: "failed_over";
    }
  | {
      error: OlosError;
      pathways: Pathway[];
      status: "unavailable";
    };

type ActivePathway = Pathway & { state: "active" };

interface AppliedPathwayFailover {
  matched: boolean;
  pathways: Pathway[];
}

export function resolvePathwayFailover(
  options: ResolvePathwayFailoverOptions
): PathwayFailoverResolution {
  const failover = applyPathwayFailover(options);

  if (!failover.matched) {
    return unavailable(options.pathwayId, failover.pathways);
  }

  const activePathway = nextActivePathway(failover.pathways);

  if (activePathway !== undefined) {
    return {
      activePathway,
      pathways: failover.pathways,
      status: "failed_over",
    };
  }

  return unavailable(options.pathwayId, failover.pathways);
}

function applyPathwayFailover(
  options: ResolvePathwayFailoverOptions
): AppliedPathwayFailover {
  let matched = false;

  const pathways = options.pathways.map((pathway) => {
    assertPathway(pathway);

    if (pathway.pathwayId !== options.pathwayId) {
      return pathway;
    }

    matched = true;

    return {
      ...pathway,
      state: options.state ?? "degraded",
    };
  });

  return { matched, pathways };
}

function unavailable(
  pathwayId: OlosId,
  pathways: Pathway[]
): PathwayFailoverResolution {
  return {
    error: {
      error: {
        code: "olos.provider_unavailable",
        details: {
          pathwayId,
        },
        message: "no active pathway is available",
      },
    },
    pathways,
    status: "unavailable",
  };
}

function nextActivePathway(pathways: readonly Pathway[]): Pathway | undefined {
  return pathways
    .filter(isActivePathway)
    .sort((first, second) => first.priority - second.priority)[0];
}

function isActivePathway(pathway: Pathway): pathway is ActivePathway {
  return pathway.state === "active";
}
