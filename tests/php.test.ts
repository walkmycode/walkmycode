// PHP and Laravel: what extract/php.ts reads from one file, and the map of a
// small Laravel app written out below (routes, a controller, a model, a
// migration, Blade views), read the way the CLI reads a folder.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { tableNameOf } from "../src/analyzer/extract/php";
import type { CodeMap, MapEdge } from "../src/analyzer/types";
import { readDir } from "../scripts/readDir";
import { factsOf } from "./analyzer.helpers";

const lines = (...l: string[]) => l.join("\n");

/** A fresh Laravel app, cut down: line numbers matter, the tests cite them. */
const LARAVEL: Record<string, string> = {
  "composer.json": JSON.stringify({ name: "laravel/laravel", require: { php: "^8.3", "laravel/framework": "^13.0" }, autoload: { "psr-4": { "App\\": "app/", "Database\\Factories\\": "database/factories/" } } }, null, 2),
  "package.json": JSON.stringify({ private: true, type: "module", scripts: { build: "vite build", dev: "vite" }, devDependencies: { "laravel-vite-plugin": "^2.0.0", vite: "^7.0.0" } }, null, 2),
  "routes/web.php": lines(
    "<?php", // 1
    "",
    "use App\\Http\\Controllers\\TodoController;",
    "use Illuminate\\Support\\Facades\\Route;",
    "", // 5
    "Route::get('/', function () {",
    "    return view('welcome');",
    "})->name('home');",
    "",
    "Route::get('/todos', [TodoController::class, 'index'])->name('todos.index');", // 10
    "Route::resource('todos', TodoController::class)->except(['index']);",
    "Route::view('/about', 'about');",
  ),
  "routes/api.php": lines(
    "<?php", // 1
    "use App\\Http\\Controllers\\TodoController;",
    "use Illuminate\\Support\\Facades\\Route;",
    "Route::prefix('v1')->group(function () {",
    "    Route::get('/todos', [TodoController::class, 'index']);", // 5
    "});",
  ),
  "app/Http/Controllers/Controller.php": lines("<?php", "", "namespace App\\Http\\Controllers;", "", "abstract class Controller", "{", "}"),
  "app/Http/Controllers/TodoController.php": lines(
    "<?php", // 1
    "",
    "namespace App\\Http\\Controllers;",
    "",
    "use App\\Models\\Todo;", // 5
    "use Illuminate\\Http\\Request;",
    "use Illuminate\\Support\\Facades\\Http;",
    "",
    "class TodoController extends Controller",
    "{", // 10
    "    public function index()",
    "    {",
    "        $todos = Todo::latest()->get();",
    "        return view('todos.index', ['todos' => $todos]);",
    "    }", // 15
    "",
    "    public function store(Request $request)",
    "    {",
    "        Todo::create($request->validate(['title' => 'required']));",
    "        Http::post('https://hooks.slack.com/services/T000/B000', ['text' => 'New todo']);", // 20
    "        return redirect()->route('todos.index');",
    "    }",
    "",
    "    public function update(Request $request, Todo $todo)",
    "    {", // 25
    "        $todo->update(['done' => $request->boolean('done')]);",
    "        return back();",
    "    }",
    "",
    "    public function destroy(Todo $todo)", // 30
    "    {",
    "        $todo->delete();",
    "        return back();",
    "    }",
    "}", // 35
  ),
  "app/Models/Todo.php": lines(
    "<?php", // 1
    "",
    "namespace App\\Models;",
    "",
    "use Illuminate\\Database\\Eloquent\\Model;", // 5
    "",
    "class Todo extends Model",
    "{",
    "    protected $fillable = ['title', 'done'];",
    "}", // 10
  ),
  "database/migrations/2026_01_01_000000_create_todos_table.php": lines(
    "<?php", // 1
    "",
    "use Illuminate\\Database\\Migrations\\Migration;",
    "use Illuminate\\Database\\Schema\\Blueprint;",
    "use Illuminate\\Support\\Facades\\Schema;", // 5
    "",
    "return new class extends Migration",
    "{",
    "    public function up(): void",
    "    {", // 10
    "        Schema::create('todos', function (Blueprint $table) {",
    "            $table->id();",
    "            $table->string('title');",
    "            $table->boolean('done')->default(false);",
    "            $table->timestamps();", // 15
    "        });",
    "    }",
    "",
    "    public function down(): void",
    "    {", // 20
    "        Schema::dropIfExists('todos');",
    "    }",
    "};",
  ),
  "resources/views/layouts/app.blade.php": lines("<html>", "<body>", "    @yield('content')", "</body>", "</html>"),
  "resources/views/todos/index.blade.php": lines(
    "@extends('layouts.app')", // 1
    "",
    "@section('content')",
    "    <form method=\"POST\" action=\"{{ route('todos.store') }}\">",
    "        @csrf", // 5
    "        <input name=\"title\">",
    "        <button type=\"submit\">Add</button>",
    "    </form>",
    "    @foreach ($todos as $todo)",
    "        <a href=\"{{ route('todos.show', $todo) }}\">{{ $todo->title }}</a>", // 10
    "        <form method=\"POST\" action=\"/todos/{{ $todo->id }}\">",
    "            @csrf",
    "            @method('DELETE')",
    "            <button>Delete</button>",
    "        </form>", // 15
    "        <form method=\"POST\" action=\"{{ route('todos.update', $todo) }}\">",
    "            @method('PATCH')",
    "            <button>Done</button>",
    "        </form>",
    "        <form method=\"POST\" action=\"{{ route('todos.edit', $todo) }}\"><button>Edit</button></form>", // 20
    "    @endforeach",
    "    <a href=\"{{ url('/todos/create') }}\">New todo</a>",
    "    <a href=\"/about\">About</a>",
    "    <a href=\"{{ route('todos.archive') }}\">Archive</a>",
    "    <a href=\"https://laravel.com/docs\">Docs</a>", // 25
    "@endsection",
  ),
  "resources/views/welcome.blade.php": lines("<h1>Welcome</h1>"),
  "resources/views/about.blade.php": lines("<h1>About</h1>"),
  // Written at run time: never read.
  "storage/framework/views/0a1b2c.php": lines("<?php echo 'compiled view';"),
  "bootstrap/cache/routes-v7.php": lines("<?php return [];"),
  "bootstrap/app.php": lines("<?php", "return Application::configure(basePath: dirname(__DIR__))->create();"),
  "vendor/laravel/framework/src/Foundation/Application.php": lines("<?php", "class Application {}"),
};

