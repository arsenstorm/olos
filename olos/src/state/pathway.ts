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
  const validatedPathways = options.pathways.map(validatePathway);
  const matched = validatedPathways.some((pathway) =>
    isFailoverTarget(pathway, options.pathwayId)
  );

  const pathways = validatedPathways.map((pathway) => {
    if (!isFailoverTarget(pathway, options.pathwayId)) {
      return pathway;
    }

    return failedOverPathway(pathway, options);
  });

  return { matched, pathways };
}

function validatePathway(pathway: Pathway): Pathway {
  assertPathway(pathway);
  return pathway;
}

function isFailoverTarget(pathway: Pathway, pathwayId: OlosId): boolean {
  return pathway.pathwayId === pathwayId;
}

function failedOverPathway(
  pathway: Pathway,
  options: ResolvePathwayFailoverOptions
): Pathway {
  return {
    ...pathway,
    state: failoverState(options),
  };
}

function failoverState(
  options: ResolvePathwayFailoverOptions
): Extract<PathwayState, "degraded" | "disabled" | "draining"> {
  return options.state ?? "degraded";
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
