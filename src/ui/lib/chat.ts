// Slash commands typed into the chat field. Pure; covered by tests/ui/social.test.ts.
//   /trade <name>   ask an online player to trade (GAME_SPEC §12)
// Anything that does not look like a command ("hi", "/o/", "gg /trade") is an ordinary chat line.
import { characterNameError } from './validate';

export type ChatCommand =
  | { kind: 'trade'; name: string }
  /** A command the player got wrong: show the message, keep the draft, send nothing. */
  | { kind: 'error'; message: string };

export const CHAT_COMMAND_HELP = 'Commands: /trade <character name>';

/** null = not a command: send the text as chat. */
export function parseChatCommand(text: string): ChatCommand | null {
  const m = /^\/([a-z]+)(?:\s+(.*))?$/i.exec(text.trim());
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const arg = (m[2] ?? '').trim();
  if (cmd === 'trade') {
    if (!arg) return { kind: 'error', message: 'Usage: /trade <character name>' };
    const err = characterNameError(arg);
    if (err) return { kind: 'error', message: err };
    return { kind: 'trade', name: arg };
  }
  return { kind: 'error', message: `Unknown command /${cmd}. ${CHAT_COMMAND_HELP}` };
}
