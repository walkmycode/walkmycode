// C# on the map (src/analyzer/extract/csharp.ts, resolveTyped in build.ts, extract/entities.ts):
// types found by namespace (`using`, the file's own and the ones around it), methods and the
// calls followed through declared types, ASP.NET Core controllers and minimal APIs, EF Core
// DbSets as tables (named by [Table], ToTable and [Column] when the code names them) and their
// use, HttpClient calls, Refit interfaces, IConfiguration settings; the aspnet-todos fixture end to end.
// npm's own grammar build (tree-sitter-c-sharp) is the one loaded here, as in the app.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { drawnLang, readableLanguage } from "../src/analyzer/config/files";
import type { CodeMap } from "../src/analyzer/types";
import { buildFixture, factsOf } from "./analyzer.helpers";

const mapOf = async (files: Record<string, string>): Promise<CodeMap> => (await buildMap(Object.entries(files).map(([path, content]) => ({ path, content })), { name: "t" })).map;
const imports = (m: CodeMap) => m.edges.filter((e) => e.kind === "imports").map((e) => `${e.from.slice(5)} -> ${e.to.slice(5)}${e.toFns?.length ? ` [${e.toFns.join(",")}]` : ""}`).sort();

describe("C# facts", () => {
  it("is drawn, no longer only read", () => {
    assert.equal(drawnLang("Api/Program.cs"), "csharp");
    assert.equal(readableLanguage("Program.cs"), null);
  });

  it("reads the namespace (file-scoped or a block), usings as opened namespaces and an alias as an import", async () => {
    const f = await factsOf("A.cs", "using System;\nusing Shop.Core;\nusing Db = Shop.Data.ShopContext;\nusing static Shop.Util.Money;\nnamespace Shop.Api;\npublic class A { }\ninternal record B(int X);\n");
    assert.equal(f.typed?.namespace, "Shop.Api");
    assert.deepEqual(f.typed?.opens, [{ ns: "System", line: 1 }, { ns: "Shop.Core", line: 2 }]);
    assert.deepEqual(f.imports.map((i) => `${i.spec} ${i.names[0].local}@${i.line}`), ["Shop.Data.ShopContext Db@3", "Shop.Util.Money Money@4"]);
    assert.deepEqual(f.typed?.types, ["A", "B"]);
    const block = await factsOf("B.cs", "namespace Shop.Core\n{\n    public class Service { }\n}\n");
    assert.equal(block.typed?.namespace, "Shop.Core");
    assert.deepEqual(block.typed?.types, ["Service"]);
  });

  it("names a method by its class and a call by the declared type of what it is called on", async () => {
    const f = await factsOf(
      "OrderService.cs",
      `namespace Shop.Core;
public class OrderService(Mailer mailer)
{
    private readonly OrderRepository _repo;
    public Clock Clock { get; set; }
    public OrderService(OrderRepository repo) { _repo = repo; }
    public async Task<Order> Place(Order order, Audit audit)
    {
        var stamp = new Stamp();
        stamp.Touch();
        audit.Log(stamp);
        this._repo.Save(order);
        mailer.Send(order);
        Money.Parse("1");
        Helper();
        return await _repo.Find<Order>(1);
    }
    void Helper() { }
    public int Total => Clock.Now();
}
public interface IClock { int Now(); }
`,
    );
    assert.deepEqual(f.fns.map((x) => `${x.name}${x.exported ? " pub" : ""}`), ["OrderService.OrderService pub", "OrderService.Place pub", "OrderService.Helper", "IClock.Now pub"]);
    assert.deepEqual(f.fns[1].calls.sort(), ["Audit.Log", "Helper", "Mailer.Send", "Money.Parse", "OrderRepository.Find", "OrderRepository.Save", "Stamp.Stamp", "Stamp.Touch"]);
    assert.deepEqual(f.exports, ["OrderService", "IClock"]);
    const refs = f.typed!.refs.map((r) => r.name);
    for (const name of ["Mailer", "OrderRepository", "Clock", "Order", "Audit", "Stamp", "Money", "Task"]) assert.ok(refs.includes(name), `${name} is named: ${refs.join(",")}`);
    assert.ok(!refs.includes("OrderService") && !refs.includes("Place") && !refs.includes("Total"), "not the names it declares");
  });

  it("reads a controller's routes under its own: [controller], verbs with and without a template, a rooted one", async () => {
    const f = await factsOf(
      "OrdersController.cs",
      `[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok();

    [HttpGet("{id:int}")]
    public IActionResult One(int id) => Ok();

    [HttpPost("[action]")]
    public IActionResult Import() => Ok();

    [HttpDelete, Route("all")]
    public void Wipe() { }

    [HttpGet("/health")]
    public string Health() => "ok";

    [HttpPut("~/api/v2/orders/{id}")]
    public void Replace(int id) { }

    public void Helper() { }
}
public class Plain { [HttpGet("x")] public void NotARoute() { } }`,
    );
    assert.deepEqual(
      f.routes.map((r) => `${r.method} ${r.path} ${r.handler} ${r.line}-${r.endLine}`),
      [
        "GET /api/orders OrdersController.List 5-6",
        "GET /api/orders/{id} OrdersController.One 8-9",
        "POST /api/orders/Import OrdersController.Import 11-12",
        "DELETE /api/orders/all OrdersController.Wipe 14-15",
        "GET /health OrdersController.Health 17-18",
        "PUT /api/v2/orders/{id} OrdersController.Replace 20-21",
      ],
    );
  });

  it("reads minimal APIs, under the prefix of the group they hang off", async () => {
    const f = await factsOf(
      "Program.cs",
      `var app = builder.Build();
app.MapGet("/health", () => "ok");
var api = app.MapGroup("/api");
var orders = api.MapGroup("/orders");
orders.MapGet("/{id:guid}", async (Guid id, ShopContext db) => await db.Orders.FindAsync(id));
orders.MapPost("/", OrderHandlers.Create);
api.MapDelete("/cache", ClearCache);
app.MapFallback(() => "no");
app.Run();`,
    );
    assert.deepEqual(f.routes.map((r) => `${r.method} ${r.path} ${r.handler ?? "(inline)"} @${r.owner}`), ["GET /health (inline) @app", "GET /{id} (inline) @orders", "POST / OrderHandlers.Create @orders", "DELETE /cache ClearCache @api"]);
    assert.deepEqual(f.ownerPrefix, { api: "/api", orders: "/api/orders" });
  });

  it("finds HttpClient calls with their URL, the environment, a constant and SQL in strings", async () => {
    const f = await factsOf(
      "PayClient.cs",
      `public class PayClient
{
    private const string Api = "https://api.stripe.com/v1";
    private readonly HttpClient _http;
    public async Task Charge(string id)
    {
        var key = Environment.GetEnvironmentVariable("STRIPE_SECRET_KEY");
        await _http.PostAsync($"{Api}/charges", null);
        await _http.GetFromJsonAsync<User>("http://users:8080/api/users/" + id);
        await client.DeleteAsync($"{baseUrl}/api/sessions/{id}");
        await conn.ExecuteAsync(@"INSERT INTO charges (amount) VALUES (@a)", new { a = 1 });
        await cache.GetAsync("not-a-url");
    }
}`,
    );
    assert.deepEqual(
      f.http.map((h) => `${h.method} ${h.url} ${h.fromVariable ? `base=${h.literalBase ?? "?"}` : "literal"}`),
      ["POST */charges base=https://api.stripe.com/v1", "GET http://users:8080/api/users/* literal", "DELETE */api/sessions/* base=?"],
    );
    assert.deepEqual(f.envReads.map((e) => e.name), ["STRIPE_SECRET_KEY"]);
    assert.deepEqual(f.consts.Api, { literal: "https://api.stripe.com/v1", line: 3 });
    assert.deepEqual(f.sql.map((q) => `${q.op} ${q.table}`), ["write charges"]);
  });

  it("reads a DbContext's sets, and each use of one as a read or a write", async () => {
    const f = await factsOf(
      "Shop.cs",
      `public class ShopContext : DbContext
{
    public DbSet<Order> Orders { get; set; }
    public DbSet<User> People => Set<User>();
    public string Name { get; set; }
}
public class Orders(ShopContext db)
{
    private readonly ShopContext _context;
    public void Run(Order o, Other other)
    {
        db.Orders.Add(o);
        var all = _context.Orders.Where(x => x.Id > 1).ToList();
        _context.People.Where(p => p.Old).ExecuteDelete();
        this._context.Orders.Remove(o);
        other.Orders.Add(o);
        db.SaveChanges();
    }
}`,
    );
    assert.deepEqual(f.entity?.entities, [
      { cls: "Order", table: "Orders", line: 3, set: true },
      { cls: "User", table: "People", line: 4, set: true },
    ]);
    // `other` is no DbContext; SaveChanges is a method, not a set, and the link step drops what is no set.
    assert.deepEqual(f.entity?.uses.filter((u) => ["Orders", "People"].includes(u.set!)).map((u) => `${u.op} ${u.set}@${u.line}`), ["write Orders@12", "read Orders@13", "write People@14", "write Orders@15"]);
  });
});

