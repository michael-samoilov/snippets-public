// The policy content files (src/app/*/content.mdx) export a `updated` date
// constant alongside the default MDX component. `@types/mdx` types `*.mdx`
// with only a default export; this ambient declaration merges the named
// export in, so `import Content, { updated } from "./content.mdx"` type-checks.
// (Files without the export simply never import it — an unused ambient member
// is harmless.)
declare module "*.mdx" {
  export const updated: string;
}
