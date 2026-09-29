// Party state (GAME_SPEC §11): up to MAX_PARTY_SIZE members, a leader who invites / kicks / promotes,
// invites that expire after 60 s, leadership passing to the next member when the leader leaves.
// Pure state bookkeeping: messaging, access enforcement and presentation live in the Game.
//
// An invite speaks for its sender's party only while the sender may still invite: it is withdrawn when the
// sender joins someone else's party or stops leading (promote, hand-off, leave), and accept() re-checks it.
//
// PERSISTENCE: parties survive restarts and members going offline. Every change is handed to the
// PartyPersistence (the Game writes it to SQLite); restore() rebuilds them on startup. A party nobody is in
// play for (idleSince > 0) is kept until the Game cleans it up (PARTY_IDLE_TTL_MS). Invites are not persisted.
import { MAX_PARTY_SIZE } from '../contracts/net';

export const INVITE_TTL_MS = 60_000;
/** Pending invites one character may have out at once. */
export const MAX_PENDING_INVITES = 8;
/** After a decline, the same inviter must wait this long before asking the same player again. */
export const DECLINE_COOLDOWN_MS = 20_000;
/**
 * A party with no member in play for this long is dissolved (its members never came back). Generous on purpose:
 * friends who play every few evenings keep their party between sessions (and across deploys).
 */
export const PARTY_IDLE_TTL_MS = 14 * 24 * 60 * 60_000;
const INVITE_GONE = 'That invite has expired or was withdrawn.';

export interface Party {
  readonly id: string;
  leaderId: string;
  /** Character ids in join order. */
  members: string[];
  /** Wall ms the party was founded. */
  readonly created: number;
  /** Wall ms since which no member has been in play (0 while someone is). */
  idleSince: number;
}

/** Where party changes go (the Game writes them to the database). Must not throw. */
export interface PartyPersistence {
  save(party: Party): void;
  remove(partyId: string): void;
}

/** A stored party to bring back on startup (members in join order). */
export interface RestoredParty {
  id: string;
  leaderId: string;
  members: string[];
  created: number;
  idleSince: number;
}

export interface Invite {
  readonly id: string;
  readonly fromId: string;
  readonly fromName: string;
  readonly toId: string;
  expires: number;
}

export type PartyResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface InviteResult {
  invite: Invite;
  /** An identical invite was already pending: it was only renewed (the invitee already has the popup). */
  renewed: boolean;
}

const ok = <T>(value: T): PartyResult<T> => ({ ok: true, value });
const fail = <T>(error: string): PartyResult<T> => ({ ok: false, error });

export interface LeaveResult {
  /** The party after the change (null when it was dissolved or the character was in none). */
  party: Party | null;
  /** Characters that lost their party because it dissolved (the last remaining member). */
  orphaned: string[];
  /** New leader when leadership passed. */
  newLeaderId: string | null;
}

export class PartyService {
  private readonly parties = new Map<string, Party>();
  private readonly memberOf = new Map<string, string>();
  private readonly invites = new Map<string, Invite>();
  /** `${fromId}|${toId}` → wall ms until which that inviter may not ask that player again. */
  private readonly declined = new Map<string, number>();
  private nextPartyId = 1;
  private nextInviteId = 1;

  constructor(
    private readonly now: () => number,
    private readonly persistence: PartyPersistence | null = null,
  ) {}

  private saved(party: Party): void {
    this.persistence?.save(party);
  }

  private removed(partyId: string): void {
    this.persistence?.remove(partyId);
  }

  /**
   * Bring stored parties back (startup). Members already in another restored party, duplicates and parties
   * left with fewer than two members are skipped (and reported so the caller can delete their rows);
   * a leader who is no longer a member is replaced by the first member. Returns the restored parties.
   */
  restore(rows: readonly RestoredParty[]): { restored: Party[]; dropped: string[] } {
    const restored: Party[] = [];
    const dropped: string[] = [];
    for (const row of rows) {
      const members = [...new Set(row.members)].filter((m) => !this.memberOf.has(m)).slice(0, MAX_PARTY_SIZE);
      if (this.parties.has(row.id) || members.length < 2) {
        dropped.push(row.id);
        continue;
      }
      const party: Party = {
        id: row.id,
        leaderId: members.includes(row.leaderId) ? row.leaderId : members[0],
        members,
        created: row.created,
        idleSince: row.idleSince,
      };
      this.parties.set(party.id, party);
      for (const m of members) this.memberOf.set(m, party.id);
      const n = /^p(\d+)$/.exec(party.id);
      if (n) this.nextPartyId = Math.max(this.nextPartyId, Number(n[1]) + 1);
      if (party.leaderId !== row.leaderId || members.length !== row.members.length) this.saved(party);
      restored.push(party);
    }
    return { restored, dropped };
  }

