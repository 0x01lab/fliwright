# @fliwright/plugin-riverpod

Optional TypeScript state adapter for Flutter applications instrumented with
`fliwright_bridge_riverpod`.

```ts
import { riverpodPlugin } from '@fliwright/plugin-riverpod';
```

The Flutter application must attach `FliwrightRiverpodObserver` in its trusted
debug or test entrypoint. Provider writes require explicit app-owned writable
registrations.
