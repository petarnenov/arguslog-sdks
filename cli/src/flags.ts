/**
 * Tiny `--flag value` / `--flag=value` parser. Intentionally not a full getopt — the CLI surface
 * is small enough that pulling in commander/yargs is unjustified weight.
 *
 * Returns positional arguments plus a record of named flags. Long flags only (no short forms).
 */
export interface ParsedFlags {
  positional: string[];
  flags: Record<string, string>;
}

export function parseFlags(args: readonly string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const name = arg.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[name] = 'true';
      continue;
    }
    flags[name] = next;
    i++;
  }
  return { positional, flags };
}
