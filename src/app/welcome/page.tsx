"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth";
import { getBookKey, refreshEnrollment } from "@/lib/e2e";
import { EnrollFlow } from "@/components/encryption/enroll-flow";
import { copy } from "@/lib/copy";

/**
 * The post-sign-in enrollment step. Signing in implies end-to-end
 * encryption — the sync engine holds the book (needsSetup) and the
 * server refuses unencrypted entries — so both sign-in paths land here
 * until a passphrase exists. The page itself is not the gate (the
 * engine is): the quiet escape link returns to the book, where sync
 * simply waits and the calendar's needs-setup letter carries the same
 * door. Already-enrolled accounts (including a second device, which
 * lands locked) step straight aside.
 */
export default function WelcomePage() {
  const router = useRouter();
  const { user, status } = useSession();
  const [show, setShow] = useState(false);
  // once the passphrase is set the recovery code is on screen — the
  // escape link leaves with the flow, so the only door is "I've saved it".
  // The ref mirrors it for the effect below: the session hook refetches
  // after enrollment, re-running the step-aside — which must NOT fire
  // mid-flow, or it would yank the once-only recovery code off screen.
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (status === "loading") return;
    if (status === "signed-out" || !user) {
      router.replace("/calendar");
      return;
    }
    let alive = true;
    void (async () => {
      const [enrolled, key] = await Promise.all([
        refreshEnrollment(),
        getBookKey(),
      ]);
      if (!alive || startedRef.current) return;
      // enrolled (or unknowable right now) → the book handles it: a
      // second device shows the locked letter, an outage retries. Only a
      // confirmed not-enrolled account needs this step.
      if (enrolled !== false || key) {
        router.replace("/calendar");
        return;
      }
      setShow(true);
    })();
    return () => {
      alive = false;
    };
  }, [status, user, router]);

  if (!show || !user) return null;

  return (
    <div className="page-settle">
      <div className="max-w-[32rem]">
        <h1 className="voice-display text-[2rem] leading-[1.05] sm:text-[2.4rem]">
          {copy.welcome.title}
        </h1>
        <p className="voice-prose mt-5 text-[1rem] text-ink-soft">
          {copy.welcome.body}
        </p>
        <div className="mt-8">
          <EnrollFlow
            email={user.email ?? ""}
            onEnrolled={() => {
              startedRef.current = true;
              setStarted(true);
            }}
            onDone={() => router.push("/calendar")}
          />
        </div>
        {!started && (
          <div className="mt-8">
            <button
              type="button"
              onClick={() => router.push("/calendar")}
              className="pressable rounded-[5px] font-serif text-[0.95rem] text-ink-faint hover:text-ink-soft"
            >
              {copy.welcome.later}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
