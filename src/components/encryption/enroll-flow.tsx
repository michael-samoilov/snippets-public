"use client";

/**
 * The enrollment flow — choose the passphrase, receive the recovery
 * code once, hear about the Drive safety net — shared by the welcome
 * step (inline on the sheet) and Settings (inside its dialog), so the
 * two can never drift. Signing in implies encryption: this flow is the
 * one gate between a signed-in book and its first sync, which is why it
 * lives as its own component rather than a Settings dialog's insides.
 *
 * It owns form state and the enroll call only; the parent owns the
 * surrounding chrome (dialog or sheet) and hears `onEnrolled` the
 * moment the key exists, then `onDone` when the code is acknowledged.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { PaperButton } from "@/components/paper-button";
import { enroll, recoveryKitText } from "@/lib/e2e";
import { requestSync } from "@/lib/sync";
import { checkPassphrase, type PassphraseStrength } from "@/lib/passphrase";
import { copy } from "@/lib/copy";

export function EyeToggle({
  shown,
  onToggle,
}: {
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      // pointer-down + preventDefault so tapping the eye never steals focus
      // (and the keyboard) from the field
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
      aria-label={shown ? "Hide passphrase" : "Show passphrase"}
      aria-pressed={shown}
      className="pressable absolute right-1.5 top-1/2 -translate-y-1/2 rounded-[5px] p-1.5 text-ink-faint hover:text-ink-soft"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {shown ? (
          <>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </>
        ) : (
          <>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  );
}

/** Passphrase strength — four bars, ember-weak climbing to green-strong. */
export function StrengthMeter({ score, label }: { score: number; label: string }) {
  const filled = Math.min(4, Math.max(1, score));
  const tone =
    score <= 1
      ? "--strength-weak"
      : score === 2
        ? "--strength-fair"
        : score === 3
          ? "--strength-good"
          : "--strength-strong";
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-1 flex-1 rounded-full transition-colors duration-200"
            style={{
              backgroundColor: `var(${i < filled ? tone : "--strength-track"})`,
            }}
          />
        ))}
      </div>
      <p className="voice-prose-sm">{label}</p>
    </div>
  );
}

export function EnrollFlow({
  email,
  onEnrolled,
  onDone,
}: {
  email: string;
  /** the key now exists on this device (fired before the code is acknowledged) */
  onEnrolled?: () => void;
  /** the recovery code has been acknowledged — the flow is complete */
  onDone: () => void;
}) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [strength, setStrength] = useState<PassphraseStrength | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  // nudge a focused field above the keyboard — 'center' keeps it
  // comfortably in view without pushing a visible field out of the way
  const revealOnFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
  };

  // the things a guesser tries first: the account's email and its local part
  const guessHints = useMemo(
    () => [email, email.split("@")[0], "snippets"].filter(Boolean),
    [email],
  );

  // quiet live strength read; the dynamic zxcvbn import is memoized so
  // only the first keystroke pays for it
  useEffect(() => {
    if (!pass) {
      setStrength(null);
      return;
    }
    let alive = true;
    void checkPassphrase(pass, guessHints).then((s) => {
      if (alive) setStrength(s);
    });
    return () => {
      alive = false;
    };
  }, [pass, guessHints]);

  const doEnroll = async () => {
    if (pass.length < 10) {
      setError(copy.settings.encryption.tooShort);
      return;
    }
    if (pass !== confirm) {
      setError(copy.settings.encryption.mismatch);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // the passphrase is the weakest link once its wrapped copy rests
      // on the server — refuse a guessable one rather than seal behind it
      const graded = await checkPassphrase(pass, guessHints);
      if (!graded.ok) {
        setError(copy.settings.encryption.tooWeak);
        setBusy(false);
        return;
      }
      const code = await enroll(pass);
      setPass("");
      setConfirm("");
      setRecoveryCode(code);
      onEnrolled?.();
      requestSync();
    } catch {
      setError(copy.settings.encryption.enrollFailed);
    }
    setBusy(false);
  };

  const downloadKit = () => {
    if (!recoveryCode) return;
    const blob = new Blob([recoveryKitText(recoveryCode, email)], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "snippets-recovery-code.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (recoveryCode !== null) {
    // the recovery code — shown exactly once; only "I've saved it" moves on
    return (
      <div className="space-y-3">
        <p className="voice-label-sm">{copy.settings.encryption.recoveryTitle}</p>
        <p className="voice-prose-sm text-ink-soft">
          {copy.settings.encryption.recoveryBody}
        </p>
        <p className="voice-data select-all break-all text-center text-ui leading-relaxed">
          {recoveryCode}
        </p>
        <p className="voice-prose-sm">
          {copy.settings.encryption.recoveryFileNote}
        </p>
        <p className="voice-prose-sm text-ink-soft">
          {copy.settings.encryption.recoveryDrive}{" "}
          <Link href="/settings" className="underline underline-offset-2">
            {copy.settings.backup.heading}
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <PaperButton onClick={downloadKit}>
            {copy.settings.encryption.downloadKit}
          </PaperButton>
          <button
            type="button"
            onClick={onDone}
            className="pressable rounded-[5px] font-serif text-ui text-ink-faint hover:text-ink-soft"
          >
            {copy.settings.encryption.recoveryDone}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void doEnroll();
      }}
    >
      <label className="voice-label-sm block" htmlFor="e2e-pass">
        {copy.settings.encryption.passphraseLabel}
      </label>
      <div className="relative">
        <Input
          id="e2e-pass"
          type={showPass ? "text" : "password"}
          autoComplete="new-password"
          placeholder={copy.settings.encryption.passphrasePlaceholder}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onFocus={revealOnFocus}
          className="h-10 pr-11 font-serif text-ui"
        />
        <EyeToggle shown={showPass} onToggle={() => setShowPass((v) => !v)} />
      </div>
      {pass.length > 0 && strength && (
        <StrengthMeter
          score={strength.score}
          label={
            strength.score >= 4
              ? copy.settings.encryption.strengthStrong
              : strength.ok
                ? copy.settings.encryption.strengthOk
                : copy.settings.encryption.strengthWeak
          }
        />
      )}
      <label className="voice-label-sm block" htmlFor="e2e-confirm">
        {copy.settings.encryption.passphraseConfirmLabel}
      </label>
      <Input
        id="e2e-confirm"
        type={showPass ? "text" : "password"}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        onFocus={revealOnFocus}
        className="h-10 font-serif text-ui"
      />
      {error && (
        <p role="alert" className="voice-prose-sm text-ember">
          {error}
        </p>
      )}
      <div className="pt-1">
        <PaperButton type="submit" disabled={busy}>
          {busy
            ? copy.settings.encryption.enrolling
            : copy.settings.encryption.enrollConfirm}
        </PaperButton>
      </div>
    </form>
  );
}
