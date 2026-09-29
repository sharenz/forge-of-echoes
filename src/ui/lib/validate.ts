// Client-side form validation mirroring the server rules in src/contracts/net.ts, so players see the
// problem before a round trip. The server stays authoritative. Pure; covered by tests/ui/helpers.test.ts.

export function usernameError(name: string): string | null {
  const n = name.trim();
  if (n.length < 3) return 'Usernames need at least 3 characters.';
  if (n.length > 20) return 'Usernames can have at most 20 characters.';
  if (!/^[A-Za-z0-9_]+$/.test(n)) return 'Use only letters, digits and underscores.';
  return null;
}

export function passwordError(pw: string): string | null {
  if (pw.length < 8) return 'Passwords need at least 8 characters.';
  return null;
}

export function characterNameError(name: string): string | null {
  const n = name.trim();
  if (n.length < 3) return 'Names need at least 3 characters.';
  if (n.length > 16) return 'Names can have at most 16 characters.';
  // Name plates use the in-world pixel font, which covers ASCII only.
  if (!/^[A-Za-z][A-Za-z0-9 _'-]*$/.test(n)) return 'Start with a letter; use letters, digits, spaces, hyphens or apostrophes.';
  return null;
}
