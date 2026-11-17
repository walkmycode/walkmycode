// Java on the map (src/analyzer/extract/java.ts, resolveTyped in build.ts, extract/entities.ts):
// classes found by their full name (imports, `import a.b.*`, the same package), methods and
// the calls followed through declared types, Spring MVC and JAX-RS routes, JPA entities and
// Spring Data repositories as tables (Lombok or not), RestTemplate, WebClient, OkHttp and
// java.net.http calls, `@Value` settings; the spring-orders fixture end to end. npm's own grammar build (tree-sitter-java) is the one loaded here, as in the app.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { drawnLang, readableLanguage } from "../src/analyzer/config/files";
import { snake } from "../src/analyzer/extract/java";
import type { CodeMap } from "../src/analyzer/types";
import { buildFixture, factsOf } from "./analyzer.helpers";

const mapOf = async (files: Record<string, string>): Promise<CodeMap> => (await buildMap(Object.entries(files).map(([path, content]) => ({ path, content })), { name: "t" })).map;
const imports = (m: CodeMap) => m.edges.filter((e) => e.kind === "imports").map((e) => `${e.from.slice(5)} -> ${e.to.slice(5)}${e.toFns?.length ? ` [${e.toFns.join(",")}]` : ""}`).sort();
const J = "src/main/java/com/acme/orders";

