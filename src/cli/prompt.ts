// Dependency-free terminal picker: type to fuzzy-search, arrows to move, enter to choose, esc to go back.
// Rendering and key handling are pure functions (tested); `pick` wires them to a raw-mode TTY.
import { fuzzyFilter } from './fuzzy';

export interface Choice<T> {
  value: T;
  label: string;
  /** Dim text after the label. */
  hint?: string;
  /** Extra text that only the search looks at. */
  search?: string;
  /** Detail lines shown below the list for the highlighted choice. */
  preview?: string[];
}

export interface PickerState<T> {
  title: string;
  all: readonly Choice<T>[];
  query: string;
  index: number;
}

export type Key =
  | { k: 'up' } | { k: 'down' } | { k: 'pageup' } | { k: 'pagedown' } | { k: 'home' } | { k: 'end' }
  | { k: 'enter' } | { k: 'esc' } | { k: 'interrupt' } | { k: 'backspace' } | { k: 'clear' } | { k: 'char'; ch: string };

const KEY_RE = /\x1b\[[0-9;]*[A-Za-z~]|\x1b[OA-Z]|\x1b|[\s\S]/gu;

/** Split one chunk of raw stdin into keys (a paste arrives as many chars in one chunk). */
export function parseKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  for (const t of chunk.match(KEY_RE) ?? []) {
    if (t === '\x1b[A' || t === '\x1bOA') keys.push({ k: 'up' });
    else if (t === '\x1b[B' || t === '\x1bOB') keys.push({ k: 'down' });
    else if (t === '\x1b[5~') keys.push({ k: 'pageup' });
    else if (t === '\x1b[6~') keys.push({ k: 'pagedown' });
    else if (t === '\x1b[H' || t === '\x1b[1~' || t === '\x1bOH') keys.push({ k: 'home' });
    else if (t === '\x1b[F' || t === '\x1b[4~' || t === '\x1bOF') keys.push({ k: 'end' });
    else if (t === '\r' || t === '\n') keys.push({ k: 'enter' });
    else if (t === '\x1b') keys.push({ k: 'esc' });
    else if (t === '\x03' || t === '\x04') keys.push({ k: 'interrupt' });
    else if (t === '\x7f' || t === '\b') keys.push({ k: 'backspace' });
    else if (t === '\x15' || t === '\x17') keys.push({ k: 'clear' });
    else if (t === '\x10') keys.push({ k: 'up' }); // ctrl-p
    else if (t === '\x0e') keys.push({ k: 'down' }); // ctrl-n
    else if (t.startsWith('\x1b')) continue; // unknown escape sequence
    else if (t >= ' ') keys.push({ k: 'char', ch: t });
  }
  return keys;
}

export const visibleChoices = <T>(s: PickerState<T>): Choice<T>[] =>
  fuzzyFilter(s.all, s.query, (c) => `${c.label} ${c.hint ?? ''} ${c.search ?? ''}`);

export type PickerOutcome<T> = { state: PickerState<T>; done?: { value: T } | { cancelled: true } };

/** Apply one key. The highlighted index always stays inside the filtered list. */
export function applyKey<T>(state: PickerState<T>, key: Key, pageSize = 8): PickerOutcome<T> {
  let { query, index } = state;
  switch (key.k) {
    case 'interrupt':
    case 'esc': return { state, done: { cancelled: true } };
    case 'enter': {
      const hit = visibleChoices(state)[index];
      return hit ? { state, done: { value: hit.value } } : { state };
    }
    case 'up': index--; break;
    case 'down': index++; break;
    case 'pageup': index -= pageSize; break;
    case 'pagedown': index += pageSize; break;
    case 'home': index = 0; break;
    case 'end': index = Number.MAX_SAFE_INTEGER; break;
    case 'backspace': query = query.slice(0, -1); index = 0; break;
    case 'clear': query = ''; index = 0; break;
    case 'char': query += key.ch; index = 0; break;
  }
  const n = visibleChoices({ ...state, query }).length;
  index = n === 0 ? 0 : Math.min(n - 1, Math.max(0, index));
  return { state: { ...state, query, index } };
}

const paint = (on: boolean, code: string, s: string): string => (on ? `\x1b[${code}m${s}\x1b[0m` : s);

/** One frame: title, search box, a window of choices, then the preview of the highlighted one. */
export function renderPicker<T>(state: PickerState<T>, cols: number, color: boolean, windowSize = 10): string[] {
  const items = visibleChoices(state);
  const clip = (s: string, w: number): string => (s.length > w ? s.slice(0, Math.max(0, w - 1)) + '…' : s);
  const lines: string[] = [];
  lines.push(paint(color, '1', state.title));
  lines.push(`${paint(color, '36', 'search')} ${state.query}${paint(color, '2', state.query ? '' : 'type to filter')}${color ? '\x1b[7m \x1b[0m' : '_'}`);
  const start = Math.max(0, Math.min(state.index - Math.floor(windowSize / 2), items.length - windowSize));
  const slice = items.slice(start, start + windowSize);
  if (items.length === 0) lines.push(paint(color, '2', '  no matches'));
  slice.forEach((c, i) => {
    const active = start + i === state.index;
    const text = clip(`${active ? '> ' : '  '}${c.label}${c.hint ? `  ${c.hint}` : ''}`, cols - 1);
    lines.push(active ? paint(color, '7', text.padEnd(Math.min(cols - 1, 60))) : text);
  });
  lines.push(paint(color, '2', `  ${items.length ? state.index + 1 : 0}/${items.length}${start + windowSize < items.length ? '  (more below)' : ''}`));
  const preview = items[state.index]?.preview;
  if (preview?.length) {
    lines.push(paint(color, '2', '  ' + '-'.repeat(Math.min(cols - 4, 40))));
    for (const p of preview) lines.push('  ' + clip(p, cols - 3));
  }
  lines.push(paint(color, '2', 'up/down move   enter select   esc back   ctrl-u clear'));
  return lines;
}

export interface PickIO {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  color: boolean;
}

/** Show the picker; resolves with the chosen value, or null on esc / ctrl-c. */
export function pick<T>(io: PickIO, title: string, choices: readonly Choice<T>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let state: PickerState<T> = { title, all: choices, query: '', index: 0 };
    let drawn = 0;
    const { stdin, stdout } = io;
    const draw = (final = false): void => {
      if (drawn > 0) stdout.write(`\x1b[${drawn}A\r\x1b[J`);
      if (final) { drawn = 0; return; }
      const frame = renderPicker(state, stdout.columns || 80, io.color);
      stdout.write(frame.join('\n') + '\n');
      drawn = frame.length;
    };
    const finish = (value: T | null): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      draw(true);
      stdout.write('\x1b[?25h');
      resolve(value);
    };
    const onData = (buf: Buffer | string): void => {
      for (const key of parseKeys(buf.toString())) {
        const out = applyKey(state, key);
        state = out.state;
        if (out.done) return finish('value' in out.done ? out.done.value : null);
      }
      draw();
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stdout.write('\x1b[?25l');
    draw();
  });
}
