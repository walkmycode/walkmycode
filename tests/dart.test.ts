// Dart and Flutter: what extract/dart.ts reads from one file, what linkDart()
// settles across a package, and the map of tests/fixtures/flutter-app, alone
// and beside a small FastAPI backend.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { linkDart } from "../src/analyzer/extract/dart";
import { emptyFacts } from "../src/analyzer/facts";
import type { CodeMap, SourceFile } from "../src/analyzer/types";
import { combineRepos } from "../src/lib/workspace";
import { buildFixture, factsOf, readFixture } from "./analyzer.helpers";

describe("extractDart: imports, classes, widgets", () => {
  it("reads imports, exports and parts, and names outside services by package", async () => {
    const f = await factsOf(
      "lib/a.dart",
      ["import 'dart:async';", "import 'package:firebase_core/firebase_core.dart';", "import '../core/api.dart' as api show ApiClient;", "export 'src/b.dart';", "part 'a.g.dart';"].join("\n"),
    );
    assert.deepEqual(
      f.imports.map((i) => [i.spec, i.line]),
      [["dart:async", 1], ["package:firebase_core/firebase_core.dart", 2], ["../core/api.dart", 3], ["src/b.dart", 4], ["a.g.dart", 5]],
    );
    assert.deepEqual(f.imports[2].names, [{ local: "api", imported: "*" }, { local: "ApiClient", imported: "ApiClient" }]);
    assert.deepEqual(f.services, [{ service: "Firebase", line: 2, via: "sdk", text: "package:firebase_core/firebase_core.dart" }]);
  });

  it("puts a file with a widget in the ui layer; classes and functions are fns, methods are nested", async () => {
    const src = [
      "class Profile extends StatefulWidget {", // 1
      "  @override",
      "  State<Profile> createState() => _ProfileState();",
      "}",
      "class _ProfileState extends State<Profile> {", // 5
      "  void _save() {}",
      "  @override",
      "  Widget build(BuildContext context) => const SizedBox();",
      "}",
      "final profileProvider = FutureProvider((ref) async => 1);", // 10
      "int helper(int a) => a;",
    ].join("\n");
    const f = await factsOf("lib/profile.dart", src);
    assert.equal(f.hasJsx, true);
    assert.deepEqual(
      f.fns.map((x) => `${x.name}:${x.start}-${x.end}:${x.exported}`),
      ["Profile:1-4:true", "_ProfileState:5-9:false", "profileProvider:10-10:true", "helper:11-11:true"],
    );
    assert.deepEqual(f.exports, ["Profile", "profileProvider", "helper"]);
    assert.ok(f.nested.some((n) => n.name === "_save" && n.start === 6));
    const plain = await factsOf("lib/model.dart", "class Order { final String id; Order(this.id); }");
    assert.equal(plain.hasJsx, false);
  });
});

describe("extractDart: requests", () => {
  it("reads Dio calls: the method from the call, `$id` as *, Options(method:), and a base from String.fromEnvironment", async () => {
    const src = [
      "const _base = String.fromEnvironment('API_URL', defaultValue: 'https://api.example.com');", // 1
      "Future<void> run(String id) async {",
      "  await api.patch<Booking>('/api/v1/bookings/$id/status', data: {});",
      "  await widget.apiClient.get('/api/v1/deposit/${widget.ref}');",
      "  await _dio.request('/api/v1/jobs', options: Options(method: 'POST'));", // 5
      "  await dio.get('$_base/health');",
      "  await http.get(Uri.parse('$_base/items'));",
      "  await http.post(Uri.https('pay.example.com', '/v1/charges'));",
      "}",
    ].join("\n");
    const f = await factsOf("lib/api.dart", src);
    assert.deepEqual(
      f.http.map((h) => [h.method, h.url, h.line, h.callee, h.fromVariable, h.varName, h.literalBase]),
      [
        ["PATCH", "/api/v1/bookings/*/status", 3, "api.patch", false, undefined, undefined],
        ["GET", "/api/v1/deposit/*", 4, "widget.apiClient.get", false, undefined, undefined],
        ["POST", "/api/v1/jobs", 5, "_dio.request", false, undefined, undefined],
        ["GET", "*/health", 6, "dio.get", true, "API_URL", "https://api.example.com"],
        ["GET", "*/items", 7, "http.get", true, "API_URL", "https://api.example.com"],
        ["POST", "https://pay.example.com/v1/charges", 8, "http.post", false, undefined, undefined],
      ],
    );
    assert.deepEqual(f.envReads, [{ name: "API_URL", line: 1 }]);
    assert.deepEqual(f.consts._base, { envVar: "API_URL", literal: "https://api.example.com", line: 1 });
  });

  it("records the base a Dio client is given, and names a constant it can't see for linkDart", async () => {
    const f = await factsOf(
      "lib/client.dart",
      ["const kApi = String.fromEnvironment('BASE_URL');", "final dio = Dio(BaseOptions(baseUrl: kApi));", "final other = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));", "Future<void> f() => http.get(Uri.parse('${Endpoints.base}/x'));"].join("\n"),
    );
    assert.deepEqual(f.clientBases, [{ line: 2, envVar: "BASE_URL" }, { line: 3, ref: "ApiConfig.baseUrl" }]);
    assert.equal(f.http[0].baseIdent, "Endpoints.base");
    assert.equal(f.http[0].url, "*/x");
  });

  it("keeps a URL that starts with a path constant a path, so the client's base still applies", async () => {
    const f = await factsOf("lib/chat.dart", ["class Chat {", "  static const _basePath = '/api/v1/chat';", "  Future<void> open() => _api.post('$_basePath/sessions');", "}"].join("\n"));
    assert.deepEqual(f.http.map((h) => [h.method, h.url, h.fromVariable, h.literalBase]), [["POST", "/api/v1/chat/sessions", false, undefined]]);
  });

  it("sees no request in navigation, preferences or a server's own routes", async () => {
    const f = await factsOf(
      "lib/x.dart",
      ["import 'package:shelf_router/shelf_router.dart';", "void f(String key) {", "  context.push('/orders');", "  prefs.getString(kTokenKey);", "  prefs.get(key);", "  router.get('/users', (Request r) => Response.ok(''));", "}"].join("\n"),
    );
    assert.deepEqual(f.http, []);
  });
});

