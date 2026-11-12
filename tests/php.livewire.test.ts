// Livewire on Laravel: components in app/Livewire as cards of the screen, the
// view each renders, where pages put them (<livewire:x />, @livewire('x')),
// full-page routes, wire:click to the method it runs, and the tables their
// Eloquent calls read and write. A small app written out below; line numbers
// matter, the tests cite them.
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { livewireName } from "../src/analyzer/extract/php";
import type { CodeMap, MapEdge } from "../src/analyzer/types";
import { factsOf } from "./analyzer.helpers";

const lines = (...l: string[]) => l.join("\n");

const APP: Record<string, string> = {
  "composer.json": JSON.stringify({ name: "laravel/laravel", require: { php: "^8.3", "laravel/framework": "^13.0", "livewire/livewire": "^3.6" }, autoload: { "psr-4": { "App\\": "app/" } } }, null, 2),
  "routes/web.php": lines(
    "<?php", // 1
    "use App\\Livewire\\TodoList;",
    "use Illuminate\\Support\\Facades\\Route;",
    "Route::get('/todos', TodoList::class)->name('todos');",
    "Route::view('/', 'welcome');", // 5
  ),
  "app/Livewire/TodoList.php": lines(
    "<?php", // 1
    "",
    "namespace App\\Livewire;",
    "",
    "use App\\Models\\Todo;", // 5
    "use Livewire\\Component;",
    "",
    "class TodoList extends Component",
    "{",
    "    public string $title = '';", // 10
    "",
    "    public function add()",
    "    {",
    "        Todo::create(['title' => $this->title]);",
    "        $this->title = '';", // 15
    "    }",
    "",
    "    public function remove(int $id)",
    "    {",
    "        Todo::find($id)->delete();", // 20
    "    }",
    "",
    "    public function render()",
    "    {",
    "        return view('livewire.todo-list', ['todos' => Todo::all()]);", // 25
    "    }",
    "}",
  ),
  "app/Livewire/Counter.php": lines(
    "<?php", // 1
    "namespace App\\Livewire;",
    "use Livewire\\Component;",
    "class Counter extends Component",
    "{", // 5
    "    public int $count = 0;",
    "    public function increment() { $this->count++; }",
    "}",
  ),
  "app/Models/Todo.php": lines("<?php", "namespace App\\Models;", "use Illuminate\\Database\\Eloquent\\Model;", "class Todo extends Model {}"),
  "resources/views/livewire/todo-list.blade.php": lines(
    "<div>", // 1
    "    <form wire:submit.prevent=\"add\">",
    "        <input wire:model=\"title\">",
    "        <button type=\"submit\">Add</button>",
    "    </form>", // 5
    "    @foreach ($todos as $todo)",
    "        <button wire:click=\"remove({{ $todo->id }})\">x</button>",
    "    @endforeach",
    "    <livewire:counter />",
    "</div>", // 10
  ),
  "resources/views/livewire/counter.blade.php": lines("<div>", "    <span>{{ $count }}</span>", "    <button wire:click=\"increment\">+</button>", "    <button wire:click=\"$refresh\">Refresh</button>", "</div>"),
  "resources/views/welcome.blade.php": lines("<h1>Todos</h1>", "@livewire('todo-list')"),
};

const T = "app/Livewire/TodoList.php";
const TV = "resources/views/livewire/todo-list.blade.php";
const edge = (map: CodeMap, kind: MapEdge["kind"], from: string, to: string) => map.edges.find((e) => e.kind === kind && e.from === from && e.to === to);
const at = (e: MapEdge | undefined) => e?.evidence.map((x) => `${x.file}:${x.line}`);

describe("Livewire: one file", () => {
  it("names a component the way Livewire does", () => {
    assert.deepEqual(["App\\Livewire\\TodoList", "App\\Livewire\\Todos\\EditForm", "App\\Http\\Livewire\\Counter", "App\\Models\\Todo"].map(livewireName), ["todo-list", "todos.edit-form", "counter", undefined]);
  });

  it("reads the components a view puts on the page, and the methods wire: runs", async () => {
    const f = await factsOf(TV, APP[TV]);
    assert.deepEqual(
      f.imports.map((i) => [i.spec, i.line]),
      [["livewire:counter", 9]],
    );
    assert.deepEqual(f.php?.wires, [
      { event: "submit", method: "add", line: 2 },
      { event: "click", method: "remove", line: 7 },
    ]);
    const c = await factsOf("resources/views/livewire/counter.blade.php", APP["resources/views/livewire/counter.blade.php"]);
    assert.deepEqual(c.php?.wires?.map((w) => w.method), ["increment"]);
  });
});

describe("a Livewire app", () => {
  let map: CodeMap;
  before(async () => {
    map = (await buildMap(Object.entries(APP).map(([path, content]) => ({ path, content })), { name: "todo-app" })).map;
  });

  it("draws each component as a card of the screen", () => {
    for (const p of [T, "app/Livewire/Counter.php"]) {
      const n = map.nodes.find((x) => x.id === `file:${p}`);
      assert.equal(n?.layer, "ui", p);
      assert.equal(n?.kind, "component", p);
    }
  });

  it("links each component to the view it renders: render()'s view(), else Livewire's convention", () => {
    assert.deepEqual(at(edge(map, "calls", `file:${T}`, `file:${TV}`)), [`${T}:25`]);
    assert.deepEqual(at(edge(map, "calls", "file:app/Livewire/Counter.php", "file:resources/views/livewire/counter.blade.php")), ["app/Livewire/Counter.php:4"]);
  });

  it("puts components on pages: <livewire:counter /> and @livewire('todo-list') import them", () => {
    assert.deepEqual(at(edge(map, "imports", `file:${TV}`, "file:app/Livewire/Counter.php")), [`${TV}:9`]);
    assert.deepEqual(at(edge(map, "imports", "file:resources/views/welcome.blade.php", `file:${T}`)), ["resources/views/welcome.blade.php:2"]);
  });

  it("links a full-page route to its component's render(), and to the view it renders", () => {
    const route = "route:routes/web.php#GET /todos";
    assert.equal(map.nodes.find((n) => n.id === route)?.handler, "TodoList");
    const e = edge(map, "calls", route, `file:${T}`);
    assert.equal(e?.confidence, "certain");
    assert.deepEqual(at(e), ["routes/web.php:4", `${T}:23`]);
    assert.deepEqual(e?.toFns, ["render"]);
    assert.deepEqual(at(edge(map, "calls", route, `file:${TV}`)), [`${T}:25`]);
  });

  it("links wire:click and wire:submit to the component method they run", () => {
    const e = edge(map, "calls", `file:${TV}`, `file:${T}`);
    assert.deepEqual(at(e), [`${TV}:2`, `${T}:12`, `${TV}:7`, `${T}:18`]);
    assert.deepEqual(e?.toFns, ["add", "remove"]);
    assert.deepEqual(e?.evidence[0].trigger, { element: "wire:submit", line: 2 });
    assert.deepEqual(edge(map, "calls", "file:resources/views/livewire/counter.blade.php", "file:app/Livewire/Counter.php")?.toFns, ["increment"]);
  });

  it("reads and writes the table from the component's Eloquent calls", () => {
    assert.deepEqual(at(edge(map, "writes", `file:${T}`, "table:todos")), [`${T}:14`, `${T}:20`]);
    assert.deepEqual(at(edge(map, "reads", `file:${T}`, "table:todos")), [`${T}:25`]);
    assert.deepEqual(edge(map, "writes", `file:${T}`, "table:todos")?.fromFns, ["add", "remove"]);
  });
});
