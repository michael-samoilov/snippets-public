import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import { Em } from "@/components/prose";
import { SectionHeading } from "@/components/section-heading";

/**
 * Markdown → the design system. This is how the policy pages (authored
 * in `.mdx`) get the house voices without the author writing any
 * className: a Markdown heading becomes the small-caps `SectionHeading`,
 * `**bold**` becomes `Em`, a link becomes the underlined style (and an
 * internal `/path` link uses Next's client router), inline `` `code` ``
 * becomes the mono data voice, and a fenced code block becomes the
 * hairline-bordered box. The structured pieces (the glance rows, the
 * provider list, the numbered tests, the deep dive) are in
 * `src/components/policy-mdx.tsx`, imported directly by the `.mdx`.
 *
 * App Router convention: this file lives at the project root and Next
 * merges it into every MDX render.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    // privacy's hero — sized to hold one line even at 360px
    h1: ({ children }) => (
      <h1 className="voice-display text-balance text-[1.25rem] leading-[1.15] sm:text-[2rem] sm:leading-[1.1]">
        {children}
      </h1>
    ),
    // rehype-slug puts an id on every heading, so /verify can deep-link
    h2: ({ children, id }) => <SectionHeading id={id}>{children}</SectionHeading>,
    h3: ({ children, id }) => (
      <h3 id={id} className="voice-label-sm text-ink-soft">
        {children}
      </h3>
    ),
    p: ({ children }) => <p className="voice-prose-sm">{children}</p>,
    strong: ({ children }) => <Em>{children}</Em>,
    a: ({ href, children }) => {
      const to = href ?? "#";
      // internal routes ride the client router; everything else is a plain
      // anchor (external opens a new tab, safely)
      if (to.startsWith("/") || to.startsWith("#"))
        return (
          <Link href={to} className="underline underline-offset-2">
            {children}
          </Link>
        );
      const external = to.startsWith("http");
      return (
        <a
          href={to}
          className="underline underline-offset-2"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {children}
        </a>
      );
    },
    ul: ({ children }) => (
      <ul className="ml-4 list-disc space-y-1.5">{children}</ul>
    ),
    li: ({ children }) => <li className="voice-prose-sm">{children}</li>,
    code: ({ children }) => <span className="voice-data">{children}</span>,
    pre: ({ children }) => (
      <pre className="overflow-x-auto rounded-[7px] border border-rule-faint px-4 py-3 voice-data">
        {children}
      </pre>
    ),
    ...components,
  };
}