describe("extractDart: triggers, data, settings, screens", () => {
  it("labels a button by its Text, tooltip or label, and follows a handler through `busy ? null : _save`", async () => {
    const src = [
      "class _S extends State<S> {",
      "  Future<void> _save() async {}",
      "  Widget build(BuildContext context) => Column(children: [",
      "    ElevatedButton(onPressed: _save, child: const Text('Save')),", // 4
      "    IconButton(icon: const Icon(Icons.add), tooltip: 'Add booking', onPressed: () => _add()),",
      "    FilledButton.icon(onPressed: busy ? null : _save, label: const Text('Book now'), icon: const Icon(Icons.check)),",
      "    ListTile(title: Text('Services'), onTap: () async { await a(); await b(); }),",
      "  ]);",
      "}",
    ].join("\n");
    const f = await factsOf("lib/s.dart", src);
    assert.deepEqual(f.triggers, [
      { element: "button", label: "Save", handler: "_save", line: 4 },
      { element: "button", label: "Add booking", handler: "_add", line: 5, range: [5, 5] },
      { element: "button", label: "Book now", handler: "_save", line: 6 },
      { element: "list item", label: "Services", handler: "inline", line: 7, range: [7, 7] },
    ]);
  });

  it("reads sqflite SQL and helpers, Hive boxes, Firestore collections and Supabase tables", async () => {
    const src = [
      "import 'package:cloud_firestore/cloud_firestore.dart';",
      "Future<void> f() async {",
      "  await db.execute('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY)');", // 3
      "  await db.rawQuery('SELECT * FROM notes WHERE id = ?', [1]);",
      "  await db.insert('notes', {'a': 1});", // 5
      "  await Hive.openBox<String>('settings');",
      "  Hive.box('cache');",
      "  await FirebaseFirestore.instance.collection('orders').add({});", // 8
      "  await _db.collection('users').doc(id).get();",
      "  await supabase.from('bookings').select();", // 10
      "  await supabase.from('bookings').insert({});",
      "}",
    ].join("\n");
    const f = await factsOf("lib/data.dart", src);
    const sql = f.sql.map((q) => `${q.op} ${q.table}:${q.line}`).sort();
    assert.deepEqual(sql, ["define notes:3", "define settings:6", "read bookings:10", "read cache:7", "read notes:4", "read users:9", "write bookings:11", "write notes:5", "write orders:8"]);
  });

  it("reads settings from String.fromEnvironment, dotenv and Platform.environment", async () => {
    const f = await factsOf(
      "lib/env.dart",
      ["const a = bool.fromEnvironment('DEBUG_MENU');", "final b = dotenv.env['MAPS_KEY'];", "final c = Platform.environment['HOME_URL'];", "final d = String.fromEnvironment('SENTRY_DSN');"].join("\n"),
    );
    assert.deepEqual(
      f.envReads.map((e) => `${e.name}:${e.line}`),
      ["DEBUG_MENU:1", "SENTRY_DSN:4", "MAPS_KEY:2", "HOME_URL:3"],
    );
    assert.ok(f.services.some((s) => s.service === "Sentry" && s.via === "env"));
  });

  it("reads go_router screens with nested paths, a page wrapper and MaterialApp's routes", async () => {
    const src = [
      "final r = GoRouter(routes: [",
      "  GoRoute(path: '/a', builder: (c, s) => const AScreen(), routes: [", // 2
      "    GoRoute(path: 'b/:id', pageBuilder: (c, s) => NoTransitionPage(child: BScreen(id: s.pathParameters['id']!))),",
      "  ]),",
      "  GoRoute(path: Routes.home, builder: (c, s) { return HomePage(); }),", // 5
      "]);",
      "final app = MaterialApp(routes: {'/legacy': (context) => const LegacyScreen()});",
    ].join("\n");
    const f = await factsOf("lib/router.dart", src);
    assert.deepEqual(f.screens, [
      { path: "/a", widget: "AScreen", line: 2 },
      { path: "/a/b/:id", widget: "BScreen", line: 3 },
      { path: "{Routes.home}", widget: "HomePage", line: 5 },
      { path: "/legacy", widget: "LegacyScreen", line: 7 },
    ]);
  });
});

