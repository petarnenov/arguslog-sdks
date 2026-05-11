import type { InjectionKey } from 'vue';

import type { ArguslogService } from './arguslog-service.js';

export const ARGUSLOG_KEY: InjectionKey<ArguslogService> = Symbol('arguslog');
