import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { KINDS } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Files a captured snippet: suggests a title, kind, tags, and (for quotes)
 * an attribution. The user's chosen model: Haiku — fast and pennies/month.
 * Without ANTHROPIC_API_KEY this returns 503 and the client falls back to
 * heuristics + manual chips.
 */

const MODEL = process.env.ENRICH_MODEL ?? "claude-haiku-4-5";

const RequestSchema = z.object({
  text: z.string().min(1).max(20_000),
});

const EnrichmentSchema = z.object({
  title: z
    .string()
    .describe("A short evocative title, at most six words, no quotation marks"),
  kind: z.enum(KINDS),
  tags: z
    .array(z.string())
    .describe("1-3 lowercase topical tags, single words or short hyphenated phrases"),
  attribution: z
    .string()
    .nullable()
    .describe("For quotes only: who said or wrote it, if stated. Otherwise null."),
});

const SYSTEM = `You file entries in a personal commonplace book — a private collection of storyworthy moments, jokes, quotes, and stray thoughts captured throughout someone's day, often by voice.

Classify each entry as exactly one kind:
- story: a lived moment with people, places, or events — something that could be told aloud
- joke: something said or written to get a laugh — bits, puns, funny exchanges
- quote: someone else's words the writer wants to keep (books, friends, overheard)
- idea: something to make, try, write, or think more about
- phrase: a word, idiom, or turn of phrase kept for the language itself
- observation: something noticed and described plainly, without narrative

Titles should sound like the writer's own shorthand — concrete and particular, never generic ("Coffee with Marisol", not "A nice moment"). Never use the word "snippet". Tags are topical, lowercase, at most three; prefer fewer, better tags. Attribution only when the entry is a quote and the source is evident from the text; otherwise null. Voice transcripts may have transcription errors — interpret charitably, but never invent details that are not there.`;

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "enrichment_unconfigured" },
      { status: 503 },
    );
  }

  let text: string;
  try {
    const body = RequestSchema.parse(await request.json());
    text = body.text;
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const client = new Anthropic();
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: text }],
      output_config: {
        format: zodOutputFormat(EnrichmentSchema),
      },
    });

    if (!response.parsed_output) {
      return Response.json({ error: "unparseable" }, { status: 502 });
    }

    const { title, kind, tags, attribution } = response.parsed_output;
    return Response.json({
      title,
      kind,
      tags: tags.slice(0, 3).map((t) => t.toLowerCase().trim()).filter(Boolean),
      ...(attribution ? { attribution } : {}),
    });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      const status = error.status === 429 ? 429 : 502;
      return Response.json({ error: "enrichment_failed" }, { status });
    }
    return Response.json({ error: "enrichment_failed" }, { status: 502 });
  }
}
