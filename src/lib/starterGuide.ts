// The guide's welcome for a project WalkMyCode just made (src/components/Guide.tsx):
// what it is, where things live in that framework, and first things to ask;
// and, when the user said what it should do, the one request that builds it.

export interface StarterGuide {
  /** One sentence after "This is <name>, ". */
  what: string;
  /** Where to look: folder or file, and what it holds. */
  where: [string, string][];
  /** Questions or asks to offer as buttons. */
  asks: string[];
}

export const STARTER_GUIDE: Record<string, StarterGuide> = {
  laravel: {
    what: "a brand-new Laravel app: PHP on the server, a SQLite database already migrated, and Vite for the front end.",
    where: [
      ["routes/web.php", "the pages: each URL and what answers it"],
      ["app/Models", "your data, one class per table"],
      ["database/migrations", "the tables, as code"],
      ["resources/views", "the HTML (Blade templates)"],
    ],
    asks: ["Add a todo list: a page to add, tick off and delete tasks, saved in SQLite", "Walk me through what happens when someone opens the home page", "How do I add a new table?"],
  },
  next: {
    what: "a brand-new Next.js app with the App Router, TypeScript and Tailwind.",
    where: [
      ["src/app/page.tsx", "the home page"],
      ["src/app/layout.tsx", "what wraps every page"],
      ["src/app", "one folder per URL"],
    ],
    asks: ["Add a todo list page that keeps tasks in the browser", "How does a page get its data in the App Router?", "Add an API route that returns JSON"],
  },
  "vite-react": {
    what: "a brand-new React front end in TypeScript, built and served by Vite.",
    where: [
      ["src/App.tsx", "the app's first component"],
      ["src/main.tsx", "where React starts"],
      ["index.html", "the page Vite serves"],
    ],
    asks: ["Add a todo list component with add, tick and delete", "How does state work in React here?", "Split App.tsx into smaller components"],
  },
  fastapi: {
    what: "a brand-new FastAPI service in Python, with one route and a virtual environment set up.",
    where: [
      ["main.py", "the app and its routes"],
      ["requirements.txt", "the packages it needs"],
    ],
    asks: ["Add a todo API: list, add, complete and delete tasks", "How do I run it and try the route?", "Add a SQLite database with SQLModel"],
  },
  express: {
    what: "a brand-new Express server in Node.js, with one route.",
    where: [
      ["index.js", "the server and its routes"],
      ["package.json", "its packages and scripts"],
    ],
    asks: ["Add a todo API: list, add, complete and delete tasks", "How do I run it and call the route?", "Serve a small HTML page that uses the API"],
  },
};

/** Long enough for a paragraph of what it should do; short enough to stay one request. */
export const BRIEF_MAX = 600;

/** The form's "What should it do?", tidied to one line ("" when left empty). */
export function cleanBrief(brief: string | undefined): string {
  return (brief ?? "").replace(/\s+/g, " ").trim().slice(0, BRIEF_MAX).trim();
}

/**
 * "Build it": what the guide is asked, through whichever AI is set up. It names
 * the framework so the answer follows its conventions, and asks for the files
 * to be written (not just described) and how to run the result.
 */
export function buildItAsk(label: string, brief: string): string {
  const what = cleanBrief(brief).replace(/[\s.!;,]+$/, "");
  return `Build this in the new ${label} project: ${what}. Follow the framework's conventions, write the files, and tell me how to run it.`;
}
