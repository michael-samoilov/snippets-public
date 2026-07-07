import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // drizzle-kit generate works offline; migrate needs the real URL
    url: process.env.DATABASE_URL ?? "postgres://localhost/snippets",
  },
});
