# Direct-Public Deployment Checklist

Direct-public object-store mode is manifest-gated publication. It does not make
uncommitted uploads private.

Document these two statements before using this mode:

```text
Uncommitted objects may be directly readable if their URLs are known.
OLOS No-Scan Mode does not prove uploaded media bytes are safe or decodable.
```

## Required Controls

- Generate object keys in the coordinator. The slot-issue request should omit
  `objectKey` and `deliveryUrl`; OLOS derives both server-side from the
  configured `mediaBaseUrl` plus an unguessable nonce. The wire still accepts
  publisher-supplied values for compatibility, but a direct-public deployment
  should treat that as a transitional escape hatch and audit calls that use
  it.
- Include enough per-slot entropy that future object URLs are not guessable.
  When `publicationMode === "direct-public"` the coordinator generates a
  fresh 16-byte nonce automatically; for read-gated or
  private-upload-public-promotion deployments, the publisher remains
  responsible for nonce policy.
- Issue short-lived, exact-key, method-bound upload grants.
- Bind content type and create-if-absent headers where the provider supports
  signed headers.
- Enforce slot expiry, max bytes, expected content type, exact object key, and
  duplicate-commit conflicts before commit.
- Serve canonical playlists only from trusted cursor and `CommittedWindow`
  state.
- Disable preload hints for deterministic future object URLs unless future 404s
  cannot poison playback.
- Never reuse live media object keys after overwrite or delete.

## Media Origin

Use a dedicated, cookieless media origin. It should serve media bytes only.

Recommended response policy:

```http
Content-Type: video/mp4
X-Content-Type-Options: nosniff
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Credentials: false
Set-Cookie: never
```

Use `createDirectPublicMediaResponseHeaders` from `olos/state` to compose these
headers from a direct-public security policy before serving committed media
objects.
Use `createDirectPublicNegativeObjectResponseHeaders` for missing or future
media-object responses so 404s use the declared short negative cache policy.

Block:

- bucket or prefix listing
- unknown extensions
- HTML `Accept` requests for media objects
- top-level document navigation to media objects
- public development endpoints in production

## Application Controls

The application must provide:

- publisher authentication
- viewer authorization where required
- per-session quotas and rate limits
- max slots per minute
- max uncommitted bytes
- max failed uploads
- stale cursor and stale lease alerts
- abuse and budget kill switches

## Emergency Response

A kill switch must be able to:

1. Stop issuing new upload slots.
2. Reject completion hints.
3. Ignore provider events for the affected session.
4. Freeze cursor advancement.
5. Revoke viewer access where applicable.
6. Block the affected media prefix at the delivery layer.
7. Purge caches when stale or abusive objects may be served.

Existing manifests may continue to render from the last trusted cursor unless
the application also revokes playback.

## Stronger Alternatives

Use read-gated direct publication or private upload plus public promotion when
uncommitted object readability is unacceptable. These modes add delivery-path
complexity, but they change the privacy boundary from manifest-gated to
read-gated.