describe("C# settings, table names and Refit", () => {
  it("reads IConfiguration by the key it names, and what holds the value", async () => {
    const f = await factsOf(
      "Clients.cs",
      `public class Clients
{
    private readonly string _users;
    public string Pay { get; } = "";
    public Clients(IConfiguration config, IConfiguration _configuration)
    {
        _users = config["Users:Url"] ?? "http://localhost:5001";
        var retries = config.GetValue<int>("Users:Retries");
        var db = _configuration.GetConnectionString("Default");
        var region = config.GetSection("App")["Region"];
        var mode = config.GetSection("App:Mode").Value;
        var t = config.GetSection("Users").GetValue<int>("Timeout");
        var other = dictionary["not:config"];
    }
    Task One(int id) => _http.GetAsync($"{_users}/api/users/{id}");
}`,
    );
    assert.deepEqual(f.envReads.map((e) => `${e.name}@${e.line}`), ["Users:Url@7", "Users:Retries@8", "ConnectionStrings:Default@9", "App:Region@10", "App:Mode@11", "Users:Timeout@12"]);
    assert.deepEqual(f.consts._users, { envVar: "Users:Url", literal: "http://localhost:5001", line: 7 });
    assert.equal(f.consts.db.envVar, "ConnectionStrings:Default");
    assert.deepEqual(f.http.map((h) => `${h.method} ${h.url} ${h.varName} or ${h.literalBase}`), ["GET */api/users/* Users:Url or http://localhost:5001"]);
  });

  it("reads a table's own name: [Table] on the class, ToTable in the model builder, [Column] and [NotMapped] on a property", async () => {
    const f = await factsOf(
      "Model.cs",
      `[Table("orders")]
public class Order
{
    public int Id { get; set; }
    [Column("total_cents")] public long Total { get; set; }
    [NotMapped] public string Label => "x";
}
public class ShopContext : DbContext
{
    public DbSet<Order> Orders { get; set; }
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>().ToTable("people");
        modelBuilder.Entity<Shop.Models.Line>(e =>
        {
            e.HasKey(x => x.Id);
            e.ToTable("order_lines");
        });
    }
}`,
    );
    assert.deepEqual(f.entity?.names, [
      { cls: "Order", table: "orders", line: 1 },
      { cls: "User", table: "people", line: 13 },
      { cls: "Line", table: "order_lines", line: 17 },
    ]);
    assert.deepEqual(f.entity?.fields.Order.columns, [{ name: "Id", type: "int" }, { name: "total_cents", type: "long" }]);
  });

  it("gives the named table to the DbSet's uses, wherever the name is written", async () => {
    const m = await mapOf({
      "Data/ShopContext.cs": 'namespace Shop;\npublic class ShopContext : DbContext {\n  public DbSet<Order> Orders { get; set; }\n  public DbSet<User> Users { get; set; }\n  public DbSet<Tag> Tags { get; set; }\n  protected override void OnModelCreating(ModelBuilder b) { b.Entity<User>().ToTable("people"); }\n}\n',
      "Models/Order.cs": 'namespace Shop;\n[Table("orders")]\npublic class Order { public int Id { get; set; } }\npublic class User { public int Id { get; set; } }\npublic class Tag { public int Id { get; set; } }\n',
      "Services/Orders.cs": "namespace Shop;\npublic class Orders {\n  private readonly ShopContext _db;\n  public void Run(Order o) { _db.Orders.Add(o); _db.Users.ToList(); _db.Tags.ToList(); }\n}\n",
    });
    assert.deepEqual(m.nodes.filter((n) => n.kind === "table").map((n) => n.name).sort(), ["Tags", "orders", "people"]);
    const data = m.edges.filter((e) => ["reads", "writes"].includes(e.kind)).map((e) => `${e.kind} ${e.to}`).sort();
    assert.deepEqual(data, ["reads table:people", "reads table:tags", "writes table:orders"]);
  });

  it("reads a Refit interface's methods as requests, and nothing from a class or a controller", async () => {
    const f = await factsOf("IUsersApi.cs", 'public interface IUsersApi\n{\n    [Get("/api/users/{id}")]\n    Task<User> One(int id);\n    [Post("/api/users")]\n    Task Create([Body] User user);\n    [Headers("X: 1")]\n    Task Other();\n}\npublic class NotRefit { [Get("/x")] public void F() { } }\n');
    assert.deepEqual(f.http.map((h) => `${h.method} ${h.url} ${h.callee} @${h.line}`), ["GET /api/users/* IUsersApi.One @3", "POST /api/users IUsersApi.Create @5"]);
    assert.deepEqual(f.routes, [], "a Refit attribute is a request sent, not a route answered");
  });
});

