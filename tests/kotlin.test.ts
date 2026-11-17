// Kotlin on the map (src/analyzer/extract/kotlin.ts, resolveTyped in build.ts, extract/entities.ts):
// classes, objects and top-level functions found by their full name (imports, the same package,
// Java classes too), calls followed through declared types, Spring MVC and Ktor routes, JPA
// entities and Spring Data repositories, HTTP clients, `@Value` settings; the kotlin-spring-notes
// fixture end to end. The grammar is the tree-sitter-grammars build, loaded here as in the app.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { drawnLang, readableLanguage } from "../src/analyzer/config/files";
import { grammarFor } from "../src/analyzer/parser";
import type { CodeMap } from "../src/analyzer/types";
import { buildFixture, factsOf } from "./analyzer.helpers";

const mapOf = async (files: Record<string, string>): Promise<CodeMap> => (await buildMap(Object.entries(files).map(([path, content]) => ({ path, content })), { name: "t" })).map;
const imports = (m: CodeMap) => m.edges.filter((e) => e.kind === "imports").map((e) => `${e.from.slice(5)} -> ${e.to.slice(5)}${e.toFns?.length ? ` [${e.toFns.join(",")}]` : ""}`).sort();
const K = "src/main/kotlin/com/acme/notes";
const D = "$";

