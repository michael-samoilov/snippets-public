import fs from "node:fs";
import path from "node:path";
import Link from "next/link";

/**
 * Menu of the lab tools — a directory of everything under /lab, nested by folder.
 * Built by scanning the routes at build time (add a lab page, it appears here).
 * Gated to non-production by src/proxy.ts, so this only shows on local dev and
 * preview deploys.
 */
export const dynamic = "force-static";

interface Node {
  name: string;
  href: string;
  hasPage: boolean;
  children: Node[];
}

function scan(dirAbs: string, hrefBase: string): Node[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("(") && !e.name.startsWith("_"))
    .map((e) => {
      const abs = path.join(dirAbs, e.name);
      const href = `${hrefBase}/${e.name}`;
      const hasPage =
        fs.existsSync(path.join(abs, "page.tsx")) || fs.existsSync(path.join(abs, "page.jsx"));
      return { name: e.name, href, hasPage, children: scan(abs, href) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const LAB = scan(path.join(process.cwd(), "src/app/(dev)/lab"), "/lab");

function List({ nodes }: { nodes: Node[] }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
      {nodes.map((n) => (
        <li key={n.href}>
          {n.hasPage ? (
            <Link href={n.href} style={{ color: "#1e3a5f", textDecoration: "none", fontWeight: 600 }}>
              {n.name}
            </Link>
          ) : (
            <span style={{ color: "#6f6553" }}>{n.name}/</span>
          )}
          {n.children.length > 0 && <List nodes={n.children} />}
        </li>
      ))}
    </ul>
  );
}

export default function LabMenu() {
  return (
    <div style={{ minHeight: "100vh", background: "#e8dcc2", color: "#241e15", padding: 24, fontFamily: "ui-monospace, monospace" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>lab</h1>
        <p style={{ color: "#6f6553", fontSize: 13, marginBottom: 20 }}>
          Build-time tools. Not shipped to production — this menu and every page under it 404 on
          the production domain (src/proxy.ts); reach them on a preview deploy.
        </p>
        <List nodes={LAB} />
      </div>
    </div>
  );
}
