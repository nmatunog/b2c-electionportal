import { hashPasswordIfProvided, isHashedPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

type UserAuthRecord = {
  id: string;
  password: string | null;
};

/**
 * Backward-compatible authentication check.
 * If a legacy plaintext password matches, it is transparently upgraded to bcrypt.
 */
export async function verifyAndUpgradePassword(user: UserAuthRecord, inputPassword: string): Promise<boolean> {
  const ok = await verifyPassword(user.password, inputPassword);
  if (!ok) return false;

  if (user.password && !isHashedPassword(user.password)) {
    const next = await hashPasswordIfProvided(inputPassword);
    if (next && next !== user.password) {
      await prisma.user.update({
        where: { id: user.id },
        data: { password: next },
      });
    }
  }

  return true;
}

