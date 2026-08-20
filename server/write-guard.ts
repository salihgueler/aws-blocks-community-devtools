/**
 * Cloud writes are locked by default. The unlock is explicit, in-memory,
 * and self-expiring: a console restart or 15 idle minutes re-locks. This
 * module is the single authority — every write route asks it first.
 */

const UNLOCK_TTL_MS = 15 * 60 * 1000;

let unlockedAt: number | null = null;

export function setUnlocked(unlock: boolean): void {
  unlockedAt = unlock ? Date.now() : null;
}

export function isUnlocked(): boolean {
  if (unlockedAt === null) return false;
  if (Date.now() - unlockedAt > UNLOCK_TTL_MS) {
    unlockedAt = null;
    return false;
  }
  return true;
}

export function unlockExpiresInMs(): number | null {
  return isUnlocked() ? UNLOCK_TTL_MS - (Date.now() - (unlockedAt ?? 0)) : null;
}
