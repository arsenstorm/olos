import type { CursorWindow } from "../types/cursor";
import { isNonNegativeInteger } from "../validation/ids";
import type { RuntimePublisherPlannedObjectKind } from "./publisher-plan";

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

function nonNegativeInteger(value: number, name: string): number {
  if (!isNonNegativeInteger(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value;
}
