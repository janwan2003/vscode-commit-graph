// Lets git hand a file (the rebase todo, a commit message) to VS Code and wait until the
// user is done with it, the way `code --wait` does, but without needing `code` on PATH.
// git runs GIT_SEQUENCE_EDITOR / GIT_EDITOR through its shell with the file as $1; our
// script drops a request file into a folder and waits for an answer file:
//   req.<id>  the path git wants edited (written by the script, read by the extension)
//   ok.<id>   the user is done: exit 0 and git reads the file back
//   no.<id>   the user cancelled: exit 1 (a todo: git aborts the rebase and puts everything
//             back; a message: git stops the rebase at that commit)
// No VS Code dependency.
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Seconds the script waits for an answer before giving up (exit 1). */
export const WAIT_LIMIT_S = 3 * 3600;

/** The POSIX shell script git runs as its editor. `$$` (the shell's pid) keeps requests apart. */
export function waitScript(limitS = WAIT_LIMIT_S): string {
  return [
    '#!/bin/sh',
    '# Written by Mergeline: hands the file git wants edited to VS Code and waits for it.',
    'd="$MERGELINE_WAIT_DIR"',
    '[ -n "$d" ] && [ -d "$d" ] || exit 1',
    'id=$$',
    'printf \'%s\\n\' "$1" > "$d/tmp.$id" && mv "$d/tmp.$id" "$d/req.$id" || exit 1',
    `n=0; max=${limitS * 5}`,
    'while [ "$n" -lt "$max" ]; do',
    '  if [ -e "$d/ok.$id" ]; then rm -f "$d/ok.$id"; exit 0; fi',
    '  if [ -e "$d/no.$id" ]; then rm -f "$d/no.$id"; exit 1; fi',
    '  sleep 0.2 2>/dev/null || sleep 1',
    '  n=$((n + 1))',
    'done',
    'rm -f "$d/req.$id"',
    'exit 1',
    '',
  ].join('\n');
}

/** Forward slashes: git for Windows runs the editor through its own sh. */
const fwd = (p: string) => p.replace(/\\/g, '/');
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export interface WaitRequest {
  id: string;
  /** Absolute path of the file to edit, as git gave it (may be relative to the repo: resolve against cwd). */
  file: string;
}

/** One waiting session: a private folder with the script, and the env that points git at it. */
export class WaitDir {
  readonly dir: string;
  readonly script: string;
  private seen = new Set<string>();

  constructor(base = tmpdir()) {
    this.dir = mkdtempSync(join(base, 'mergeline-wait-'));
    this.script = join(this.dir, 'editor.sh');
    writeFileSync(this.script, waitScript(), { mode: 0o755 });
  }

  /** Env for `git rebase -i`: both the todo and any commit message come to us. */
  env(): Record<string, string> {
    const cmd = `sh ${shq(fwd(this.script))}`;
    return { MERGELINE_WAIT_DIR: fwd(this.dir), GIT_SEQUENCE_EDITOR: cmd, GIT_EDITOR: cmd };
  }

  /** Requests that appeared since the last call. */
  poll(): WaitRequest[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    const res: WaitRequest[] = [];
    for (const n of names) {
      if (!n.startsWith('req.')) continue;
      const id = n.slice(4);
      if (this.seen.has(id)) continue;
      let file = '';
      try {
        file = readFileSync(join(this.dir, n), 'utf8').replace(/\r?\n$/, '');
      } catch {
        continue;
      }
      if (!file) continue;
      this.seen.add(id);
      res.push({ id, file });
    }
    return res;
  }

  /** Answer a request: done (git reads the file back) or cancelled. */
  answer(id: string, ok: boolean) {
    if (!existsSync(join(this.dir, `req.${id}`))) return;
    rmSync(join(this.dir, `req.${id}`), { force: true });
    const tmp = join(this.dir, `ans.${id}`);
    writeFileSync(tmp, '');
    renameSync(tmp, join(this.dir, `${ok ? 'ok' : 'no'}.${id}`));
  }

  dispose() {
    // Waiting scripts see the folder vanish only as "no answer"; cancel them first so git is not left hanging.
    for (const n of (() => {
      try {
        return readdirSync(this.dir);
      } catch {
        return [];
      }
    })())
      if (n.startsWith('req.')) this.answer(n.slice(4), false);
    // Give the scripts a moment to see their answer before the folder goes.
    setTimeout(() => rmSync(this.dir, { recursive: true, force: true }), 2000).unref?.();
  }
}

export type TodoKind = 'todo' | 'message';

/** What git asked us to edit, from the file name. */
export function editKind(file: string): TodoKind {
  return /(^|[\\/])git-rebase-todo$/.test(file) ? 'todo' : 'message';
}

/**
 * Counts of the commands in a rebase todo (comments and blank lines ignored), so the
 * extension can say what a todo is about to do, e.g. { pick: 3, squash: 1 }.
 */
export function todoSummary(text: string): Record<string, number> {
  const long: Record<string, string> = { p: 'pick', r: 'reword', e: 'edit', s: 'squash', f: 'fixup', x: 'exec', b: 'break', d: 'drop', l: 'label', t: 'reset', m: 'merge', u: 'update-ref' };
  const res: Record<string, number> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const w = line.split(/\s+/)[0].toLowerCase();
    const k = long[w] ?? w;
    res[k] = (res[k] ?? 0) + 1;
  }
  return res;
}

/** True when a rebase todo has a step that asks for a commit message: reword, squash, `fixup -c` or `merge -c`. */
export function todoNeedsMessage(text: string): boolean {
  return text.split(/\r?\n/).some((raw) => {
    const t = raw.trim().split(/\s+/);
    return /^(r|reword|s|squash)$/i.test(t[0] ?? '') || (/^(f|fixup)$/i.test(t[0] ?? '') && t[1] === '-c') || (/^(m|merge)$/i.test(t[0] ?? '') && t[1] === '-c');
  });
}
