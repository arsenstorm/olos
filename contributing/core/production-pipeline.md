# Production Object Pipeline

This is the recommended shape for an OLOS object-store deployment. It is a
runbook for wiring the package primitives, not a separate conformance target.

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
load cursor -> plan next object -> issue grant -> upload -> commit -> refresh lease
```

The application still owns encoder cadence, upload retry timing, credentials,
and backoff. Use `resolveRuntimePublisherLoopDecision` to decide whether the
next iteration should continue, retry, or stop. Refresh the publisher lease only
after a successful committed or idempotent step.

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
the batch.

## Retention Job

Run retention after the cursor has advanced far enough for older committed
objects to be retired:

```text
plan retention -> delete retired objects -> record failed deletes for retry
```

Never reuse deleted live media keys. Retention cleans storage cost; it must not
change the trusted cursor.

## Playback

Serve manifests from coordinator state only. Blocking reload should wait on a
cursor notifier, queue, pub/sub channel, or durable runtime signal. A single
process can use `createMemoryRuntimeCursorNotifier`; distributed deployments
need their own shared wake-up mechanism.

Do not emit preload hints for deterministic future object URLs in direct-public
object-store mode unless the deployment proves future 404s cannot poison
playback.

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
