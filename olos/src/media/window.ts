import type { TrackWindowProfileInput } from "../state/committed-window";
import type { StreamProfile } from "../types/profile";
import {
  CMAF_LLHLS_PROFILE_ID,
  type MediaCommittedSegment,
  type MediaSessionProfile,
  type MediaTrackWindowProfile,
} from "./types";
import { assertMediaSessionProfile } from "./validation";

export type { TrackWindowProfileInput } from "../state/committed-window";

/**
 * Build the `trackWindowProfile` hook for the CMAF/LL-HLS profile: trimmed
 * leading segments take their discontinuity markers with them, so the
 * track's `EXT-X-DISCONTINUITY-SEQUENCE` is the session baseline plus the
 * number of trimmed segments flagged `discontinuityBefore` (RFC 8216
 * §6.2.2). Returns no profile while the value matches the baseline so
 * unchanged windows keep their serialized shape.
 */
export function createMediaTrackWindowProfile(
  sessionProfile: Pick<MediaSessionProfile, "discontinuitySequence">
) {
  const baseline = sessionProfile.discontinuitySequence ?? 0;

  return (
    input: TrackWindowProfileInput
  ): MediaTrackWindowProfile | undefined => {
    const trimmedDiscontinuities = input.trimmedSegments.filter(
      (segment) =>
        (segment as MediaCommittedSegment).segment?.profile
          ?.discontinuityBefore === true
    ).length;

    if (trimmedDiscontinuities === 0) {
      return;
    }

    return { discontinuitySequence: baseline + trimmedDiscontinuities };
  };
}

/**
 * Returns the `trackWindowProfile` hook for a session profile when it is
 * the CMAF/LL-HLS profile, or undefined for any other profile. Intended
 * for coordinator runtimes that serve mixed profiles.
 */
export function mediaTrackWindowProfileFor(profile: StreamProfile) {
  if (profile.id !== CMAF_LLHLS_PROFILE_ID) {
    return;
  }

  assertMediaSessionProfile(profile, "session.profile");

  return createMediaTrackWindowProfile(profile);
}
