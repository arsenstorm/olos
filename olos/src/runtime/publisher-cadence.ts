import type { CursorWindow } from "../types/cursor";
import type { ProfileData } from "../types/profile";
import type { PublicationMode } from "../types/publication";
import { assertCursorWindow } from "../validation/cursor";
import { assertNonNegativeInteger } from "../validation/ids";
import {
  type ResolveRuntimePublisherObjectExpiryOptions,
  type RuntimePublisherObjectExpiry,
  resolveRuntimePublisherObjectExpiry,
} from "./publisher-expiry";
import type {
  CreateRuntimePublisherObjectPlanOptions,
  RuntimePublisherObjectPlan,
  RuntimePublisherPlannedObjectKind,
} from "./publisher-plan";
import { createRuntimePublisherObjectPlan } from "./publisher-plan";
import { optionalField, positiveInteger } from "./request-fields";

/**
 * Publishing cadence: `segment` emits whole segments, `part` emits partial
 * segments (`partsPerSegment` per sequence number) for low latency.
 */
export type RuntimePublisherCadenceMode = "part" | "segment";

/** Options for `resolveRuntimePublisherNextObjectPosition`. */
export interface ResolveRuntimePublisherNextObjectPositionOptions {
  /**
   * Committed window from the session cursor; the next position follows it.
   * Omit before the first commit to start at `startSequenceNumber`.
   */
  cursorWindow?: CursorWindow;
  /** Pass `false` to plan the init object first; defaults to `true`. */
  initPublished?: boolean;
  /** Cadence to advance in; defaults to `segment`. */
  mode?: RuntimePublisherCadenceMode;
  /** Parts per segment; required (positive integer) in `part` mode. */
  partsPerSegment?: number;
  /** First sequence number when there is no cursor window yet (default 0). */
  startSequenceNumber?: number;
}

/** Timeline position of a planned object. */
export interface RuntimePublisherObjectPosition {
  kind: RuntimePublisherPlannedObjectKind;
  /** Zero-based part index within the segment; only set for parts. */
  partNumber?: number;
  sequenceNumber: number;
}

/**
 * Default slot parameters for one object kind, applied to every planned
 * object of that kind.
 */
export interface RuntimePublisherObjectKindDefaults {
  /**
   * Expected seconds one object of this kind covers; sizes the slot TTL
   * (see `resolveRuntimePublisherObjectExpiry`).
   */
  cadenceSeconds: number;
  contentType: string;
  /** File extension used when deriving the object key; omitted for none. */
  extension?: string;
  maxBytes: number;
  /** Lower byte bound; must not exceed `maxBytes`. */
  minBytes?: number;
  /** Profile data stamped on every slot of this kind (opaque to Core). */
  profile?: ProfileData;
}

interface RuntimePublisherObjectPositionContext {
  cursorWindow?: CursorWindow;
  partsPerSegment?: number;
  startSequenceNumber: number;
}

interface RuntimePublisherPartPositionContext {
  cursorWindow?: CursorWindow;
  partsPerSegment: number;
  startSequenceNumber: number;
}

/**
 * Per-kind defaults for every plannable object kind (init, part, segment),
 * e.g. as built by `createRuntimeObjectLowLatencyPublisherDefaults`.
 */
export type RuntimePublisherPlannedObjectDefaults = Record<
  RuntimePublisherPlannedObjectKind,
  RuntimePublisherObjectKindDefaults
>;

/** Options for `createRuntimePublisherObjectPlanInput`. */
export interface CreateRuntimePublisherObjectPlanInputOptions {
  /** Per-kind defaults the position's kind is looked up in. */
  defaults: RuntimePublisherPlannedObjectDefaults;
  /**
   * Nonce mixed into the derived object key; required downstream for
   * `direct-public` publication.
   */
  objectKeyNonce?: string;
  objectKeyPrefix?: string;
  position: RuntimePublisherObjectPosition;
  publicationMode?: PublicationMode;
  trackId: string;
}

/**
 * Options for `createRuntimePublisherNextObjectPlan`: position resolution,
 * per-kind defaults, and expiry inputs combined. The expiry's
 * `cadenceSeconds` comes from the resolved kind's defaults, so it is
 * omitted here.
 */
export interface CreateRuntimePublisherNextObjectPlanOptions
  extends Omit<CreateRuntimePublisherObjectPlanInputOptions, "position">,
    Omit<ResolveRuntimePublisherObjectExpiryOptions, "cadenceSeconds">,
    ResolveRuntimePublisherNextObjectPositionOptions {}

/**
 * A fully resolved object plan input, still missing only the `expiresAt`
 * that expiry resolution supplies. Carries the kind's `cadenceSeconds` for
 * that resolution.
 */
export type RuntimePublisherObjectPlanInput = Omit<
  CreateRuntimePublisherObjectPlanOptions,
  "expiresAt"
> & { cadenceSeconds: number };

/**
 * Result of `createRuntimePublisherNextObjectPlan`: the slot plan, the
 * expiry it was stamped with, and the timeline position it targets.
 */
export interface RuntimePublisherNextObjectPlan {
  expiry: RuntimePublisherObjectExpiry;
  plan: RuntimePublisherObjectPlan;
  position: RuntimePublisherObjectPosition;
}

/**
 * Work out which object a publisher should produce next. Yields the init
 * object when `initPublished` is `false`; otherwise advances past
 * `cursorWindow` in the chosen cadence — the next segment, or the next part
 * (rolling into part 0 of the next segment after `partsPerSegment` parts).
 * Without a cursor window it starts at `startSequenceNumber`
 * (default 0).
 */
