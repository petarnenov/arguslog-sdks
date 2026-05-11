import type { CliConfig } from '../config.js';
import { apiFetch } from '../http.js';

export interface Release {
  id: number;
  projectId: number;
  version: string;
  createdAt: string;
}

export interface ReleasesNewArgs {
  version: string;
  projectId: number;
}

export async function releasesNew(args: ReleasesNewArgs, config: CliConfig): Promise<Release> {
  return apiFetch<Release>(config, `/api/v1/projects/${args.projectId}/releases`, {
    method: 'POST',
    body: JSON.stringify({ version: args.version }),
  });
}
