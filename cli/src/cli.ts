import { releasesNew } from './commands/releases.js';
import { sourcemapsUpload } from './commands/sourcemaps.js';
import { type CliConfig, CliConfigError, loadConfig } from './config.js';
import { parseFlags } from './flags.js';
import { ApiError } from './http.js';
import { VERSION } from './version.js';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Override config loading — useful for tests; production reads from env + ~/.arguslog. */
  loadConfig?: () => CliConfig;
}

const HELP = `arguslog ${VERSION}

Usage:
  arguslog <command> [options]

Commands:
  releases new <version> --project <id>
                                  Create a new release tag.
  sourcemaps upload <path> --project <id> --release <id> [--name <originalPath>]
                                  Upload a sourcemap and attach it to a release.
  help                            Show this help.
  version                         Print CLI version.

Auth:
  Token comes from $ARGUSLOG_TOKEN or ~/.arguslog/credentials
    (JSON: { "token": "arglog_pat_...", "apiBaseUrl": "https://..." }).
  $ARGUSLOG_API_URL overrides the api base URL when present.
`;

export function parseArgs(argv: readonly string[]): { command: string; rest: readonly string[] } {
  const [command = 'help', ...rest] = argv;
  return { command, rest };
}

export async function run(
  argv: readonly string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  const { command, rest } = parseArgs(argv);

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      return { exitCode: 0, stdout: HELP, stderr: '' };
    case 'version':
    case '--version':
    case '-v':
      return { exitCode: 0, stdout: `${VERSION}\n`, stderr: '' };
    case 'releases':
      return runReleases(rest, options);
    case 'sourcemaps':
      return runSourcemaps(rest, options);
    default:
      return {
        exitCode: 1,
        stdout: '',
        stderr: `arguslog: unknown command '${command}'. Run 'arguslog help' for usage.\n`,
      };
  }
}

async function runReleases(rest: readonly string[], options: RunOptions): Promise<CommandResult> {
  const [sub, ...subRest] = rest;
  if (sub !== 'new') {
    return usageError(`releases: unknown subcommand '${sub ?? ''}'. Try 'releases new <version>'.`);
  }
  const { positional, flags } = parseFlags(subRest);
  const version = positional[0];
  if (!version) return usageError('releases new: missing <version> argument.');
  const projectId = parseProjectId(flags.project);
  if (projectId === null) return usageError('releases new: --project <id> is required (numeric).');

  return withConfig(options, async (config) => {
    const release = await releasesNew({ version, projectId }, config);
    return ok(`release #${release.id} created: ${release.version}\n`);
  });
}

async function runSourcemaps(rest: readonly string[], options: RunOptions): Promise<CommandResult> {
  const [sub, ...subRest] = rest;
  if (sub !== 'upload') {
    return usageError(
      `sourcemaps: unknown subcommand '${sub ?? ''}'. Try 'sourcemaps upload <path>'.`,
    );
  }
  const { positional, flags } = parseFlags(subRest);
  const filePath = positional[0];
  if (!filePath) return usageError('sourcemaps upload: missing <path> argument.');
  const projectId = parseProjectId(flags.project);
  if (projectId === null) {
    return usageError('sourcemaps upload: --project <id> is required (numeric).');
  }
  const releaseId = parseProjectId(flags.release);
  if (releaseId === null) {
    return usageError('sourcemaps upload: --release <id> is required (numeric).');
  }
  // Default the on-disk filename as the originalPath unless the caller renames it (lets a CI
  // pipeline upload `dist/app.abc123.js.map` but record it as `dist/app.js`).
  const originalPath = flags.name?.trim() || basenameOf(filePath);

  return withConfig(options, async (config) => {
    const result = await sourcemapsUpload({ filePath, originalPath, projectId, releaseId }, config);
    return ok(
      `sourcemap #${result.artifact.id} uploaded (${result.artifact.sizeBytes} bytes, ` +
        `sha256=${result.artifact.sha256.slice(0, 12)}…)\n`,
    );
  });
}

async function withConfig(
  options: RunOptions,
  body: (config: CliConfig) => Promise<CommandResult>,
): Promise<CommandResult> {
  let config: CliConfig;
  try {
    config = (options.loadConfig ?? loadConfig)();
  } catch (err) {
    if (err instanceof CliConfigError) return fail(`arguslog: ${err.message}\n`);
    throw err;
  }
  try {
    return await body(config);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(`arguslog: api ${err.status} — ${err.problem.detail ?? err.problem.title}\n`);
    }
    if (err instanceof Error) return fail(`arguslog: ${err.message}\n`);
    return fail(`arguslog: ${String(err)}\n`);
  }
}

function parseProjectId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function basenameOf(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash >= 0 ? p.slice(slash + 1) : p;
}

function ok(line: string): CommandResult {
  return { exitCode: 0, stdout: line, stderr: '' };
}

function usageError(message: string): CommandResult {
  return { exitCode: 2, stdout: '', stderr: `arguslog: ${message}\n` };
}

function fail(message: string): CommandResult {
  return { exitCode: 1, stdout: '', stderr: message };
}
