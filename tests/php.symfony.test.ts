// Symfony and Doctrine: routes from #[Route] attributes (with the class's own
// prefix), Doctrine entities as tables with their columns, repositories and the
// entity manager reading and writing them, and Twig templates as pages, linked
// from the routes that render them and to the routes their forms and links go
// to. A small app written out below, read the way the CLI reads a folder; line
// numbers matter, the tests cite them.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import type { CodeMap, MapEdge } from "../src/analyzer/types";
import { readDir } from "../scripts/readDir";
import { factsOf } from "./analyzer.helpers";

const lines = (...l: string[]) => l.join("\n");

const APP: Record<string, string> = {
  "composer.json": JSON.stringify({ name: "acme/todo", require: { php: ">=8.2", "symfony/framework-bundle": "7.3.*", "doctrine/orm": "^3.3", "symfony/twig-bundle": "7.3.*" }, autoload: { "psr-4": { "App\\": "src/" } } }, null, 2),
  "src/Controller/TodoController.php": lines(
    "<?php", // 1
    "",
    "namespace App\\Controller;",
    "",
    "use App\\Entity\\Todo;", // 5
    "use App\\Repository\\TodoRepository;",
    "use Doctrine\\ORM\\EntityManagerInterface;",
    "use Symfony\\Bundle\\FrameworkBundle\\Controller\\AbstractController;",
    "use Symfony\\Component\\HttpFoundation\\Request;",
    "use Symfony\\Component\\HttpFoundation\\Response;", // 10
    "use Symfony\\Component\\Routing\\Attribute\\Route;",
    "",
    "#[Route('/todos', name: 'todo_')]",
    "class TodoController extends AbstractController",
    "{", // 15
    "    #[Route('', name: 'index', methods: ['GET'])]",
    "    public function index(TodoRepository $todos): Response",
    "    {",
    "        return $this->render('todo/index.html.twig', ['todos' => $todos->findAll()]);",
    "    }", // 20
    "",
    "    #[Route('/create', name: 'create', methods: ['POST'])]",
    "    public function create(Request $request, EntityManagerInterface $em): Response",
    "    {",
    "        $todo = new Todo();", // 25
    "        $todo->setTitle($request->request->get('title'));",
    "        $em->persist($todo);",
    "        $em->flush();",
    "        return $this->redirectToRoute('todo_index');",
    "    }", // 30
    "",
    "    #[Route('/{id}', name: 'show', methods: ['GET'])]",
    "    public function show(int $id, EntityManagerInterface $em): Response",
    "    {",
    "        $todo = $em->getRepository(Todo::class)->find($id);", // 35
    "        return $this->render('todo/show.html.twig', ['todo' => $todo]);",
    "    }",
    "",
    "    #[Route('/{id}', name: 'delete', methods: ['DELETE'])]",
    "    public function delete(Todo $todo, EntityManagerInterface $em): Response", // 40
    "    {",
    "        $em->remove($todo);",
    "        $em->flush();",
    "        return $this->redirectToRoute('todo_index');",
    "    }", // 45
    "}",
  ),
  "src/Controller/HealthController.php": lines(
    "<?php", // 1
    "namespace App\\Controller;",
    "use Symfony\\Component\\Routing\\Attribute\\Route;",
    "#[Route('/health', name: 'health')]",
    "class HealthController", // 5
    "{",
    "    public function __invoke(): Response { return new Response('ok'); }",
    "}",
  ),
  "src/Entity/Todo.php": lines(
    "<?php", // 1
    "",
    "namespace App\\Entity;",
    "",
    "use App\\Repository\\TodoRepository;", // 5
    "use Doctrine\\DBAL\\Types\\Types;",
    "use Doctrine\\ORM\\Mapping as ORM;",
    "",
    "#[ORM\\Entity(repositoryClass: TodoRepository::class)]",
    "#[ORM\\Table(name: 'todos')]", // 10
    "class Todo",
    "{",
    "    #[ORM\\Id]",
    "    #[ORM\\GeneratedValue]",
    "    #[ORM\\Column]", // 15
    "    private ?int $id = null;",
    "",
    "    #[ORM\\Column(length: 255)]",
    "    private ?string $title = null;",
    "", // 20
    "    #[ORM\\Column(type: Types::BOOLEAN)]",
    "    private bool $done = false;",
    "",
    "    #[ORM\\Column(name: 'created', type: 'datetime_immutable')]",
    "    private ?\\DateTimeImmutable $createdAt = null;", // 25
    "",
    "    #[ORM\\ManyToOne(inversedBy: 'todos')]",
    "    private ?User $owner = null;",
    "",
    "    public function setTitle(string $title): static", // 30
    "    {",
    "        $this->title = $title;",
    "        return $this;",
    "    }",
    "}", // 35
  ),
  "src/Entity/User.php": lines("<?php", "namespace App\\Entity;", "use Doctrine\\ORM\\Mapping as ORM;", "#[ORM\\Entity]", "class User", "{", "    #[ORM\\Id, ORM\\GeneratedValue, ORM\\Column]", "    private ?int $id = null;", "    #[ORM\\Column(length: 180)]", "    private string $emailAddress;", "}"),
  "src/Repository/TodoRepository.php": lines(
    "<?php", // 1
    "",
    "namespace App\\Repository;",
    "",
    "use App\\Entity\\Todo;", // 5
    "use Doctrine\\Bundle\\DoctrineBundle\\Repository\\ServiceEntityRepository;",
    "use Doctrine\\Persistence\\ManagerRegistry;",
    "",
    "class TodoRepository extends ServiceEntityRepository",
    "{", // 10
    "    public function __construct(ManagerRegistry $registry)",
    "    {",
    "        parent::__construct($registry, Todo::class);",
    "    }",
    "", // 15
    "    public function findOpen(): array",
    "    {",
    "        return $this->createQueryBuilder('t')->andWhere('t.done = false')->getQuery()->getResult();",
    "    }",
    "}", // 20
  ),
  "templates/base.html.twig": lines("<html><body>{% block body %}{% endblock %}</body></html>"),
  "templates/todo/index.html.twig": lines(
    "{% extends 'base.html.twig' %}", // 1
    "",
    "{% block body %}",
    "    <form method=\"post\" action=\"{{ path('todo_create') }}\">",
    "        <input name=\"title\">", // 5
    "        <button>Add</button>",
    "    </form>",
    "    {% for todo in todos %}",
    "        <a href=\"{{ path('todo_show', {id: todo.id}) }}\">{{ todo.title }}</a>",
    "        {{ include('todo/_delete_form.html.twig') }}", // 10
    "    {% endfor %}",
    "{% endblock %}",
  ),
  "templates/todo/_delete_form.html.twig": lines(
    "<form method=\"post\" action=\"{{ path('todo_delete', {id: todo.id}) }}\">", // 1
    "    <input type=\"hidden\" name=\"_method\" value=\"DELETE\">",
    "    <button>Delete</button>",
    "</form>",
  ),
  "templates/todo/show.html.twig": lines("{% extends 'base.html.twig' %}", "{% block body %}<h1>{{ todo.title }}</h1><a href=\"/todos\">Back</a>{% endblock %}"),
  // Written at run time: never read.
  "var/cache/dev/ContainerAbc/App_KernelDevDebugContainer.php": lines("<?php", "class App_KernelDevDebugContainer {}"),
};

