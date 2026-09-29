// Enforces the AGENTS.md type scale across the UI: the four --font-ui-* tokens are defined exactly once
// (12 / 14 / 17 / 25 px), and every font size in src/ui and dev/ui.html goes through them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const UI = join(ROOT, 'src', 'ui');
const TOKENS = join(UI, 'styles', 'tokens.css');
const ALLOWED = /^var\(--font-ui-(caption|secondary|body|title)\)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(css|tsx?|html)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...walk(UI), join(ROOT, 'dev', 'ui.html')];

/** Every `font-size:` / `fontSize:` / `font:` value in a source file, with its line number. */
function fontDeclarations(src: string): { prop: string; value: string; line: number }[] {
  const found: { prop: string; value: string; line: number }[] = [];
  const lines = src.split('\n');
  lines.forEach((text, i) => {
    const css = /(?:^|[\s;{"'`])(font-size|font)\s*:\s*([^;}"'`]+)/g;
    for (const m of text.matchAll(css)) found.push({ prop: m[1], value: m[2].trim(), line: i + 1 });
    const js = /\b(fontSize)\s*:\s*([^,}\n]+)/g;
    for (const m of text.matchAll(js)) found.push({ prop: m[1], value: m[2].trim(), line: i + 1 });
  });
  return found;
}

describe('UI typography scale', () => {
  it('defines the four tokens exactly once, with the AGENTS.md sizes', () => {
    const tokens = readFileSync(TOKENS, 'utf8');
    expect(tokens).toMatch(/--font-ui-caption:\s*14px;/);
    expect(tokens).toMatch(/--font-ui-secondary:\s*16px;/);
    expect(tokens).toMatch(/--font-ui-body:\s*19px;/);
    expect(tokens).toMatch(/--font-ui-title:\s*28px;/);
    for (const f of files) {
      if (f === TOKENS) continue;
      const src = readFileSync(f, 'utf8');
      expect(src, `${relative(ROOT, f)} redefines a type token`).not.toMatch(/--font-ui-(caption|secondary|body|title)\s*:/);
    }
  });

  it('provides the .ui-type-* classes on the tokens', () => {
    const tokens = readFileSync(TOKENS, 'utf8');
    for (const step of ['caption', 'secondary', 'body', 'title']) {
      expect(tokens).toMatch(new RegExp(`\\.ui-type-${step}\\s*\\{[^}]*font-size:\\s*var\\(--font-ui-${step}\\)`));
    }
  });

  it('uses only the scale tokens for every font size in src/ui and dev/ui.html', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const d of fontDeclarations(src)) {
        if (d.prop === 'font' && /^inherit\b/.test(d.value)) continue;
        if (d.prop === 'font') {
          offenders.push(`${relative(ROOT, f)}:${d.line} uses the font shorthand (${d.value})`);
          continue;
        }
        if (d.value === 'inherit') continue;
        const v = d.value.replace(/^['"`]|['"`]$/g, '').replace(/\s*!important$/, '');
        if (!ALLOWED.test(v)) offenders.push(`${relative(ROOT, f)}:${d.line} ${d.prop}: ${d.value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scanner catches stray sizes in CSS, inline styles and shorthands', () => {
    const src = [
      '.a { font-size: 13px; }',
      '.b{font-size:var(--font-ui-body)}',
      "<span style={{ fontSize: '1.2em' }} />",
      '.c { font: 600 16px serif; }',
      '.d { font-family: x; font-weight: 700; }',
    ].join('\n');
    const decls = fontDeclarations(src);
    expect(decls.map((d) => `${d.prop}=${d.value}`)).toEqual([
      'font-size=13px',
      'font-size=var(--font-ui-body)',
      "fontSize='1.2em'",
      'font=600 16px serif',
    ]);
  });

  it('scans a meaningful set of files', () => {
    expect(files.filter((f) => f.endsWith('.css')).length).toBeGreaterThanOrEqual(5);
    expect(files.filter((f) => f.endsWith('.tsx')).length).toBeGreaterThanOrEqual(10);
  });
});
