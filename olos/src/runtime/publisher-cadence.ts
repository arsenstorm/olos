import type { CursorWindow } from "../types/cursor";
import type { PublicationMode } from "../types/upload-slot";
import { isNonNegativeInteger } from "../validation/ids";
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

export type RuntimePublisherPlannedObjectDefaults = Record<
  RuntimePublisherPlannedObjectKind,
  RuntimePublisherObjectKindDefaults
>;

export interface CreateRuntimePublisherObjectPlanInputOptions {
  baseUrl: string;
  defaults: RuntimePublisherPlannedObjectDefaults;
  objectKeyPrefix: string;
  position: RuntimePublisherObjectPosition;
  publicationMode: PublicationMode;
  publisherInstanceId: string;
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
  const startMediaSequenceNumber = nonNegativeInteger(
    options.startMediaSequenceNumber ?? 0,
    "startMediaSequenceNumber"
  );

  if (options.initPublished === false) {
    return {
      kind: "init",
      mediaSequenceNumber: 0,
    };
  }

  if (options.mode === "part") {
    const partsPerSegment = positiveInteger(
      options.partsPerSegment,
      "partsPerSegment"
    );

    return nextPartPosition({
      cursorWindow: options.cursorWindow,
      partsPerSegment,
      startMediaSequenceNumber,
    });
  }

  return {
    kind: "segment",
    mediaSequenceNumber:
      options.cursorWindow === undefined
        ? startMediaSequenceNumber
        : options.cursorWindow.lastMediaSequenceNumber + 1,
  };
}

export function createRuntimePublisherObjectPlanInput(
  options: CreateRuntimePublisherObjectPlanInputOptions
): RuntimePublisherObjectPlanInput {
  const defaults = options.defaults[options.position.kind];

  return {
    baseUrl: options.baseUrl,
    contentType: defaults.contentType,
    duration: defaults.duration,
    extension: defaults.extension,
    kind: options.position.kind,
    maxBytes: defaults.maxBytes,
    mediaSequenceNumber: options.position.mediaSequenceNumber,
    objectKeyPrefix: options.objectKeyPrefix,
    publicationMode: options.publicationMode,
    publisherInstanceId: options.publisherInstanceId,
    renditionId: options.renditionId,
    ...optionalNumber("minBytes", defaults.minBytes),
    ...optionalNumber("partNumber", options.position.partNumber),
  };
}

export function createRuntimePublisherNextObjectPlan(
  options: CreateRuntimePublisherNextObjectPlanOptions
): RuntimePublisherNextObjectPlan {
  const position = resolveRuntimePublisherNextObjectPosition(options);
  const input = createRuntimePublisherObjectPlanInput({
    ...options,
    position,
  });
  const expiry = resolveRuntimePublisherObjectExpiry({
    duration: input.duration,
    minTtlSeconds: options.minTtlSeconds,
    now: options.now,
    targetLatency: options.targetLatency,
  });

  return {
    expiry,
    plan: createRuntimePublisherObjectPlan({
      ...input,
      expiresAt: expiry.expiresAt,
    }),
    position,
  };
}

function nextPartPosition(options: {
  cursorWindow?: CursorWindow;
  partsPerSegment: number;
  startMediaSequenceNumber: number;
}): RuntimePublisherObjectPosition {
  const { cursorWindow } = options;

  if (cursorWindow === undefined) {
    return {
      kind: "part",
      mediaSequenceNumber: options.startMediaSequenceNumber,
      partNumber: 0,
    };
  }

  if (cursorWindow.lastPartNumber !== undefined) {
    const nextPartNumber = cursorWindow.lastPartNumber + 1;

    if (nextPartNumber < options.partsPerSegment) {
      return {
        kind: "part",
        mediaSequenceNumber: cursorWindow.lastMediaSequenceNumber,
        partNumber: nextPartNumber,
      };
    }
  }

  return {
    kind: "part",
    mediaSequenceNumber: cursorWindow.lastMediaSequenceNumber + 1,
    partNumber: 0,
  };
}

function positiveInteger(value: number | undefined, name: string): number {
  if (!isNonNegativeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function optionalNumber<Key extends "minBytes" | "partNumber">(
  key: Key,
  value: number | undefined
): Partial<Record<Key, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, number>);
}

function nonNegativeInteger(value: number, name: string): number {
  if (!isNonNegativeInteger(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value;
}