describe("linkDart", () => {
  it("sends a package's relative requests to the one base its Dio clients are given", () => {
    const client = emptyFacts(5);
    client.clientBases = [{ line: 3, envVar: "BASE_URL" }];
    const repo = emptyFacts(9);
    repo.http = [
      { url: "/api/orders", method: "GET", line: 4, callee: "_dio.get", fromVariable: false },
      { url: "https://api.example.com/x", method: "GET", line: 5, callee: "_dio.get", fromVariable: false },
    ];
    const facts = { "lib/client.dart": client, "lib/repo.dart": repo };
    linkDart(facts, () => "app", () => []);
    assert.deepEqual(repo.http[0], { url: "*/api/orders", method: "GET", line: 4, callee: "_dio.get", fromVariable: true, varName: "BASE_URL" });
    assert.equal(repo.http[1].url, "https://api.example.com/x");
  });

  it("guesses nothing when one client's base is unknown, and follows a constant through an import", () => {
    const a = emptyFacts(5);
    a.clientBases = [{ line: 1, envVar: "BASE_URL" }, { line: 2 }];
    const b = emptyFacts(5);
    b.http = [
      { url: "/x", method: "GET", line: 1, callee: "api.get", fromVariable: false },
      { url: "*/y", method: "GET", line: 2, callee: "http.get", fromVariable: true, baseIdent: "Env.api" },
    ];
    const env = emptyFacts(3);
    env.consts["Env.api"] = { envVar: "API", literal: "https://api.example.com", line: 2 };
    linkDart({ "lib/a.dart": a, "lib/b.dart": b, "lib/env.dart": env }, () => "app", (p) => (p === "lib/b.dart" ? ["lib/env.dart"] : []));
    assert.equal(b.http[0].url, "/x");
    assert.equal(b.http[0].fromVariable, false);
    assert.equal(b.http[1].varName, "API");
    assert.equal(b.http[1].literalBase, "https://api.example.com");
  });
});