describe("Java facts", () => {
  it("is drawn, no longer only read", () => {
    assert.equal(drawnLang("src/main/java/app/Main.java"), "java");
    assert.equal(readableLanguage("Main.java"), null);
  });

  it("reads the package, each import by its full name, a starred import as an opened package", async () => {
    const f = await factsOf("A.java", "package shop.api;\nimport shop.core.OrderService;\nimport shop.data.*;\nimport static shop.util.Money.parse;\nimport java.util.List;\nclass A { private shop.audit.Trail trail; }\n");
    assert.equal(f.typed?.namespace, "shop.api");
    assert.deepEqual(f.imports.map((i) => `${i.spec} ${i.names[0].local}@${i.line}`), ["shop.core.OrderService OrderService@2", "shop.util.Money.parse parse@4", "java.util.List List@5", "shop.audit.Trail Trail@6"]);
    assert.deepEqual(f.typed?.opens, [{ ns: "shop.data", line: 3 }]);
    assert.deepEqual(f.typed?.types, ["A"]);
  });

  it("names a method by its class and a call by the declared type of what it is called on", async () => {
    const f = await factsOf(
      "OrderService.java",
      `package shop.core;
public class OrderService {
    private final OrderRepository repo;
    private Mailer mailer;
    public OrderService(OrderRepository repo) { this.repo = repo; }
    public Order place(Order order, Clock clock) {
        var audit = new Audit();
        Stamp stamp = clock.now();
        audit.log(stamp);
        this.mailer.send(order);
        Money.parse("1");
        helper();
        return repo.save(order);
    }
    void helper() {}
    static class Inner { void run() {} }
}
interface Clock { Stamp now(); }
enum Kind { A }
record Money(long cents) { static Money parse(String s) { return new Money(1); } }
`,
    );
    assert.deepEqual(f.fns.map((x) => `${x.name}${x.exported ? " pub" : ""}`), ["OrderService.OrderService pub", "OrderService.place pub", "OrderService.helper", "OrderService.Inner.run", "Clock.now pub", "Money.parse"]);
    assert.deepEqual(f.fns[1].calls.sort(), ["Audit.Audit", "Audit.log", "Clock.now", "Mailer.send", "Money.parse", "OrderRepository.save", "helper"]);
    assert.deepEqual(f.exports, ["OrderService", "Clock", "Kind", "Money"]);
    assert.deepEqual(f.typed?.types, ["OrderService", "Clock", "Kind", "Money"]);
    // The types the code names and does not declare, each on the first line it is named.
    assert.deepEqual(f.typed?.refs.filter((r) => !["String"].includes(r.name)).map((r) => `${r.name}@${r.line}`), ["OrderRepository@3", "Mailer@4", "Order@6", "Audit@7", "Stamp@8"]);
  });

  it("reads Spring MVC routes under the class's own mapping, with the method that answers each", async () => {
    const f = await factsOf(
      "OrderController.java",
      `@RestController
@RequestMapping("/api/orders")
public class OrderController {
    @GetMapping
    public List<Order> list() { return null; }

    @GetMapping("/{id}")
    public Order one(@PathVariable Long id) { return null; }

    @PostMapping(path = "/bulk")
    public void bulk() {}

    @RequestMapping(value = {"/{id}", "/{id}/"}, method = RequestMethod.DELETE)
    public void cancel(@PathVariable Long id) {}

    @RequestMapping("/any")
    public void any() {}

    public void helper() {}
}`,
    );
    assert.deepEqual(
      f.routes.map((r) => `${r.method} ${r.path} ${r.handler} ${r.line}-${r.endLine}`),
      ["GET /api/orders OrderController.list 4-5", "GET /api/orders/{id} OrderController.one 7-8", "POST /api/orders/bulk OrderController.bulk 10-11", "DELETE /api/orders/{id} OrderController.cancel 13-14", "ANY /api/orders/any OrderController.any 16-17"],
    );
  });

  it("reads JAX-RS routes: the class's @Path, a method's verb and its own @Path", async () => {
    const f = await factsOf("Users.java", '@Path("/users")\npublic class Users {\n    @GET\n    public String all() { return ""; }\n\n    @POST\n    @Path("{id}/ban")\n    public void ban() {}\n}\n');
    assert.deepEqual(f.routes.map((r) => `${r.method} ${r.path} ${r.handler}`), ["GET /users Users.all", "POST /users/{id}/ban Users.ban"]);
  });

  it("finds RestTemplate calls with their URL, System.getenv, a constant and SQL in strings", async () => {
    const f = await factsOf(
      "PayClient.java",
      `public class PayClient {
    private static final String API = "https://api.stripe.com/v1";
    private final RestTemplate rest = new RestTemplate();
    void charge(String id) {
        String key = System.getenv("STRIPE_SECRET_KEY");
        rest.postForObject(API + "/charges", null, String.class);
        rest.getForEntity("http://users:8080/api/users/" + id, String.class);
        restTemplate.delete(baseUrl + "/api/sessions/" + id);
        jdbc.update("INSERT INTO charges (amount) VALUES (?)", 1);
        list.put("not", "a request");
    }
}`,
    );
    assert.deepEqual(
      f.http.map((h) => `${h.method} ${h.url} ${h.fromVariable ? `base=${h.literalBase ?? "?"}` : "literal"}`),
      ["POST */charges base=https://api.stripe.com/v1", "GET http://users:8080/api/users/* literal", "DELETE */api/sessions/* base=?"],
    );
    assert.deepEqual(f.envReads.map((e) => e.name), ["STRIPE_SECRET_KEY"]);
    assert.deepEqual(f.consts.API, { literal: "https://api.stripe.com/v1", line: 2 });
    assert.deepEqual(f.sql.map((q) => `${q.op} ${q.table}`), ["write charges"]);
  });

  it("reads @Value on a field and on a constructor's parameter as a setting, with its default", async () => {
    const f = await factsOf(
      "UserClient.java",
      `public class UserClient {
    @Value("\${users.url}")
    private String usersUrl;
    private final String payUrl;
    public UserClient(@Value("\${payments.url:https://pay.example.com}") String payUrl, Environment env) {
        this.payUrl = payUrl;
        String region = env.getProperty("app.region");
    }
    void check(long id) {
        rest.getForObject(usersUrl + "/api/users/" + id, String.class);
        rest.postForObject(payUrl + "/charges", null, String.class);
    }
}`,
    );
    assert.deepEqual(f.envReads.map((e) => `${e.name}@${e.line}`), ["users.url@2", "payments.url@5", "app.region@7"]);
    assert.deepEqual(f.consts, { usersUrl: { envVar: "users.url", line: 2 }, payUrl: { envVar: "payments.url", literal: "https://pay.example.com", line: 5 } });
    assert.deepEqual(
      f.http.map((h) => `${h.method} ${h.url} ${h.varName}${h.literalBase ? ` or ${h.literalBase}` : ""}`),
      ["GET */api/users/* users.url", "POST */charges payments.url or https://pay.example.com"],
    );
  });

  it("reads WebClient calls: the verb before the URL, the client's one base in front of a path", async () => {
    const f = await factsOf(
      "PayClient.java",
      `public class PayClient {
    private final WebClient client;
    public PayClient(@Value("\${payments.url}") String base) {
        this.client = WebClient.builder().baseUrl(base).build();
    }
    void run(String id) {
        client.post().uri("/charges").retrieve();
        client.get().uri("/charges/{id}", id).retrieve();
        client.delete().uri("https://other.example.com/x").retrieve();
        builder.uri("not a request");
    }
}`,
    );
    assert.deepEqual(f.http.map((h) => `${h.method} ${h.url} ${h.varName ?? "literal"} @${h.line}`), ["POST */charges payments.url @7", "GET */charges/* payments.url @8", "DELETE https://other.example.com/x literal @9"]);
    const literal = await factsOf("A.java", 'class A { WebClient c = WebClient.create("http://users:8080"); void f() { c.put().uri("/api/users/{id}", 1); } }\n');
    assert.deepEqual(literal.http.map((h) => `${h.method} ${h.url}`), ["PUT http://users:8080/api/users/*"]);
    const two = await factsOf("B.java", 'class B { WebClient a = WebClient.create("http://a"); WebClient b = WebClient.create("http://b"); void f() { a.get().uri("/x"); } }\n');
    assert.deepEqual(two.http.map((h) => `${h.method} ${h.url}`), ["GET /x"], "two clients, two bases: the path alone");
  });

  it("reads OkHttp and java.net.http requests: the URL, and the verb given after it", async () => {
    const f = await factsOf(
      "Hooks.java",
      `public class Hooks {
    void run(String id) throws Exception {
        Request post = new Request.Builder()
            .url("https://hooks.slack.com/services/x")
            .post(body)
            .build();
        Request get = new Request.Builder().url("http://users:8080/api/users/" + id).build();
        HttpRequest del = HttpRequest.newBuilder().uri(URI.create("http://users:8080/api/sessions/" + id)).DELETE().build();
        HttpRequest plain = HttpRequest.newBuilder(URI.create("http://users:8080/health")).build();
    }
}`,
    );
    assert.deepEqual(f.http.map((h) => `${h.method} ${h.url} @${h.line}`), [
      "POST https://hooks.slack.com/services/x @3",
      "GET http://users:8080/api/users/* @7",
      "DELETE http://users:8080/api/sessions/* @8",
      "GET http://users:8080/health @9",
    ]);
  });

  it("names tables and columns the way Spring Boot does", () => {
    assert.equal(snake("OrderLine"), "order_line");
    assert.equal(snake("totalCents"), "total_cents");
    assert.equal(snake("URLPath"), "url_path");
    assert.equal(snake("id"), "id");
  });
});

