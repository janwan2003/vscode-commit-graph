// Branch colours (setting mergeline.branchColors): a fixed graph colour per branch name or glob.
// No VS Code dependency, so the unit tests can run it.

import { branchPart, pinMatcher, type PinRef } from './pins';

/** The graph palette, in --lane-0..9 order (media/graph.css). These names follow the theme. */
export const PALETTE_NAMES = ['blue', 'red', 'green', 'yellow', 'purple', 'cyan', 'pink', 'lime', 'orange', 'grey'] as const;
const ALIASES: Record<string, number> = { gray: 9, amber: 3, teal: 5, magenta: 6 };
/** Colour indexes 0..9 are the palette; custom colours from the setting are 10 + their position. */
export const CUSTOM_BASE = 10;
/** Lane strings encode a colour as one character ('0'..'9', then 'a'..'z'), so at most 26 custom colours. */
export const MAX_CUSTOM = 26;

/**
 * A setting value as a CSS colour the webview can put in an SVG attribute, or null when it is not one
 * Mergeline accepts: a palette name (blue, red, …: follows the light/dark theme), #rgb/#rgba/#rrggbb/#rrggbbaa,
 * or rgb()/rgba()/hsl()/hsla() with plain numbers. Anything else is refused, so no other CSS can get in.
 */
export function cssColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  const k = (PALETTE_NAMES as readonly string[]).indexOf(s);
  if (k >= 0) return `var(--lane-${k})`;
  if (s in ALIASES) return `var(--lane-${ALIASES[s]})`;
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(s)) return s;
  if (/^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.]+(?:deg|%)?(?:\s*[,\s/]\s*[0-9.]+%?){2,3}\s*\)$/.test(s)) return s;
  return null;
}

export interface ColorRules {
  /** In setting order: earlier entries win when a commit has several matching branches. */
  rules: { pattern: string; match: (name: string) => boolean; color: number }[];
  /** CSS value of custom colour CUSTOM_BASE + i. */
  colors: string[];
  problems: string[];
}

/** Parses mergeline.branchColors: an object of branch name or `*` glob → colour. */
export function colorRules(setting: unknown): ColorRules {
  const out: ColorRules = { rules: [], colors: [], problems: [] };
  if (!setting || typeof setting !== 'object' || Array.isArray(setting)) return out;
  for (const [pattern, value] of Object.entries(setting as Record<string, unknown>)) {
    if (!pattern.trim()) continue;
    const css = cssColor(value);
    if (!css) {
      out.problems.push(`"${pattern}": ${JSON.stringify(value)} is not a colour (use a name like red or a #hex value)`);
      continue;
    }
    let i = out.colors.indexOf(css);
    if (i < 0) {
      if (out.colors.length >= MAX_CUSTOM) {
        out.problems.push(`"${pattern}": more than ${MAX_CUSTOM} different colours`);
        continue;
      }
      i = out.colors.push(css) - 1;
    }
    out.rules.push({ pattern: pattern.trim(), match: pinMatcher(pattern), color: CUSTOM_BASE + i });
  }
  return out;
}

/** The colour of a branch name (`main`, `release/1.2`; no remote prefix), or undefined. */
export function nameColor(rules: ColorRules, name: string): number | undefined {
  return rules.rules.find((r) => r.match(name))?.color;
}

/**
 * Commit sha → colour for every commit a coloured local or remote-tracking branch points at. The layout
 * gives a line that starts at such a commit this colour. With several branches on one commit, the one
 * whose rule comes first wins. `uncommitted`: the working-tree row, coloured like the checked-out branch.
 */
export function tipColors(rules: ColorRules, refs: PinRef[], uncommitted?: { sha: string; branch: string | null }): Map<string, number> {
  const best = new Map<string, number>(); // sha → rule index
  if (!rules.rules.length) return new Map();
  const ruleOf = (name: string) => rules.rules.findIndex((r) => r.match(name));
  for (const r of refs) {
    if (r.type !== 'head' && r.type !== 'remote') continue;
    const n = branchPart(r);
    if (n === 'HEAD') continue;
    const k = ruleOf(n);
    if (k >= 0 && (!best.has(r.sha) || k < best.get(r.sha)!)) best.set(r.sha, k);
  }
  const out = new Map<string, number>();
  for (const [sha, k] of best) out.set(sha, rules.rules[k].color);
  if (uncommitted?.branch) {
    const k = ruleOf(uncommitted.branch);
    if (k >= 0) out.set(uncommitted.sha, rules.rules[k].color);
  }
  return out;
}

/** Ref name → CSS colour for the branch badges of coloured branches (local `main` and remote `origin/main`). */
export function refColors(rules: ColorRules, refs: PinRef[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of refs) {
    if (r.type !== 'head' && r.type !== 'remote') continue;
    const c = nameColor(rules, branchPart(r));
    if (c !== undefined) out[r.name] = rules.colors[c - CUSTOM_BASE];
  }
  return out;
}

/** One lane-string character for colour index c (see PackedRow in graph.ts and media/rows.js). */
export function colorChar(c: number): string {
  return c < 10 ? String(c) : String.fromCharCode(97 + c - 10);
}
