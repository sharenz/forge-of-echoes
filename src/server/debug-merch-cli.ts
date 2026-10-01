import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GameDatabase } from './db';

export async function debugMerch(args: readonly string[], dbPath: string): Promise<string> {
  if (args.length !== 3 || !['enable', 'disable', 'status'].includes(args[2]))
    throw new Error('Usage: debug_merch <account> <character> enable|disable|status');
  if (!existsSync(dbPath)) throw new Error(`Database does not exist: ${dbPath}. Set DB_PATH to the game database.`);
  const [accountName, characterName, action] = args;
  const db = await GameDatabase.open(dbPath);
  try {
    const account = db.accountByUsername(accountName);
    const character = db.characterByName(characterName);
    if (!account) throw new Error(`Account not found: ${accountName}`);
    if (!character || character.accountId !== account.id) throw new Error(`Character ${characterName} does not belong to ${account.username}.`);
    if (action !== 'status') db.setDebugMerchant(character.id, action === 'enable');
    const enabled = db.debugMerchantEnabled(character.id);
    return `${account.username} / ${character.name}: testing merchant ${enabled ? 'enabled' : 'disabled'}.${action === 'status' ? '' : ' Live hideouts update within one second; no restart needed.'}`;
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  debugMerch(process.argv.slice(2), process.env.DB_PATH ?? 'data/dev.db')
    .then(message => console.log(message))
    .catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
