# OLOS Provider Capabilities

Status: `draft-v0.1.2`

## 1. Abstract

OLOS Provider Capabilities define how a storage/delivery provider declares whether it can safely participate in OLOS object-store publication.

Capabilities are descriptive. They do not replace conformance tests.

## 2. Questions answered

A capability document SHOULD answer:

```text
Can objects be created if absent?
Can object existence be checked immediately after upload?
Can upload grants be scoped to exact object keys?
Can required headers be signed or otherwise enforced?
Can public delivery URLs be derived predictably from committed object keys?
Can future-object 404 caching be controlled?
Can object reads be gated before commit, if required?
Can provider events be delivered to the coordinator?
```

## 3. Capability document

Example:

```json
{
  "olos": "1.0",
  "providerId": "r2-primary",
  "kind": "object-store",
  "api": {
    "family": "s3-compatible"
  },
  "consistency": {
    "readAfterCreate": "strong",
    "headAfterCreate": "strong",
    "listAfterCreate": "strong"
  },
  "publication": {
    "directObjectPublication": true,
    "manifestGatedPublication": true,
    "readGateAvailable": true,
    "privateUploadPublicPromotion": true,
    "createIfAbsent": true,
    "overwritesAllowed": false
  },
  "uploadGrants": {
    "presignedPut": true,
    "temporaryCredentials": true,
    "maxRecommendedTtlSeconds": 60,
    "requiredHeadersCanBeSigned": true
  },
  "delivery": {
    "publicBaseUrl": "https://media.example.com",
    "rangeRequests": true,
    "immutableCaching": true,
    "negativeCachingPolicyDeclared": true,
    "documentNavigationCanBeBlocked": true
  },
  "events": {
    "objectCreated": true,
    "delivery": "at-least-once"
  }
}
```

## 4. Required fields

```text
olos
providerId
kind
consistency.readAfterCreate
consistency.headAfterCreate
publication.directObjectPublication
publication.createIfAbsent
uploadGrants.presignedPut or uploadGrants.temporaryCredentials
delivery.publicBaseUrl
delivery.negativeCachingPolicyDeclared
```

## 5. Publication capability meanings

### directObjectPublication

The provider can allow publishers to upload directly to the final object key that may later be emitted in playlists.

### manifestGatedPublication

The provider can support the OLOS model where only the coordinator/manifest gateway controls official playback state.

This does not necessarily mean that uncommitted objects are unreadable.

### readGateAvailable

The provider or delivery pathway can block public reads until a coordinator-approved condition is met.

Examples:

```text
signed read URLs
CDN token authentication
Worker-mediated read access
private bucket access through authorised proxy
```

### privateUploadPublicPromotion

The provider supports the stricter optional model where candidate uploads are not publicly readable and are copied/promoted after commit.

## 6. Consistency requirements

For direct object publication, `headAfterCreate` MUST be `strong`.

A provider MUST NOT be used for direct object publication unless the coordinator can reliably determine that an object exists before playlist emission.

For direct object publication, `overwritesAllowed` MUST NOT be `true`.

## 7. Cache requirements

A provider profile MUST describe:

```text
whether 404 responses are cached
how 404 caching can be disabled for live prefixes
whether overwritten objects may be served stale
whether deletion is reflected immediately through delivery caches
whether cache rules can distinguish manifests from media objects
```

For live media:

```text
object keys MUST be immutable
future object URLs SHOULD be unguessable
preload hints SHOULD be disabled unless safe
404 caching for live future paths SHOULD be disabled
```

## 8. Security requirements

A provider capability document MUST state whether the provider can support:

```text
exact-key upload grants
create-if-absent uploads
method-bound upload grants
content-type-bound upload grants
short upload-grant expiry
object-size observation before commit
read gating, if direct readability is not acceptable
```

## 9. Conformance

A provider is not OLOS-conformant merely because it publishes a capability document.

A provider binding SHOULD pass conformance tests for:

```text
exact-key upload
create-if-absent behaviour
HeadObject after upload
duplicate event idempotency
future-object 404 safety
public URL resolution
read-gate behaviour, if claimed
```
