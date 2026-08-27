#!/usr/bin/env python3
"""Objective-first scorer for the verify-snippets eval.

Score ONE candidate from its sub-agent transcript and its EVIDENCE_DIR. Most
criteria are mechanical (did it discover the skill, run a real lane, pick the
right lane, stay in scope, not over-trigger). One slice is a keyword heuristic
over the final report (honest scoping); a model-judge hook is left for when an
independent judge is configured. No model is called here, so the loop can
hillclimb the objective numbers without one.

    python3 score.py --prompt-id composer-keep-scroll-ios \\
        --transcript /root/.claude/projects/-home-user-snippets/<sid>/subagents/agent-<id>.jsonl \\
        --evidence /tmp/verify-snippets-eval/<run>/<cand> \\
        [--worktree /path/to/candidate/worktree] [--report report.txt]

Prints a JSON object: {prompt_id, mode, criteria:{...0..1}, total:0..1, notes}.
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# lane category -> (script-name substrings, evidence subdirs, a stdout verdict regex)
LANES = {
    "memory": (["cdp_memory.py"], ["cdp-memory"], r"(PASS|FAIL) — |no unbounded growth|LEAK"),
    "frames": (["cdp_frames.py"], ["cdp-frames"], r"(PASS|FAIL) — |long task|report-only"),
    "webkit": (["webkit_wheel_scroll.py", "webkit_session.py", "measure-webkit-spans.py"],
               ["webkit-wheel", "webkit-session", "webkit"],
               r"PASS:|scrolled the book|rose_to_month|days_rendered|sections"),
    "persona": (["personas.py", "ios_pwa_page", "ios_safari_page", "chrome_ios_page",
                 "android_chrome_page"], [], r"doctor: OK|PASS  |stubs hold"),
    "gecko": (["firefox_gecko.py"], ["firefox-gecko"], r'"engine":\s*"gecko"|PASS|days_rendered'),
    "device": (["appium_scroll.py"], ["device"], r"PASS|momentum"),
}
SKILL_SCRIPTS = [s for (subs, _, _) in LANES.values() for s in subs]
SKILL_MD = ".claude/skills/verify-snippets/SKILL.md"
SKILL_DIR = ".claude/skills/verify-snippets/"
OVERCLAIM = re.compile(r"(verified|confirmed|works?|pass(?:es|ed)?)[^.]{0,40}"
                       r"(iphone|ios|60\s?fps|momentum)", re.I)
HEDGE = re.compile(r"can(?:not|'t)|device[- ]only|on[- ]device|manual|not verifiable|"
                   r"headless|blink|webkitgtk|unverified", re.I)


def load_prompt(prompt_id):
    spec = json.load(open(os.path.join(HERE, "prompts.json")))
    for p in spec["positive"]:
        if p["id"] == prompt_id:
            return "positive", p
    for p in spec["negative"]:
        if p["id"] == prompt_id:
            return "negative", p
    sys.exit(f"unknown prompt id: {prompt_id}")


def parse_transcript(path):
    """Return (read_paths, bash_commands, tool_result_texts, final_report)."""
    reads, cmds, results, texts = [], [], [], []
    if not path or not os.path.exists(path):
        return reads, cmds, results, texts, ""
    for line in open(path):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        blocks = []
        msg = obj.get("message")
        if isinstance(msg, dict) and isinstance(msg.get("content"), list):
            blocks = msg["content"]
        elif obj.get("type") in ("tool_use", "tool_result", "text"):
            blocks = [obj]
        for b in blocks:
            if not isinstance(b, dict):
                continue
            t = b.get("type")
            if t == "tool_use":
                name, inp = b.get("name"), b.get("input", {}) or {}
                if name == "Read" and inp.get("file_path"):
                    reads.append(inp["file_path"])
                elif name == "Bash" and inp.get("command"):
                    cmds.append(inp["command"])
            elif t == "tool_result":
                c = b.get("content")
                results.append(c if isinstance(c, str)
                               else " ".join(x.get("text", "") for x in c if isinstance(x, dict))
                               if isinstance(c, list) else "")
            elif t == "text" and b.get("text", "").strip():
                texts.append(b["text"])
    return reads, cmds, results, texts, (texts[-1] if texts else "")


def lane_ran(cat, cmds, reads, results, report, evidence):
    subs, subdirs, verdict = LANES[cat]
    ran_text = " ".join(cmds) + " " + " ".join(reads)
    invoked = any(s in ran_text for s in subs)
    if cat == "persona":
        # personas are used by IMPORT, not a CLI, so there is no verdict line
        # or evidence dir. Naming one in the run or the report is the signal.
        return invoked or any(s in report for s in subs)
    if not invoked:
        return False
    saw_verdict = any(re.search(verdict, r) for r in results)
    have_evidence = any(evidence and os.path.isdir(os.path.join(evidence, d)) and os.listdir(os.path.join(evidence, d))
                        for d in subdirs)
    return saw_verdict or have_evidence


def score(prompt_id, transcript, evidence, worktree, report_override):
    mode, spec = load_prompt(prompt_id)
    reads, cmds, results, _, final = parse_transcript(transcript)
    if report_override:
        final = open(report_override).read()

    evidence_written = bool(evidence and os.path.isdir(evidence) and os.listdir(evidence))
    ran = {cat for cat in LANES if lane_ran(cat, cmds, reads, results, final, evidence)}
    discovered = int(any(SKILL_DIR in r for r in reads)
                     or any(s in c for c in cmds for s in SKILL_SCRIPTS)
                     or bool(ran)
                     or evidence_written)

    def in_scope():
        if not worktree:
            return 1.0
        out = subprocess.run(["git", "-C", worktree, "status", "--porcelain", "src"],
                             capture_output=True, text=True).stdout.strip()
        return 1.0 if not out else 0.0

    notes = {"ran_lanes": sorted(ran), "reads_skill_md": any(r.endswith(SKILL_MD) for r in reads)}

    if mode == "negative":
        not_over = int(not ran and not evidence_written)
        criteria = {"not_over_triggered": not_over, "in_scope": in_scope()}
        total = 0.8 * criteria["not_over_triggered"] + 0.2 * criteria["in_scope"]
        return {"prompt_id": prompt_id, "mode": mode, "criteria": criteria,
                "total": round(total, 3), "notes": notes}

    expected = set(spec["expected_lanes"])
    executed = 1.0 if (ran & expected) else 0.0
    right_lane = round(len(ran & expected) / len(expected), 3) if expected else 0.0
    caveats = spec.get("must_scope_device_only", [])
    named = sum(1 for k in caveats if k.lower() in final.lower())
    scoping = named / len(caveats) if caveats else 1.0
    if OVERCLAIM.search(final) and not HEDGE.search(final):
        scoping *= 0.3            # unqualified iOS/60fps claim from a sandbox run
    scoping = round(scoping, 3)

    criteria = {"discovered": discovered, "executed": executed, "right_lane": right_lane,
                "in_scope": in_scope(), "honest_scoping": scoping}
    total = (0.15 * criteria["discovered"] + 0.25 * criteria["executed"]
             + 0.20 * criteria["right_lane"] + 0.15 * criteria["in_scope"]
             + 0.25 * criteria["honest_scoping"])
    notes["judge_hook"] = "honest_scoping is a heuristic; swap a model judge here when one is independent"
    return {"prompt_id": prompt_id, "mode": mode, "criteria": criteria,
            "total": round(total, 3), "notes": notes}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt-id", required=True)
    ap.add_argument("--transcript", default="")
    ap.add_argument("--evidence", default="")
    ap.add_argument("--worktree", default="")
    ap.add_argument("--report", default="")
    a = ap.parse_args()
    print(json.dumps(score(a.prompt_id, a.transcript, a.evidence, a.worktree, a.report), indent=2))
