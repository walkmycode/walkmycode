// What one file tells us, before anything is matched across files. The
// extractors produce these; build.ts turns them into the map.

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ANY";

export interface ImportFact {
  /** Module specifier as written: "./lib/api", "../core", "stripe", "..core.hosted". */
  spec: string;
  /** Local binding names → exported name ("*" for namespace, "default"). */
  names: { local: string; imported: string }[];
  line: number;
}

export interface FnFact {
  name: string;
  start: number;
  end: number;
  /** Callee names inside the body: "foo" or "obj.prop". */
  calls: string[];
  exported: boolean;
}

export interface RouteFact {
  method: Method;
  path: string;
  line: number;
  endLine: number;
  handler?: string;
  /** Variable the route hangs off (`router`, `app`) — for prefixes. */
  owner?: string;
  /** PHP (Laravel): the controller method that answers, as the route names it: the class
   * fully qualified, and `legacy` for a 'TodoController@index' string (no import says which class). */
  controller?: { cls: string; method: string; legacy?: boolean };
  /** PHP (Laravel): the route's own name, `->name('todos.index')`. */
  name?: string;
}

/** PHP: a class (or interface, trait, enum) a file declares; names fully qualified. */
export interface PhpClassFact {
  fqn: string;
  /** The class it extends, fully qualified, when it extends one. */
  extends?: string;
  line: number;
  end: number;
  /** An Eloquent model's own `protected $table = 'x'`; a Doctrine entity's table (`#[ORM\Table(name: 'x')]`, else its snake-cased name). */
  table?: { name: string; line: number };
  /** Doctrine: an entity (`#[ORM\Entity]`), and the repository class it names. */
  entity?: { repository?: string };
  /** Doctrine: a repository's entity (`parent::__construct($registry, Todo::class)`). */
  entityOf?: string;
  methods: { name: string; start: number; end: number }[];
}

/** PHP: what a file's code does, kept for linkPhp (extract/php.ts) to settle across files. */
export interface PhpFacts {
  namespace?: string;
  classes: PhpClassFact[];
  /** Calls on a class that may be an Eloquent model: `Todo::all()`, `$todo->save()` on a
   * typed `Todo $todo`. Only a class that turns out to be a model becomes a table. */
  modelUses: { cls: string; op: "read" | "write"; line: number }[];
  /** `view('todos.index')`, `Route::view('/', 'welcome')`, `Inertia::render('Todos/Index')`; Symfony's
   * `$this->render('todo/index.html.twig')` names a Twig template. */
  views: { name: string; line: number; inertia?: boolean }[];
  /** Blade: a form's action or a link's href that is one of the app's own routes, by its name
   * (`route('todos.store')`) or its path (`/todos`, `url('/todos')`; `*` for each `{{ }}` piece).
   * `method` is the form's, `@method('DELETE')` winning; GET for a link. */
  requests?: { element: "form" | "a"; method: Method; name?: string; path?: string; label?: string; line: number }[];
  /** Blade (Livewire): `wire:click="save"`, `wire:submit.prevent="add"`: the component method it runs. */
  wires?: { event: string; method: string; line: number }[];
}

export interface IncludeFact {
  /** `audio.router`, `router`, `usersRouter` — resolved later. */
  target: string;
  prefix: string;
  line: number;
}

export interface HttpCallFact {
  /** Path or URL with `*` for each interpolated piece. */
  url: string;
  method?: Method;
  line: number;
  callee: string;
  /** True when the URL began with a variable (base URL) — a guess. */
  fromVariable: boolean;
  /** "USERS_URL" when the URL starts with an env read, or a module constant bound to one. */
  varName?: string;
  /** "http://users:8080" when it starts with a module constant bound to a literal. */
  literalBase?: string;
  /** `env.USERS.fetch(...)`: the Cloudflare service binding the request goes through. */
  binding?: string;
  /** "getApiBaseUrl" when the URL starts with a call (`${getApiBaseUrl()}/x`): build.ts
   * follows it to the setting that function reads, for "Where does this point?". */
  baseCall?: string;
  /** "API_BASE" when the URL starts with a name this file does not bind (an imported constant). */
  baseIdent?: string;
}

