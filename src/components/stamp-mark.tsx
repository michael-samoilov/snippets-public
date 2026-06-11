/** The pressed-wax mark: the app's only pictorial stamp. */
export function StampMark() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
      <circle cx="6" cy="6" r="6" fill="var(--wax-deep)" />
      <circle cx="6" cy="6" r="5" fill="var(--wax)" />
      <circle cx="4.2" cy="3.9" r="1.9" fill="var(--wax-bright)" opacity="0.65" />
      <path d="M6 3.2 V8.8 M3.6 4.6 L8.4 7.4 M3.6 7.4 L8.4 4.6" stroke="var(--paper-raised)" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}
