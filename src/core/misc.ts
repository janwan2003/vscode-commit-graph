// Small helpers with no VS Code dependency: archive formats, and avatar image URLs for commit authors, used only when the user turns on
// `mergeline.showAvatars` (off by default). Nothing is fetched here: the webview
// loads the image, and an author with no avatar falls back to their initials.
import { createHash } from 'node:crypto';

/**
 * GitHub's noreply addresses map straight to the account's avatar; every other address
 * goes to Gravatar as an MD5 hash of the trimmed, lower-cased email (`d=404`: no
 * generated image, so the webview shows initials instead).
 */
export function avatarUrl(email: string, size = 40): string | null {
  const e = email.trim().toLowerCase();
  if (!e || !e.includes('@')) return null;
  const gh = /^(?:(\d+)\+)?([a-z0-9-]+(?:\[bot\])?)@users\.noreply\.github\.com$/.exec(e);
  if (gh) return gh[1] ? `https://avatars.githubusercontent.com/u/${gh[1]}?s=${size}&v=4` : `https://avatars.githubusercontent.com/${encodeURIComponent(gh[2])}?s=${size}`;
  return `https://www.gravatar.com/avatar/${createHash('md5').update(e).digest('hex')}?s=${size}&d=404`;
}

/** One URL per distinct email in `emails` (null entries skipped). */
export function avatarMap(emails: Iterable<string>, size = 40): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of emails) {
    if (!e || e in out) continue;
    const u = avatarUrl(e, size);
    if (u) out[e] = u;
  }
  return out;
}

/** git archive format for a file name: zip, tar.gz (also .tgz) or tar; zip when the extension is none of them. */
export function archiveFormat(file: string): { format: 'zip' | 'tar.gz' | 'tar'; ext: boolean } {
  const f = file.toLowerCase();
  if (f.endsWith('.tar.gz') || f.endsWith('.tgz')) return { format: 'tar.gz', ext: true };
  if (f.endsWith('.tar')) return { format: 'tar', ext: true };
  return { format: 'zip', ext: f.endsWith('.zip') };
}
