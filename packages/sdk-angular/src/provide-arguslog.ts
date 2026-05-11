import {
  ENVIRONMENT_INITIALIZER,
  ErrorHandler,
  makeEnvironmentProviders,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { init, type ArguslogOptions } from '@arguslog/sdk-browser';

import { ArguslogErrorHandler } from './error-handler.js';
import { ARGUSLOG_OPTIONS } from './tokens.js';

export function provideArguslog(options: ArguslogOptions): EnvironmentProviders {
  return makeEnvironmentProviders(buildProviders(options));
}

/** Internal: returns the raw provider list, used by ArguslogModule.forRoot. */
export function buildProviders(options: ArguslogOptions): Provider[] {
  return [
    { provide: ARGUSLOG_OPTIONS, useValue: options },
    { provide: ErrorHandler, useClass: ArguslogErrorHandler },
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => init(options),
    },
  ];
}