const C = "src/Controller/TodoController.php";
const R = (s: string) => `route:${C}#${s}`;
const edge = (map: CodeMap, kind: MapEdge["kind"], from: string, to: string) => map.edges.find((e) => e.kind === kind && e.from === from && e.to === to);
const at = (e: MapEdge | undefined) => e?.evidence.map((x) => `${x.file}:${x.line}`);

describe("Symfony: one file", () => {
  it("reads #[Route] attributes under the class's prefix, with their names and methods", async () => {
    const f = await factsOf(C, APP[C]);
    assert.deepEqual(
      f.routes.map((r) => [r.method, r.path, r.line, r.handler, r.name]),
      [
        ["GET", "/todos", 16, "index", "todo_index"],
        ["POST", "/todos/create", 22, "create", "todo_create"],
        ["GET", "/todos/{id}", 32, "show", "todo_show"],
        ["DELETE", "/todos/{id}", 39, "delete", "todo_delete"],
      ],
    );
    assert.deepEqual(f.php?.views, [
      { name: "todo/index.html.twig", line: 19 },
      { name: "todo/show.html.twig", line: 36 },
    ]);
    const h = await factsOf("src/Controller/HealthController.php", APP["src/Controller/HealthController.php"]);
    assert.deepEqual(h.routes.map((r) => [r.method, r.path, r.handler, r.name]), [["ANY", "/health", "__invoke", "health"]]);
  });

  it("reads a Doctrine entity's table, columns and repository", async () => {
    const f = await factsOf("src/Entity/Todo.php", APP["src/Entity/Todo.php"]);
    assert.deepEqual(f.sql, [{ table: "todos", op: "define", line: 10 }]);
    assert.deepEqual(f.columns, [
      {
        table: "todos",
        columns: [
          { name: "id", type: "int" },
          { name: "title", type: "string" },
          { name: "done", type: "boolean" },
          { name: "created", type: "datetime_immutable" },
          { name: "owner_id", type: "ManyToOne" },
        ],
        line: 10,
      },
    ]);
    assert.deepEqual(f.php?.classes[0].entity, { repository: "App\\Repository\\TodoRepository" });
    // No #[ORM\Table]: the class's name, snake-cased; a property's column likewise.
    const u = await factsOf("src/Entity/User.php", APP["src/Entity/User.php"]);
    assert.deepEqual(u.columns?.[0], { table: "user", columns: [{ name: "id", type: "int" }, { name: "email_address", type: "string" }], line: 4 });
  });
});