describe("C# types on the map", () => {
  it("finds a type in an opened namespace, in the file's own, in one around it, and by an alias", async () => {
    const m = await mapOf({
      "Api/Orders.cs": "using Shop.Core;\nusing Db = Shop.Data.ShopContext;\nnamespace Shop.Api.V1;\npublic class Orders {\n  private readonly Service _service;\n  void Run(Db db, Limits limits) { _service.Go(); Helper.Help(); Root.Start(); }\n}\n",
      "Api/Helper.cs": "namespace Shop.Api.V1;\nstatic class Helper { public static void Help() { } }\n",
      "Api/Limits.cs": "namespace Shop.Api;\npublic class Limits { }\n",
      "Root.cs": "namespace Shop;\npublic static class Root { public static void Start() { } }\n",
      "Core/Service.cs": "namespace Shop.Core;\npublic class Service { public void Go() { } }\n",
      "Data/ShopContext.cs": "namespace Shop.Data;\npublic class ShopContext { }\n",
      "Other/Helper.cs": "namespace Other;\npublic class Helper { }\n",
    });
    assert.deepEqual(imports(m), [
      "Api/Orders.cs -> Api/Helper.cs [Help]",
      "Api/Orders.cs -> Api/Limits.cs",
      "Api/Orders.cs -> Core/Service.cs [Go]",
      "Api/Orders.cs -> Data/ShopContext.cs",
      "Api/Orders.cs -> Root.cs [Start]",
    ]);
    assert.equal(m.stats.otherCode?.["C#"], undefined);
  });

  it("settles a DbSet, its entity's properties and its uses into one table, wherever each is written", async () => {
    const m = await mapOf({
      "Data/ShopContext.cs": "namespace Shop;\npublic class ShopContext : DbContext {\n  public DbSet<Order> Orders { get; set; }\n}\n",
      "Models/Order.cs": "namespace Shop;\npublic class Order {\n  public int Id { get; set; }\n  public string Note { get; set; }\n  public Customer Buyer { get; set; }\n  public List<Order> Parts { get; set; }\n  public static int Count { get; set; }\n}\npublic class Customer { public int Id { get; set; } }\n",
      "Services/OrderService.cs": "namespace Shop;\npublic class OrderService {\n  private readonly ShopContext _db;\n  public void Add(Order o) { _db.Orders.Add(o); }\n  public int Count() { return _db.Orders.Count(); }\n  public void Other(Basket basket) { basket.Orders.Clear(); }\n}\n",
    });
    const tables = m.nodes.filter((n) => n.kind === "table").map((n) => `${n.name}(${n.columns?.map((c) => `${c.name}:${c.type}`).join(",")})`);
    assert.deepEqual(tables, ["Orders(Id:int,Note:string,Buyer:Customer)"], "a list is a relation; a class that is no table stays (EF Core may own it)");
    const data = m.edges.filter((e) => ["reads", "writes", "defines"].includes(e.kind)).map((e) => `${e.kind} ${e.from.slice(5)}@${e.evidence[0].line}`).sort();
    assert.deepEqual(data, ["defines Data/ShopContext.cs@3", "reads Services/OrderService.cs@5", "writes Services/OrderService.cs@4"]);
    assert.equal(m.nodes.find((n) => n.id === "file:Models/Order.cs")?.layer, "data");
    assert.equal(m.nodes.find((n) => n.id === "file:Data/ShopContext.cs")?.layer, "data");
    assert.equal(m.nodes.find((n) => n.id === "file:Services/OrderService.cs")?.layer, "logic");
  });
});

