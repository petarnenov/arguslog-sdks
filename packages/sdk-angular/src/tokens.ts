import { InjectionToken } from '@angular/core';
import type { ArguslogOptions } from '@arguslog/sdk-browser';

export const ARGUSLOG_OPTIONS = new InjectionToken<ArguslogOptions>('ARGUSLOG_OPTIONS');
