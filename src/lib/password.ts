import { compare, hash } from "bcryptjs";

const HASH_ROUNDS = 10;
const BCRYPT_PREFIX = /^\$2[aby]\$/;

export function isHashedPassword(value: string | null | undefined): boolean {
  return typeof value === "string" && BCRYPT_PREFIX.test(value);
}

export async function hashPasswordIfProvided(password?: string): Promise<string | undefined> {
  if (!password) return undefined;
  const trimmed = password.trim();
  if (!trimmed) return undefined;
  if (isHashedPassword(trimmed)) return trimmed;
  return hash(trimmed, HASH_ROUNDS);
}

export async function verifyPassword(storedPassword: string | null | undefined, inputPassword: string): Promise<boolean> {
  if (!storedPassword) return true;
  if (isHashedPassword(storedPassword)) {
    return compare(inputPassword, storedPassword);
  }
  // Backward-compatible path for legacy plaintext rows.
  return inputPassword === storedPassword;
}

