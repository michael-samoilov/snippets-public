#!/usr/bin/env python3
"""Score every candidate transcript for a run and aggregate to one result.

Each candidate is spawned with a `description` that starts with its prompt id
(for example "composer-keep-scroll-ios candidate 1"), so this maps a
sub-agent transcript back to its prompt from the sibling `.meta.json` without
manual tracking. It runs score.py per candidate, then means per prompt and
overall, and writes results/<label>.json.

    python3 evals/verify-snippets/aggregate.py --label 2026-08-27-usage \\
        --session-id <SESSION_ID> [--evidence-root /tmp/vs-eval/<run>]

Only transcripts whose description matches a known prompt id are scored, so
unrelated sub-agents (explorers, earlier runs) are skipped.
"""
import argparse
import glob
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SUBROOT = "/root/.claude/projects/-home-user-snippets"


def prompt_ids():
    spec = json.load(open(os.path.join(HERE, "prompts.json")))
    return [p["id"] for p in spec["positive"]] + [p["id"] for p in spec["negative"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True)
    ap.add_argument(
        "--session-id",
        required=True,
        metavar="SESSION_ID",
        help="the orchestrating session's id; its subagent transcripts are scored",
    )
    ap.add_argument("--evidence-root", default="")
    a = ap.parse_args()

    ids = prompt_ids()
    subdir = os.path.join(SUBROOT, a.session_id, "subagents")
    scored = []
    for meta_path in sorted(glob.glob(os.path.join(subdir, "agent-*.meta.json"))):
        meta = json.load(open(meta_path))
        desc = meta.get("description", "")
        pid = next((i for i in ids if desc.startswith(i)), None)
        if not pid:
            continue
        agent_id = os.path.basename(meta_path)[len("agent-"):-len(".meta.json")]
        transcript = os.path.join(subdir, f"agent-{agent_id}.jsonl")
        if not os.path.exists(transcript):
            continue
        cmd = ["python3", os.path.join(HERE, "score.py"), "--prompt-id", pid,
               "--transcript", transcript]
        if a.evidence_root:
            cmd += ["--evidence", os.path.join(a.evidence_root, agent_id)]
        out = subprocess.run(cmd, capture_output=True, text=True)
        if out.returncode != 0:
            print(f"score failed for {agent_id}: {out.stderr}", file=sys.stderr)
            continue
        r = json.loads(out.stdout)
        r["agent_id"] = agent_id
        scored.append(r)

    by_prompt = {}
    for r in scored:
        by_prompt.setdefault(r["prompt_id"], []).append(r["total"])
    per_prompt = {k: round(sum(v) / len(v), 3) for k, v in by_prompt.items()}
    overall = round(sum(r["total"] for r in scored) / len(scored), 3) if scored else None

    result = {"label": a.label, "candidates": len(scored),
              "per_prompt_mean": per_prompt, "overall_mean": overall,
              "detail": scored}
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    path = os.path.join(HERE, "results", f"{a.label}.json")
    json.dump(result, open(path, "w"), indent=2)
    print(json.dumps({"label": a.label, "candidates": len(scored),
                      "per_prompt_mean": per_prompt, "overall_mean": overall}, indent=2))
    print("written:", path)


if __name__ == "__main__":
    main()