describe("the flutter-app fixture", () => {
  let map: CodeMap;
  let facts: Awaited<ReturnType<typeof buildFixture>>["facts"];
  before(async () => {
    ({ map, facts } = await buildFixture("flutter-app"));
  });

  it("reads lib/ and pubspec.yaml, skips tests and generated parts, and never reads a platform folder", () => {
    const files = new Map(map.files.map((f) => [f.path, f]));
    assert.ok(!map.files.some((f) => f.path.startsWith("android/")));
    assert.equal(files.get("test/widget_test.dart")?.skipped, "test");
    assert.equal(files.get("lib/models/order.g.dart")?.skipped, "generated");
    assert.equal(files.get("lib/main.dart")?.lang, "dart");
    assert.ok(facts["lib/api/orders_repository.dart"]);
  });

  it("is one Flutter app that starts at main()", () => {
    assert.equal(map.system.kind, "monolith");
    const [app] = map.services;
    assert.equal(app.kind, "app");
    assert.equal(app.framework, "Flutter");
    assert.deepEqual(app.entry && [app.entry.file, app.entry.line], ["lib/main.dart", 5]);
  });

  it("resolves package: and relative imports, and puts widgets in the ui layer", () => {
    const ids = new Set(map.edges.map((e) => e.id));
    assert.ok(ids.has("imports:file:lib/main.dart->file:lib/router.dart"));
    assert.ok(ids.has("imports:file:lib/screens/orders_screen.dart->file:lib/api/orders_repository.dart"));
    assert.ok(ids.has("imports:file:lib/router.dart->file:lib/routes.dart"));
    const layer = (p: string) => map.nodes.find((n) => n.id === `file:${p}`)?.layer;
    assert.equal(layer("lib/screens/home_screen.dart"), "ui");
    assert.equal(layer("lib/main.dart"), "ui");
    assert.equal(layer("lib/api/orders_repository.dart"), "logic");
  });

  it("gives the repository's relative Dio requests the client's BASE_URL setting, and sends them to its stand-in as one dashed arrow", () => {
    const http = facts["lib/api/orders_repository.dart"].http;
    assert.deepEqual(
      http.map((h) => [h.method, h.url, h.line, h.varName, h.fromVariable]),
      [
        ["GET", "*/api/orders", 9, "BASE_URL", true],
        ["GET", "*/api/orders/*", 11, "BASE_URL", true],
        ["DELETE", "*/api/orders/*/cancel", 14, "BASE_URL", true],
        ["POST", "*/api/orders", 18, "BASE_URL", true],
      ],
    );
    // Nothing gives BASE_URL a value and no route here answers: "Where does this point?" (docs/SERVICES.md §13).
    const out = map.edges.filter((e) => e.from === "file:lib/api/orders_repository.dart" && e.kind !== "imports");
    assert.deepEqual(
      out.map((e) => [e.kind, e.to, e.confidence, e.evidence.map((v) => v.line)]),
      [["uses-service", "svc-int:svc-base-url", "likely", [9, 11, 14, 18]]],
    );
    assert.deepEqual(
      map.unresolvedBases?.map((u) => [u.setting, u.calls, u.placeholder]),
      [["BASE_URL", 4, "svc-base-url"]],
    );
  });

  it("sends the Pay now button's request to Stripe, citing the line and the button", () => {
    const e = map.edges.find((x) => x.id === "uses-service:file:lib/screens/home_screen.dart->svc:stripe");
    assert.ok(e);
    assert.equal(e.confidence, "certain");
    assert.deepEqual(e.evidence[0].trigger, { element: "button", label: "Pay now", line: 17 });
    assert.equal(e.evidence[0].line, 9);
  });

  it("reads Firestore collections as tables, and Firebase as an outside service", () => {
    const ids = new Set(map.edges.map((e) => e.id));
    assert.ok(ids.has("reads:file:lib/screens/orders_screen.dart->table:orders"));
    assert.ok(ids.has("writes:file:lib/screens/orders_screen.dart->table:audit"));
    assert.ok(ids.has("uses-service:file:lib/screens/orders_screen.dart->svc:firebase"));
  });

  it("labels each routed screen's card with its path and the router line", () => {
    const note = (p: string) => map.nodes.find((n) => n.id === `file:${p}`)?.note;
    assert.equal(note("lib/screens/home_screen.dart"), "screen at / (router.dart:11)");
    assert.equal(note("lib/screens/orders_screen.dart"), "screen at /orders (router.dart:12)");
    assert.equal(note("lib/screens/order_screen.dart"), "screen at /orders/:id (router.dart:16)");
    assert.ok(!map.nodes.some((n) => n.kind === "route"), "screens are not API routes");
  });
});

describe("the flutter-app fixture beside a FastAPI backend", () => {
  let map: CodeMap;
  before(async () => {
    const backend: SourceFile[] = [
      { path: "requirements.txt", content: "fastapi\nuvicorn\n" },
      {
        path: "app/main.py",
        content: ["from fastapi import FastAPI", "app = FastAPI()", "", '@app.get("/api/orders")', "def list_orders():", "    return []", "", '@app.get("/api/orders/{order_id}")', "def get_order(order_id: str):", "    return {}", "", '@app.post("/api/orders")', "def create_order():", "    return {}", ""].join("\n"),
      },
    ];
    const { sources, repos } = combineRepos([
      { label: "mobile", files: await readFixture("flutter-app"), kind: "cli" },
      { label: "backend", files: backend, kind: "cli" },
    ]);
    map = (await buildMap(sources, { name: "shop", repos })).map;
  });

  it("is two apps, the Flutter one first", () => {
    assert.equal(map.system.kind, "services");
    assert.deepEqual(
      map.services.filter((s) => s.kind === "app").map((s) => [s.name, s.framework]),
      [["mobile", "Flutter"], ["backend", "FastAPI"]],
    );
  });

  it("matches the app's requests to the backend's routes by path, as dashed guesses that say why", () => {
    const from = "file:mobile/lib/api/orders_repository.dart";
    const to = (route: string) => map.edges.find((e) => e.from === from && e.to === `route:backend/app/main.py#${route}`);
    for (const r of ["GET /api/orders", "GET /api/orders/{order_id}", "POST /api/orders"]) {
      const e = to(r);
      assert.ok(e, r);
      assert.equal(e.kind, "calls-route");
      assert.equal(e.confidence, "likely");
      assert.match(e.note ?? "", /starts with a variable/);
      assert.ok(e.evidence.every((v) => v.file === "mobile/lib/api/orders_repository.dart" && v.line > 0));
    }
    // DELETE /api/orders/{id}/cancel has no route: no arrow.
    assert.ok(!map.edges.some((e) => e.from === from && e.evidence.some((v) => v.line === 14)));
  });
});
