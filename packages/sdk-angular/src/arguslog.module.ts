import { NgModule, type ModuleWithProviders } from '@angular/core';
import type { ArguslogOptions } from '@arguslog/sdk-browser';

import { buildProviders } from './provide-arguslog.js';

@NgModule({})
export class ArguslogModule {
  static forRoot(options: ArguslogOptions): ModuleWithProviders<ArguslogModule> {
    return {
      ngModule: ArguslogModule,
      providers: buildProviders(options),
    };
  }
}
