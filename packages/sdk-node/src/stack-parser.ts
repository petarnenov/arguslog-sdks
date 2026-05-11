import type { StackFrame } from '@arguslog/sdk-core';

// V8 stack frames as Node emits them, e.g.:
//   "    at functionName (/abs/path/file.js:10:5)"
//   "    at Object.<anonymous> (/abs/path/file.js:1:1)"
//   "    at /abs/path/file.js:10:5"                     (anonymous)
//   "    at async Module._compile (node:internal/modules/cjs/loader:1234:5)"
//   "    at new ClassName (/abs/path/file.js:5:10)"
//
// Group 1 (optional): the function label (already stripped of "async "/"new " prefixes)
// Groups 2-4: filename:line:col
const NAMED_RE = /^\s*at\s+(?:async\s+|new\s+)?(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/;
const ANON_RE = /^\s*at\s+(?:async\s+)?(.+):(\d+):(\d+)\s*$/;

export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    const frame = parseLine(line);
    if (frame) frames.push(frame);
  }
  return frames.reverse();
}

function parseLine(line: string): StackFrame | null {
  const named = NAMED_RE.exec(line);
  if (named) {
    const [, fn, file, lineno, colno] = named;
    return makeFrame(fn, file!, lineno!, colno!);
  }
  const anon = ANON_RE.exec(line);
  if (anon) {
    const [, file, lineno, colno] = anon;
    return makeFrame(undefined, file!, lineno!, colno!);
  }
  return null;
}

function makeFrame(
  fn: string | undefined,
  file: string,
  lineno: string,
  colno: string,
): StackFrame {
  return {
    function: fn || '?',
    filename: file,
    lineno: Number(lineno),
    colno: Number(colno),
    inApp: isInApp(file),
  };
}

function isInApp(filename: string): boolean {
  // Node-internal modules and anything from node_modules are framework code, not the user's.
  if (filename.startsWith('node:')) return false;
  if (filename.includes('/node_modules/')) return false;
  return true;
}
