# Production Object Pipeline

This is the recommended shape for an OLOS object-store deployment. It is a
runbook for wiring the package primitives, not a separate conformance target.

The executable package-level wiring proof is
`olos/e2e/production-wiring.test.ts`. It covers the intended composition of the
stored S3 runtime handler, object low-latency profile defaults, playback
manifests, publisher heartbeat health, reconciliation, and retention deletion.
It is not a substitute for application-owned authentication, authorization,
storage policy, monitoring, or provider-specific integration tests.

## Services

Use four application-owned surfaces:

| Surface | Owns | OLOS helps with |
| --- | --- | --- |
| Control API | Auth, tenant limits, session creation, kill switches | Session validation and transitions |
| Publisher API | Publisher auth, slot/grant routes, upload callbacks | Slot issuance, S3 grants, commits |
| Playback API | Viewer auth, manifest routes, cursor waits | HLS rendering and blocking reload decisions |
| Jobs | Recovery, retention, alerts, leases | Reconciliation, retention plans, live-health status |

The coordinator store must be authoritative. Use conditional writes or a
transactional adapter so cursor updates are monotonic.

## Live Path

1. The control API creates a session and pathways after authenticating the
   tenant and publisher.
2. The publisher loop asks OLOS for the next object plan from the current
   cursor window.
3. OLOS issues an exact-key, short-lived S3 upload grant.
4. The application uploads encoder bytes through the granted URL.
5. OLOS observes the exact object with S3 `HeadObject` or a normalized provider
   event.
6. OLOS commits the slot, advances the trusted cursor, and returns manifest
   artifacts when requested.
7. The playback API renders HLS from the cursor and `CommittedWindow`; it never
   lists storage or trusts publisher playlist input.

For the `object-ll` target, keep the default 0.5s parts, 2s segments, 3s target
latency, 1s manifest cache, and 3s blocking reload wait unless a deployment has
evidence that a different profile is stable.

## Publisher Loop

Run one object step at a time:

```text
load cursor -> plan next object -> heartbeat -> issue grant -> upload -> commit -> refresh lease
```

The application still owns encoder cadence, upload retry timing, credentials,
and backoff. Use `resolveRuntimePublisherLoopDecision` to decide whether the
next iteration should continue, retry, or stop. The pre-grant heartbeat is a
liveness gate: if the app cannot refresh its publisher lease, do not issue a new
upload grant. Refresh the lease again only after a successful committed or
idempotent step so health checks reflect the last completed publication.

Use a `commitPolicy` hook when commit eligibility depends on application state:
publisher authorisation, account status, quota counters, moderation state, or
tenant limits. The hook should return `allowed` or an OLOS error such as
`olos.security_policy_violation` or `olos.quota_exceeded`; it must not mutate
the coordinator state itself. Apply the same hook to normal commit routes,
provider-event commit paths, reconciliation, and publisher helpers so recovery
cannot publish objects that the live path would reject.

Slot expiry is strict unless the deployment sets `lateToleranceMs`. Use late
tolerance only for bounded clock or provider-event delays, and apply the same
value to live commits, provider events, publisher helpers, and reconciliation.

## Provider Events

Provider events are useful for recovery and low-latency commit paths, but they
are not publication authority by themselves. Normalize the event, match it to an
issued slot by exact object key, verify the object when required, then commit
through the same coordinator path as client completion hints.

Duplicate events should be idempotent. Events for unknown keys should be
ignored, audited, or rejected without creating implicit slots.

## Recovery Job

Run reconciliation on a short interval or after worker restarts:

```text
plan in-flight S3 slots -> reconcile selected slots -> record summary
```

Keep the batch size application-owned. Reconciliation should not block the live
publisher loop, and failed slots should be reported without stopping the rest of
the batch. Record rejected OLOS error codes separately from missing-object or
provider failures so policy stops are visible in job metrics.

## Retention Job

Run retention after the cursor has advanced far enough for older committed
objects to be retired:

```text
plan retention -> delete retired objects -> record failed deletes for retry
```

Never reuse deleted live media keys. Retention cleans storage cost; it must not
change the trusted cursor. Record failed object keys and slot IDs for retry
logs; failed deletes must not roll back successful deletes from the same run.

## Operational Monitoring

Poll live health from coordinator state and alert on stale cursors, stale
publisher leases, repeated reconciliation failures, and retention delete
failures. `resolveRuntimeLiveHealth` and the stored health route classify cursor
freshness and publisher lease status; the application owns polling intervals,
alert routing, and restart policy.

For the `object-ll` profile, a cursor that has not advanced for more than the
configured cursor staleness window should be treated as degraded. A stale
publisher lease means the publisher has stopped refreshing liveness; do not
issue new grants for that publisher until it refreshes successfully.

During an incident, use publication control to stop new slots, commits,
provider events, and cursor advancement for the affected session or tenant.
Existing manifests may continue from the last trusted cursor. The application
must separately revoke viewers, block media prefixes, purge caches, or restart
publishers when those actions are required.

## Playback

Serve manifests from coordinator state only. Blocking reload should wait on a
cursor notifier, queue, pub/sub channel, or durable runtime signal. A single
process can use `createMemoryRuntimeCursorNotifier`; distributed deployments
need their own shared wake-up mechanism.

Do not emit preload hints for deterministic future object URLs in direct-public
object-store mode unless the deployment proves future 404s cannot poison
playback.

Serve media bytes from a separate media origin, not from the coordinator
runtime routes. Use `createDirectPublicMediaResponseHeaders` for committed
media responses and `createDirectPublicNegativeObjectResponseHeaders` for
missing or future media-object responses when that origin fronts direct-public
objects.

## Security Boundary

OLOS does not authenticate users, authorize viewers, provision buckets, enforce
CDN rules, scan media bytes, or moderate content. The application must provide:

- publisher and viewer authentication
- tenant/session quotas
- object key secrecy or read gating
- media-only delivery headers
- unknown-extension and top-level document blocks
- cache purge or emergency prefix blocks
- monitoring for stale cursors and stale publisher leases

The invariant is:

```text
untrusted upload != official playable stream state
```

Direct-public deployments must also document that uncommitted objects may be
readable if their URLs are known.