export interface ChannelFact {
  channel: string;
  op: "publish" | "consume";
  tech: "kafka" | "rabbitmq" | "sqs" | "sns" | "nats" | "redis" | "bullmq" | "celery";
  line: number;
  /** True when the channel name is a string literal. */
  literal: boolean;
  /** The env setting the name comes from (an SQS queue URL in QUEUE_URL): resolved against config in build.ts. */
  varName?: string;
  /** Celery: the task this message runs (task and queue names are never conflated). */
  task?: string;
  /** Celery send_task("module.task"): the task is named, not imported, so it is kept even when no module defines it. */
  sendTask?: boolean;
}

export interface RpcFact {
  service: string;
  role: "implements" | "calls";
  host?: string;
  line: number;
}

export interface EnvReadFact {
  name: string;
  line: number;
}

/** A module-level constant: `const BASE = process.env.X ?? "http://…"`,
 * `BASE = os.getenv("X", "…")`. Either side may be missing. */
export interface ConstFact {
  envVar?: string;
  literal?: string;
  line: number;
}

/** Dart: a base URL a file gives an HTTP client (`Dio(BaseOptions(baseUrl: X))`), as an
 * env setting and/or a literal, or the name of a constant defined in another file. */
export interface ClientBaseFact {
  envVar?: string;
  literal?: string;
  ref?: string;
  line: number;
}

/** Dart: a screen a router shows (`GoRoute(path: '/x', builder: ... => XScreen())`).
 * `path` may hold `{Routes.x}`, a constant defined in another file. */
export interface ScreenFact {
  path: string;
  widget: string;
  line: number;
}

/** A table's columns, as the code that creates it writes them: CREATE TABLE, a Prisma model, an ORM
 * class, a Laravel migration. `type` is as written there ("VARCHAR(255)", "string", "Int?"). */
export interface ColumnsFact {
  table: string;
  columns: { name: string; type?: string }[];
  line: number;
}

export interface SqlFact {
  table: string;
  op: "read" | "write" | "define";
  line: number;
}

export interface ServiceFact {
  service: string;
  line: number;
  /** "sdk" | "host" | "env" — env is only a hint. */
  via: "sdk" | "host" | "env";
  text: string;
}

export interface TriggerFact {
  /** The JSX element that fires a handler: `button`, `form`, `a`. */
  element: string;
  label?: string;
  /** Handler function name, or "inline" when the handler is an arrow. */
  handler: string;
  line: number;
  /** Line range of the inline handler, so calls within are attributed. */
  range?: [number, number];
}

export interface FileFacts {
  imports: ImportFact[];
  fns: FnFact[];
  routes: RouteFact[];
  includes: IncludeFact[];
  http: HttpCallFact[];
  sql: SqlFact[];
  services: ServiceFact[];
  triggers: TriggerFact[];
  /** Named functions at any depth (handlers inside components), for triggers. */
  nested: { name: string; start: number; end: number }[];
  /** `router = APIRouter(prefix=...)` / `express.Router()` own prefixes. */
  ownerPrefix: Record<string, string>;
  hasJsx: boolean;
  /** Names exported from this file. */
  exports: string[];
  lines: number;
  channels: ChannelFact[];
  rpc: RpcFact[];
  /** Every env read, whatever its name (services[] keeps only the third-party hints). */
  envReads: EnvReadFact[];
  /** Module-level constants bound to an env read and/or a string literal. */
  consts: Record<string, ConstFact>;
  /** Dart: base URLs this file gives an HTTP client; linkDart (extract/dart.ts) hands them to the package's relative requests. */
  clientBases?: ClientBaseFact[];
  /** Dart: screens this file's router shows, for the screen's card. */
  screens?: ScreenFact[];
  /** Columns of the tables this file creates; build.ts puts them on the table's card. */
  columns?: ColumnsFact[];
  /** PHP: classes, model uses and views; linkPhp (extract/php.ts) turns them into tables and links. */
  php?: PhpFacts;
}

export function emptyFacts(lines: number): FileFacts {
  return {
    imports: [],
    fns: [],
    routes: [],
    includes: [],
    http: [],
    sql: [],
    services: [],
    triggers: [],
    nested: [],
    ownerPrefix: {},
    hasJsx: false,
    exports: [],
    lines,
    channels: [],
    rpc: [],
    envReads: [],
    consts: {},
  };
}
