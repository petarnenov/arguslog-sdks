import type { StackFrame } from '@arguslog/sdk-core';

const CHROME_RE = /^\s*at (?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+)|<anonymous>)\)?\s*$/;
const FIREFOX_RE = /^([^@]*)@(.+?):(\d+):(\d+)$/;

export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const lines = stack.split('\n');
  const frames: StackFrame[] = [];
  for (const line of lines) {
    const frame = parseLine(line);
    if (frame) frames.push(frame);
  }
  return frames.reverse();
}

function parseLine(line: string): StackFrame | null {
  const chrome = CHROME_RE.exec(line);
  if (chrome) {
    const [, fn, file, lineno, colno] = chrome;
    return {
      function: fn || '?',
      filename: file,
      lineno: lineno ? Number(lineno) : undefined,
      colno: colno ? Number(colno) : undefined,
    };
  }
  const firefox = FIREFOX_RE.exec(line);
  if (firefox) {
    const [, fn, file, lineno, colno] = firefox;
    return {
      function: fn || '?',
      filename: file,
      lineno: lineno ? Number(lineno) : undefined,
      colno: colno ? Number(colno) : undefined,
    };
  }
  return null;
}
