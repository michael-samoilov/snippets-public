"use client";

/* TEMPORARY dev harness for iterating the wax-stamp press. Not linked
   anywhere; removed before the feature ships. Replays on demand. */

import { useState } from "react";
import { WaxStamp } from "@/components/capture/wax-stamp";

export default function StampLab() {
  const [playKey, setPlayKey] = useState(1);
  const [size, setSize] = useState(180);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="voice-label">wax-stamp lab</h1>
      <div className="grid place-items-center rounded-[10px] border border-rule-faint bg-paper py-16">
        <WaxStamp playKey={playKey} size={size} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-replay
          onClick={() => setPlayKey((n) => n + 1)}
          className="rounded-[5px] bg-ink px-5 py-2 font-serif text-[0.95rem] text-paper"
        >
          Replay
        </button>
        <span className="voice-data">play #{playKey}</span>
        <label className="flex items-center gap-2 text-[0.85rem]">
          <span className="voice-data w-20">size {size}</span>
          <input
            type="range"
            min={48}
            max={240}
            step={4}
            value={size}
            onChange={(e) => setSize(+e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
