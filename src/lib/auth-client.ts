"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

/** The Better Auth browser client. Same-origin; no baseURL needed. */
export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
});
