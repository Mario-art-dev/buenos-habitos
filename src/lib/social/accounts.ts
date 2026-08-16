import { db } from "@/lib/db";
import type { Platform } from "@/lib/types";

export async function saveAccount(params: {
  platform: Platform;
  accountName?: string | null;
  accountId?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
}) {
  return db.socialAccount.upsert({
    where: { platform: params.platform },
    create: params,
    update: params,
  });
}

export function getAccount(platform: Platform) {
  return db.socialAccount.findUnique({ where: { platform } });
}

export function removeAccount(platform: Platform) {
  return db.socialAccount.deleteMany({ where: { platform } });
}