describe("Kotlin facts", () => {
  it("is drawn, .kt and .kts, no longer only read", () => {
    assert.equal(drawnLang("src/main/kotlin/app/Main.kt"), "kotlin");
    assert.equal(drawnLang("scripts/seed.kts"), "kotlin");
    assert.equal(readableLanguage("Main.kt"), null);
    assert.equal(grammarFor("Main.kt"), "kotlin");
  });

  it("reads the package, imports (an alias too), a starred import, and what the file declares at the top", async () => {
    const f = await factsOf("A.kt", "package shop.api\n\nimport shop.core.OrderService\nimport shop.data.*\nimport shop.util.parseMoney as money\n\nclass A(val x: shop.audit.Trail)\nobject Registry\nfun helper(): Int = 1\nval LIMIT = 3\nprivate fun hidden() {}\nfun String.shout(): String = uppercase()\n");
    assert.equal(f.typed?.namespace, "shop.api");
    assert.deepEqual(f.imports.map((i) => `${i.spec} ${i.names[0].local}@${i.line}`), ["shop.core.OrderService OrderService@3", "shop.util.parseMoney money@5", "shop.audit.Trail Trail@7"]);
    assert.deepEqual(f.typed?.opens, [{ ns: "shop.data", line: 4 }]);
    assert.deepEqual(f.typed?.types, ["A", "Registry", "helper", "LIMIT", "hidden"], "an extension function is not found by its own name");
    assert.deepEqual(f.exports, ["A", "Registry", "helper"]);
  });

  it("names a method by its class, an object's and a companion's too, and a call by the declared type of what it is called on", async () => {
    const f = await factsOf(
      "OrderService.kt",
      `package shop.core
class OrderService(private val repo: OrderRepository, mailer: Mailer) {
    lateinit var clock: Clock
    private val audit = Audit()

    fun place(order: Order, stamps: Stamper): Order {
        val helper = Helper()
        val stamp: Stamp = stamps.now()
        helper.run(stamp)
        audit.log(order)
        this.clock.tick()
        Money.parse("1")
        cleanTitle("x")
        return repo.save(order)
    }

    private fun quiet() {}

    companion object {
        fun create(): OrderService = OrderService(OrderRepository(), Mailer())
    }
}
object Registry {
    fun all(): List<String> = listOf()
}
fun topLevel(a: Int): Int = a + 1
`,
    );
    assert.deepEqual(f.fns.map((x) => `${x.name}${x.exported ? " pub" : ""}`), ["OrderService.place pub", "OrderService.quiet", "OrderService.create pub", "Registry.all pub", "topLevel pub"]);
    assert.deepEqual(f.fns[0].calls.sort(), ["Audit.log", "Clock.tick", "Helper.Helper", "Helper.run", "Money.parse", "OrderRepository.save", "Stamper.now", "cleanTitle"]);
    assert.deepEqual(f.fns[2].calls.sort(), ["Mailer.Mailer", "OrderRepository.OrderRepository", "OrderService.OrderService"]);
  });

  it("reads Spring MVC routes under the class's own mapping, with the method that answers each", async () => {
    const f = await factsOf(
      "OrderController.kt",
      `@RestController
@RequestMapping("/api/orders")
class OrderController(private val orders: OrderService) {
    @GetMapping
    fun list(): List<Order> = orders.all()

    @GetMapping("/{id}")
    fun one(@PathVariable id: Long): Order = orders.find(id)

    @PostMapping(path = ["/bulk"])
    fun bulk() {}

    @RequestMapping(value = ["/{id}"], method = [RequestMethod.DELETE])
    fun cancel(@PathVariable id: Long) {}

    fun helper() {}
}`,
    );
    assert.deepEqual(
      f.routes.map((r) => `${r.method} ${r.path} ${r.handler} ${r.line}-${r.endLine}`),
      ["GET /api/orders OrderController.list 4-5", "GET /api/orders/{id} OrderController.one 7-8", "POST /api/orders/bulk OrderController.bulk 10-11", "DELETE /api/orders/{id} OrderController.cancel 13-14"],
    );
  });

  it("still finds a class's annotations when the parser reads them as a statement in front of it", async () => {
    // A member written on one line with its braces makes this grammar lose the class's annotations.
    const f = await factsOf("C.kt", 'import a.b.c as d\n\n@RestController\n@RequestMapping("/api/things")\nclass C(private val s: S) : Base(), Api {\n    @GetMapping("/{id}")\n    fun one(): Int = s.find()\n\n    companion object { const val BASE = "x" }\n}\n');
    assert.deepEqual(f.routes.map((r) => `${r.method} ${r.path}`), ["GET /api/things/{id}"]);
  });

  it("reads Ktor routes: inside routing, under route(), and in a function on Route", async () => {
    const f = await factsOf(
      "Routes.kt",
      `fun Application.module() {
    routing {
        get("/health") { call.respondText("ok") }
        route("/api") {
            route("/v1") {
                post("/orders") { service.place(call.receive()) }
            }
        }
    }
}

fun Route.users(svc: UserService) {
    get("/users/{id}") { svc.find(1) }
    delete("/users/{id}") { svc.remove(1) }
}

fun other(map: Map<String, String>) {
    map.get("/not-a-route")
    get("/also-not") { }
}`,
    );
    assert.deepEqual(f.routes.map((r) => `${r.method} ${r.path} @${r.line}`), ["GET /health @3", "POST /api/v1/orders @6", "GET /users/{id} @13", "DELETE /users/{id} @14"]);
  });

  it("reads JPA entities: constructor properties and body properties as columns, relations left out", async () => {
    const f = await factsOf(
      "Note.kt",
      `@Entity
@Table(name = "notes")
data class Note(
    @Id val id: Long = 0,
    val title: String,
    @Column(name = "body_text") val body: String,
    @ManyToOne val author: Author? = null,
) {
    var pinnedAt: Instant? = null
    @Transient var draft: Boolean = false
}
@Entity
class Author { @Id var id: Long = 0 }
interface NoteRepository : JpaRepository<Note, Long>
class Plain(val name: String)`,
    );
    assert.deepEqual(f.entity?.entities.map((e) => `${e.cls}=${e.table}@${e.line}`), ["Note=notes@1", "Author=author@12"]);
    assert.deepEqual(f.entity?.fields.Note.columns.map((c) => `${c.name}:${c.type}`), ["id:Long", "title:String", "body_text:String", "pinned_at:Instant?"]);
    assert.deepEqual(f.entity?.uses, [{ cls: "Note", op: "read", line: 14 }, { cls: "Note", op: "write", line: 14 }]);
  });

  it("finds requests with a string template for a URL, @Value settings, the environment and SQL", async () => {
    const f = await factsOf(
      "Clients.kt",
      `class Clients(@Value("\\${D}{users.url}") private val usersUrl: String, private val http: HttpClient) {
    @Value("\\${D}{pay.url:https://pay.example.com}")
    lateinit var payUrl: String
    private val rest = RestTemplate()
    private val web = WebClient.create("http://tags:8080")

    suspend fun run(id: Long) {
        val key = System.getenv("USERS_API_KEY")
        rest.getForObject("${D}usersUrl/api/users/${D}id", String::class.java)
        rest.postForObject(payUrl + "/charges", null, String::class.java)
        web.get().uri("/api/tags/{id}", id).retrieve()
        http.delete("http://users:8080/api/sessions/${D}{id}")
        Request.Builder().url("${D}BASE/hooks").post(body).build()
        jdbc.update("INSERT INTO charges (amount) VALUES (?)", 1)
        map.get("not a request")
    }

    companion object {
        const val BASE = "https://hooks.slack.com"
    }
}`,
    );
    assert.deepEqual(f.envReads.map((e) => `${e.name}@${e.line}`), ["users.url@1", "pay.url@2", "USERS_API_KEY@8"]);
    assert.deepEqual(f.consts.payUrl, { envVar: "pay.url", literal: "https://pay.example.com", line: 2 });
    assert.deepEqual(
      f.http.map((h) => `${h.method} ${h.url} ${h.varName ?? h.literalBase ?? "literal"}`),
      ["GET */api/users/* users.url", "POST */charges pay.url", "GET http://tags:8080/api/tags/* literal", "DELETE http://users:8080/api/sessions/* literal", "POST */hooks https://hooks.slack.com"],
    );
    assert.deepEqual(f.sql.map((q) => `${q.op} ${q.table}`), ["write charges"]);
  });
});

