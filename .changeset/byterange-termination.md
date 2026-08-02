---
"@arsenstorm/olos": minor
---

Byterange segment streaming now fails fast instead of looping forever when a
part object returns no body/bytes; open-ended range responses are 200 without
the previously invalid `content-range: bytes N-/*` header; bounded 206
responses error the stream if the promised range cannot be fully supplied.
