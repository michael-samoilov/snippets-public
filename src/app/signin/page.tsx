"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { PaperButton } from "@/components/paper-button";
import { GoogleMark } from "@/components/google-mark";
import { PageBackHeader } from "@/components/page-back-header";
import { authClient } from "@/lib/auth-client";
import { useSession } from "@/lib/auth";
import { copy } from "@/lib/copy";

type Step = "email" | "code";

/**
 * One quiet page: an address, a six-digit code, and beneath a rule,
 * Google. Signing in is never required — the lead says so — and the
 * page steps aside if a session already exists.
 */
export default function SignInPage() {
  const router = useRouter();
  const { status } = useSession();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // separate error slots so each message renders beside the control that
  // triggered it, rather than one shared line stranded between the two flows
  const [emailError, setEmailError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "signed-in") router.replace("/calendar");
  }, [status, router]);

  const sendCode = async () => {
    const address = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(address)) {
      setEmailError(copy.signin.errors.invalidEmail);
      return;
    }
    setBusy(true);
    setEmailError(null);
    const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({
      email: address,
      type: "sign-in",
    });
    setBusy(false);
    if (sendError) {
      setEmailError(
        sendError.status === 503
          ? copy.signin.errors.notConfigured
          : copy.signin.errors.sendFailed,
      );
      return;
    }
    setEmail(address);
    setCode("");
    setStep("code");
  };

  const verify = async () => {
    if (code.trim().length < 6) {
      setEmailError(copy.signin.errors.badCode);
      return;
    }
    setBusy(true);
    setEmailError(null);
    const { error: verifyError } = await authClient.signIn.emailOtp({
      email,
      otp: code.trim(),
    });
    setBusy(false);
    if (verifyError) {
      setEmailError(copy.signin.errors.badCode);
      return;
    }
    router.push("/welcome");
  };

  const google = async () => {
    setBusy(true);
    setGoogleError(null);
    const { error: signInError } = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/welcome",
    });
    // on success the browser navigates away; reaching here means it didn't
    setBusy(false);
    if (signInError) {
      setGoogleError(
        signInError.status === 503
          ? copy.signin.errors.notConfigured
          : copy.signin.errors.googleFailed,
      );
    }
  };

  return (
    <PageBackHeader title={copy.signin.title}>
      <p className="voice-prose text-[0.95rem] text-ink-soft">
        {copy.signin.lead}
      </p>

      {step === "email" ? (
        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
        >
          <label
            htmlFor="signin-email"
            className="voice-label block border-b border-rule pb-1.5"
          >
            {copy.signin.emailLabel}
          </label>
          {/* the field fills the full container width, the button sits at
              its natural width on the right, both the same height */}
          <div className="mt-4 flex items-stretch gap-2">
            <Input
              id="signin-email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder={copy.signin.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 flex-1 font-serif text-[1rem]"
            />
            <PaperButton
              type="submit"
              disabled={busy}
              className="inline-flex h-10 shrink-0 items-center justify-center"
            >
              {busy ? copy.signin.sending : copy.signin.sendCode}
            </PaperButton>
          </div>
        </form>
      ) : (
        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <p className="voice-prose text-[0.95rem]">
            {copy.signin.codeSent(email)}
          </p>
          <label htmlFor="signin-code" className="sr-only">
            {copy.signin.codeLabel}
          </label>
          <Input
            id="signin-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="mt-4 h-11 max-w-[11ch] text-center font-mono text-[1.15rem] tracking-[0.35em]"
          />
          <div className="mt-4 flex items-center gap-4">
            <PaperButton type="submit" disabled={busy}>
              {busy ? copy.signin.verifying : copy.signin.verify}
            </PaperButton>
            <button
              type="button"
              className="pressable rounded-[5px] font-serif text-[0.94rem] text-ink-faint hover:text-ink-soft"
              onClick={() => {
                setStep("email");
                setEmailError(null);
              }}
            >
              {copy.signin.differentEmail}
            </button>
          </div>
        </form>
      )}

      {emailError && (
        <p role="alert" className="voice-prose mt-4 text-[0.94rem] text-ember">
          {emailError}
        </p>
      )}

      <div
        aria-hidden="true"
        className="mt-9 flex items-center gap-3 text-ink-faint"
      >
        <span className="h-px flex-1 bg-rule-faint" />
        <span className="voice-label text-[0.78rem]">{copy.signin.or}</span>
        <span className="h-px flex-1 bg-rule-faint" />
      </div>

      <div className="mt-6">
        <PaperButton
          onClick={() => void google()}
          disabled={busy}
          className="h-10 w-full"
        >
          <span className="flex w-full items-center justify-center gap-2.5">
            <GoogleMark tone="color" />
            {copy.signin.google}
          </span>
        </PaperButton>
        {googleError && (
          <p role="alert" className="voice-prose mt-3 text-[0.94rem] text-ember">
            {googleError}
          </p>
        )}
      </div>

      {/* the agreement, said once and quietly — both documents one tap away */}
      <p className="voice-prose mt-6 text-[0.86rem] text-ink-faint">
        {copy.signin.agree}{" "}
        <Link
          href="/terms"
          className="underline underline-offset-2 hover:text-ink-soft"
        >
          {copy.signin.agreeTerms}
        </Link>{" "}
        {copy.signin.agreeAnd}{" "}
        <Link
          href="/privacy"
          className="underline underline-offset-2 hover:text-ink-soft"
        >
          {copy.signin.agreePrivacy}
        </Link>
        .
      </p>
    </PageBackHeader>
  );
}
