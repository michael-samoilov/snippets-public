"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PaperButton } from "@/components/paper-button";
import { useSession } from "@/lib/auth";
import { getBookKey, refreshEnrollment } from "@/lib/e2e";
import { copy } from "@/lib/copy";

const seenKey = (userId: string) => `snippets:e2eOfferSeen:${userId}`;

/**
 * The one-time, post-sign-in encryption offer. Both sign-in paths — the
 * code flow and Google's redirect — land here first; it either makes the
 * offer or steps quietly aside to the book. Never required (law 8):
 * "Not now" is a first-class choice, and the offer is shown at most once
 * per device per account. Already-sealed accounts never see it.
 */
export default function WelcomePage() {
  const router = useRouter();
  const { user, status } = useSession();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "signed-out" || !user) {
      router.replace("/calendar");
      return;
    }
    // already offered on this device → step aside
    if (localStorage.getItem(seenKey(user.id))) {
      router.replace("/calendar");
      return;
    }
    let alive = true;
    void (async () => {
      const [enrolled, key] = await Promise.all([
        refreshEnrollment(),
        getBookKey(),
      ]);
      if (!alive) return;
      // already sealed, or we can't confirm the account isn't — don't nag
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

  const markSeen = () => {
    if (user) localStorage.setItem(seenKey(user.id), "1");
  };

  const seal = () => {
    markSeen();
    router.push("/settings?seal=1");
  };

  const later = () => {
    markSeen();
    router.push("/calendar");
  };

  if (!show) return null;

  return (
    <div className="page-settle">
      <div className="max-w-[32rem]">
        <h1 className="voice-display text-[2rem] leading-[1.05] sm:text-[2.4rem]">
          {copy.welcome.title}
        </h1>
        <p className="voice-prose mt-5 text-[1rem] text-ink-soft">
          {copy.welcome.body}
        </p>
        <div className="mt-8 flex items-center gap-5">
          <PaperButton onClick={seal}>{copy.welcome.seal}</PaperButton>
          <button
            type="button"
            onClick={later}
            className="pressable rounded-[5px] font-serif text-[0.95rem] text-ink-faint hover:text-ink-soft"
          >
            {copy.welcome.later}
          </button>
        </div>
      </div>
    </div>
  );
}