  /** Record whether anyone of the party is in play (0 = someone is; otherwise since when nobody is). */
  setIdle(partyId: string, idleSince: number): void {
    const party = this.parties.get(partyId);
    if (!party || party.idleSince === idleSince) return;
    party.idleSince = idleSince;
    this.saved(party);
  }

  /** Parties nobody has been in play for since at least `maxIdleMs`. */
  staleParties(now: number, maxIdleMs: number): Party[] {
    return [...this.parties.values()].filter((p) => p.idleSince > 0 && now - p.idleSince >= maxIdleMs);
  }

  /** Every party (diagnostics, shutdown bookkeeping). */
  list(): Party[] {
    return [...this.parties.values()];
  }

  get(partyId: string): Party | null {
    return this.parties.get(partyId) ?? null;
  }

  partyOf(characterId: string): Party | null {
    const id = this.memberOf.get(characterId);
    return id ? (this.parties.get(id) ?? null) : null;
  }

  sameParty(a: string, b: string): boolean {
    if (a === b) return true;
    const pa = this.memberOf.get(a);
    return pa !== undefined && pa === this.memberOf.get(b);
  }

  /** Everyone sharing a party with `characterId` (including them), or just them. */
  circle(characterId: string): string[] {
    return this.partyOf(characterId)?.members.slice() ?? [characterId];
  }

  invite(from: { id: string; name: string }, to: { id: string; name: string }): PartyResult<InviteResult> {
    if (from.id === to.id) return fail("You can't invite yourself.");
    const party = this.partyOf(from.id);
    if (party && party.leaderId !== from.id) return fail('Only the party leader can invite.');
    if (party?.members.includes(to.id)) return fail(`${to.name} is already in your party.`);
    if (this.partyOf(to.id)) return fail(`${to.name} is already in a party.`);
    if (party && party.members.length >= MAX_PARTY_SIZE) return fail(`Your party is full (${MAX_PARTY_SIZE} players).`);
    this.expireInvites();
    const now = this.now();
    const cooldownKey = `${from.id}|${to.id}`;
    const until = this.declined.get(cooldownKey) ?? 0;
    if (until > now) return fail(`${to.name} declined your invite. Give them a moment before asking again.`);
    this.declined.delete(cooldownKey);
    for (const inv of this.invites.values()) {
      if (inv.fromId === from.id && inv.toId === to.id) {
        inv.expires = now + INVITE_TTL_MS;
        return ok({ invite: inv, renewed: true });
      }
    }
    let pending = 0;
    for (const inv of this.invites.values()) if (inv.fromId === from.id) pending++;
    if (pending >= MAX_PENDING_INVITES) return fail('You have too many pending invites.');
    const inv: Invite = { id: `inv${this.nextInviteId++}`, fromId: from.id, fromName: from.name, toId: to.id, expires: now + INVITE_TTL_MS };
    this.invites.set(inv.id, inv);
    return ok({ invite: inv, renewed: false });
  }

  /** Pending (unexpired) invites addressed to `characterId`. */
  invitesFor(characterId: string): Invite[] {
    this.expireInvites();
    return [...this.invites.values()].filter((i) => i.toId === characterId);
  }

  getInvite(inviteId: string): Invite | null {
    this.expireInvites();
    return this.invites.get(inviteId) ?? null;
  }

  /**
   * Decline an invite addressed to `characterId`. A real decline (not a system clean-up) starts a short
   * cooldown before the same inviter can ask again, so nobody can be flooded with popups.
   */
  decline(characterId: string, inviteId: string, cooldown = true): PartyResult<Invite> {
    const inv = this.getInvite(inviteId);
    if (!inv || inv.toId !== characterId) return fail(INVITE_GONE);
    this.invites.delete(inv.id);
    if (cooldown) this.declined.set(`${inv.fromId}|${inv.toId}`, this.now() + DECLINE_COOLDOWN_MS);
    return ok(inv);
  }

  /**
   * Accept an invite: join the inviter's party, or found one with the inviter as leader. The caller has
   * checked that the inviter is still online.
   */
  accept(characterId: string, inviteId: string): PartyResult<{ party: Party; invite: Invite }> {
    const inv = this.getInvite(inviteId);
    if (!inv || inv.toId !== characterId) return fail(INVITE_GONE);
    if (this.partyOf(characterId)) return fail('Leave your current party first.');
    let party = this.partyOf(inv.fromId);
    if (party && party.leaderId !== inv.fromId) {
      // The inviter no longer leads (joined another party or handed leadership over): the invite is void.
      this.invites.delete(inv.id);
      return fail('That invite is no longer valid.');
    }
    if (party && party.members.length >= MAX_PARTY_SIZE) {
      this.invites.delete(inv.id);
      return fail(`The party is full (${MAX_PARTY_SIZE} players).`);
    }
    this.invites.delete(inv.id);
    if (!party) {
      party = { id: `p${this.nextPartyId++}`, leaderId: inv.fromId, members: [inv.fromId], created: this.now(), idleSince: 0 };
      this.parties.set(party.id, party);
      this.memberOf.set(inv.fromId, party.id);
    }
    party.members.push(characterId);
    party.idleSince = 0;
    this.memberOf.set(characterId, party.id);
    // A member who is not the leader cannot invite: withdraw whatever the newcomer had sent out.
    this.dropInvitesFrom([characterId]);
    this.saved(party);
    return ok({ party, invite: inv });
  }

