// The example app on the home page ("Try with an example app"): examples/team-tasks,
// packed as one JSON file in public/examples/, which every build serves next to the
// page (the app at /examples/…, WalkMyCode Lite beside its index.html). The page maps
// it in the browser like any folder, so the map is always made by the analyzer it
// ships with. The starter tour is written here against the example's own lines: each
// step names the line it starts at by its text, so editing the example cannot leave a
// step pointing at the wrong lines (a step whose text is gone fails the build).
//
//   node scripts/pack-example.mjs        (run by `npm run build`, `build:lite` and `dev`)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const NAME = "team-tasks";
const SRC = join("examples", NAME);
const OUT = join("public", "examples", `${NAME}.json`);

/** The starter tour: how "Add task" reaches the database, and the email it sends. */
const TOUR = {
  title: "How adding a task works",
  steps: [
    { file: "components/NewTaskForm.tsx", from: "async function add", to: "onAdded();", say: "It starts on the project page. You type a title and press Add task, and this function sends it to the server: a POST request to /api/projects/<id>/tasks, with the title inside." },
    { file: "app/api/projects/[id]/tasks/route.ts", from: "export async function POST", to: "}", say: "The server's route answers that request. It checks you're signed in, checks the title, then asks the task logic to create the task." },
    { file: "lib/validate.ts", from: "export const newTask", to: "});", say: "The check itself: a title must be there and not too long. Anything else gets a friendly error instead of reaching the database." },
    { file: "lib/tasks.ts", from: "export async function createTask", to: "return task;", say: "Here the task is written to the database with Prisma. If someone was given the task, they get an email." },
    { file: "lib/email.ts", from: "export async function sendAssignedEmail", to: "});", say: "The email goes out through Resend, an outside service, using a key from the settings. Without the key, nothing is sent." },
    { file: "prisma/schema.prisma", from: "model Task {", to: "}", say: "And this is the table the task lands in: its title, whether it's done, its project and who it's for." },
  ],
};

function walk(dir) {
  const out = [];
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(SRC).map((p) => ({ path: relative(SRC, p).replaceAll("\\", "/"), content: readFileSync(p, "utf8").replace(/\r\n/g, "\n") }));
const byPath = new Map(files.map((f) => [f.path, f.content]));

const steps = TOUR.steps.map((s) => {
  const lines = byPath.get(s.file)?.split("\n");
  if (!lines) throw new Error(`pack-example: the tour names ${s.file}, which the example does not have`);
  const start = lines.findIndex((l) => l.includes(s.from));
  if (start < 0) throw new Error(`pack-example: "${s.from}" is not in ${s.file}`);
  let end = start;
  while (end < lines.length - 1 && lines[end].trim() !== s.to && !(end > start && lines[end].includes(s.to) && s.to.length > 2)) end++;
  return { say: s.say, file: s.file, start_line: start + 1, end_line: end + 1, node_ids: [] };
});

const body = JSON.stringify({ v: 1, name: NAME, title: "Team Tasks", about: "A small Next.js app: pages, an API and a Postgres database.", files, tour: { title: TOUR.title, steps } });
mkdirSync(join("public", "examples"), { recursive: true });
writeFileSync(OUT, body);
console.log(`pack-example: ${OUT} (${files.length} files, ${(body.length / 1024).toFixed(1)} KB, a ${steps.length}-step tour)`);
