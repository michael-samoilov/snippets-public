"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { PaperButton } from "@/components/paper-button";
import { GoogleMark } from "@/components/google-mark";
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "signed-in") router.replace("/calendar");
  }, [status, router]);

  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1)
      router.back();
    else router.push("/calendar");
  };

  const sendCode = async () => {
    const address = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(address)) {
      setError(copy.signin.errors.invalidEmail);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({
      email: address,
      type: "sign-in",
    });
    setBusy(false);
    if (sendError) {
      setError(
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
      setError(copy.signin.errors.badCode);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: verifyError } = await authClient.signIn.emailOtp({
      email,
      otp: code.trim(),
    });
    setBusy(false);
    if (verifyError) {
      setError(copy.signin.errors.badCode);
      return;
    }
    router.push("/welcome");
  };

  const google = async () => {
    setBusy(true);
    setError(null);
    const { error: googleError } = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/welcome",
    });
    // on success the browser navigates away; reaching here means it didn't
    setBusy(false);
    if (googleError) {
      setError(
        googleError.status === 503
          ? copy.signin.errors.notConfigured
          : copy.signin.errors.googleFailed,
      );
    }
  };

  return (
    <div className="page-settle">
      <header className="mb-8">
        <button
          type="button"
          onClick={goBack}
          aria-label={copy.signin.back}
          className="pressable inline-flex items-baseline rounded-[5px] text-left text-[2.5rem] leading-[1.02] hover:text-wax sm:text-[2.9rem]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 580.5 770.7"
            className="mr-1.5 inline-block h-[0.58em] w-auto -translate-y-[0.08em] text-ink-faint"
            fill="currentColor"
          >
            <path d="M2.5 361.7Q9.2 341.0 29.6 323.6Q50.0 306.3 93.9 280.9Q194.1 222.2 270.3 175.3Q346.5 128.4 404.2 89.6Q461.8 50.7 505.6 17.8Q526.6 4.1 545.6 0.8Q564.5 -2.5 573.8 7.3Q584.0 18.1 578.7 33.0Q573.3 47.9 557.4 66.6Q528.7 98.6 492.7 135.8Q456.7 172.9 412.8 215.7Q369.0 258.5 316.2 308.1Q263.3 357.6 200.6 414.5L209.2 350.7Q254.5 428.8 286.1 494.0Q317.6 559.3 339.9 613.0Q362.2 666.7 378.3 711.2Q384.8 727.5 382.6 742.0Q380.5 756.4 367.8 764.6Q353.6 773.3 339.9 769.5Q326.2 765.8 313.8 751.2Q286.3 712.3 249.6 665.8Q212.9 619.3 162.8 564.8Q112.7 510.4 43.4 448.7Q14.2 421.7 5.3 402.8Q-3.6 383.8 2.5 361.7Z" />
          </svg>
          <h1 className="voice-display leading-[1.02]">{copy.signin.title}</h1>
        </button>
      </header>

      <div className="max-w-[26rem]">
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
            {/* one row: the field fills, the button sits at its natural width
                on the right, both the same height */}
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
                className="pressable rounded-[5px] font-serif text-[0.9rem] text-ink-faint hover:text-ink-soft"
                onClick={() => {
                  setStep("email");
                  setError(null);
                }}
              >
                {copy.signin.differentEmail}
              </button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="voice-prose mt-4 text-[0.9rem] text-ember">
            {error}
          </p>
        )}

        <div
          aria-hidden="true"
          className="mt-9 flex items-center gap-3 text-ink-faint"
        >
          <span className="h-px flex-1 bg-rule-faint" />
          <span className="voice-label text-[0.75rem]">{copy.signin.or}</span>
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
        </div>

        {/* the agreement, said once and quietly — both documents one tap away */}
        <p className="voice-prose mt-6 text-center text-[0.82rem] text-ink-faint">
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
      </div>
    </div>
  );
}