const C = "app/Http/Controllers/TodoController.php";
const edge = (map: CodeMap, kind: MapEdge["kind"], from: string, to: string) => map.edges.find((e) => e.kind === kind && e.from === from && e.to === to);
const at = (e: MapEdge | undefined) => e?.evidence.map((x) => `${x.file}:${x.line}`);

describe("extractPhp: one file", () => {
  it("reads `use` imports (group and alias too) and names the namespace's classes", async () => {
    const f = await factsOf("app/Http/Controllers/A.php", lines("<?php", "namespace App\\Http\\Controllers;", "use App\\Models\\{Todo, User as Owner};", "use function Foo\\bar;", "class A extends Controller {}"));
    assert.deepEqual(
      f.imports.map((i) => [i.spec, i.names[0].local, i.line]),
      [
        ["App\\Models\\Todo", "Todo", 3],
        ["App\\Models\\User", "Owner", 3],
        ["App\\Http\\Controllers\\Controller", "Controller", 5],
      ],
    );
    assert.deepEqual(f.php?.classes.map((c) => [c.fqn, c.extends]), [["App\\Http\\Controllers\\A", "App\\Http\\Controllers\\Controller"]]);
  });

  it("reads routes: closures, controller arrays, 'Controller@method', match, groups with a prefix and a controller", async () => {
    const f = await factsOf(
      "routes/web.php",
      lines(
        "<?php",
        "use App\\Http\\Controllers\\PostController;",
        "Route::get('/', fn () => view('welcome'));",
        "Route::post('/posts', [PostController::class, 'store'])->name('posts.store');",
        "Route::put('/legacy/{id}', 'LegacyController@update');", // 5
        "Route::match(['get', 'post'], '/search', [PostController::class, 'search']);",
        "Route::middleware('auth')->prefix('admin')->name('admin.')->group(function () {",
        "    Route::controller(PostController::class)->group(function () {",
        "        Route::delete('/posts/{post}', 'destroy')->name('posts.destroy');",
        "    });", // 10
        "});",
        "Route::apiResource('photos.comments', CommentController::class);",
      ),
    );
    assert.deepEqual(
      f.routes.map((r) => [r.method, r.path, r.line, r.handler, r.name]),
      [
        ["GET", "/", 3, undefined, undefined],
        ["POST", "/posts", 4, "PostController@store", "posts.store"],
        ["PUT", "/legacy/{id}", 5, "LegacyController@update", undefined],
        ["GET", "/search", 6, "PostController@search", undefined],
        ["POST", "/search", 6, "PostController@search", undefined],
        ["DELETE", "/admin/posts/{post}", 9, "PostController@destroy", "admin.posts.destroy"],
        ["GET", "/photos/{photo}/comments", 12, "CommentController@index", "photos.comments.index"],
        ["POST", "/photos/{photo}/comments", 12, "CommentController@store", "photos.comments.store"],
        ["GET", "/photos/{photo}/comments/{comment}", 12, "CommentController@show", "photos.comments.show"],
        ["PUT", "/photos/{photo}/comments/{comment}", 12, "CommentController@update", "photos.comments.update"],
        ["PATCH", "/photos/{photo}/comments/{comment}", 12, "CommentController@update", "photos.comments.update"],
        ["DELETE", "/photos/{photo}/comments/{comment}", 12, "CommentController@destroy", "photos.comments.destroy"],
      ],
    );
    assert.deepEqual(f.routes[1].controller, { cls: "App\\Http\\Controllers\\PostController", method: "store" });
    assert.deepEqual(f.routes[2].controller, { cls: "App\\Http\\Controllers\\LegacyController", method: "update", legacy: true });
  });

  it("reads Eloquent calls, DB::table, migration columns, views, env() and Http requests", async () => {
    const f = await factsOf(
      "app/Services/Sync.php",
      lines(
        "<?php",
        "namespace App\\Services;",
        "use App\\Models\\Todo;",
        "class Sync {",
        "  public function run(Todo $todo) {", // 5
        "    Todo::where('done', true)->delete();",
        "    $todo->save();",
        "    DB::table('audit')->insert(['at' => now()]);",
        "    $r = Http::withToken(env('API_TOKEN'))->get(env('API_URL', 'https://api.example.com') . '/items/' . $todo->id);",
        "    return view('sync.done');", // 10
        "  }",
        "}",
      ),
    );
    assert.deepEqual(f.php?.modelUses, [
      { cls: "App\\Models\\Todo", op: "write", line: 6 },
      { cls: "App\\Models\\Todo", op: "write", line: 7 },
    ]);
    assert.deepEqual(f.sql, [{ table: "audit", op: "write", line: 8 }]);
    assert.deepEqual(
      f.http.map((h) => [h.method, h.url, h.fromVariable, h.varName, h.literalBase, h.callee]),
      [["GET", "*/items/*", true, "API_URL", "https://api.example.com", "Http.get"]],
    );
    assert.deepEqual(
      f.envReads.map((e) => e.name),
      ["API_TOKEN", "API_URL"],
    );
    assert.deepEqual(f.php?.views, [{ name: "sync.done", line: 10 }]);
    assert.deepEqual(f.fns.map((x) => [x.name, x.start, x.end, x.exported]), [["run", 5, 11, true]]);
    assert.ok(f.fns[0].calls.includes("Todo.where") && f.fns[0].calls.includes("Todo.save"));

    const m = await factsOf("database/migrations/x.php", LARAVEL["database/migrations/2026_01_01_000000_create_todos_table.php"]);
    assert.deepEqual(m.sql, [{ table: "todos", op: "define", line: 11 }]);
    assert.deepEqual(m.columns, [
      {
        table: "todos",
        columns: [
          { name: "id", type: "id" },
          { name: "title", type: "string" },
          { name: "done", type: "boolean" },
          { name: "created_at", type: "timestamp" },
          { name: "updated_at", type: "timestamp" },
        ],
        line: 11,
      },
    ]);
    const more = await factsOf(
      "database/migrations/y.php",
      lines("<?php", "Schema::table('todos', function (Blueprint $table) {", "    $table->foreignId('user_id')->constrained();", "    $table->foreignIdFor(Team::class);", "    $table->softDeletes();", "    $table->index('title');", "});"),
    );
    assert.deepEqual(more.columns?.[0].columns, [
      { name: "user_id", type: "foreignId" },
      { name: "team_id", type: "foreignId" },
      { name: "deleted_at", type: "timestamp" },
    ]);
  });

  it("reads a Blade view's forms and links: by route name or path, @method winning over the form's method", async () => {
    const f = await factsOf("resources/views/todos/index.blade.php", LARAVEL["resources/views/todos/index.blade.php"]);
    assert.deepEqual(
      f.php?.requests?.map((r) => [r.line, r.element, r.method, r.name ?? r.path, r.label]),
      [
        [4, "form", "POST", "todos.store", "Add"],
        [10, "a", "GET", "todos.show", undefined],
        [11, "form", "DELETE", "/todos/*", "Delete"],
        [16, "form", "PATCH", "todos.update", "Done"],
        [20, "form", "POST", "todos.edit", "Edit"],
        [22, "a", "GET", "/todos/create", "New todo"],
        [23, "a", "GET", "/about", "About"],
        [24, "a", "GET", "todos.archive", "Archive"],
      ],
    );
    const hidden = await factsOf("resources/views/x.blade.php", lines("<form action='/todos/1' method='post'>", "<input type=\"hidden\" name=\"_method\" value=\"PUT\">", "</form>", "<form action=\"{{ $action }}\"></form>", "<a href=\"#top\">Top</a>"));
    assert.deepEqual(hidden.php?.requests?.map((r) => [r.method, r.path]), [["PUT", "/todos/1"]]);
  });

  it("names a model's table the way Laravel does", () => {
    assert.deepEqual(["Todo", "UserProfile", "Category", "Person", "Address", "Box"].map(tableNameOf), ["todos", "user_profiles", "categories", "people", "addresses", "boxes"]);
  });
});