describe("Java classes on the map", () => {
  it("finds a class by import, in an opened package, in the same package and by a static import", async () => {
    const m = await mapOf({
      "src/main/java/shop/api/Api.java": "package shop.api;\nimport shop.core.Service;\nimport shop.data.*;\nimport static shop.util.Money.parse;\npublic class Api {\n  private Service service;\n  void run(Repo repo) { service.go(); repo.all(); Helper.help(); parse(\"1\"); }\n}\n",
      "src/main/java/shop/api/Helper.java": "package shop.api;\nclass Helper { static void help() {} }\n",
      "src/main/java/shop/core/Service.java": "package shop.core;\npublic class Service { public void go() {} }\n",
      "src/main/java/shop/data/Repo.java": "package shop.data;\npublic class Repo { public void all() {} }\n",
      "src/main/java/shop/util/Money.java": "package shop.util;\npublic class Money { public static long parse(String s) { return 1; } }\n",
      "src/main/java/other/Helper.java": "package other;\npublic class Helper { }\n",
    });
    const A = "src/main/java/shop";
    assert.deepEqual(imports(m), [`${A}/api/Api.java -> ${A}/api/Helper.java [help]`, `${A}/api/Api.java -> ${A}/core/Service.java [go]`, `${A}/api/Api.java -> ${A}/data/Repo.java [all]`, `${A}/api/Api.java -> ${A}/util/Money.java [parse]`]);
    const same = m.edges.find((e) => e.to === `file:${A}/api/Helper.java`)!;
    assert.deepEqual(same.evidence.map((v) => v.line), [7], "no import to cite: the line the class is first named on");
    assert.equal(m.nodes.find((n) => n.id === `file:${A}/api/Api.java`)?.name, "shop/api/Api", "src/main/java is left out of a card's name");
    assert.equal(m.stats.otherCode?.Java, undefined);
  });

  it("settles a JPA entity, its repository and a JPQL query into one table", async () => {
    const m = await mapOf({
      "app/Order.java": 'package app;\n@Entity\n@Table(name = "orders")\npublic class Order {\n  @Id Long id;\n  @Column(name = "total_cents") long total;\n  String customerNote;\n  @ManyToOne Customer customer;\n  static int count;\n}\n',
      "app/Customer.java": "package app;\n@Entity\npublic class Customer { @Id Long id; String fullName; }\n",
      "app/OrderRepository.java": 'package app;\npublic interface OrderRepository extends JpaRepository<Order, Long> {}\n',
      "app/Reports.java": 'package app;\nclass Reports { Object big(EntityManager em) { return em.createQuery("SELECT o FROM Order o WHERE o.total > 10"); } }\n',
      "app/Dto.java": "package app;\nclass Dto { String name; }\n",
    });
    const tables = m.nodes.filter((n) => n.kind === "table").map((n) => `${n.name}(${n.columns?.map((c) => c.name).join(",")})`).sort();
    assert.deepEqual(tables, ["customer(id,full_name)", "orders(id,total_cents,customer_note)"]);
    const data = m.edges.filter((e) => ["reads", "writes", "defines"].includes(e.kind)).map((e) => `${e.kind} ${e.from.slice(5)} -> ${e.to}`).sort();
    assert.deepEqual(data, ["defines app/Customer.java -> table:customer", "defines app/Order.java -> table:orders", "reads app/OrderRepository.java -> table:orders", "reads app/Reports.java -> table:orders", "writes app/OrderRepository.java -> table:orders"]);
    assert.equal(m.nodes.find((n) => n.id === "file:app/Order.java")?.layer, "data");
    assert.equal(m.nodes.find((n) => n.id === "file:app/Dto.java")?.layer, "logic", "a class that is no entity is no table");
  });

  it("reads a Lombok entity like any other: the fields are the columns, and a generated getter is still a call", async () => {
    const m = await mapOf({
      "app/Customer.java": "package app;\nimport lombok.*;\n@Entity\n@Data\n@Builder\n@NoArgsConstructor\n@AllArgsConstructor\npublic class Customer {\n  @Id private Long id;\n  private String fullName;\n  @Getter(AccessLevel.NONE) private String passwordHash;\n}\n",
      "app/Greeter.java": "package app;\n@RequiredArgsConstructor\npublic class Greeter {\n  private final Mailer mailer;\n  String greet(Customer customer) { mailer.send(customer.getFullName()); return customer.getFullName(); }\n}\n",
      "app/Mailer.java": "package app;\npublic class Mailer { public void send(String to) {} }\n",
    });
    assert.deepEqual(m.nodes.filter((n) => n.kind === "table").map((n) => `${n.name}(${n.columns?.map((c) => c.name).join(",")})`), ["customer(id,full_name,password_hash)"]);
    // No constructor is written (Lombok's @RequiredArgsConstructor): the field's type alone says where send() is.
    assert.deepEqual(imports(m), ["app/Greeter.java -> app/Customer.java [getFullName]", "app/Greeter.java -> app/Mailer.java [send]"]);
  });
});

