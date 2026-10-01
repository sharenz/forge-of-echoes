// Out-of-game screens: loading, login / register, character select and the disconnected screen.
import { setSkipFlag } from '../guide/Driver';
import { gt, suggestName } from '../../data/guide/strings';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CharacterSummary } from '../../contracts/net';
import { Button, Embers, Frame, PanelHead, Sigil, cx, usePortrait } from '../components/common';
import { useLocal } from '../local';
import { characterNameError, passwordError, usernameError } from '../lib/validate';
import { useStore, useUi } from '../store';

/** The CSS-crafted wordmark: a turning rune ring with an ember heart above tracked Cinzel capitals. */
export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div class={cx('fe-logo', compact && 'fe-logo--compact')} aria-label="Forge of Echoes" role="img">
      {!compact && (
        <div class="fe-logo__sigil" aria-hidden="true">
          <div class="fe-logo__ring fe-logo__ring--outer" />
          <div class="fe-logo__ring fe-logo__ring--runes" />
          <div class="fe-logo__spiral" />
          <div class="fe-logo__heart" />
        </div>
      )}
      <div class="fe-logo__word" aria-hidden="true">
        <span class="fe-logo__forge">Forge</span>
        <span class="fe-logo__of">
          <i />
          of
          <i />
        </span>
        <span class="fe-logo__echoes">Echoes</span>
      </div>
    </div>
  );
}

function TitleBackdrop() {
  return (
    <div class="fe-titlebg" aria-hidden="true">
      <div class="fe-titlebg__glow" />
      <div class="fe-titlebg__stones" />
      <Embers count={34} />
      <div class="fe-titlebg__vignette" />
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div class="fe-screen fe-screen--loading fe-solid">
      <TitleBackdrop />
      <div class="fe-loading">
        <Sigil />
        <div class="fe-loading__text">Kindling the forge</div>
      </div>
    </div>
  );
}

const SEEN_KEY = 'foe.seen';
/** This browser has been through the account screen before (localStorage; a blocked store counts as "not yet"). */
function hasSeenTitle(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function rememberTitle(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* per-browser convenience only */ }
}

export function AuthScreen() {
  const store = useStore();
  const busy = useUi((s) => s.busy);
  const error = useUi((s) => s.error);
  // A first-time visitor (no session, and this browser never logged in) lands on "Create account"; a returning one on "Log in".
  const [mode, setMode] = useState<'login' | 'register'>(() => (hasSeenTitle() ? 'login' : 'register'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [tried, setTried] = useState(false);

  const uErr = mode === 'register' ? usernameError(username) : username.trim() ? null : 'Enter your username.';
  const pErr = mode === 'register' ? passwordError(password) : password ? null : 'Enter your password.';
  const cErr = mode === 'register' && confirm !== password ? 'The passwords do not match.' : null;
  const valid = !uErr && !pErr && !cErr;

  const submit = (e: Event): void => {
    e.preventDefault();
    setTried(true);
    if (!valid || busy) {
      if (!valid) store.actions.uiSound('error');
      return;
    }
    rememberTitle();
    if (mode === 'login') store.actions.login(username.trim(), password);
    else store.actions.register(username.trim(), password);
  };

  return (
    <div class="fe-screen fe-screen--auth fe-solid">
      <TitleBackdrop />
      <div class="fe-auth">
        <Logo />
        <p class="fe-auth__pitch ui-type-secondary" data-pitch>{gt('title.pitch')}</p>
        <Frame class="fe-auth__card">
          <div class="fe-auth__tabs" role="tablist">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                class={cx('fe-auth__tab', mode === m && 'fe-auth__tab--on')}
                onClick={() => {
                  store.actions.uiSound('click');
                  setMode(m);
                  setTried(false);
                }}
              >
                {m === 'login' ? 'Log in' : 'Create account'}
              </button>
            ))}
          </div>
          <form class="fe-auth__form" onSubmit={submit} noValidate>
            <div class="fe-field">
              <label class="fe-field__label" for="fe-user">
                Username
              </label>
              <input
                id="fe-user"
                class={cx('fe-input', tried && uErr && 'fe-input--invalid')}
                value={username}
                disabled={busy}
                autoComplete="username"
                autoFocus
                spellcheck={false}
                onInput={(e) => setUsername((e.currentTarget as HTMLInputElement).value)}
              />
              <div class="fe-field__hint">{tried && uErr ? uErr : ''}</div>
            </div>
            <div class="fe-field">
              <label class="fe-field__label" for="fe-pass">
                Password
              </label>
              <input
                id="fe-pass"
                type="password"
                class={cx('fe-input', tried && pErr && 'fe-input--invalid')}
                value={password}
                disabled={busy}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)}
              />
              <div class="fe-field__hint">{tried && pErr ? pErr : ''}</div>
            </div>
            {mode === 'register' && (
              <div class="fe-field">
                <label class="fe-field__label" for="fe-pass2">
                  Repeat password
                </label>
                <input
                  id="fe-pass2"
                  type="password"
                  class={cx('fe-input', tried && cErr && 'fe-input--invalid')}
                  value={confirm}
                  disabled={busy}
                  autoComplete="new-password"
                  onInput={(e) => setConfirm((e.currentTarget as HTMLInputElement).value)}
                />
                <div class="fe-field__hint">{tried && cErr ? cErr : ''}</div>
              </div>
            )}
            {error && (
              <div class="fe-auth__error" role="alert">
                {error}
              </div>
            )}
            <Button type="submit" variant="ember" size="large" busy={busy} class="fe-auth__submit">
              {busy ? (mode === 'login' ? 'Entering' : 'Creating') : mode === 'login' ? 'Enter the forge' : 'Create account'}
            </Button>
          </form>
        </Frame>
        <div class="fe-auth__foot">Online only. Your characters and items live on the server.</div>
      </div>
    </div>
  );
}

