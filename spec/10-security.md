# 10. Security profile: direct-public deployment

OLOS's default publication mode, `direct-public`, serves committed
objects straight from the object store's public origin. This section
states the requirements of that profile normatively.

Reference implementation (informative): `olos/src/state/direct-public-security-policy.ts`,
`cache-policy.ts`, and the direct-public deployment checklist in
`contributing/core/direct-public-deployment.md`.

## 10.1 Threat model boundary

Direct-public mode is **manifest-gated publication**. An object is
part of the stream only when the committed window references it
(Section 5). It does not make uncommitted uploads private. Deployments
MUST document and accept two facts before they use this mode:

- If their URLs are known, uncommitted objects can be directly
  readable. Unguessable nonced keys (Section 7.6) are the mitigation.
- OLOS does not prove that uploaded object bytes are safe or
  decodable. Commit validation covers identity and bounds only. Core
  treats `profile` as opaque and does not validate it (Section 2.1).

If uncommitted-object readability is unacceptable, deployments MUST
use `read-gated` or `private-upload-public-promotion` mode
(Section 7.8).

## 10.2 Provider and origin requirements

<!-- olos-conformance: 10.2 SEC-DIRECT-001 -->

A direct-public deployment MUST satisfy the direct-public gates of the
provider capability document (Section 7.7). Non-HTTPS public origins
MUST be rejected.

The delivery origin MUST be dedicated and cookieless. It serves object
bytes only. The public base URL determines `allowedDeliveryOrigins`,
the origins that playlist rendering can reference (Section 8.1).
Playlists MUST NOT reference other origins. `Set-Cookie` is a
forbidden response header on the delivery origin.

## 10.3 Media request policy

<!-- olos-conformance: 10.3 SEC-DIRECT-003 SEC-DIRECT-004 SEC-DIRECT-006 SEC-DIRECT-007 -->

This policy governs the delivery path for objects of any profile. The
delivery origin MUST evaluate every object request against these
rules, in order, and block on the first match:

| Rule | Status |
| --- | --- |
| Object key fails path safety (Section 7.5) | 404 |
| Extension not in the allowed set (`allowedObjectExtensions`) | 404 |
| Document navigation (`Sec-Fetch-Dest: document` or `Sec-Fetch-Mode: navigate`) | 403 |
| Request `Accept` includes `text/html` | 403 |

The key-safety rule MUST come before the navigation-header rules.
Traversal attempts then never reach later logic. Bucket and prefix
listing MUST be blocked at the provider.

Object responses MUST carry:

```http
Content-Type: <policy objectContentType>
X-Content-Type-Options: nosniff
Access-Control-Allow-Credentials: false
Cross-Origin-Resource-Policy: same-site
Cache-Control: <object policy, Section 10.4>
```

The security policy carries `allowedObjectExtensions` and
`objectContentType` as profile-supplied fields. Core pins no extension
set and no content type. The CMAF/LL-HLS profile supplies
`.m4s`/`.mp4` and `video/mp4` for these fields. A deployment that
delivers another profile's objects MUST apply the same rule order and
headers, with the content type and extension set of that profile. The
byterange aggregation service takes its `content-type` from the caller
(Section 8.5.2).

## 10.4 Cache policy, including negative caching

<!-- olos-conformance: 10.4 OBJ-CACHE-001 OBJ-CACHE-002 OBJ-CACHE-003 OBJ-CACHE-004 OBJ-CACHE-005 -->

Three cache targets, all `public`:

| Target | Cache-Control | Constraint |
| --- | --- | --- |
| Object | `public, max-age=31536000, immutable` | Requires provider `immutableCaching`. Keys are immutable and nonce-unique, so the max age MAY be a year. |
| Delivery document | `public, max-age=1, must-revalidate` | `max-age` MUST NOT exceed the target latency in seconds (default 3). The default is 1 s. |
| Negative object (404/miss) | `public, max-age=1, must-revalidate` | Same freshness bound. Requires provider `negativeCachingPolicyDeclared`. |

Negative caching is load-bearing. Preload-hinted or predicted object
URLs can be requested before the object exists. An unbounded cached
404 then poisons playback after the upload commits. Negative
responses for objects MUST use the short must-revalidate policy
above. They MUST be served only for keys that pass the Section 10.3
policy. Because immutable caching forbids reuse, a live object key
MUST NOT be reused after overwrite or delete. A new upload always
gets a new key (fresh nonce).

## 10.5 Upload-slot hardening

<!-- olos-conformance: 10.5 SEC-DIRECT-002 SEC-DIRECT-005 -->

Every upload slot MUST carry size bounds, a bound content type, an
`expiresAt` timestamp, and a server-derived nonced object key. Commit
validation MUST match the observation against them and reject a
mismatch (Section 4.4, Section 6.5.2). Grants MUST NOT outlive
`expiresAt` (Section 7.2). Retention prunes expired slots (Section 9).
Non-idempotent duplicate commits are rejected (Section 4).

Slot-issue payloads MUST NOT accept publisher-supplied `objectKey` or
`deliveryUrl` (Section 6.5.1). Completion hints MUST NOT accept
`deliveryUrl` (Section 6.6.3).

Deployments MUST be able to disable `issue_slot`, `commit_upload`,
`process_provider_event`, and `advance_cursor` per session (kill
switch). Blocked operations are rejected with
`olos.security_policy_violation`. A full kill switch, combined with
delivery-layer blocking and cache purge, is the emergency response
path. Unless the deployment also revokes playback, existing delivery
documents continue to render from the last trusted cursor.

## 10.6 Application responsibilities (non-goals)

The following items are out of scope for OLOS. The embedding
application MUST provide them:

- publisher authentication and viewer authorization.
- per-session quotas and rate limits (max slots per minute, max
  uncommitted bytes, max failed uploads). Commit policies enforce them
  and reject with codes such as `olos.quota_exceeded`.
- stale-cursor and stale-lease alerting (Section 6.4.4 provides the
  signal only).
- abuse and budget kill-switch triggers (Section 10.5 provides the
  mechanism only).
- content scanning, moderation, and DRM.

A conforming coordinator implementation is not a safe deployment by
itself. Conformance claims (Appendix B) cover protocol behavior only.
