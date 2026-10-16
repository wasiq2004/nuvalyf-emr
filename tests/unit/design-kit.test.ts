// Guards a quiet failure mode: a server component that imports a plain value
// (a class string, a constant) from a "use client" module receives a client
// reference instead of the value, so styles silently vanish. Components
// (PascalCase) are fine to import; anything else must come from a module
// without "use client" (e.g. components/app/styles.ts).
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(entry.name) ? [full] : [];
  });
}

const isClientModule = (source: string) => /^\s*["']use client["']/.test(source);

function resolveImport(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  const base = path.join(ROOT, specifier.slice(2));
  for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

describe("server/client boundary", () => {
  it("server files import only components from client modules", () => {
    const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))];
    const problems: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      if (isClientModule(source)) continue;
      for (const match of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)) {
        const target = resolveImport(match[2]);
        if (!target || !isClientModule(fs.readFileSync(target, "utf8"))) continue;
        const names = match[1]
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n && !n.startsWith("type "));
        for (const name of names) {
          const local = name.split(/\s+as\s+/)[0];
          if (!/^[A-Z]/.test(local)) problems.push(`${path.relative(ROOT, file)} imports "${local}" from client module ${match[2]}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
