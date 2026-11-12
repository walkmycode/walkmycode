// Serves repos indexed from the command line (`npm run index -- <dir>`)
// out of .walkmycode/, for trying WalkMyCode on a big real codebase without
// picking a folder every time. Local only: it reads this machine's disk.
// Maps written by an older WalkMyCode are upgraded on the way out.
// The list also carries each map's card for the home page (src/lib/mapCard.ts):
// counts only, worked out once per version of the file.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { upgradeMap } from "@/analyzer/migrate";
import { dataDirIn } from "@/lib/dataDir";
import { cardOf, type MapCard } from "@/lib/mapCard";

/** .walkmycode/ in the project, or the old .lantern/ when only that one exists. */
const dir = () => dataDirIn(process.cwd());

/** A map's card, kept until its file changes (a big map is megabytes of JSON). */
const cards = new Map<string, { mtimeMs: number; card: MapCard }>();

async function cardFor(name: string): Promise<MapCard | null> {
  const path = join(dir(), `${name}.map.json`);
  try {
    const { mtimeMs } = await stat(path);
    const hit = cards.get(name);
    if (hit && hit.mtimeMs === mtimeMs) return hit.card;
    const card = cardOf(upgradeMap(JSON.parse(await readFile(path, "utf8")), "cli"), name);
    cards.set(name, { mtimeMs, card });
    return card;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name");
  try {
    if (!name) {
      const names = (await readdir(dir())).filter((f) => f.endsWith(".map.json")).map((f) => f.replace(/\.map\.json$/, ""));
      const found = (await Promise.all(names.map(cardFor))).filter((c): c is MapCard => c !== null);
      return NextResponse.json({ demos: names, cards: found });
    }
    if (!/^[\w.-]+$/.test(name)) return NextResponse.json({ error: "bad name" }, { status: 400 });
    const [raw, files] = await Promise.all([readFile(join(dir(), `${name}.map.json`), "utf8"), readFile(join(dir(), `${name}.files.json`), "utf8")]);
    const map = JSON.stringify(upgradeMap(JSON.parse(raw), "cli"));
    return new Response(`{"map":${map},"files":${files}}`, { headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ demos: [], cards: [] });
  }
}