describe("Kotlin names on the map", () => {
  it("finds a class by import, in the same package, a top-level function by import and by package, and a Java class", async () => {
    const m = await mapOf({
      "src/main/kotlin/shop/api/Api.kt": "package shop.api\n\nimport shop.core.Service\nimport shop.util.parseMoney\nimport shop.legacy.Audit\n\nclass Api(private val service: Service) {\n    fun run() {\n        service.go()\n        Helper.help()\n        parseMoney(\"1\")\n        local()\n        Audit.log(\"x\")\n    }\n}\n",
      "src/main/kotlin/shop/api/Helper.kt": "package shop.api\n\nobject Helper {\n    fun help() {}\n}\n\nfun local() {}\n",
      "src/main/kotlin/shop/core/Service.kt": "package shop.core\n\nclass Service {\n    fun go() {}\n}\n",
      "src/main/kotlin/shop/util/Money.kt": "package shop.util\n\nfun parseMoney(s: String): Long = s.toLong()\n",
      "src/main/java/shop/legacy/Audit.java": "package shop.legacy;\npublic class Audit { public static void log(String s) {} }\n",
      "src/main/java/shop/legacy/Caller.java": "package shop.legacy;\nimport shop.core.Service;\npublic class Caller { void f(Service s) { s.go(); } }\n",
    });
    const A = "src/main/kotlin/shop";
    assert.deepEqual(imports(m), [
      // Java calls Kotlin by the same full name.
      `src/main/java/shop/legacy/Caller.java -> ${A}/core/Service.kt [go]`,
      `${A}/api/Api.kt -> src/main/java/shop/legacy/Audit.java [log]`,
      `${A}/api/Api.kt -> ${A}/api/Helper.kt [help,local]`,
      `${A}/api/Api.kt -> ${A}/core/Service.kt [go]`,
      `${A}/api/Api.kt -> ${A}/util/Money.kt [parseMoney]`,
    ]);
    assert.equal(m.nodes.find((n) => n.id === `file:${A}/api/Api.kt`)?.name, "shop/api/Api", "src/main/kotlin is left out of a card's name");
    assert.equal(m.stats.otherCode?.Kotlin, undefined);
  });

  it("leaves Gradle's Kotlin scripts off the map", async () => {
    const m = await mapOf({ "build.gradle.kts": 'plugins {\n    kotlin("jvm") version "2.2.0"\n}\n', "settings.gradle.kts": 'rootProject.name = "x"\n', "src/main/kotlin/Main.kt": "fun main() {}\n" });
    assert.deepEqual(m.nodes.map((n) => n.id), ["file:src/main/kotlin/Main.kt"]);
    assert.equal(m.files.find((f) => f.path === "build.gradle.kts")?.skipped, "build script");
  });
});

