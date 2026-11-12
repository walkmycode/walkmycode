// "Any framework" in New project (docs/design/new-project-any.html): the framework's own commands to
// start a project, run one at a time in the new folder after the user has read (and maybe edited) them.
// A curated list of each framework's official create commands, plus "Other" for commands the user
// writes. Shared by the page (to show them) and the server (which checks them again before running).

export interface Framework {
  id: string;
  label: string;
  /** What it needs on the computer, in words. */
  needs: string;
  /** Where the commands come from. */
  source: string;
  /** The commands, run in order in the new (empty) project folder. */
  commands: (name: string, windows: boolean) => string[];
}

const venv = (windows: boolean, tool: string) => (windows ? `.venv\\Scripts\\${tool}` : `.venv/bin/${tool}`);
/** A name as a Python package or Rust crate takes it: letters, digits and underscores. */
const ident = (name: string) => name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");

export const FRAMEWORKS: Framework[] = [
  {
    id: "django",
    label: "Django",
    needs: "Python",
    source: "docs.djangoproject.com (tutorial, part 1)",
    commands: (name, w) => ["python -m venv .venv", `${venv(w, "pip")} install django`, `${venv(w, "django-admin")} startproject ${ident(name)} .`, `${venv(w, "python")} manage.py migrate`],
  },
  {
    id: "rails",
    label: "Ruby on Rails",
    needs: "Ruby",
    source: "guides.rubyonrails.org (getting started)",
    commands: () => ["gem install rails", "rails new . --skip-git"],
  },
  { id: "sveltekit", label: "SvelteKit", needs: "Node.js", source: "svelte.dev/docs/kit (creating a project)", commands: () => ["npx sv create . --template minimal --types ts --no-add-ons --install npm"] },
  { id: "nestjs", label: "NestJS", needs: "Node.js", source: "docs.nestjs.com (first steps)", commands: () => ["npx @nestjs/cli new . --package-manager npm --skip-git"] },
  { id: "astro", label: "Astro", needs: "Node.js", source: "docs.astro.build (install)", commands: () => ["npm create astro@latest . -- --template minimal --install --no-git --yes"] },
  { id: "aspnet", label: "ASP.NET Core", needs: ".NET SDK", source: "learn.microsoft.com (dotnet new webapi)", commands: (name) => [`dotnet new webapi --name ${ident(name)} --output .`] },
  { id: "axum", label: "Axum (Rust)", needs: "Rust (cargo)", source: "docs.rs/axum", commands: (name) => [`cargo init --name ${ident(name).toLowerCase()}`, "cargo add axum", "cargo add tokio --features full"] },
  { id: "gin", label: "Gin (Go)", needs: "Go", source: "gin-gonic.com (quickstart)", commands: (name) => [`go mod init ${name}`, "go get github.com/gin-gonic/gin"] },
  { id: "symfony", label: "Symfony", needs: "PHP and Composer", source: "symfony.com/doc (setup)", commands: () => ["composer create-project symfony/skeleton ."] },
  { id: "other", label: "Other", needs: "whatever its commands use", source: "your own commands", commands: () => [] },
];

export const MAX_COMMANDS = 10;

/**
 * Why these commands won't run, or null. They run in the new project's folder only: no reaching outside
 * it, no running as another user, no piping a download into a shell, nothing that deletes broadly.
 */
export function checkCommands(commands: string[]): string | null {
  const list = commands.map((c) => c.trim()).filter(Boolean);
  if (!list.length) return "Add at least one command.";
  if (list.length > MAX_COMMANDS) return `At most ${MAX_COMMANDS} commands.`;
  for (const c of list) {
    if (c.length > 300) return `Too long: ${c.slice(0, 40)}…`;
    if (/(^|[\s;&|])(sudo|su|runas|doas)\s/i.test(c)) return `Runs as another user: ${c}`;
    if (/\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b/i.test(c)) return `Downloads with ${c.split(/\s/)[0]}: use the framework's own tool instead.`;
    if (/\|\s*(sh|bash|zsh|iex|invoke-expression|powershell|pwsh|cmd)\b/i.test(c)) return `Pipes into a shell: ${c}`;
    if (/\brm\s+-[a-z]*r|\b(rmdir|rd|del|format|shutdown|reg|diskpart)\b/i.test(c)) return `Deletes or changes the system: ${c}`;
    if (/(^|[\s"'=])(\.\.([\\/]|$)|[A-Za-z]:[\\/]|[\\/]|~)/.test(c.replace(/\.venv[\\/]/g, ""))) return `Reaches outside the project folder: ${c}`;
  }
  return null;
}
