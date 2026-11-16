// The drawing a file wears in Files (src/components/FileTree.tsx; mockup docs/design/files-icons.html): one
// from the analogy scenes' set (src/lib/drawings), found by what the file is before its extension. A
// Dockerfile is the container, a workflow the CI conveyor, a test the checklist, a lock file the chain,
// README the book, LICENSE the certificate, .env the padlock. Code is one drawing in its language's colour
// (Rust orange, TypeScript blue…), so no language's logo is borrowed. Folders with a job wear that job's
// drawing; the rest are the folder. Pure: names and colours only, no drawings, so it costs nothing to load.

/** A drawing's name from the set, its colour when it is not the drawing's own, and what the file is. */
export type FileIcon = { name: string; tint?: string; what: string };

/** Each language's name and colour, by extension. */
export const LANGUAGES: Readonly<Record<string, readonly [string, string]>> = {
  rs: ["Rust", "#f0a94b"], ts: ["TypeScript", "#7fbfe6"], tsx: ["TypeScript", "#7fbfe6"], mts: ["TypeScript", "#7fbfe6"], cts: ["TypeScript", "#7fbfe6"],
  js: ["JavaScript", "#f3d77a"], jsx: ["JavaScript", "#f3d77a"], mjs: ["JavaScript", "#f3d77a"], cjs: ["JavaScript", "#f3d77a"],
  py: ["Python", "#6aa5c9"], go: ["Go", "#63c2a2"], java: ["Java", "#e07f73"], kt: ["Kotlin", "#b79cf0"], kts: ["Kotlin", "#b79cf0"], scala: ["Scala", "#e0564f"],
  cs: ["C#", "#9a7fe0"], fs: ["F#", "#63c2a2"], c: ["C", "#8e929c"], h: ["C", "#8e929c"], cc: ["C++", "#5f86b3"], cpp: ["C++", "#5f86b3"], hpp: ["C++", "#5f86b3"],
  rb: ["Ruby", "#e0564f"], php: ["PHP", "#8d6bc7"], swift: ["Swift", "#f0844b"], dart: ["Dart", "#4fb3d9"], lua: ["Lua", "#5f86b3"], ex: ["Elixir", "#8d6bc7"], exs: ["Elixir", "#8d6bc7"],
  erl: ["Erlang", "#c4566b"], hs: ["Haskell", "#8d6bc7"], clj: ["Clojure", "#7fd08a"], r: ["R", "#6aa5c9"], jl: ["Julia", "#9a7fe0"], zig: ["Zig", "#f0a94b"], nim: ["Nim", "#f3d77a"],
  vue: ["Vue", "#7fd08a"], svelte: ["Svelte", "#f0844b"], astro: ["Astro", "#e07f73"], m: ["Objective-C", "#6aa5c9"], mm: ["Objective-C++", "#6aa5c9"], prisma: ["Prisma", "#5f86b3"], twig: ["Twig", "#7fd08a"],
};

/** By extension, after a file's name and folder have had their say. */
const BY_EXT: readonly [readonly string[], string, string][] = [
  [["html", "htm"], "browser", "A web page"],
  [["css", "scss", "sass", "less"], "palette", "Styles: colours and layout"],
  [["json", "jsonc", "json5"], "json", "Data, as JSON"],
  [["yml", "yaml", "toml", "ini", "cfg", "conf", "xml", "properties"], "gear", "Settings"],
  [["md", "mdx", "markdown", "txt", "rst", "adoc", "pdf"], "page", "Writing: notes and docs"],
  [["sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd"], "terminal", "A script you run in a terminal"],
  [["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp", "tif", "tiff", "mp4", "mov", "webm", "mkv"], "camera", "An image or a video"],
  [["mp3", "wav", "ogg", "flac", "m4a"], "music", "A sound"],
  [["csv", "tsv", "xlsx", "xls", "parquet"], "barchart", "A table of data"],
  [["log"], "logs", "A log of what happened"],
  [["ttf", "otf", "woff", "woff2"], "pencil", "A font"],
  [["zip", "tar", "gz", "tgz", "7z", "rar", "bz2", "xz"], "box", "An archive"],
  [["proto", "graphql", "gql"], "api", "An API's contract"],
  [["ipynb"], "linechart", "A notebook of experiments"],
  [["wasm", "exe", "dll", "so", "dylib", "bin", "o", "class", "jar"], "chip", "A compiled program"],
];