describe("an ASP.NET Core app end to end (fixtures/aspnet-todos)", () => {
  it("draws the controller's routes and the minimal APIs, with the prefix each sits under", async () => {
    const { map } = await buildFixture("aspnet-todos");
    const routes = map.nodes.filter((n) => n.kind === "route").map((n) => `${n.name}${n.handler ? ` -> ${n.handler}` : ""}`).sort();
    assert.deepEqual(routes, [
      "DELETE /api/lists/{id} -> ListHandlers.Remove",
      "DELETE /api/todos/{id} -> TodosController.Remove",
      "GET /api/lists",
      "GET /api/ping -> TodosController.Ping",
      "GET /api/todos -> TodosController.List",
      "GET /api/todos/{id} -> TodosController.One",
      "GET /health",
      "POST /api/lists",
      "POST /api/todos -> TodosController.Create",
    ]);
    const calls = map.edges.filter((e) => e.kind === "calls").map((e) => `${e.from.split("#")[1]} -> ${e.to.slice(5)} [${e.toFns?.join(",")}]`).sort();
    assert.deepEqual(calls, [
      "DELETE /api/todos/{id} -> Services/TodoService.cs [Remove]",
      "GET /api/todos -> Services/TodoService.cs [All]",
      "GET /api/todos/{id} -> Services/TodoService.cs [Find]",
      "POST /api/todos -> Services/TodoService.cs [Add]",
    ]);
  });

  it("makes the DbSets tables with their entity's columns, read and written where the code uses them", async () => {
    const { map } = await buildFixture("aspnet-todos");
    const tables = map.nodes.filter((n) => n.kind === "table").map((n) => `${n.name}(${n.columns?.map((c) => c.name).join(",")})`).sort();
    // Todo says [Table("todo_items")] and [Column("is_done")]; TodoList is named in OnModelCreating; Label is [NotMapped].
    assert.deepEqual(tables, ["todo_items(Id,Title,is_done)", "todo_lists(Id,Name)"]);
    const data = map.edges.filter((e) => ["reads", "writes", "defines"].includes(e.kind)).map((e) => `${e.kind} ${e.from.replace(/^(file|route):/, "").replace(/^.*#/, "")} -> ${e.to}`).sort();
    assert.deepEqual(data, [
      "defines Data/TodoContext.cs -> table:todo_items",
      "defines Data/TodoContext.cs -> table:todo_lists",
      "reads GET /api/lists -> table:todo_lists",
      "reads Services/TodoService.cs -> table:todo_items",
      "writes DELETE /api/lists/{id} -> table:todo_lists",
      "writes POST /api/lists -> table:todo_lists",
      "writes Services/TodoService.cs -> table:todo_items",
    ]);
  });

  it("links the service to its DbContext, and to Slack and users by what appsettings.json says; leaves tests and the compiler's files out", async () => {
    const { map } = await buildFixture("aspnet-todos");
    assert.ok(imports(map).includes("Services/TodoService.cs -> Data/TodoContext.cs [SaveChangesAsync]"), imports(map).join("\n"));
    assert.ok(imports(map).includes("Controllers/TodosController.cs -> Services/TodoService.cs [All,Find,Add,Remove]"), imports(map).join("\n"));
    const uses = map.edges.filter((e) => e.kind === "uses-service").map((e) => `${e.to} (${e.evidence.map((v) => `${v.file.split("/").pop()}:${v.line}`).join(", ")})`).sort();
    // _usersUrl = config.GetValue<string>("Users:Url") → appsettings.json line 4; _notify = config["Slack:Webhook"] → line 7.
    assert.deepEqual(uses, ["svc-int:svc-users (TodoService.cs:34, appsettings.json:4)", "svc:slack (TodoService.cs:33, appsettings.json:7, TodoService.cs:20)"]);
    assert.ok(imports(map).includes("Services/TodoService.cs -> Services/IUsersApi.cs [Notify]"), "the Refit interface is a file like any other");
    assert.deepEqual(map.files.filter((f) => f.configKind === "settings").map((f) => f.path).sort(), ["appsettings.Development.json", "appsettings.json"]);
    const skipped = Object.fromEntries(map.files.filter((f) => f.skipped).map((f) => [f.path, f.skipped]));
    assert.deepEqual(skipped, { "obj/Debug/net9.0/Todos.AssemblyInfo.cs": "generated", "Todos.Tests/TodoServiceTests.cs": "test" });
    // The Refit requests go to a users service whose code is not here: said, not guessed.
    assert.ok(map.warnings.every((w) => /users/.test(w)), map.warnings.join("\n"));
  });
});
