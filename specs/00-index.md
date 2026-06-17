# OLOS Specification Index

Status: `draft-v0.1.2`  
Updates: `draft-v0.1.1`  
Intended audience: implementers, protocol reviewers, RFC contributors.

## 1. Name

The protocol suite is named:

```text
Open Live Object Streaming
```

The short name is:

```text
OLOS
```

## 2. Definition

OLOS is a provider-neutral live streaming protocol suite in which live media is published as immutable timed media objects, committed to an authoritative live cursor, and mapped to existing playback protocols.

A compact definition:

```text
OLOS standardises live media publication as immutable timed objects,
with provider-neutral storage, coordination and playback mapping.
```

## 3. Normative language

The words `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`, `MAY`, and `OPTIONAL` are to be interpreted as described by RFC 2119 and RFC 8174 when, and only when, they appear in uppercase.

## 4. Document map

| Document | Purpose |
|---|---|
| `01-architecture.md` | Defines the system architecture, roles, goals and non-goals. |
| `02-core.md` | Defines OLOS sessions, upload slots, commits, cursors, `CommittedWindow`, epochs and pathways. |
| `03-object-binding.md` | Defines provider-neutral object-store publication semantics. |
| `04-provider-capabilities.md` | Defines provider capability discovery. |
| `05-hls-mapping.md` | Defines how OLOS state maps to LL-HLS playlists. |
| `06-security.md` | Defines the hostile-publisher model and no-scan mode controls. |
| `07-r2-profile.md` | Defines the Cloudflare R2 implementation profile. |
| `08-conformance.md` | Defines conformance levels and test requirements. |

## 5. Scope

OLOS v0.1.2 standardises:

```text
session creation
publisher identity
upload slot issuance
pre-signed upload grants
immutable object naming
object commit semantics
authoritative live cursor semantics
CommittedWindow manifest-input semantics
provider capability discovery
object-store publication requirements
LL-HLS playlist mapping
hostile-publisher security controls
no-scan mode disclosure
conformance test expectations
```

## 6. Non-goals

OLOS does not standardise:

```text
video codecs
audio codecs
CMAF internals
HLS playlist grammar
DASH MPD grammar
RTMP wire format
WebRTC signalling
MoQ transport
CDN cache algorithms
object-store vendor APIs
malware detection
transcoding
```

## 7. Relationship to existing standards

OLOS is intended to be complementary.

```text
CMAF
  provides the media object format.

LL-HLS
  provides the first playback mapping.

LL-DASH
  may provide a future playback mapping.

DASH-IF Live Media Ingest
  overlaps with live CMAF ingest to receiving entities.

RTMP/E-RTMP
  may be used as source ingest into a publisher agent.

WHIP/WebRTC
  may be used as source ingest into a publisher agent.

MoQ
  may be used as a future relay/delivery bridge, but is not required for OLOS-Object.
```

## 8. v0.1.2 implementation objective

The first conforming implementation should prove:

```text
a streamer can publish live CMAF objects using pre-signed object-store URLs;
a coordinator can commit those objects without parsing media bytes;
a live cursor and committed media window can be maintained;
an LL-HLS gateway can derive playlists from the cursor and CommittedWindow;
official playback manifests include committed media only;
a hostile publisher cannot publish arbitrary playlist text or arbitrary URLs.
```