describe("a Spring Boot service end to end (fixtures/spring-orders)", () => {
  it("draws every route under /api/orders, each calling the service method its handler calls", async () => {
    const { map } = await buildFixture("spring-orders");
    const routes = map.nodes.filter((n) => n.kind === "route").map((n) => `${n.name} -> ${n.handler}`).sort();
    assert.deepEqual(routes, ["DELETE /api/orders/{id} -> OrderController.cancel", "GET /api/orders -> OrderController.list", "GET /api/orders/{id} -> OrderController.one", "POST /api/orders -> OrderController.create"]);
    const calls = map.edges.filter((e) => e.kind === "calls").map((e) => `${e.from.split("#")[1]} -> ${e.to.slice(5 + J.length + 1)} [${e.toFns?.join(",")}]`).sort();
    assert.deepEqual(calls, [
      "DELETE /api/orders/{id} -> core/OrderService.java [cancel]",
      "GET /api/orders -> core/OrderService.java [all]",
      "GET /api/orders/{id} -> api/OrderView.java [of]",
      "GET /api/orders/{id} -> core/OrderService.java [find]",
      "POST /api/orders -> core/OrderService.java [place]",
      "POST /api/orders -> data/Customer.java [Customer]",
    ]);
  });

  it("follows the service to its repository and its client, by the types of its fields", async () => {
    const { map } = await buildFixture("spring-orders");
    const from = imports(map).filter((l) => l.startsWith(`${J}/core/OrderService.java`)).map((l) => l.replaceAll(`${J}/`, ""));
    assert.deepEqual(from, [
      "core/OrderService.java -> client/AuditClient.java [placed]",
      "core/OrderService.java -> client/PaymentClient.java [charge]",
      "core/OrderService.java -> client/UserClient.java [check]",
      // Customer's getters are Lombok's (@Data): not in the file, still a call into it.
      "core/OrderService.java -> data/Customer.java [getFullName]",
      "core/OrderService.java -> data/Order.java [getUserId,getTotalCents,getId]",
      "core/OrderService.java -> data/OrderRepository.java [findAll,findById,save,deleteById]",
    ]);
  });

  it("makes the entities tables, the repository their reader and writer, and the client a call to users", async () => {
    const { map } = await buildFixture("spring-orders");
    const tables = map.nodes.filter((n) => n.kind === "table").map((n) => `${n.name}(${n.columns?.map((c) => c.name).join(",")})`).sort();
    assert.deepEqual(tables, ["customer(id,full_name)", "order_line(id,sku)", "orders(id,user_id,total_cents)"]);
    const kinds = (k: string) => map.edges.filter((e) => e.kind === k).map((e) => `${e.from.slice(5 + J.length + 1)} -> ${e.to}`).sort();
    assert.deepEqual(kinds("defines"), ["data/Customer.java -> table:customer", "data/Order.java -> table:orders", "data/OrderLine.java -> table:order_line"]);
    assert.deepEqual(kinds("reads"), ["data/OrderRepository.java -> table:orders"]);
    assert.deepEqual(kinds("writes"), ["data/OrderRepository.java -> table:orders"]);
    const layers = Object.fromEntries(map.nodes.filter((n) => n.kind === "module").map((n) => [n.name.split("/").pop(), n.layer]));
    assert.deepEqual(layers, { OrderController: "api", OrderView: "logic", AuditClient: "logic", PaymentClient: "logic", UserClient: "logic", OrderService: "logic", Customer: "data", Order: "data", OrderLine: "data", OrderRepository: "data", OrdersApplication: "logic" });
  });

  it("follows each client to where application.properties says it goes: a setting, the environment's default, a literal", async () => {
    const { map } = await buildFixture("spring-orders");
    const uses = map.edges.filter((e) => e.kind === "uses-service").map((e) => `${e.from.slice(5 + J.length + 1)} -> ${e.to} (${e.evidence.map((v) => `${v.file.split("/").pop()}:${v.line}`).join(", ")})`).sort();
    assert.deepEqual(uses, [
      // OkHttp, a literal URL.
      "client/AuditClient.java -> svc:slack (AuditClient.java:11, AuditClient.java:12)",
      // WebClient, its base from @Value("${payments.url}"), which application.properties sets.
      "client/PaymentClient.java -> svc:stripe (PaymentClient.java:16, application.properties:3, PaymentClient.java:20)",
      // RestTemplate, its base from users.url=${USERS_URL:http://users:8080}: no USERS_URL anywhere, so the default.
      "client/UserClient.java -> svc-int:svc-users (UserClient.java:16, application.properties:2)",
    ]);
    const settings = map.files.filter((f) => f.configKind === "settings").map((f) => f.path.split("/").pop());
    assert.deepEqual(settings.sort(), ["application-dev.properties", "application.properties"]);
  });

  it("leaves the tests out of the map", async () => {
    const { map } = await buildFixture("spring-orders");
    assert.equal(map.files.find((f) => f.path.endsWith("OrderServiceTest.java"))?.skipped, "test");
    assert.equal(map.stats.otherCode, undefined);
  });
});
