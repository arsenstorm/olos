# OLOS Architecture

Status: `draft-v0.1.2`

## 1. Abstract

Open Live Object Streaming (OLOS) defines a provider-neutral architecture for publishing live media as immutable timed media objects. A publisher fills pre-authorised upload slots, a coordinator commits object availability to a live cursor and `CommittedWindow`, and playback gateways render existing playback formats from that trusted state.

The v0.1.2 architecture is object-store-first. It targets low-cost HTTP live streaming, not true realtime media relay.

## 2. Design thesis

```text
Media bytes are immutable objects.
Live state is an authoritative cursor plus a committed media window.
Playback is derived from the cursor and `CommittedWindow`.
Storage and orchestration are replaceable.
```

## 3. Roles

### 3.1 Capture Source

A system that produces encoded or encodable live media.

Examples:

```text
OBS
hardware encoder
mobile app
camera pipeline
RTMP source
E-RTMP source
SRT source
WHIP source
```

### 3.2 Publisher

The component that converts live input into OLOS media objects and uploads them.

Responsibilities:

```text
receive encoded timed media
create CMAF/fMP4 init and media part objects
request upload slots
upload bytes to provider-granted URLs
send completion hints
send heartbeats
handle reconnects and epoch changes
```

### 3.3 Coordinator

The trusted authority for live state.

Responsibilities:

```text
authenticate publishers
create sessions
issue upload slots
grant upload URLs
observe object upload completion
commit slots
advance the live cursor and committed window
enforce quotas
handle failover and discontinuities
end or abort sessions
```

### 3.4 Storage Provider

A system that stores media objects.

Examples:

```text
Cloudflare R2
AWS S3
Google Cloud Storage
Azure Blob Storage
MinIO
Ceph
self-hosted HTTP object origin
```

### 3.5 Delivery Provider

A cache, CDN, object public endpoint, or origin pathway that serves committed media objects to viewers.

### 3.6 Manifest Gateway

A trusted service that converts OLOS cursor and `CommittedWindow` state into existing playback formats.

v0.1.2 requires LL-HLS mapping.

Future mappings may include:

```text
LL-DASH
native OLOS JSON cursor/CommittedWindow
MoQ bridge
```

### 3.7 Viewer

A client that consumes playback output and media objects.

Examples:

```text
Safari/native HLS
hls.js with MSE
native mobile player
set-top box player
```

## 4. Trust model

OLOS assumes:

```text
publishers are hostile or compromised unless explicitly trusted
storage providers store bytes but do not validate media safety
delivery providers may cache aggressively
viewers parse untrusted media bytes
coordinators and manifest gateways are trusted
```

The central invariant is:

```text
untrusted upload != official playable stream state
```

A media object becomes part of the official stream only when the coordinator commits an upload slot and the manifest gateway emits the object from trusted state. In single-bucket public deployments the object may be directly readable before commit; OLOS then provides manifest-gated publication, not unreadability before commit.

## 5. Deployment model: object-store mode

```text
Capture Source
  -> Publisher
  -> pre-signed object PUT to coordinator-issued object key
  -> single object-store bucket/prefix
  -> object-created event / completion hint
  -> Coordinator verifies exact object existence
  -> live cursor and CommittedWindow
  -> Manifest Gateway
  -> LL-HLS playlist
  -> Delivery Provider
  -> Viewer
```

Object-store mode is designed for:

```text
low cost
provider portability
HTTP cache compatibility
commodity object storage
2–4 s practical latency
```

It is not designed for:

```text
sub-second end-to-end latency
interactive conferencing
realtime fan-out
```

## 6. Deployment model: active-origin mode

Future OLOS profiles may support active origin servers.

```text
Publisher
  -> active origin
  -> origin commits OLOS objects/cursor/CommittedWindow
  -> gateway
  -> playback
```

This may reduce latency by avoiding some object-store commit and cache restrictions.

## 7. Deployment model: multi-provider mode

OLOS sessions may define multiple pathways.

Example:

```text
r2-primary
s3-backup
owned-origin-emergency
```

The cursor identifies which pathways are active and preferred; the `CommittedWindow` identifies which objects are officially playable. HLS mapping may translate pathways to HLS Content Steering where appropriate.

## 8. Latency classes

OLOS defines latency classes as deployment guidance, not hard protocol guarantees.

| Class | Typical part duration | Expected latency | Notes |
|---|---:|---:|---|
| `object-standard` | 1–2 s | ~4–8 s | robust HTTP streaming |
| `object-ll` | 500 ms | ~2–4 s | v0.1.2 target |
| `object-experimental` | 100–250 ms | ~1.2–2.5 s | high request/object rate and stall risk |
| `origin-ll` | chunked/active origin | ~1–2 s | future profile |
| `relay-bridge` | MoQ/WebTransport style | possibly sub-second | not object-store-native |

## 9. Non-goals

OLOS architecture does not attempt to replace:

```text
CMAF
HLS
DASH
RTMP
WHIP/WebRTC
MoQ
CDNs
object stores
malware scanning
transcoding
```

## 10. RFC-worthy boundary

The RFC-worthy OLOS layer is:

```text
upload slot allocation
immutable object publication
object commit
live cursor
CommittedWindow
provider capabilities
pathway/failover metadata
security requirements
playback mappings
```

The RFC should not claim ownership of media container or playback grammar.
