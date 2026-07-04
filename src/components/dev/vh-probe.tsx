"use client";

import { useEffect, useState } from "react";

// TEMPORARY, reflow-SAFE viewport probe for the "today zone too tall on load"
// jank. Gated behind ?debug=vh2 so it never shows for normal users.
//
// Why a new one: the old ?debug=vh overlay MASKED the bug because it called
// getBoundingClientRect()/offsetHeight every frame — a layout READ forces iOS to
// re-resolve the viewport units, which is the very thing that "fixes" the too-tall
// shell. So this probe reads ONLY values that never force layout (innerHeight,
// visualViewport, the inline --app-h string) and draws the height units as pure
// CSS hairlines. It cannot mask the bug.
//
// Load  <app>/calendar?debug=vh2  on the phone, let it settle, screenshot.
// Read: which colored line sits at the TRUE bottom of the screen (that unit is
// correct); any line BELOW the fold over-reports. FIRST vs NOW shows whether
// innerHeight changed after first paint (i.e. was wrong at parse).
const MARKER = "vh2-1";

export function VhProbe() {
  const [on, setOn] = useState(false);
  const [firstTxt, setFirstTxt] = useState("");
  const [nowTxt, setNowTxt] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("debug") !== "vh2")
      return;
    setOn(true);

    let raf = 0;
    let captured = false;
    // NB: none of these reads force layout/reflow — that is the whole point.
    const snap = () => {
      const vv = window.visualViewport;
      const appH =
        document.documentElement.style.getPropertyValue("--app-h") || "(unset)";
      return [
        `${MARKER}`,
        `innerH ${window.innerHeight}`,
        `vv.h   ${vv ? Math.round(vv.height) : "-"}  offTop ${vv ? Math.round(vv.offsetTop) : "-"}`,
        `screen ${window.screen.height}  dpr ${window.devicePixelRatio}`,
        `--app-h ${appH}`,
      ].join("\n");
    };
    const tick = () => {
      const s = snap();
      if (!captured) {
        captured = true;
        setFirstTxt("FIRST\n" + s);
      }
      setNowTxt("NOW\n" + s);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!on) return null;

  const line = (expr: string, color: string, label: string, labelLeft: string) => (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        top: `calc(${expr} - 2px)`,
        height: 2,
        background: color,
        zIndex: 99998,
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: labelLeft,
          top: -15,
          color: "#000",
          background: color,
          font: "700 12px/1.25 ui-monospace, monospace",
          padding: "0 4px",
          whiteSpace: "nowrap",
        }}
      >
        {label} {expr}
      </span>
    </div>
  );

  return (
    <>
      {line("100svh", "#ff453a", "svh", "2%")}
      {line("100dvh", "#32d74b", "dvh", "28%")}
      {line("100lvh", "#0a84ff", "lvh", "54%")}
      {line("var(--app-h)", "#ffd60a", "app-h", "80%")}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 99999,
          background: "rgba(0,0,0,0.85)",
          color: "#8dff8d",
          font: "11px/1.35 ui-monospace, SFMono-Regular, monospace",
          padding: "6px 8px",
          whiteSpace: "pre",
          pointerEvents: "none",
          maxWidth: "100vw",
        }}
      >
        {firstTxt}
        {"\n\n"}
        {nowTxt}
      </div>
    </>
  );
}
