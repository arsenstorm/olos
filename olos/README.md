# OLOS

Open Live Object Streaming protocol primitives.

## Imports

```ts
import { OLOS_PROTOCOL_NAME } from "olos";
import type { Session } from "olos/types";
```

## Upload Event Identity

`olos/s3` accepts normalized upload events through
`routeStoredS3CoordinatorUploadEvent`.

For `object.created` events, the event ID becomes the commit ID, the object
observation time becomes `committedAt`, and the object key is matched against an
issued upload slot before S3 is queried.

For `upload.completed` hints, the hint ID becomes the commit ID, the hint time
becomes `committedAt`, and both the slot ID and object key must match before the
upload can be committed.

This keeps retries idempotent: replaying the same provider event reaches the
same commit identity instead of creating a new media commit.