describe("a Laravel app", () => {
  let root: string;
  let map: CodeMap;
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "walkmycode-laravel-"));
    for (const [p, content] of Object.entries(LARAVEL)) {
      await mkdir(dirname(join(root, p)), { recursive: true });
      await writeFile(join(root, p), content);
    }
    map = (await buildMap(await readDir(root), { name: "todo-app" })).map;
  });
  after(() => rm(root, { recursive: true, force: true }));

  it("reads .php and composer.json, but not storage/, bootstrap/cache or vendor/", async () => {
    const paths = (await readDir(root)).map((s) => s.path);
    assert.ok(paths.includes("composer.json") && paths.includes("routes/web.php") && paths.includes("resources/views/welcome.blade.php"));
    assert.ok(paths.includes("bootstrap/app.php"));
    assert.ok(!paths.some((p) => p.startsWith("storage/") || p.startsWith("bootstrap/cache/") || p.startsWith("vendor/")));
  });

  it("draws every route, with routes/api.php under /api", () => {
    const routes = map.nodes.filter((n) => n.kind === "route").map((n) => `${n.method} ${n.path}`);
    assert.deepEqual(routes.sort(), ["DELETE /todos/{todo}", "GET /", "GET /about", "GET /api/v1/todos", "GET /todos", "GET /todos/create", "GET /todos/{todo}", "GET /todos/{todo}/edit", "PATCH /todos/{todo}", "POST /todos", "PUT /todos/{todo}"].sort());
    assert.equal(map.stats.routes, 11);
    assert.equal(map.nodes.find((n) => n.id === "route:routes/web.php#GET /")?.note, "named home");
  });

  it("links each route to its controller method, citing the route and the method", () => {
    const index = edge(map, "calls", "route:routes/web.php#GET /todos", `file:${C}`);
    assert.equal(index?.confidence, "certain");
    assert.deepEqual(at(index), ["routes/web.php:10", `${C}:11`]);
    assert.deepEqual(index?.toFns, ["index"]);
    assert.deepEqual(at(edge(map, "calls", "route:routes/web.php#POST /todos", `file:${C}`)), ["routes/web.php:11", `${C}:17`]);
    assert.deepEqual(at(edge(map, "calls", "route:routes/web.php#DELETE /todos/{todo}", `file:${C}`)), ["routes/web.php:11", `${C}:30`]);
    // show() is not defined: the route still goes to the controller, citing only the route.
    assert.deepEqual(at(edge(map, "calls", "route:routes/web.php#GET /todos/{todo}", `file:${C}`)), ["routes/web.php:11"]);
    assert.deepEqual(at(edge(map, "calls", "route:routes/api.php#GET /api/v1/todos", `file:${C}`)), ["routes/api.php:5", `${C}:11`]);
  });

  it("makes the todos table from the model and the migration, with its columns", () => {
    const t = map.nodes.find((n) => n.id === "table:todos");
    assert.equal(t?.layer, "data");
    assert.deepEqual(
      t?.columns?.map((c) => `${c.name} ${c.type}`),
      ["id id", "title string", "done boolean", "created_at timestamp", "updated_at timestamp"],
    );
    assert.deepEqual(t?.columnsAt, { file: "database/migrations/2026_01_01_000000_create_todos_table.php", line: 11 });
    assert.equal(t?.note, undefined);
    assert.equal(map.stats.tables, 1);
    assert.deepEqual(at(edge(map, "defines", "file:database/migrations/2026_01_01_000000_create_todos_table.php", "table:todos")), ["database/migrations/2026_01_01_000000_create_todos_table.php:11"]);
    assert.deepEqual(at(edge(map, "defines", "file:app/Models/Todo.php", "table:todos")), ["app/Models/Todo.php:7"]);
    assert.equal(map.nodes.find((n) => n.id === "file:app/Models/Todo.php")?.layer, "data");
  });

  it("reads and writes the table from the controller's Eloquent calls", () => {
    const reads = edge(map, "reads", `file:${C}`, "table:todos");
    const writes = edge(map, "writes", `file:${C}`, "table:todos");
    assert.equal(reads?.confidence, "certain");
    assert.deepEqual(at(reads), [`${C}:13`]);
    assert.deepEqual(at(writes), [`${C}:19`, `${C}:26`, `${C}:32`]);
    assert.deepEqual(writes?.fromFns, ["store", "update", "destroy"]);
    // And the controller imports the model, with the calls it makes on it.
    const imp = edge(map, "imports", `file:${C}`, "file:app/Models/Todo.php");
    assert.deepEqual(at(imp), [`${C}:5`]);
    assert.deepEqual(imp?.toFns?.sort(), ["create", "delete", "latest", "update"]);
  });

  it("shows Blade views as pages, each linked from the route that returns it", () => {
    const page = map.nodes.find((n) => n.id === "file:resources/views/todos/index.blade.php");
    assert.equal(page?.layer, "ui");
    assert.equal(page?.name, "resources/views/todos/index");
    assert.deepEqual(at(edge(map, "calls", "route:routes/web.php#GET /todos", page!.id)), [`${C}:14`]);
    assert.deepEqual(at(edge(map, "calls", "route:routes/api.php#GET /api/v1/todos", page!.id)), [`${C}:14`]);
    assert.deepEqual(at(edge(map, "calls", "route:routes/web.php#GET /", "file:resources/views/welcome.blade.php")), ["routes/web.php:7"]);
    assert.deepEqual(at(edge(map, "calls", "route:routes/web.php#GET /about", "file:resources/views/about.blade.php")), ["routes/web.php:12"]);
    assert.deepEqual(at(edge(map, "imports", page!.id, "file:resources/views/layouts/app.blade.php")), ["resources/views/todos/index.blade.php:1"]);
  });

  it("links a page's forms and links to the routes they go to, citing the line and what is clicked", () => {
    const page = "file:resources/views/todos/index.blade.php";
    const V = "resources/views/todos/index.blade.php";
    const req = (to: string) => edge(map, "calls-route", page, `route:routes/web.php#${to}`);
    const store = req("POST /todos");
    assert.equal(store?.confidence, "certain");
    assert.deepEqual(at(store), [`${V}:4`]);
    assert.deepEqual(store?.evidence[0].trigger, { element: "form", label: "Add", line: 4 });
    assert.deepEqual(store?.toFns, ["TodoController@store"]);
    assert.deepEqual(at(req("GET /todos/{todo}")), [`${V}:10`]);
    // By path, the {{ }} piece filling the parameter; @method('DELETE') makes the POST a DELETE.
    assert.equal(req("DELETE /todos/{todo}")?.confidence, "certain");
    assert.deepEqual(at(req("DELETE /todos/{todo}")), [`${V}:11`]);
    assert.deepEqual(at(req("PATCH /todos/{todo}")), [`${V}:16`]);
    assert.equal(req("PUT /todos/{todo}"), undefined);
    assert.deepEqual(at(req("GET /todos/create")), [`${V}:22`]);
    assert.deepEqual(at(req("GET /about")), [`${V}:23`]);
    // A form that POSTs to a GET route: drawn, but as a guess that says why.
    const edit = req("GET /todos/{todo}/edit");
    assert.equal(edit?.confidence, "likely");
    assert.equal(edit?.note, "the form sends POST, but the route 'todos.edit' answers GET");
    assert.ok(map.warnings.includes(`${V}:24 names the route 'todos.archive', which I can't find`));
    assert.ok(!map.edges.some((e) => e.from === page && e.kind === "uses-service"), "a link to another site is no request");
  });

  it("names the outside service a request goes to, and labels the app Laravel", () => {
    const slack = edge(map, "uses-service", `file:${C}`, "svc:slack");
    assert.deepEqual(at(slack), [`${C}:20`]);
    const app = map.services.find((s) => s.kind === "app");
    assert.equal(app?.framework, "Laravel");
  });
});
