---
"@arsenstorm/olos": minor
---

Byterange segment streaming now fails fast. If a part object returns no
body or no bytes, the stream errors instead of looping forever. Open-ended
range responses are now 200 and do not send the invalid
`content-range: bytes N-/*` header. If a bounded 206 response cannot supply
the full promised range, the stream errors instead of a silent truncation.