  /**
   * Remove a member (leaving or kicked). Leadership passes to the next member (preferring `isOnline` ones);
   * a party left with one member dissolves.
   */
  remove(characterId: string, isOnline: (id: string) => boolean = () => true): LeaveResult {
    const party = this.partyOf(characterId);
    if (!party) return { party: null, orphaned: [], newLeaderId: null };
    party.members = party.members.filter((m) => m !== characterId);
    this.memberOf.delete(characterId);
    // Invites sent on behalf of this party no longer speak for it.
    this.dropInvitesFrom([characterId]);
    if (party.members.length <= 1) {
      const orphaned = party.members.slice();
      for (const m of orphaned) this.memberOf.delete(m);
      this.parties.delete(party.id);
      this.dropInvitesFrom(orphaned);
      this.removed(party.id);
      return { party: null, orphaned, newLeaderId: null };
    }
    let newLeaderId: string | null = null;
    if (party.leaderId === characterId) {
      party.leaderId = party.members.find(isOnline) ?? party.members[0];
      newLeaderId = party.leaderId;
    }
    this.saved(party);
    return { party, orphaned: [], newLeaderId };
  }

  /** Why `leaderId` may not remove `targetId` from the party (null = allowed; then call remove()). */
  kickError(leaderId: string, targetId: string): string | null {
    const party = this.partyOf(leaderId);
    if (!party) return 'You are not in a party.';
    if (party.leaderId !== leaderId) return 'Only the party leader can remove members.';
    if (targetId === leaderId) return 'Use "Leave party" to leave your own party.';
    if (!party.members.includes(targetId)) return 'That player is not in your party.';
    return null;
  }

  promote(leaderId: string, targetId: string): PartyResult<Party> {
    const party = this.partyOf(leaderId);
    if (!party) return fail('You are not in a party.');
    if (party.leaderId !== leaderId) return fail('Only the party leader can promote.');
    if (targetId === leaderId) return fail('You already lead the party.');
    if (!party.members.includes(targetId)) return fail('That player is not in your party.');
    party.leaderId = targetId;
    this.dropInvitesFrom([leaderId]);
    this.saved(party);
    return ok(party);
  }

  /** The leader went offline: hand leadership to an online member if there is one. Returns the new leader. */
  handOffLeadership(characterId: string, isOnline: (id: string) => boolean): string | null {
    const party = this.partyOf(characterId);
    if (!party || party.leaderId !== characterId) return null;
    const next = party.members.find((m) => m !== characterId && isOnline(m));
    if (!next) return null;
    party.leaderId = next;
    this.dropInvitesFrom([characterId]);
    this.saved(party);
    return next;
  }

  /**
   * A party whose leader is not in play while another member is: hand leadership to the first member in
   * play, so the party is never stuck without someone who can invite, kick or promote. Returns the new leader.
   */
  repairLeadership(partyId: string, isOnline: (id: string) => boolean): string | null {
    const party = this.parties.get(partyId);
    if (!party || isOnline(party.leaderId)) return null;
    return this.handOffLeadership(party.leaderId, isOnline);
  }

  /** Dissolve a party (e.g. nobody in it is online any more). Returns the former members. */
  dissolve(partyId: string): string[] {
    const party = this.parties.get(partyId);
    if (!party) return [];
    for (const m of party.members) this.memberOf.delete(m);
    this.parties.delete(partyId);
    this.dropInvitesFrom(party.members);
    this.removed(partyId);
    return party.members.slice();
  }

  /** Forget invites from or to a character (they went offline / were deleted). */
  dropInvitesOf(characterId: string): void {
    for (const [id, inv] of this.invites) if (inv.fromId === characterId || inv.toId === characterId) this.invites.delete(id);
  }

  private dropInvitesFrom(ids: readonly string[]): void {
    for (const [id, inv] of this.invites) if (ids.includes(inv.fromId)) this.invites.delete(id);
  }

  expireInvites(): void {
    const now = this.now();
    for (const [id, inv] of this.invites) if (inv.expires <= now) this.invites.delete(id);
    for (const [key, until] of this.declined) if (until <= now) this.declined.delete(key);
  }

  get partyCount(): number {
    return this.parties.size;
  }
}