export function CharactersScreen() {
  const store = useStore();
  const local = useLocal();
  const chars = useUi((s) => s.characters);
  const account = useUi((s) => s.account);
  const busy = useUi((s) => s.busy);
  const error = useUi((s) => s.error);
  const [selected, setSelected] = useState<string | null>(chars[0]?.id ?? null);
  // A name is suggested (and selected, so typing replaces it): nobody has to invent one before seeing the game.
  const [name, setName] = useState(() => suggestName());
  const [tried, setTried] = useState(false);
  const [creating, setCreating] = useState(chars.length === 0);
  // Which request the store's single `error` belongs to, so it shows next to the thing that failed.
  const [lastAction, setLastAction] = useState<'create' | 'play' | 'delete' | null>(null);
  // A create request in flight: the name and the ids that existed before it (names are unique server-wide, so
  // the new character is the one with this name that was not there yet).
  const pending = useRef<{ name: string; known: Set<string> } | null>(null);

  useEffect(() => {
    if (!chars.some((c) => c.id === selected)) setSelected(chars[0]?.id ?? null);
    if (chars.length === 0) setCreating(true);
  }, [chars]);

  // The form stays open until the server answers: success selects the new character, a rejection (a taken
  // name) keeps the typed name with the error under it.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    const made = chars.find((c) => !p.known.has(c.id) && c.name.toLowerCase() === p.name.toLowerCase());
    if (made) {
      pending.current = null;
      setSelected(made.id);
      setCreating(false);
      setName('');
      setTried(false);
      setLastAction(null);
    } else if (!busy && error) {
      pending.current = null;
    }
  }, [chars, busy, error]);

  const sel: CharacterSummary | undefined = chars.find((c) => c.id === selected);
  const nameErr = characterNameError(name);
  const portrait = usePortrait(128);
  const bigPortrait = usePortrait(256);

  const create = (e: Event): void => {
    e.preventDefault();
    setTried(true);
    if (nameErr || busy) {
      if (nameErr) store.actions.uiSound('error');
      return;
    }
    pending.current = { name: name.trim(), known: new Set(chars.map((c) => c.id)) };
    setLastAction('create');
    store.actions.createCharacter(name.trim());
  };
  const createError = lastAction === 'create' ? error : null;
  const otherError = lastAction === 'create' ? null : error;

  return (
    <div class="fe-screen fe-screen--chars fe-solid">
      <TitleBackdrop />
      <div class="fe-chars">
        <Logo compact />
        <div class="fe-chars__grid">
          <Frame class="fe-chars__list">
            <PanelHead title="Characters" />
            <div class="fe-chars__items">
              {chars.map((c) => (
                <button
                  key={c.id}
                  class={cx('fe-charcard', c.id === selected && !creating && 'fe-charcard--on')}
                  onClick={() => {
                    store.actions.uiSound('click');
                    setSelected(c.id);
                    setCreating(false);
                  }}
                  onDblClick={() => {
                    if (busy) return;
                    setLastAction('play');
                    store.actions.playCharacter(c.id);
                  }}
                >
                  <img class="fe-px fe-charcard__portrait" src={portrait} alt="" draggable={false} />
                  <span class="fe-charcard__text">
                    <span class="fe-charcard__name">{c.name}</span>
                    <span class="fe-charcard__meta">Level {c.level} Sorceress</span>
                  </span>
                </button>
              ))}
              {chars.length === 0 && <div class="fe-chars__empty">No characters yet. Create your first Sorceress.</div>}
            </div>
            <button
              class={cx('fe-charcard fe-charcard--new', creating && 'fe-charcard--on')}
              onClick={() => {
                store.actions.uiSound('click');
                setCreating(true);
              }}
            >
              <span class="fe-charcard__plus">+</span>
              <span class="fe-charcard__name">New character</span>
            </button>
          </Frame>

          <Frame class="fe-chars__detail">
            {creating || !sel ? (
              <form class="fe-create" onSubmit={create} noValidate>
                <PanelHead title="New character" />
                <div class="fe-create__class">
                  <div class="fe-create__portrait">
                    <img class="fe-px" src={portrait} alt="" draggable={false} />
                  </div>
                  <div class="fe-create__about">
                    <div class="fe-create__classname">Sorceress</div>
                    <p>
                      An ember-sworn caster. She burns hordes with lance and nova, freezes them with rime and lightning, and blinks out of
                      reach.
                    </p>
                    <ul class="fe-create__traits">
                      <li>Intelligence: Focus and spell damage</li>
                      <li>Starts with Ember Lance and one skill point</li>
                      <li>Wand, sceptre and focus</li>
                    </ul>
                  </div>
                </div>
                <div class="fe-field">
                  <label class="fe-field__label" for="fe-cname">
                    Name
                  </label>
                  <input
                    id="fe-cname"
                    class={cx('fe-input', tried && nameErr && 'fe-input--invalid')}
                    value={name}
                    maxLength={16}
                    disabled={busy}
                    placeholder="3 to 16 characters"
                    autoComplete="off"
                    spellcheck={false}
                    autoFocus
                    onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
                    onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
                  />
                  <button type="button" class="fe-create__dice ui-type-secondary" data-name-dice title={gt('title.diceLabel')} aria-label={gt('title.diceLabel')} disabled={busy}
                    onClick={() => { store.actions.uiSound('click'); setName(suggestName()); }}>
                    <span aria-hidden="true">{'\u2684'}</span>
                  </button>
                  <div class="fe-field__hint">{tried && nameErr ? nameErr : ''}</div>
                  <label class="fe-create__skip ui-type-caption">
                    <input type="checkbox" data-skip-tutorial onChange={(e) => setSkipFlag((e.currentTarget as HTMLInputElement).checked)} />
                    {gt('title.skip')}
                  </label>
                </div>
                {createError && (
                  <div class="fe-auth__error" role="alert">
                    {createError}
                  </div>
                )}
                <div class="fe-create__actions">
                  {chars.length > 0 && (
                    <Button variant="ghost" onClick={() => setCreating(false)}>
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" variant="ember" size="large" busy={busy}>
                    Create character
                  </Button>
                </div>
              </form>
            ) : (
              <div class="fe-selected">
                <PanelHead title={sel.name} />
                <div class="fe-selected__art">
                  <img class="fe-px" src={bigPortrait} alt="" draggable={false} />
                  <div class="fe-selected__glow" />
                </div>
                <div class="fe-selected__meta">Level {sel.level} Sorceress</div>
                {otherError && (
                  <div class="fe-auth__error" role="alert">
                    {otherError}
                  </div>
                )}
                <div class="fe-selected__actions">
                  <Button
                    variant="ember"
                    size="large"
                    busy={busy}
                    onClick={() => {
                      setLastAction('play');
                      store.actions.playCharacter(sel.id);
                    }}
                  >
                    Play
                  </Button>
                  <Button
                    variant="danger"
                    size="small"
                    disabled={busy}
                    onClick={() =>
                      local.dialog.set({
                        title: 'Delete character',
                        body: `Delete ${sel.name} forever? Every item, map and point of experience goes with them.`,
                        confirmLabel: 'Delete',
                        danger: true,
                        requireText: sel.name,
                        onConfirm: () => {
                          setLastAction('delete');
                          store.actions.deleteCharacter(sel.id);
                        },
                      })
                    }
                  >
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </Frame>
        </div>
        <div class="fe-chars__account">
          <span class="fe-muted">Signed in as</span> {account?.username ?? 'unknown'}
          <Button size="small" variant="ghost" onClick={() => store.actions.logout()}>
            Log out
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DisconnectedScreen() {
  const store = useStore();
  const connection = useUi((s) => s.connection);
  const error = useUi((s) => s.error);
  const reconnecting = connection === 'reconnecting' || connection === 'connecting';
  return (
    <div class="fe-screen fe-screen--disc fe-solid">
      <TitleBackdrop />
      <Frame class="fe-disc">
        <PanelHead title={reconnecting ? 'Reconnecting' : 'Connection lost'} />
        <div class="fe-disc__body">
          {reconnecting ? (
            <>
              <Sigil />
              {/* The client may explain the drop here (a server update: "Server updating — reconnecting…"). */}
              <p>{error ?? 'The link to the server broke.'}</p>
              <p>Rejoining where you left off as soon as the server answers.</p>
              <p class="fe-muted ui-type-caption">Your character, party and open maps are kept on the server.</p>
            </>
          ) : (
            <>
              <div class="fe-disc__broken" aria-hidden="true" />
              <p>{error ?? 'The server closed the connection.'}</p>
              <p class="fe-muted ui-type-caption">Your character and items are saved on the server.</p>
            </>
          )}
        </div>
        <div class="fe-dialog__actions">
          <Button variant="ghost" onClick={() => store.actions.toCharacterSelect()}>
            Back to characters
          </Button>
          {!reconnecting && (
            <Button variant="ember" onClick={() => store.actions.retryConnection()}>
              Try again
            </Button>
          )}
        </div>
      </Frame>
    </div>
  );
}
