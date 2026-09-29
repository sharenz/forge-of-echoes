// Party chat, bottom-left. Enter opens and sends, Esc closes (and discards the draft). Clicking anywhere
// outside the chat closes it too, keeping the draft, so movement keys go back to the game at once.
// Idle lines fade out on their own (CSS), and the full log returns while the input is open.
// Slash commands (lib/chat.ts) never reach the chat: "/trade <name>" sends a trade request; a mistyped command
// keeps the draft and explains itself under the field.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { cx } from '../components/common';
import { parseChatCommand } from '../lib/chat';
import { formatClock } from '../lib/format';
import { useStore, useUi } from '../store';

const MAX_LEN = 200;

export function Chat() {
  const store = useStore();
  const lines = useUi((s) => s.chat);
  const open = useUi((s) => s.chatOpen);
  const inParty = useUi((s) => !!s.party);
  const [text, setText] = useState('');
  const [cmdError, setCmdError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);

  // Focus in a layout effect so the first keystrokes after Enter already land in the field.
  useLayoutEffect(() => {
    if (open) input.current?.focus();
    else input.current?.blur();
  }, [open]);

  useLayoutEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lines, open]);

  const shown = open ? lines.slice(-60) : lines.slice(-7);
  if (!open && shown.length === 0) return null;

  return (
    <div class={cx('fe-chat', open ? 'fe-chat--open fe-solid' : 'fe-chat--idle')}>
      {/* Focusable, so clicking into the log (to read or select) does not count as leaving the chat. */}
      <div class="fe-chat__log" ref={log} role="log" aria-live="polite" tabIndex={open ? -1 : undefined}>
        {shown.map((l) => (
          <div key={l.id} class={cx('fe-chat__line', !l.fromName && 'fe-chat__line--system')}>
            {open && <span class="fe-chat__time">{formatClock(l.time)}</span>}
            {l.fromName && <span class="fe-chat__from">{l.fromName}:</span>}
            <span class="fe-chat__text">{l.text}</span>
          </div>
        ))}
      </div>
      {open && (
        <form
          class="fe-chat__form"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            const cmd = t ? parseChatCommand(t) : null;
            if (cmd?.kind === 'error') {
              store.actions.uiSound('error');
              setCmdError(cmd.message);
              return;
            }
            if (cmd?.kind === 'trade') store.actions.tradeRequest(cmd.name);
            else if (t) store.actions.sendChat(t.slice(0, MAX_LEN));
            setText('');
            setCmdError(null);
            store.actions.setChatOpen(false);
          }}
        >
          <span class="fe-chat__prompt">{inParty ? 'Party' : 'Say'}</span>
          <input
            ref={input}
            class="fe-chat__input"
            value={text}
            maxLength={MAX_LEN}
            placeholder={inParty ? 'Message your party, or /trade name' : 'Only you will see this until you join a party'}
            autoComplete="off"
            spellcheck={false}
            onInput={(e) => {
              setText((e.currentTarget as HTMLInputElement).value);
              if (cmdError) setCmdError(null);
            }}
            onBlur={(e) => {
              const next = e.relatedTarget as Element | null;
              if (next?.closest?.('.fe-chat')) return;
              if (store.get().chatOpen) store.actions.setChatOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setText('');
                setCmdError(null);
                store.actions.setChatOpen(false);
              }
            }}
          />
        </form>
      )}
      {open && cmdError && (
        <div class="fe-chat__cmd-error" role="alert">
          {cmdError}
        </div>
      )}
    </div>
  );
}
