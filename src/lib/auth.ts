"use client";

/**
 * The seam where cross-device sync will plug in. Local-first is the
 * constitution: the app must remain whole with no account and no
 * network, so whatever provider lands here only ever *adds* sync on
 * top of the device's own copy.
 */
export interface SessionUser {
  name: string;
  email: string;
}

export function useSession(): {
  user: SessionUser | null;
  status: "signed-out";
} {
  // no provider wired yet — everything stays on the device
  return { user: null, status: "signed-out" };
}