describe("a Kotlin Spring service end to end (fixtures/kotlin-spring-notes)", () => {
  it("draws every route under /api/notes, each calling the service method its handler calls", async () => {
    const { map } = await buildFixture("kotlin-spring-notes");
    const routes = map.nodes.filter((n) => n.kind === "route").map((n) => `${n.name} -> ${n.handler}`).sort();
    assert.deepEqual(routes, ["DELETE /api/notes/{id} -> NoteController.remove", "GET /api/notes -> NoteController.list", "GET /api/notes/{id} -> NoteController.one", "POST /api/notes -> NoteController.create"]);
    const calls = map.edges.filter((e) => e.kind === "calls").map((e) => `${e.from.split("#")[1]} -> ${e.to.slice(5 + K.length + 1)} [${e.toFns?.join(",")}]`).sort();
    assert.deepEqual(calls, ["DELETE /api/notes/{id} -> core/NoteService.kt [remove]", "GET /api/notes -> core/NoteService.kt [all]", "GET /api/notes/{id} -> core/NoteService.kt [find]", "POST /api/notes -> core/NoteService.kt [add]"]);
  });

  it("follows the service to its repository, its client, a function of its own package and a Java class", async () => {
    const { map } = await buildFixture("kotlin-spring-notes");
    const from = imports(map).filter((l) => l.startsWith(`${K}/core/NoteService.kt`)).map((l) => l.replaceAll(`${K}/`, ""));
    assert.deepEqual(from, [
      "core/NoteService.kt -> src/main/java/com/acme/notes/legacy/Audit.java [log]",
      "core/NoteService.kt -> client/TagClient.kt [suggest]",
      // cleanTitle() is a function on its own in Titles.kt; Slugs is an object there.
      "core/NoteService.kt -> core/Titles.kt [of,cleanTitle]",
      "core/NoteService.kt -> data/Note.kt [copy]",
      "core/NoteService.kt -> data/NoteRepository.kt [findAll,findById,save,deleteById]",
    ]);
  });

  it("makes the entities tables, the repository their reader and writer, and the client a call where application.yml says", async () => {
    const { map } = await buildFixture("kotlin-spring-notes");
    const tables = map.nodes.filter((n) => n.kind === "table").map((n) => `${n.name}(${n.columns?.map((c) => c.name).join(",")})`).sort();
    assert.deepEqual(tables, ["author(id,full_name)", "notes(id,title,body_text)"]);
    const kinds = (k: string) => map.edges.filter((e) => e.kind === k).map((e) => `${e.from.slice(5 + K.length + 1)} -> ${e.to}`).sort();
    assert.deepEqual(kinds("defines"), ["data/Author.kt -> table:author", "data/Note.kt -> table:notes"]);
    assert.deepEqual(kinds("reads"), ["data/NoteRepository.kt -> table:notes"]);
    assert.deepEqual(kinds("writes"), ["data/NoteRepository.kt -> table:notes"]);
    const use = map.edges.find((e) => e.kind === "uses-service")!;
    assert.equal(`${use.from.slice(5 + K.length + 1)} -> ${use.to}`, "client/TagClient.kt -> svc-int:svc-tags");
    assert.deepEqual(use.evidence.map((v) => `${v.file.split("/").pop()}:${v.line}`), ["TagClient.kt:13", "application.yml:2"]);
    const layers = Object.fromEntries(map.nodes.filter((n) => n.kind === "module").map((n) => [n.name.split("/").pop(), n.layer]));
    assert.deepEqual(layers, { Audit: "logic", TagClient: "logic", NoteService: "logic", Titles: "logic", Author: "data", Note: "data", NoteRepository: "data", NotesApplication: "logic" });
  });

  it("leaves the test and the build script out of the map", async () => {
    const { map } = await buildFixture("kotlin-spring-notes");
    const skipped = Object.fromEntries(map.files.filter((f) => f.skipped).map((f) => [f.path.split("/").pop(), f.skipped]));
    assert.deepEqual(skipped, { "build.gradle.kts": "build script", "NoteServiceTest.kt": "test" });
    assert.equal(map.stats.otherCode, undefined);
  });
});