export function resolveRuntimePublisherNextObjectPosition(
  options: ResolveRuntimePublisherNextObjectPositionOptions = {}
): RuntimePublisherObjectPosition {
  const context = runtimePublisherObjectPositionContext(options);

  if (options.initPublished === false) {
    return {
      kind: "init",
      sequenceNumber: 0,
    };
  }

  return nextCadencePosition(options.mode, context);
}

function runtimePublisherObjectPositionContext(
  options: ResolveRuntimePublisherNextObjectPositionOptions
): RuntimePublisherObjectPositionContext {
  const startSequenceNumber = options.startSequenceNumber ?? 0;
  assertNonNegativeInteger(startSequenceNumber, "startSequenceNumber");

  if (options.cursorWindow !== undefined) {
    assertCursorWindow(options.cursorWindow, "cursorWindow");
  }

  return {
    cursorWindow: options.cursorWindow,
    partsPerSegment: options.partsPerSegment,
    startSequenceNumber,
  };
}

function nextCadencePosition(
  mode: RuntimePublisherCadenceMode | undefined,
  context: RuntimePublisherObjectPositionContext
): RuntimePublisherObjectPosition {
  if (mode !== "part") {
    return nextSegmentPosition(context);
  }

  return nextPartPosition(runtimePublisherPartPositionContext(context));
}

function runtimePublisherPartPositionContext(
  context: RuntimePublisherObjectPositionContext
): RuntimePublisherPartPositionContext {
  return {
    cursorWindow: context.cursorWindow,
    partsPerSegment: positiveInteger(
      context.partsPerSegment,
      "partsPerSegment"
    ),
    startSequenceNumber: context.startSequenceNumber,
  };
}

/**
 * Merge a timeline position with its kind's defaults into a plan input,
 * carrying through the track, publication mode, and object key hints.
 */
export function createRuntimePublisherObjectPlanInput(
  options: CreateRuntimePublisherObjectPlanInputOptions
): RuntimePublisherObjectPlanInput {
  const defaults = options.defaults[options.position.kind];

  return {
    cadenceSeconds: defaults.cadenceSeconds,
    contentType: defaults.contentType,
    kind: options.position.kind,
    maxBytes: defaults.maxBytes,
    publicationMode: options.publicationMode,
    sequenceNumber: options.position.sequenceNumber,
    trackId: options.trackId,
    ...optionalField("extension", defaults.extension),
    ...optionalField("minBytes", defaults.minBytes),
    ...optionalField("objectKeyNonce", options.objectKeyNonce),
    ...optionalField("objectKeyPrefix", options.objectKeyPrefix),
    ...optionalField("partNumber", options.position.partNumber),
    ...optionalField("profile", defaults.profile),
  };
}

function nextSegmentPosition(options: {
  cursorWindow?: CursorWindow;
  startSequenceNumber: number;
}): RuntimePublisherObjectPosition {
  return {
    kind: "segment",
    sequenceNumber:
      options.cursorWindow === undefined
        ? options.startSequenceNumber
        : options.cursorWindow.lastSequenceNumber + 1,
  };
}

/**
 * Plan the publisher's next object end to end: resolve the position, apply
 * the kind's defaults, resolve the slot expiry from `now`, and build the
 * slot issue payload plus deterministic commit id and object key preview.
 */
export function createRuntimePublisherNextObjectPlan(
  options: CreateRuntimePublisherNextObjectPlanOptions
): RuntimePublisherNextObjectPlan {
  const input = createRuntimePublisherNextObjectPlanInput(options);
  const expiry = resolveRuntimePublisherObjectExpiry({
    cadenceSeconds: input.cadenceSeconds,
    minTtlSeconds: options.minTtlSeconds,
    now: options.now,
    targetLatency: options.targetLatency,
  });

  return {
    expiry,
    plan: runtimePublisherObjectPlan(input, expiry),
    position: input.position,
  };
}

function createRuntimePublisherNextObjectPlanInput(
  options: CreateRuntimePublisherNextObjectPlanOptions
): RuntimePublisherObjectPlanInput & {
  position: RuntimePublisherObjectPosition;
} {
  const position = resolveRuntimePublisherNextObjectPosition(options);

  return {
    ...createRuntimePublisherObjectPlanInput({
      ...options,
      position,
    }),
    position,
  };
}

function runtimePublisherObjectPlan(
  input: RuntimePublisherObjectPlanInput,
  expiry: RuntimePublisherObjectExpiry
): RuntimePublisherObjectPlan {
  const { cadenceSeconds, ...plan } = input;

  return createRuntimePublisherObjectPlan({
    ...plan,
    expiresAt: expiry.expiresAt,
  });
}

function nextPartPosition(
  options: RuntimePublisherPartPositionContext
): RuntimePublisherObjectPosition {
  const { cursorWindow } = options;

  if (cursorWindow === undefined) {
    return firstPartPosition(options.startSequenceNumber);
  }

  const nextPart = nextPartInCurrentSegment(
    cursorWindow,
    options.partsPerSegment
  );

  if (nextPart !== undefined) {
    return nextPart;
  }

  return firstPartPosition(cursorWindow.lastSequenceNumber + 1);
}

function nextPartInCurrentSegment(
  cursorWindow: CursorWindow,
  partsPerSegment: number
): RuntimePublisherObjectPosition | undefined {
  if (cursorWindow.lastPartNumber === undefined) {
    return;
  }

  const nextPartNumber = cursorWindow.lastPartNumber + 1;

  if (nextPartNumber >= partsPerSegment) {
    return;
  }

  return {
    kind: "part",
    partNumber: nextPartNumber,
    sequenceNumber: cursorWindow.lastSequenceNumber,
  };
}

function firstPartPosition(
  sequenceNumber: number
): RuntimePublisherObjectPosition {
  return {
    kind: "part",
    partNumber: 0,
    sequenceNumber,
  };
}
