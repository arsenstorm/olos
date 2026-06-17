# OLOS Security

Status: `draft-v0.1.2`

## 1. Abstract

OLOS assumes publishers may be hostile. The security model is therefore based on constrained publication, not publisher trust.

The v0.1.2 security mode is:

```text
No-Scan Mode with manifest-gated publication
```

No-Scan Mode avoids server-side malware scanning or deep media byte inspection for cost reasons. It uses upload slots, immutable object keys, generated manifests, strict delivery headers, quotas and cache controls to reduce abuse.

## 2. Central invariant

```text
untrusted upload != official playable stream state
```

A publisher may upload media bytes into a coordinator-issued object key. Only the coordinator may make that object part of the official stream by committing the slot and advancing the cursor/`CommittedWindow`.

In public single-bucket deployments, the uploaded object may be directly readable before commit if the URL is known. Therefore the stronger invariant:

```text
untrusted upload != publicly readable object
```

is only true when a deployment adds read gating or private upload/public promotion.

## 3. No-Scan Mode statement

An OLOS implementation operating in No-Scan Mode MUST document:

```text
OLOS No-Scan Mode does not validate that uploaded media bytes are safe,
legal, well-formed, decodable or free from malware. It validates publication
rights, object identity, slot sequence, object size, immutability and delivery
context.
```

Direct-public deployments MUST additionally document:

```text
Uncommitted objects may be directly readable if their URLs are known.
The coordinator only controls official playlist/cursor/CommittedWindow publication unless a read gate is configured.
```

## 4. Residual risk

No-Scan Mode cannot fully prevent:

```text
malformed media exploiting browser, OS, smart-TV or native-player decoder bugs
malicious payloads triggering parser bugs in media engines
illegal or abusive live content being streamed briefly before moderation
playback failures caused by invalid media bytes
arbitrary bytes being reachable as media objects in public direct mode
```

This residual risk is inherent unless the deployment adds one or more of:

```text
trusted publishers
byte-level structural validation
sandboxed remuxing
transcoding
malware scanning
human or automated content moderation
delayed publication
read gating
private upload/public promotion
```

## 5. Threats and controls

### 5.1 Arbitrary file hosting

A hostile publisher uploads non-media bytes and shares the direct object URL.

Required controls in direct-public mode:

```text
coordinator-generated exact object keys
short-lived pre-signed PUTs
create-if-absent uploads
strict object size limits
Content-Type-bound upload grants where possible
media origin served as cookieless media-only origin
X-Content-Type-Options: nosniff
block top-level document navigation to media objects
block unknown extensions
no bucket listing
quotas and abuse kill switch
```

Direct-public mode reduces the value of arbitrary file hosting but cannot fully prevent direct URL sharing by the publisher. Deployments requiring stronger protection MUST use read gating or private upload/public promotion.

### 5.2 Manifest injection

A hostile publisher tries to control playlists or playlist URIs.

Required controls:

```text
publishers MUST NOT upload canonical playlists
manifest gateway MUST generate playlists from cursor and `CommittedWindow` state
publisher-supplied absolute URLs MUST be rejected
publisher-supplied key/subtitle/steering URLs MUST be rejected
```

### 5.3 Object overwrite/cache poisoning

A hostile publisher overwrites or races a previously committed object.

Required controls:

```text
create-if-absent uploads
immutable committed keys
no delete-and-reuse
idempotent commits
duplicate non-identical commit rejection
future-object URLs SHOULD be unguessable
no future-object negative caching
preload hints disabled by default in object-store mode
```

### 5.4 Credential abuse

A pre-signed URL or temporary credential leaks.

Required controls:

```text
short expiry
exact key
method-bound grant
signed required headers where possible
create-if-absent
slot-bound metadata
no ListBucket/DeleteObject grants
revocation by stopping slot issuance
```

### 5.5 Cost denial-of-service

A hostile publisher creates too many objects, huge objects or too many sessions.

Required controls:

```text
max sessions per account
max slots per minute
max uncommitted bytes
max object size per slot
max bitrate envelope
max renditions
max failed uploads
budget kill switch
```

### 5.6 Decoder/parser exploitation

A hostile publisher uploads crafted media that targets viewer decoders.

Controls available in No-Scan Mode:

```text
restrict MIME and extension
restrict supported codecs
avoid custom client-side parsers
avoid untrusted timed metadata/subtitles initially
use modern maintained players
serve from cookieless origin
```

These controls reduce exposure but do not prove safety.

## 6. Upload-slot security requirements

A coordinator MUST:

```text
generate all object keys
issue upload slots before upload
bind slots to exact session/epoch/rendition/msn/part
include an unpredictable per-slot object-key component
limit slot expiry
limit object size
require create-if-absent where provider supports it
reject unknown keys
reject unknown slots
reject expired slots
reject duplicate conflicting commits
```

## 7. Pre-signed URL requirements

Upload grants SHOULD be:

```text
single-purpose
short-lived
exact-object
method-bound
content-type-bound
create-if-absent
header-bound where provider supports signed headers
```

Example required headers:

```http
Content-Type: video/mp4
If-None-Match: *
x-olos-slot-id: slot_01JZ
```

## 8. Publication boundary

Default v0.1.2:

```text
media/...  public or delivery-routable object key
```

The publication boundary is the coordinator-owned cursor, `CommittedWindow` and manifest gateway. An object MUST NOT be emitted in official playback state until the coordinator has observed the exact object and committed the slot.

Optional stricter models:

```text
read-gated direct object publication
private upload/public promotion
```

## 9. Manifest gateway security

The manifest gateway MUST:

```text
read trusted cursor and `CommittedWindow` state
derive all media URLs from committed slots
restrict URI schemes and authorities
escape playlist values
reject control characters
reject publisher-controlled key URLs
reject publisher-controlled subtitle URLs
reject publisher-controlled content-steering URLs
```

The gateway MUST NOT:

```text
serve publisher-uploaded playlists as canonical playlists
reflect publisher metadata into HTML
use object listing as the live cursor or CommittedWindow
emit an unobserved object in a playlist
```

## 10. Media origin security

Public media SHOULD be served from a cookieless origin.

Example:

```text
app.example.com       authenticated app
api.example.com       OLOS coordinator API
play.example.com      player shell
media.example.com     media bytes only
```

Recommended media headers:

```http
Content-Type: video/mp4
X-Content-Type-Options: nosniff
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Credentials: false
Cross-Origin-Resource-Policy: same-site
Set-Cookie: never
```

The media origin SHOULD block:

```text
top-level document navigation to media part URLs
unknown extensions
HTML Accept requests for media objects
bucket or prefix listing
```

## 11. Cache safety

OLOS direct object publication SHOULD avoid deterministic future URLs.

The manifest gateway SHOULD NOT emit preload hints by default in object-store mode. If preload hints are used, the deployment MUST prove that future-object requests cannot cache stale 404s or poison the live path.

## 12. Kill switch

A deployment MUST be able to:

```text
stop issuing upload slots
reject completion hints
ignore provider events for a session
freeze cursor/CommittedWindow advancement
revoke viewer access where applicable
block a media prefix at the delivery layer
purge cache where necessary
```

## 13. Security-negative tests

A conforming implementation SHOULD test:

```text
wrong object key rejected
expired slot rejected
wrong content type rejected where enforceable
oversized object rejected before commit
duplicate event idempotent
non-identical duplicate commit rejected
object not playlisted before observed existence
publisher-uploaded playlist ignored
absolute URI injection rejected
future-object 404 not cached unsafely
public media origin does not execute HTML/JS
kill switch prevents new publication
```