describe("a Symfony app", () => {
  let root: string;
  let map: CodeMap;
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "walkmycode-symfony-"));
    for (const [p, content] of Object.entries(APP)) {
      await mkdir(dirname(join(root, p)), { recursive: true });
      await writeFile(join(root, p), content);
    }
    map = (await buildMap(await readDir(root), { name: "todo-app" })).map;
  });
  after(() => rm(root, { recursive: true, force: true }));

  it("reads .twig templates, but not var/", async () => {
    const paths = (await readDir(root)).map((s) => s.path);
    assert.ok(paths.includes("templates/todo/index.html.twig"));
    assert.ok(!paths.some((p) => p.startsWith("var/")));
  });

  it("draws every route, labels the app Symfony", () => {
    const routes = map.nodes.filter((n) => n.kind === "route").map((n) => n.name);
    assert.deepEqual(routes.sort(), ["/health", "DELETE /todos/{id}", "GET /todos", "GET /todos/{id}", "POST /todos/create"]);
    assert.equal(map.nodes.find((n) => n.id === R("GET /todos"))?.note, "named todo_index");
    assert.equal(map.services.find((s) => s.kind === "app")?.framework, "Symfony");
  });

  it("makes the entities tables, with their columns, in the data lane", () => {
    const t = map.nodes.find((n) => n.id === "table:todos");
    assert.deepEqual(
      t?.columns?.map((c) => c.name),
      ["id", "title", "done", "created", "owner_id"],
    );
    assert.deepEqual(t?.columnsAt, { file: "src/Entity/Todo.php", line: 10 });
    assert.deepEqual(at(edge(map, "defines", "file:src/Entity/Todo.php", "table:todos")), ["src/Entity/Todo.php:10"]);
    assert.ok(map.nodes.some((n) => n.id === "table:user"));
    assert.equal(map.nodes.find((n) => n.id === "file:src/Entity/Todo.php")?.layer, "data");
    assert.equal(map.nodes.find((n) => n.id === "file:src/Repository/TodoRepository.php")?.layer, "data");
  });

  it("reads and writes the table from each action: the repository, getRepository(), persist() and remove()", () => {
    assert.deepEqual(at(edge(map, "reads", R("GET /todos"), "table:todos")), [`${C}:19`]);
    assert.deepEqual(at(edge(map, "writes", R("POST /todos/create"), "table:todos")), [`${C}:27`]);
    assert.deepEqual(at(edge(map, "reads", R("GET /todos/{id}"), "table:todos")), [`${C}:35`]);
    assert.deepEqual(at(edge(map, "writes", R("DELETE /todos/{id}"), "table:todos")), [`${C}:42`]);
    assert.deepEqual(at(edge(map, "reads", "file:src/Repository/TodoRepository.php", "table:todos")), ["src/Repository/TodoRepository.php:18"]);
    // And the action calls into the repository it is given.
    assert.deepEqual(edge(map, "calls", R("GET /todos"), "file:src/Repository/TodoRepository.php")?.toFns, ["findAll"]);
  });

  it("shows Twig templates as pages, linked from the route that renders them", () => {
    const page = map.nodes.find((n) => n.id === "file:templates/todo/index.html.twig");
    assert.equal(page?.layer, "ui");
    assert.equal(page?.name, "templates/todo/index");
    assert.deepEqual(at(edge(map, "calls", R("GET /todos"), page!.id)), [`${C}:19`]);
    assert.deepEqual(at(edge(map, "calls", R("GET /todos/{id}"), "file:templates/todo/show.html.twig")), [`${C}:36`]);
    assert.deepEqual(at(edge(map, "imports", page!.id, "file:templates/base.html.twig")), ["templates/todo/index.html.twig:1"]);
    assert.deepEqual(at(edge(map, "imports", page!.id, "file:templates/todo/_delete_form.html.twig")), ["templates/todo/index.html.twig:10"]);
  });

  it("links a template's forms and links to the routes they go to, by path() name or by path", () => {
    const create = edge(map, "calls-route", "file:templates/todo/index.html.twig", R("POST /todos/create"));
    assert.equal(create?.confidence, "certain");
    assert.deepEqual(create?.evidence[0].trigger, { element: "form", label: "Add", line: 4 });
    assert.deepEqual(at(edge(map, "calls-route", "file:templates/todo/index.html.twig", R("GET /todos/{id}"))), ["templates/todo/index.html.twig:9"]);
    assert.deepEqual(at(edge(map, "calls-route", "file:templates/todo/_delete_form.html.twig", R("DELETE /todos/{id}"))), ["templates/todo/_delete_form.html.twig:1"]);
    assert.deepEqual(at(edge(map, "calls-route", "file:templates/todo/show.html.twig", R("GET /todos"))), ["templates/todo/show.html.twig:2"]);
  });
});
