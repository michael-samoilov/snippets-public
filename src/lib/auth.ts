"use client";

/**
 * The seam where cross-device sync plugs in. Local-first is the
 * constitution: the app must remain whole with no account and no
 * network, so the provider wired here only ever *adds* sync on top
 * of the device's own copy.
 */
import { authClient } from "@/lib/auth-client";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export type SessionStatus = "loading" | "signed-in" | "signed-out";

export function useSession(): {
  user: SessionUser | null;
  status: SessionStatus;
} {
  const { data, isPending } = authClient.useSession();
  if (isPending) return { user: null, status: "loading" };
  if (!data?.user) return { user: null, status: "signed-out" };
  const { id, name, email } = data.user;
  return {
    user: { id, name: name || email, email },
    status: "signed-in",
  };
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
}
