---
"@arsenstorm/olos": minor
---

Byterange streaming aligns open-ended ranges with RFC 8673 and releases
S3 work when the viewer goes away. Any request that carries a Range
header now answers `206` with
`content-range: bytes <start>-9007199254740991/*` and no
`content-length` when the range is open-ended; this includes `bytes=0-`,
which previously answered `200`. Viewer disconnects and response-body
cancellation now propagate to the in-flight S3 part fetch, so an
abandoned response no longer leaks a pooled socket on a stalled part
read. Bounded ranges clamp part bodies that overshoot the requested
range, so a part fetch that ignores `Range` cannot push the response
past its promised `content-length`. Already-aborted viewers no longer
hold cursor waits open.
