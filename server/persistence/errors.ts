export class ProfileRevisionConflict extends Error {
  constructor() {
    super("profile_revision_conflict");
    this.name = "ProfileRevisionConflict";
  }
}

export class ItemLockedError extends Error {
  constructor(public readonly itemId: string) {
    super("item_locked_for_trade");
    this.name = "ItemLockedError";
  }
}

export class CharacterNameTakenError extends Error {
  constructor() {
    super("character_name_taken");
    this.name = "CharacterNameTakenError";
  }
}

export class CharacterNotFoundError extends Error {
  constructor(public readonly characterId: string) {
    super("character_not_found");
    this.name = "CharacterNotFoundError";
  }
}

export class AccountNotFoundError extends Error {
  constructor(public readonly accountId: string) {
    super("account_not_found");
    this.name = "AccountNotFoundError";
  }
}

export class AccountHandleTakenError extends Error {
  constructor() {
    super("account_handle_taken");
    this.name = "AccountHandleTakenError";
  }
}
