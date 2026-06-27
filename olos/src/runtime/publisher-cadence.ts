import type { CursorWindow } from "../types/cursor";
import type { PublicationMode } from "../types/upload-slot";
import { assertCursorWindow } from "../validation/cursor";
import { assertNonNegativeInteger } from "../validation/ids";
import { optionalField } from "./optional-field";
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
import { positiveInteger } from "./request-fields";

export type RuntimePublisherCadenceMode = "part" | "segment";

export interface ResolveRuntimePublisherNextObjectPositionOptions {
  cursorWindow?: CursorWindow;
  initPublished?: boolean;
  mode?: RuntimePublisherCadenceMode;
  partsPerSegment?: number;
  startMediaSequenceNumber?: number;
}

export interface RuntimePublisherObjectPosition {
  kind: RuntimePublisherPlannedObjectKind;
  mediaSequenceNumber: number;
  partNumber?: number;
}

export interface RuntimePublisherObjectKindDefaults {
  contentType: string;
  duration: number;
  extension: string;
  maxBytes: number;
  minBytes?: number;
}

interface RuntimePublisherObjectPositionContext {
  cursorWindow?: CursorWindow;
  partsPerSegment?: number;
  startMediaSequenceNumber: number;
}

interface RuntimePublisherPartPositionContext {
  cursorWindow?: CursorWindow;
  partsPerSegment: number;
  startMediaSequenceNumber: number;
}

export type RuntimePublisherPlannedObjectDefaults = Record<
  RuntimePublisherPlannedObjectKind,
  RuntimePublisherObjectKindDefaults
>;

export interface CreateRuntimePublisherObjectPlanInputOptions {
  defaults: RuntimePublisherPlannedObjectDefaults;
  objectKeyNonce?: string;
  objectKeyPrefix?: string;
  position: RuntimePublisherObjectPosition;
  publicationMode?: PublicationMode;
  renditionId: string;
}

export interface CreateRuntimePublisherNextObjectPlanOptions
  extends Omit<CreateRuntimePublisherObjectPlanInputOptions, "position">,
    Omit<ResolveRuntimePublisherObjectExpiryOptions, "duration">,
    ResolveRuntimePublisherNextObjectPositionOptions {}

export type RuntimePublisherObjectPlanInput = Omit<
  CreateRuntimePublisherObjectPlanOptions,
  "expiresAt"
>;

export interface RuntimePublisherNextObjectPlan {
  expiry: RuntimePublisherObjectExpiry;
  plan: RuntimePublisherObjectPlan;
  position: RuntimePublisherObjectPosition;
}

export function resolveRuntimePublisherNextObjectPosition(
  options: ResolveRuntimePublisherNextObjectPositionOptions = {}
): RuntimePublisherObjectPosition {
  const context = runtimePublisherObjectPositionContext(options);

  if (options.initPublished === false) {
    return {
      kind: "init",
      mediaSequenceNumber: 0,
    };
  }

  return nextCadencePosition(options.mode, context);
}

function runtimePublisherObjectPositionContext(
  options: ResolveRuntimePublisherNextObjectPositionOptions
): RuntimePublisherObjectPositionContext {
  const startMediaSequenceNumber = options.startMediaSequenceNumber ?? 0;
  assertNonNegativeInteger(
    startMediaSequenceNumber,
    "startMediaSequenceNumber"
  );

  if (options.cursorWindow !== undefined) {
    assertCursorWindow(options.cursorWindow, "cursorWindow");
  }

  return {
    cursorWindow: options.cursorWindow,
    partsPerSegment: options.partsPerSegment,
    startMediaSequenceNumber,
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
    startMediaSequenceNumber: context.startMediaSequenceNumber,
  };
}

export function createRuntimePublisherObjectPlanInput(
  options: CreateRuntimePublisherObjectPlanInputOptions
): RuntimePublisherObjectPlanInput {
  const defaults = options.defaults[options.position.kind];

  return {
    contentType: defaults.contentType,
    duration: defaults.duration,
    extension: defaults.extension,
    kind: options.position.kind,
    maxBytes: defaults.maxBytes,
    mediaSequenceNumber: options.position.mediaSequenceNumber,
    publicationMode: options.publicationMode,
    renditionId: options.renditionId,
    ...optionalField("minBytes", defaults.minBytes),
    ...optionalField("objectKeyNonce", options.objectKeyNonce),
    ...optionalField("objectKeyPrefix", options.objectKeyPrefix),
    ...optionalField("partNumber", options.position.partNumber),
  };
}

function nextSegmentPosition(options: {
  cursorWindow?: CursorWindow;
  startMediaSequenceNumber: number;
}): RuntimePublisherObjectPosition {
  return {
    kind: "segment",
    mediaSequenceNumber:
      options.cursorWindow === undefined
        ? options.startMediaSequenceNumber
        : options.cursorWindow.lastMediaSequenceNumber + 1,
  };
}

export function createRuntimePublisherNextObjectPlan(
  options: CreateRuntimePublisherNextObjectPlanOptions
): RuntimePublisherNextObjectPlan {
  const input = createRuntimePublisherNextObjectPlanInput(options);
  const expiry = resolveRuntimePublisherObjectExpiry({
    duration: input.duration,
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
  return createRuntimePublisherObjectPlan({
    ...input,
    expiresAt: expiry.expiresAt,
  });
}

function nextPartPosition(
  options: RuntimePublisherPartPositionContext
): RuntimePublisherObjectPosition {
  const { cursorWindow } = options;

  if (cursorWindow === undefined) {
    return firstPartPosition(options.startMediaSequenceNumber);
  }

  const nextPart = nextPartInCurrentSegment(
    cursorWindow,
    options.partsPerSegment
  );

  if (nextPart !== undefined) {
    return nextPart;
  }

  return firstPartPosition(cursorWindow.lastMediaSequenceNumber + 1);
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
    mediaSequenceNumber: cursorWindow.lastMediaSequenceNumber,
    partNumber: nextPartNumber,
  };
}

function firstPartPosition(
  mediaSequenceNumber: number
): RuntimePublisherObjectPosition {
  return {
    kind: "part",
    mediaSequenceNumber,
    partNumber: 0,
  };
}
