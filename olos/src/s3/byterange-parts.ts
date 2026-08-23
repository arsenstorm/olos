import type { CoordinatorPipelineStore } from "../protocol/coordinator-types";
import type { CommittedPart } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { ResolvedByterangeParts } from "./byterange-types";

/**
 * Read the parts that make up one virtual segment out of the session's
 * committed window, together with the cursor they were read from. Returns
 * `undefined` when the session is unknown or has no cursor yet.
 */
export async function resolveCommittedParts(
  store: CoordinatorPipelineStore,
  sessionId: string,
  segmentObjectKey: string
): Promise<ResolvedByterangeParts | undefined> {
  const snapshot = await store.load(sessionId);
  if (snapshot === undefined) {
    return;
  }
  const { cursor } = snapshot.state;
  if (cursor === undefined) {
    return;
  }

  return { cursor, parts: collectByterangeParts(cursor, segmentObjectKey) };
}

/**
 * Every part in the window that belongs to `segmentObjectKey`, in ascending
 * byterange offset order. Parts of one virtual segment can be spread across
 * tracks and segments, so the whole window is scanned.
 */
function collectByterangeParts(
  cursor: Cursor,
  segmentObjectKey: string
): CommittedPart[] {
  return Object.values(cursor.committedWindow.tracks)
    .flatMap((track) => track.segments)
    .flatMap((segment) => segment.parts ?? [])
    .filter((part) => part.byterange?.segmentObjectKey === segmentObjectKey)
    .sort((a, b) => (a.byterange?.offset ?? 0) - (b.byterange?.offset ?? 0));
}

/** The part whose byterange contains `position`, if one is committed yet. */
export function nextPartCovering(
  parts: readonly CommittedPart[],
  position: number
): CommittedPart | undefined {
  return parts.find((part) => coversPosition(part, position));
}

function coversPosition(part: CommittedPart, position: number): boolean {
  const { byterange } = part;
  if (byterange === undefined) {
    return false;
  }
  return (
    byterange.offset <= position &&
    position < byterange.offset + byterange.length
  );
}
