---
"@arsenstorm/olos": minor
---

Byterange segment streaming now fails fast. If a part object returns no
body or no bytes, the stream errors instead of looping forever. Open-ended
range responses answer 206 with the RFC 8673 open-ended `content-range`
form instead of the invalid `content-range: bytes N-/*` header. If a
bounded 206 response cannot supply the full promised range, the stream
errors instead of a silent truncation.
