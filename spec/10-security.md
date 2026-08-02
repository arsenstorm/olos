# 10. Security profile: direct-public deployment

OLOS's default publication mode, `direct-public`, serves committed
media straight from the object store's public origin and gates
publication at the manifest, not at the byte. This section states the
requirements of that profile normatively. The reference is
`olos/src/state/direct-public-security-policy.ts`, `cache-policy.ts`,
and the direct-public deployment checklist in
`contributing/core/direct-public-deployment.md`.

## 10.1 Threat model boundary

Direct-public mode is **manifest-gated publication**: an object is
part of the stream only once the committed window references it
(Section 5). It does not make uncommitted uploads private. Deployments
MUST document and accept two facts before using this mode:

- Uncommitted objects may be directly readable if their URLs are
  known. Unguessable nonced keys (Section 7.6) are the mitigation.
- OLOS does not prove uploaded media bytes are safe or decodable;
  commit validation checks identity and bounds, not content.

Where uncommitted-object readability is unacceptable, deployments MUST
use `read-gated` or `private-upload-public-promotion` mode instead
(Section 7.8).

## 10.2 Provider and origin requirements

<!-- olos-conformance: 10.2 SEC-DIRECT-001 -->

A direct-public deployment MUST satisfy, per the provider capability
document (Section 7.7):

- `publication.directObjectPublication: true` and
  `publication.manifestGatedPublication: true`;
- `delivery.documentNavigationCanBeBlocked: true`;
- `delivery.immutableCaching: true` (for media-object cache policy);
- `delivery.negativeCachingPolicyDeclared: true`;
- an HTTPS `delivery.publicBaseUrl`; non-HTTPS public origins MUST be
  rejected.

The media origin MUST be dedicated and cookieless — it serves media
bytes only. The allowed media origins for playlist rendering
(Section 8.1) are derived from the public base URL; playlists MUST NOT
reference other origins. `Set-Cookie` is a forbidden response header
on the media origin.

## 10.3 Media request policy

<!-- olos-conformance: 10.3 SEC-DIRECT-003 SEC-DIRECT-004 SEC-DIRECT-006 SEC-DIRECT-007 -->

The media origin MUST evaluate every object request against these
rules, in order, and block on the first match:

| Rule | Status |
| --- | --- |
| Object key fails path safety (Section 7.5) | 404 |
| Extension not in the allowed set (`.m4s`, `.mp4`) | 404 |
| Document navigation (`Sec-Fetch-Dest: document` or `Sec-Fetch-Mode: navigate`) | 403 |
| Request `Accept` includes `text/html` | 403 |

Key safety MUST be checked before navigation headers so traversal
attempts never reach later logic. Bucket and prefix listing MUST be
blocked at the provider.

Media responses MUST carry:

```http
Content-Type: video/mp4
X-Content-Type-Options: nosniff
Access-Control-Allow-Credentials: false
Cross-Origin-Resource-Policy: same-site
Cache-Control: <media-object policy, Section 10.4>
```

## 10.4 Cache policy, including negative caching

<!-- olos-conformance: 10.4 OBJ-CACHE-001 OBJ-CACHE-002 OBJ-CACHE-003 OBJ-CACHE-004 OBJ-CACHE-005 -->

Three cache targets, all `public`:

| Target | Cache-Control | Constraint |
| --- | --- | --- |
| Media object | `public, max-age=31536000, immutable` | Requires provider `immutableCaching`; keys are immutable and nonce-unique, so the max age MAY be a year. |
| Manifest | `public, max-age=1, must-revalidate` | `max-age` MUST NOT exceed the target latency in seconds (default 3); default 1 s. |
| Negative object (404/miss) | `public, max-age=1, must-revalidate` | Same freshness bound; requires provider `negativeCachingPolicyDeclared`. |

Negative caching is load-bearing: preload-hinted or predicted object
URLs can be requested before the object exists, and an unbounded
cached 404 would poison playback after the object lands. Negative
responses for media objects MUST use the short must-revalidate policy
above and MUST be served only for keys that pass the Section 10.3
policy. Because immutable caching forbids reuse, a live media object
key MUST NOT be reused after overwrite or delete — a new upload always
gets a new key (fresh nonce).

## 10.5 Upload-slot hardening

<!-- olos-conformance: 10.5 SEC-DIRECT-002 SEC-DIRECT-005 -->

Every upload slot MUST carry, and commit validation MUST enforce
(Section 6.5.2):

- **Size bounds**: positive `maxBytes`; optional non-negative
  `minBytes` (zero allowed). Observed size outside the bounds rejects
  the commit (`olos.object_too_large` / `olos.object_too_small`).
- **Content type**: a valid content type bound into the grant's
  signed headers and matched against the observation
  (`olos.content_type_mismatch`).
- **Expiry**: a valid `expiresAt` timestamp; grants MUST NOT outlive
  it (Section 7.2) and expired slots are pruned by retention
  (Section 9).
- **Exact object key**: derived server-side, nonced in direct-public
  mode, and matched exactly at commit (`olos.key_mismatch`).
- **Duplicate-commit conflict**: non-idempotent duplicate commits are
  rejected (`olos.duplicate_commit_conflict`).

Slot-issue payloads MUST NOT accept publisher-supplied `objectKey` or
`deliveryUrl` (Section 6.5.1), and completion hints MUST NOT accept
`deliveryUrl` (Section 6.6.3).

Publication control: deployments MUST be able to disable
`issue_slot`, `commit_upload`, `process_provider_event`, and
`advance_cursor` per session (kill switch). Blocked operations are
rejected with `olos.security_policy_violation`. A full kill switch,
combined with delivery-layer blocking and cache purge, is the
emergency response path; existing manifests may keep rendering from
the last trusted cursor unless playback is also revoked.

## 10.6 Application responsibilities (non-goals)

The following are explicitly out of scope for OLOS and MUST be
provided by the embedding application:

- publisher authentication and viewer authorization;
- per-session quotas and rate limits (max slots per minute, max
  uncommitted bytes, max failed uploads) — enforced via commit
  policies surfacing codes such as `olos.quota_exceeded`;
- stale-cursor and stale-lease alerting (Section 6.4.4 provides the
  signal, not the alert);
- abuse and budget kill-switch triggers (Section 10.5 provides the
  mechanism, not the decision);
- content scanning, moderation, and DRM.

A conforming coordinator implementation is not a safe deployment by
itself; conformance claims (Appendix in Section 1's conventions) cover
protocol behavior only.
