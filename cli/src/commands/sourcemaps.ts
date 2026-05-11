import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import type { CliConfig } from '../config.js';
import { apiFetch } from '../http.js';

export interface SourceMapArtifact {
  id: number;
  releaseId: number;
  r2Key: string;
  originalPath: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
}

export interface SourceMapUploadResponse {
  artifact: SourceMapArtifact;
  uploadUrl: string;
  expiresAt: string;
}

export interface SourcemapsUploadArgs {
  filePath: string;
  originalPath: string;
  projectId: number;
  releaseId: number;
}

export interface UploadResult {
  artifact: SourceMapArtifact;
  uploadStatus: number;
}

/**
 * Two-step upload:
 *   1. POST metadata to api → receive presigned PUT URL
 *   2. PUT file bytes directly to R2 (api never sees them)
 *
 * sha256 + sizeBytes are computed from disk; api validates both server-side and R2 enforces the
 * Content-Length signed into the presigned request, so a corrupted upload can't slip through.
 */
export async function sourcemapsUpload(
  args: SourcemapsUploadArgs,
  config: CliConfig,
): Promise<UploadResult> {
  const sizeBytes = (await stat(args.filePath)).size;
  const bytes = await readFile(args.filePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const presigned = await apiFetch<SourceMapUploadResponse>(
    config,
    `/api/v1/projects/${args.projectId}/releases/${args.releaseId}/sourcemaps`,
    {
      method: 'POST',
      body: JSON.stringify({
        originalPath: args.originalPath,
        sha256,
        sizeBytes,
      }),
    },
  );

  const putRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    body: bytes,
    headers: { 'Content-Type': 'application/json' },
  });

  if (!putRes.ok) {
    throw new Error(
      `Sourcemap upload to R2 failed with HTTP ${putRes.status}. ` +
        `The api row was created but the bytes did not land — re-run the upload to retry.`,
    );
  }

  return { artifact: presigned.artifact, uploadStatus: putRes.status };
}
