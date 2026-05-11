import os from 'node:os';

import type { EventPayload, PlatformAdapter } from '@arguslog/sdk-core';

import { SDK_VERSION } from './version.generated.js';

export class NodeAdapter implements PlatformAdapter {
  readonly sdkName = 'arguslog.node';
  readonly sdkVersion = SDK_VERSION;
  readonly platform = 'node' as const;

  enrichEvent(event: EventPayload): void {
    event.contexts = {
      ...(event.contexts ?? {}),
      runtime: { name: 'node', version: process.version },
      os: { name: os.platform(), release: os.release() },
    };
  }
}
