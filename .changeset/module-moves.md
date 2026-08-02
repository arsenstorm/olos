---
"@arsenstorm/olos": minor
---

Import-path moves and edge portability. The object-key derivation and nonce
helpers (`createPublisherObjectKey`, `createPublisherDeliveryUrl`,
`CreatePublisherObjectKeyOptions`, `DerivableMediaObjectKind`,
`createRuntimePublisherObjectKeyNonce`,
`RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES`, and
`CreateRuntimePublisherObjectKeyNonceOptions`) moved from
`@arsenstorm/olos/runtime` to `@arsenstorm/olos/state`, where their
implementations already lived. `assertSerializedCoordinatorStoreBackendConformance`
and `AssertSerializedCoordinatorStoreBackendConformanceOptions` moved from
`@arsenstorm/olos/protocol` to `@arsenstorm/olos/conformance` alongside the
other store conformance harnesses. `createCoordinatorManifestArtifacts`,
`CoordinatorManifestArtifacts`, and `CreateCoordinatorManifestArtifactsOptions`
moved from `@arsenstorm/olos/protocol` to `@arsenstorm/olos/hls`, so importing
the protocol subpath no longer pulls in the HLS renderer. Published type
declarations no longer
reference Bun global types, and the object-key nonce encoder no longer depends
on `Buffer`, so the package type-checks and runs on edge runtimes without Bun
or Node globals.
