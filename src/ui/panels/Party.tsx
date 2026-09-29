// Party (docked left): members with leader crown, presence, location and their open map; hideout visits, trade
// requests, invites by name, leave / kick / promote.
import { useState } from 'preact/hooks';
import { MAX_PARTY_SIZE } from '../../contracts/net';
import { Button, cx } from '../components/common';
import { useLocal } from '../local';
import { possessive } from '../lib/format';
import { locationText } from '../lib/party';
import { characterNameError } from '../lib/validate';
import { shallowEqual, useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';

export function PartyPanel() {
  const store = useStore();
  const local = useLocal();
  const party = useUi((s) => s.party);
  const me = useUi((s) => s.character?.id ?? '');
  const myName = useUi((s) => s.character?.name ?? '');
  const zoneOwner = useUi((s) => s.hud?.zoneOwnerName ?? '');
  const zoneIsOwn = useUi((s) => s.hud?.zoneIsOwn ?? true);
  const zone = useUi((s) => s.zone);
  const mapRun = useUi((s) => (s.hud?.run ? { name: s.hud.run.mapName, portals: s.hud.run.portalsRemaining } : null), shallowEqual);
  const tradingWith = useUi((s) => s.trade?.partnerCharacterId ?? null);
  const tradePartner = useUi((s) => s.trade?.partnerName ?? '');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);

  const members = party?.members ?? [];
  const iLead = !party || party.leaderId === me;
  const full = members.length >= MAX_PARTY_SIZE;
  const nameErr = characterNameError(name);

  const invite = (): void => {
    setTouched(true);
    if (nameErr) {
      store.actions.uiSound('error');
      return;
    }
    store.actions.partyInvite(name.trim());
    setName('');
    setTouched(false);
  };

  const confirm = (title: string, body: string, label: string, run: () => void, danger = false): void =>
    local.dialog.set({ title, body, confirmLabel: label, danger, onConfirm: run });

  /** Travelling out of a map gives up your spot in it: ask first, and say what coming back costs. */
  const travel = (where: string, go: () => void): void => {
    if (zone !== 'map' || !mapRun) {
      go();
      return;
    }
    const back =
      mapRun.portals > 0
        ? `Coming back costs one of its portals (${mapRun.portals} left).`
        : 'No portals are left, so you cannot come back.';
    confirm('Leave map', `Leave ${mapRun.name} for ${where}? ${back}`, 'Leave map', go, mapRun.portals === 0);
  };

  return (
    <PanelShell
      panel="party"
      title="Party"
      class="fe-party"
      aside={<span class="fe-party__count">{party ? `${members.length} of ${MAX_PARTY_SIZE}` : 'Solo'}</span>}
    >
      {!party && (
        <div class="fe-party__solo">
          <p>
            You are playing alone. Invite up to three friends by character name: you can visit each other's hideouts and run maps together.
          </p>
          <p class="fe-muted ui-type-caption">
            Loot is personal: every player sees and picks up only their own drops. Items dropped on the floor on purpose are
            public. Experience is shared.
          </p>
        </div>
      )}
      {party && (
        <ul class="fe-members">
          {members.map((m) => {
            const isMe = m.characterId === me;
            const leader = m.characterId === party.leaderId;
            const here = zone === 'hideout' && m.name === zoneOwner && !zoneIsOwn;
            return (
              <li key={m.characterId} class={cx('fe-member', !m.online && 'fe-member--offline', isMe && 'fe-member--me')}>
                <div class="fe-member__badge">
                  <span class="fe-member__level">{m.level}</span>
                  {leader && <span class="fe-crown" title="Party leader" />}
                </div>
                <div class="fe-member__main">
                  <div class="fe-member__name">
                    <span class={cx('fe-dot', m.online ? 'fe-dot--on' : 'fe-dot--off')} />
                    {m.name}
                    {isMe && <span class="fe-muted"> (you)</span>}
                  </div>
                  <div class="fe-member__where">{locationText(m, myName)}</div>
                  <div class={cx('fe-member__map', !m.activeMap && 'fe-muted')}>
                    {m.activeMap ? (
                      <>
                        <span class={cx('fe-portal-pip', m.activeMap.remaining === 0 && 'fe-portal-pip--spent')} />
                        <span>{m.activeMap.mapName} T{m.activeMap.tier}</span>
                        <span class="fe-member__portals">
                          {m.activeMap.remaining}/{m.activeMap.total} portals{m.activeMap.cleared ? ', cleared' : ''}
                        </span>
                      </>
                    ) : (
                      'No open map'
                    )}
                  </div>
                </div>
                <div class="fe-member__actions">
                  {!isMe && m.online && (
                    <div class="fe-member__row">
                      <Button
                        size="small"
                        disabled={!!tradingWith}
                        onClick={() => store.actions.tradeRequest(m.name)}
                        onPointerEnter={(e) =>
                          local.showTooltip(
                            {
                              kind: 'text',
                              lines: [
                                tradingWith === m.characterId
                                  ? `You are trading with ${m.name}.`
                                  : tradingWith
                                    ? `Finish your trade with ${tradePartner || 'your partner'} first.`
                                    : `Ask ${m.name} to trade. The trade window opens for both of you once they accept.`,
                              ],
                            },
                            e.currentTarget,
                            'above',
                          )
                        }
                        onPointerLeave={() => local.hideTooltip()}
                      >
                        {tradingWith === m.characterId ? 'Trading' : 'Trade'}
                      </Button>
                      <Button
                        size="small"
                        disabled={here}
                        onClick={() => travel(`${possessive(m.name)} hideout`, () => store.actions.visitHideout(m.characterId))}
                      >
                        {here ? 'Visiting' : 'Visit hideout'}
                      </Button>
                    </div>
                  )}
                  {isMe && !(zone === 'hideout' && zoneIsOwn) && (
                    <Button size="small" onClick={() => travel('your hideout', () => store.actions.goHome())}>
                      Go home
                    </Button>
                  )}
                  {!isMe && iLead && (
                    <div class="fe-member__lead">
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() =>
                          confirm('Promote', `Make ${m.name} the party leader?`, 'Promote', () => store.actions.partyPromote(m.characterId))
                        }
                      >
                        Promote
                      </Button>
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() =>
                          confirm(
                            'Remove from party',
                            `Remove ${m.name} from the party?`,
                            'Remove',
                            () => store.actions.partyKick(m.characterId),
                            true,
                          )
                        }
                      >
                        Kick
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {iLead && !full && (
        <form
          class="fe-invite"
          onSubmit={(e) => {
            e.preventDefault();
            invite();
          }}
        >
          <div class="fe-field">
            <label class="fe-field__label" for="fe-invite-name">
              Invite by character name
            </label>
            <div class="fe-invite__row">
              <input
                id="fe-invite-name"
                class={cx('fe-input', touched && nameErr && 'fe-input--invalid')}
                value={name}
                maxLength={16}
                placeholder="Character name"
                autoComplete="off"
                spellcheck={false}
                onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
              />
              <Button type="submit" variant="ember">
                Invite
              </Button>
            </div>
            <div class="fe-field__hint">{touched && nameErr ? nameErr : ''}</div>
          </div>
        </form>
      )}
      {party && !iLead && <p class="fe-panel__note ui-type-caption">Only the party leader can invite new members.</p>}
      {party && full && iLead && <p class="fe-panel__note ui-type-caption">The party is full.</p>}
      {party && (
        <div class="fe-party__foot">
          <Button
            variant="danger"
            size="small"
            onClick={() =>
              confirm(
                'Leave party',
                'Leave the party? You can be invited again at any time.',
                'Leave',
                () => store.actions.partyLeave(),
                true,
              )
            }
          >
            Leave party
          </Button>
        </div>
      )}
    </PanelShell>
  );
}
