#!/usr/bin/env node
// Verifies that a GitHub release tag matches the version field of the package being released.
// Tag format is `<package-prefix>-v<x.y.z>`; e.g. `sdk-browser-v0.1.0`, `java-sdk-v0.1.0`.
//
// Why this exists: Maven Central rejects re-publishing the same coordinates and npm refuses to
// publish a version that doesn't match what consumers expect. A drift between the tag and the
// manifest version is the most common cause of "released but never appeared" — fail loudly here
// before either registry sees the artifact.
//
// Usage:
//   node scripts/verify-tag-version.mjs <tag> <package-prefix> <version-source>
//
// Where <version-source> is one of:
//   - a path to a package.json (the `.version` field is read)
//   - the literal string passed via stdin (for Gradle, where version is dynamic)
//
// Examples:
//   node scripts/verify-tag-version.mjs sdk-browser-v0.1.0 sdk-browser packages/sdk-browser/package.json
//   node scripts/verify-tag-version.mjs java-sdk-v0.1.0 java-sdk - <<< "0.1.0"

import { readFileSync } from 'node:fs';

export function parseTag(tag, prefix) {
  const expectedPrefix = `${prefix}-v`;
  if (!tag.startsWith(expectedPrefix)) {
    throw new Error(
      `Tag "${tag}" does not start with the required prefix "${expectedPrefix}". ` +
        `Release workflows are tag-driven; rename the tag or use the matching workflow.`,
    );
  }
  const version = tag.slice(expectedPrefix.length);
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(version)) {
    throw new Error(
      `Tag version "${version}" is not valid semver. Use vX.Y.Z (or vX.Y.Z-pre.1).`,
    );
  }
  return version;
}

export function readPackageVersion(source) {
  if (source === '-') {
    // stdin path; not used in Node 20+ tests, but kept for shell-driven gradle calls.
    const stdin = readFileSync(0, 'utf-8').trim();
    if (!stdin) throw new Error('Expected version on stdin (got empty input)');
    return stdin;
  }
  const json = JSON.parse(readFileSync(source, 'utf-8'));
  if (typeof json.version !== 'string' || !json.version) {
    throw new Error(`No "version" field in ${source}`);
  }
  return json.version;
}

export function verify(tag, prefix, source) {
  const tagVersion = parseTag(tag, prefix);
  const fileVersion = readPackageVersion(source);
  if (tagVersion !== fileVersion) {
    throw new Error(
      `Tag version "${tagVersion}" does not match ${source === '-' ? 'stdin' : source} ` +
        `version "${fileVersion}". Bump the manifest before tagging.`,
    );
  }
  return tagVersion;
}

// CLI entry point — only runs when executed directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , tag, prefix, source] = process.argv;
  if (!tag || !prefix || !source) {
    console.error(
      'Usage: verify-tag-version.mjs <tag> <package-prefix> <package.json | ->\n' +
        'See script header for examples.',
    );
    process.exit(2);
  }
  try {
    const version = verify(tag, prefix, source);
    console.log(`OK — ${prefix} ${version}`);
  } catch (err) {
    console.error(`FAIL — ${err.message}`);
    process.exit(1);
  }
}