const MANIFESTS = new Set(["package.json", "cargo.toml", "pyproject.toml", "go.mod", "requirements.txt", "pipfile", "gemfile", "composer.json", "pom.xml", "build.gradle", "build.gradle.kts", "setup.py", "setup.cfg", "pubspec.yaml", "mix.exs", "deno.json"]);
const TEST_DIRS = new Set(["tests", "test", "__tests__", "spec", "specs", "e2e"]);

/** The drawing for a file, by what it is: its name and folder first, then its extension; else the page. */
export function fileIcon(path: string): FileIcon {
  const parts = path.toLowerCase().split("/");
  const name = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (/^(dockerfile|containerfile)(\..+)?$|\.dockerfile$|^(docker-)?compose(\.[a-z0-9-]+)?\.ya?ml$/.test(name)) return { name: "container", what: "Packs the app into a container" };
  if (dirs.includes("workflows") || name === ".gitlab-ci.yml" || name === "jenkinsfile" || name === "azure-pipelines.yml" || name === ".travis.yml") return { name: "conveyor", what: "A CI pipeline: builds and tests every change" };
  if (/(^|[._-])(test|spec)s?\.[a-z0-9]+$|_test\.[a-z0-9]+$|^test_.+\.py$/.test(name) || dirs.some((d) => TEST_DIRS.has(d))) return { name: "checklist", what: "Tests: checks the code does what it should" };
  if (/\.lock$|-lock\.(json|ya?ml)$|^go\.sum$|^npm-shrinkwrap\.json$/.test(name)) return { name: "chain", what: "Pins every dependency to an exact version" };
  if (MANIFESTS.has(name) || ext === "csproj" || ext === "fsproj" || ext === "gemspec") return { name: "package", what: "Lists the packages the project needs" };
  if (/^readme([.-]|$)/.test(name)) return { name: "book", what: "The project's front page" };
  if (/^(license|licence|copying|notice)([.-]|$)/.test(name)) return { name: "certificate", what: "Who may use the code, and how" };
  if (/^(changelog|changes|history|releases)([.-]|$)/.test(name)) return { name: "tag", what: "What changed in each version" };
  if (/^\.git(ignore|attributes|modules|keep)$|^\.dockerignore$|^\.npmignore$/.test(name)) return { name: "branch", what: "What git (or a build) leaves out" };
  if (/^\.env(\.|$)|\.(pem|key|p12|pfx|jks|keystore)$|(^|[._-])secrets?([._-]|$)/.test(name)) return { name: "padlock", what: "Secrets: WalkMyCode never shows a real one" };
  if (/^(makefile|gnumakefile|justfile|taskfile\.ya?ml|rakefile|procfile)$/.test(name)) return { name: "toolbox", what: "Shortcuts for the jobs you run often" };
  if (name === "nginx.conf" || name === "caddyfile" || name === "haproxy.cfg" || dirs.includes("nginx")) return { name: "router", what: "Routes web traffic to the app" };
  if (dirs.includes("migrations") || ext === "sql" || ext === "sqlite" || ext === "db") return { name: "database", what: "The database: its tables and data" };
  const lang = LANGUAGES[ext];
  if (lang) return { name: "code", tint: lang[1], what: `${lang[0]} code` };
  for (const [exts, drawing, what] of BY_EXT) if (exts.includes(ext)) return { name: drawing, what };
  return { name: "page", what: "A file" };
}

const FOLDERS: Readonly<Record<string, readonly [string, string]>> = {
  tests: ["checklist", "Tests"], test: ["checklist", "Tests"], __tests__: ["checklist", "Tests"], spec: ["checklist", "Tests"], e2e: ["checklist", "Tests"],
  docs: ["book", "The docs"], doc: ["book", "The docs"], scripts: ["terminal", "Scripts"], bin: ["terminal", "Scripts"],
  migrations: ["database", "Database migrations"], public: ["palette", "Files served as they are"], assets: ["palette", "Images and other assets"], static: ["palette", "Files served as they are"],
  workflows: ["conveyor", "CI pipelines"], logs: ["logs", "Logs"], config: ["gear", "Settings"], ".vscode": ["gear", "Editor settings"],
};

/** The drawing for a folder: its job's, when its name says it has one; else the folder. */
export function folderIcon(name: string): FileIcon {
  const job = FOLDERS[name.toLowerCase()];
  return job ? { name: job[0], what: job[1] } : { name: "folder", what: "A folder" };
}
