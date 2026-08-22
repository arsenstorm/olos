---
"@arsenstorm/olos": patch
---

Fix two manifest defects that made rendered playlists unplayable by native
HLS players (Safari and any other AVFoundation-based client). MSE players
such as hls.js tolerate both, so neither showed up in browser playback.

- `HOLD-BACK` is now rendered as `max(3 × EXT-X-TARGETDURATION,
  targetLatency)`. RFC 8216bis Section 4.4.3.8 floors the tag at three
  target durations, and Apple's player rejects the entire playlist below it
  (`HOLD-BACK less than 3 * target-duration`, CoreMedia -12646), taking down
  every variant with it. A `targetLatency` under the floor is raised rather
  than rejected — it is a deployment latency goal, not the wire tag, and the
  floor moves with `segmentTarget`. Deployments that set a low
  `targetLatency` will see a larger `HOLD-BACK` in the rendered manifest;
  the low-latency path is driven by `PART-HOLD-BACK`, which is unchanged.
- A commit's `programDateTime` now reaches the committed window's segments.
  `CommittedSegment.programDateTime` existed and the renderer emitted
  `EXT-X-PROGRAM-DATE-TIME` from it, but nothing ever copied the field off
  the commit, so the tag could not be produced at all. The first commit at a
  media sequence that carries the field — part 0 for a parted segment,
  otherwise the segment commit — now anchors the segment's wall-clock start.
  Apple's low-latency profile requires the tag and drops out of low-latency
  mode without it (CoreMedia -15412).
