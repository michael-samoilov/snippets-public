"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { KindChips } from "@/components/snippet/kind-chips";
import { updateSnippet } from "@/lib/db";
import { marginDate } from "@/lib/dates";
import type { Snippet, SnippetKind } from "@/lib/types";

export function SnippetEditor({
  snippet,
  open,
  onOpenChange,
}: {
  snippet: Snippet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="float border-none bg-paper-raised sm:max-w-lg">
        {/* the form remounts with the dialog, seeding fresh state each time */}
        <EditorForm snippet={snippet} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({
  snippet,
  close,
}: {
  snippet: Snippet;
  close: () => void;
}) {
  const [title, setTitle] = useState(snippet.title ?? "");
  const [text, setText] = useState(snippet.text);
  const [kind, setKind] = useState<SnippetKind | null>(snippet.kind);
  const [tags, setTags] = useState(snippet.tags.join(", "));
  const [attribution, setAttribution] = useState(snippet.attribution ?? "");

  const save = async () => {
    const trimmedText = text.trim();
    if (!trimmedText) return;
    await updateSnippet(snippet.id, {
      title: title.trim() || undefined,
      text: trimmedText,
      kind,
      tags: tags
        .split(",")
        .map((t) => t.trim().toLowerCase().replace(/^#/, ""))
        .filter(Boolean),
      attribution: attribution.trim() || undefined,
      // a hand-edited entry is filed by its writer — never overwrite
      enriched: "manual",
    });
    close();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="voice-display text-left text-lg">
          Edit entry
        </DialogTitle>
        <DialogDescription className="voice-data text-left">
          {marginDate(new Date(snippet.capturedAt))} ·{" "}
          {snippet.source === "voice" ? "spoken" : "written"}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          aria-label="Title"
          className="border-rule bg-transparent font-serif"
        />
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Entry text"
          rows={5}
          className="voice-prose border-rule bg-transparent"
        />
        <KindChips value={kind} onPick={setKind} label={null} />
        {kind === "quote" && (
          <Input
            value={attribution}
            onChange={(e) => setAttribution(e.target.value)}
            placeholder="Who said it (optional)"
            aria-label="Attribution"
            className="border-rule bg-transparent font-serif"
          />
        )}
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Tags, separated by commas"
          aria-label="Tags"
          className="border-rule bg-transparent font-mono text-xs"
        />
      </div>

      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={close} className="font-serif">
          Cancel
        </Button>
        <Button
          onClick={() => void save()}
          disabled={!text.trim()}
          className="bg-ink font-serif text-paper hover:bg-ink/90"
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
