/**
 * Shared prose bits for the policy pages (privacy, terms, verify) so
 * their treatment can't drift. `Em` is bold against the body prose, for
 * the load-bearing lines.
 */
export function Em({ children }: { children: React.ReactNode }) {
  return <strong className="font-bold">{children}</strong>;
}
