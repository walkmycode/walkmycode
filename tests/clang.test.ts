// C and C++ on the map (src/analyzer/extract/c.ts, resolveC and linkC in build.ts):
// `#include` as arrows, functions and methods, structs, classes and namespaces, a call
// followed from the header that declares a function to the file that defines it, SQL in
// strings; the c-inventory and cpp-shop fixtures end to end. npm's own grammar builds
// (tree-sitter-c, tree-sitter-cpp) are the ones loaded here, as in the app.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { drawnLang, readableLanguage } from "../src/analyzer/config/files";
import { grammarFor } from "../src/analyzer/parser";
import type { CodeMap } from "../src/analyzer/types";
import { buildFixture, factsOf } from "./analyzer.helpers";

const mapOf = async (files: Record<string, string>): Promise<CodeMap> => (await buildMap(Object.entries(files).map(([path, content]) => ({ path, content })), { name: "t" })).map;
const imports = (m: CodeMap) => m.edges.filter((e) => e.kind === "imports").map((e) => `${e.from.slice(5)} -> ${e.to.slice(5)}${e.toFns?.length ? ` [${e.toFns.join(",")}]` : ""}`).sort();

describe("C and C++ files", () => {
  it("are drawn, each with its grammar: a .h is C unless it holds C++", () => {
    for (const p of ["a.c", "a.h"]) assert.equal(drawnLang(p), "c", p);
    for (const p of ["a.cpp", "a.cc", "a.cxx", "a.hpp", "a.hh", "a.hxx"]) assert.equal(drawnLang(p), "cpp", p);
    for (const p of ["a.c", "a.h", "a.cpp", "a.hpp"]) assert.equal(readableLanguage(p), null, `${p} is no longer only read`);
    assert.equal(grammarFor("src/stock.c"), "c");
    assert.equal(grammarFor("src/cart.cc"), "cpp");
    assert.equal(grammarFor("include/stock.h", "typedef struct Item { int n; } Item;\nint stock_add(Item *i, int n);\n"), "c");
    assert.equal(grammarFor("include/cart.h", "namespace shop {\nclass Cart {};\n}\n"), "cpp");
    assert.equal(grammarFor("include/cart.h", "#include <string>\nstd::string name();\n"), "cpp");
    assert.equal(grammarFor("include/x.h"), "c", "with no text to look at, C");
  });
});

describe("C facts", () => {
  it("reads includes, quoted and in angle brackets, wherever they are", async () => {
    const f = await factsOf("src/main.c", '#include <stdio.h>\n#include "db.h"\n#ifdef WITH_NET\n#include "net/http.h"\n#endif\nint main(void) { return 0; }\n');
    assert.deepEqual(f.imports.map((i) => `${i.spec}@${i.line}`), ["<stdio.h>@1", "db.h@2", "net/http.h@4"]);
  });

  it("lists functions with what each calls; a static one is the file's own", async () => {
    const f = await factsOf("src/stock.c", 'static int clamp(int v) { return v < 0 ? 0 : v; }\nint stock_add(int *n, int by) {\n    *n = clamp(*n + by);\n    return *n;\n}\nchar *stock_name(void) { return strdup("x"); }\n');
    assert.deepEqual(f.fns.map((x) => `${x.name}:${x.start}-${x.end}${x.exported ? " pub" : ""}`), ["clamp:1-1", "stock_add:2-5 pub", "stock_name:6-6 pub"]);
    assert.deepEqual(f.fns[1].calls, ["clamp"]);
    assert.deepEqual(f.exports, ["stock_add", "stock_name"]);
  });

  it("takes a header's prototypes, structs, enums and typedefs as what it declares", async () => {
    const f = await factsOf("include/stock.h", "#define STOCK_MAX 64\ntypedef struct Item { char name[32]; int count; } Item;\nenum Kind { BOLT, NUT };\ntypedef struct { int a; } Pair;\nint stock_add(Item *item, int count);\nstatic int hidden(void);\nint (*on_change)(int);\nextern int stock_version;\n");
    assert.deepEqual(f.exports.sort(), ["Item", "Kind", "Pair", "stock_add"]);
    assert.deepEqual(f.scopes, ["Item"]);
    assert.deepEqual(f.fns, []);
  });

  it("finds getenv, a #define'd address, SQL in strings (adjacent literals are one string) and libcurl's URL", async () => {
    const f = await factsOf(
      "src/db.c",
      `#define API "https://api.stripe.com/v1/charges"
int save(sqlite3 *db) {
    const char *path = getenv("SHOP_DB");
    sqlite3_exec(db, "CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, total INTEGER)", 0, 0, 0);
    sqlite3_exec(db, "INSERT INTO orders (total) "
                     "VALUES (1)", 0, 0, 0);
    curl_easy_setopt(curl, CURLOPT_URL, API);
    return 0;
}`,
    );
    assert.deepEqual(f.envReads.map((e) => e.name), ["SHOP_DB"]);
    assert.deepEqual(f.sql.map((q) => `${q.op} ${q.table}@${q.line}`), ["define orders@4", "write orders@5"]);
    assert.deepEqual(f.columns?.[0].columns.map((c) => c.name), ["id", "total"]);
    assert.deepEqual(f.http.map((h) => `${h.url} ${h.callee}`), ["https://api.stripe.com/v1/charges curl_easy_setopt"]);
    assert.ok(f.services.some((s) => s.service === "Stripe"));
  });
});

describe("C++ facts", () => {
  it("names methods by their class, written in the class or outside it, and leaves an unnamed namespace to the file", async () => {
    const f = await factsOf(
      "src/cart.cpp",
      `#include "cart.hpp"
namespace shop {
namespace { int clamp(int c) { return c < 0 ? 0 : c; } }
class Cart {
 public:
  int count() const { return static_cast<int>(lines.size()); }
  void add(int cents);
};
void Cart::add(int cents) { lines.push_back(clamp(cents)); log::info("added"); }
template <typename T> T twice(T v) { return v + v; }
Cart::~Cart() {}
}`,
    );
    assert.deepEqual(f.fns.map((x) => `${x.name}${x.exported ? " pub" : ""}`), ["clamp", "Cart::count pub", "Cart::add pub", "twice pub", "Cart::~Cart pub"]);
    assert.deepEqual(f.fns[1].calls, [], "a cast is not a call, nor is a method on a value");
    // `lines` is no local of add(): a field of Cart, to be found once the class's fields are in sight (build.ts).
    assert.deepEqual(f.fns[2].calls.sort(), ["clamp", "log.info", "~Cart.lines.push_back"]);
    assert.deepEqual(f.exports.sort(), ["Cart", "twice"]);
    assert.deepEqual(f.scopes, ["Cart"]);
    assert.deepEqual(f.spaces, ["shop"]);
  });

  it("reads a nested namespace name and a struct's methods", async () => {
    const f = await factsOf("src/geo.hpp", "namespace acme::geo {\nstruct Point { int x; int y; int sum() const { return x + y; } };\nint dist(const Point& a, const Point& b);\n}\n");
    assert.deepEqual(f.spaces, ["acme", "geo"]);
    assert.deepEqual(f.fns.map((x) => x.name), ["Point::sum"]);
    assert.deepEqual(f.exports.sort(), ["Point", "dist"]);
  });
});

describe("C++ calls on a value", () => {
  it("names a method by the class of what it is called on: a parameter, a local, a pointer, the class's own field", async () => {
    const f = await factsOf(
      "src/checkout.cpp",
      `class Checkout {
 public:
  int pay(const shop::Cart& cart, Ledger* ledger) {
    Receipt receipt;
    std::unique_ptr<Mailer> mailer = find();
    auto audit = std::make_unique<Audit>();
    auto tax = Tax{};
    auto unknown = make();
    int n = 3;
    cart.count();
    ledger->post(n);
    receipt.print();
    mailer->send();
    audit->log();
    tax.rate();
    unknown.run();
    store.save();
    this->helper();
    return 0;
  }
 private:
  Store store;
  int total;
};`,
    );
    assert.deepEqual(f.fns[0].calls.sort(), ["Audit.log", "Cart.count", "Ledger.post", "Mailer.send", "Receipt.print", "Store.save", "Tax.rate", "find", "make", "std.make_unique"]);
    assert.deepEqual(f.members, { Checkout: { store: "Store" } });
  });

  it("leaves out a name declared with two classes in one function, and a call on a value in C", async () => {
    const f = await factsOf("src/a.cpp", "void run(bool b) {\n  if (b) { Cart x; x.add(1); } else { Basket x; x.add(2); }\n  Cart y; y.add(3);\n}\n");
    assert.deepEqual(f.fns[0].calls, ["Cart.add"], "x is a Cart here and a Basket there: only y is sure");
    const c = await factsOf("src/a.c", "void run(struct Item *item) { item->on_change(1); helper(); }\n");
    assert.deepEqual(c.fns[0].calls, ["helper"], "in C that is a function pointer in a struct");
  });

  it("keeps a call on a field for later when the method is written outside its class", async () => {
    const f = await factsOf("src/checkout.cpp", '#include "checkout.hpp"\nint shop::Checkout::pay() { cart.add(1); return other.x(); }\n');
    assert.deepEqual(f.fns[0].calls.sort(), ["~Checkout.cart.add", "~Checkout.other.x"]);
  });

  it("follows each method to the file that defines it: one in the class body stays at the header", async () => {
    const m = await mapOf({
      "cart.hpp": "class Cart {\n public:\n  void add(int id);\n  int count() const { return n; }\n private:\n  int n;\n};\n",
      "cart.cpp": '#include "cart.hpp"\nvoid Cart::add(int id) { n += id; }\n',
      "checkout.hpp": '#include "cart.hpp"\nclass Checkout {\n public:\n  int pay();\n private:\n  Cart cart;\n};\n',
      "checkout.cpp": '#include "checkout.hpp"\nint Checkout::pay() { cart.add(1); return cart.count(); }\n',
      "main.cpp": '#include "checkout.hpp"\n#include "cart.hpp"\nint main() { Checkout c; Cart mine; mine.count(); return c.pay(); }\n',
    });
    assert.deepEqual(imports(m), [
      "cart.cpp -> cart.hpp",
      // The field's class is in checkout.hpp; its add() is in cart.cpp.
      "checkout.cpp -> cart.cpp [add]",
      "checkout.cpp -> checkout.hpp",
      "checkout.hpp -> cart.hpp",
      "main.cpp -> cart.hpp [count]",
      "main.cpp -> checkout.cpp [pay]",
      "main.cpp -> checkout.hpp",
    ]);
  });

  it("does not guess when two files define the method", async () => {
    const m = await mapOf({
      "log.hpp": "class Log {\n public:\n  void line();\n};\n",
      "log_file.cpp": '#include "log.hpp"\nvoid Log::line() {}\n',
      "log_net.cpp": '#include "log.hpp"\nvoid Log::line() {}\n',
      "main.cpp": '#include "log.hpp"\nint main() { Log log; log.line(); return 0; }\n',
    });
    assert.deepEqual(imports(m), ["log_file.cpp -> log.hpp", "log_net.cpp -> log.hpp", "main.cpp -> log.hpp [line]"]);
  });
});

describe("C++ methods inherited from a base class", () => {
  it("lists each class with what it extends and the methods its body names", async () => {
    const f = await factsOf(
      "src/cart.hpp",
      `namespace shop {
class Cart : public Basket, private util::Countable {
 public:
  Cart();
  void add(int id);
  int count() const { auto f = [](int x) { return x; }; return f(n); }
  struct Line { int cents() const { return 0; } };
 private:
  int n;
};
struct Plain { int x; };
template <typename T> class Box : public Holder<T> { public: T get(); };
}`,
    );
    assert.deepEqual(f.classes, {
      Cart: { bases: ["Basket", "Countable"], methods: ["Cart", "add", "count"] },
      Line: { bases: [], methods: ["cents"] },
      Plain: { bases: [], methods: [] },
      Box: { bases: ["Holder"], methods: ["get"] },
    });
    assert.equal((await factsOf("src/a.c", "struct Item { int n; };\n")).classes, undefined, "C has no classes to inherit from");
  });

  it("follows a method the class does not name to the base that defines it, through the headers", async () => {
    const m = await mapOf({
      "basket.hpp": "class Basket {\n public:\n  void note(int n);\n  int size() const { return 0; }\n};\n",
      "basket.cpp": '#include "basket.hpp"\nvoid Basket::note(int n) {}\n',
      "cart.hpp": '#include "basket.hpp"\nclass Cart : public Basket {\n public:\n  void add(int id);\n};\n',
      "cart.cpp": '#include "cart.hpp"\nvoid Cart::add(int id) {}\n',
      "main.cpp": '#include "cart.hpp"\nint main() { Cart cart; cart.add(1); cart.note(2); return cart.size(); }\n',
    });
    assert.deepEqual(imports(m), [
      "basket.cpp -> basket.hpp",
      "cart.cpp -> cart.hpp",
      "cart.hpp -> basket.hpp",
      // note() is Basket's, defined in basket.cpp; size() is Basket's too, written in its class body.
      "main.cpp -> basket.cpp [note]",
      "main.cpp -> cart.cpp [add]",
      "main.cpp -> cart.hpp",
    ]);
  });

  it("takes the nearest base that names the method, and the class's own before any base", async () => {
    const m = await mapOf({
      "a.hpp": "class Root {\n public:\n  void save();\n  void load();\n};\nclass Mid : public Root {\n public:\n  void save();\n};\nclass Leaf : public Mid {\n public:\n  void run();\n};\n",
      "root.cpp": '#include "a.hpp"\nvoid Root::save() {}\nvoid Root::load() {}\n',
      "mid.cpp": '#include "a.hpp"\nvoid Mid::save() {}\n',
      "leaf.cpp": '#include "a.hpp"\nvoid Leaf::run() {}\n',
      "main.cpp": '#include "a.hpp"\nint main() { Leaf leaf; leaf.run(); leaf.save(); leaf.load(); Mid* mid = &leaf; mid->save(); return 0; }\n',
    });
    assert.deepEqual(imports(m).filter((l) => l.startsWith("main.cpp")), ["main.cpp -> a.hpp", "main.cpp -> leaf.cpp [run]", "main.cpp -> mid.cpp [save]", "main.cpp -> root.cpp [load]"]);
  });

  it("does not choose between two bases that both name the method", async () => {
    const m = await mapOf({
      "a.hpp": "class Left {\n public:\n  void draw();\n  void left();\n};\nclass Right {\n public:\n  void draw();\n};\nclass Both : public Left, public Right {};\n",
      "left.cpp": '#include "a.hpp"\nvoid Left::draw() {}\nvoid Left::left() {}\n',
      "right.cpp": '#include "a.hpp"\nvoid Right::draw() {}\n',
      "main.cpp": '#include "a.hpp"\nint main() { Both both; both.draw(); both.left(); return 0; }\n',
    });
    assert.deepEqual(imports(m).filter((l) => l.startsWith("main.cpp")), ["main.cpp -> a.hpp", "main.cpp -> left.cpp [left]"], "draw() is Left's or Right's: no arrow for it");
  });

  it("leaves a call as written when the base is out of sight, or is a template", async () => {
    const m = await mapOf({
      "cart.hpp": "#include <vendor/basket.hpp>\nclass Cart : public Basket {\n public:\n  void add(int id);\n};\ntemplate <typename T> class Crtp {\n public:\n  void each();\n};\nclass List : public Crtp<List> {};\n",
      "cart.cpp": '#include "cart.hpp"\nvoid Cart::add(int id) {}\n',
      "main.cpp": '#include "cart.hpp"\nint main() { Cart cart; cart.add(1); cart.note(2); List list; list.each(); return 0; }\n',
    });
    // note() may be Basket's, whose header is not in the project; each() is a template's, defined in no file of its own.
    assert.deepEqual(imports(m).filter((l) => l.startsWith("main.cpp")), ["main.cpp -> cart.cpp [add]", "main.cpp -> cart.hpp [note,each]"]);
  });
});

describe("C and C++ on the map", () => {
  it("finds an include beside the file, in an include folder, and by its one match in the project", async () => {
    const m = await mapOf({
      "src/main.c": '#include "util.h"\n#include <stock.h>\n#include "deep.h"\n#include <stdio.h>\nint main(void) { return 0; }\n',
      "src/util.h": "int util(void);\n",
      "include/stock.h": "int stock(void);\n",
      "lib/third/deep.h": "int deep(void);\n",
    });
    assert.deepEqual(imports(m), ["src/main.c -> include/stock.h", "src/main.c -> lib/third/deep.h", "src/main.c -> src/util.h"]);
    assert.equal(m.stats.otherCode?.C, undefined, "C is not 'not drawn' any more");
  });

  it("does not guess between two headers of the same name", async () => {
    const m = await mapOf({
      "app/main.c": '#include "config.h"\nint main(void) { return 0; }\n',
      "a/x/config.h": "int a(void);\n",
      "b/y/config.h": "int b(void);\n",
    });
    assert.deepEqual(imports(m), []);
  });

  it("follows a call from the header that declares a function to the file that defines it", async () => {
    const m = await mapOf({
      "cart.h": "int cart_add(int id);\nint cart_total(void);\n",
      "cart.c": '#include "cart.h"\nint cart_add(int id) { return id; }\nint cart_total(void) { return 0; }\n',
      "main.c": '#include "cart.h"\nint main(void) { cart_add(2); return cart_total(); }\n',
      "other.c": '#include "cart.h"\nint other(void) { return 1; }\n',
    });
    assert.deepEqual(imports(m), ["cart.c -> cart.h", "main.c -> cart.c [cart_add,cart_total]", "main.c -> cart.h", "other.c -> cart.h"]);
    const link = m.edges.find((e) => e.from === "file:main.c" && e.to === "file:cart.c")!;
    assert.deepEqual(link.evidence.map((v) => `${v.file}:${v.line}`), ["main.c:1"], "on the line of the #include that brings the function in");
    assert.deepEqual(link.fromFns, ["main"]);
  });

  it("leaves the call at the header when two files define the function", async () => {
    const m = await mapOf({
      "log.h": "void log_line(const char *s);\n",
      "log_file.c": '#include "log.h"\nvoid log_line(const char *s) {}\n',
      "log_net.c": '#include "log.h"\nvoid log_line(const char *s) {}\n',
      "main.c": '#include "log.h"\nint main(void) { log_line("hi"); return 0; }\n',
    });
    assert.deepEqual(imports(m), ["log_file.c -> log.h", "log_net.c -> log.h", "main.c -> log.h [log_line]"]);
  });

  it("gives cart.h and cart.c each a card, named with its extension", async () => {
    const m = await mapOf({ "src/cart.h": "int cart(void);\n", "src/cart.c": '#include "cart.h"\nint cart(void) { return 1; }\n' });
    assert.deepEqual(m.nodes.map((n) => n.name).sort(), ["cart.c", "cart.h"]);
  });
});

describe("a C project end to end (fixtures/c-inventory)", () => {
  it("draws the include graph and the calls behind it, and leaves the test out", async () => {
    const { map } = await buildFixture("c-inventory");
    assert.deepEqual(imports(map), [
      "src/db.c -> src/db.h",
      "src/db.h -> include/stock.h",
      "src/main.c -> include/stock.h",
      "src/main.c -> src/db.c [db_open,db_save]",
      "src/main.c -> src/db.h",
      "src/main.c -> src/stock.c [stock_add,stock_total]",
      "src/stock.c -> include/stock.h",
    ]);
    assert.equal(map.files.find((f) => f.path === "src/stock_test.c")?.skipped, "test");
    assert.deepEqual(map.warnings, []);
  });

  it("makes the SQL in db.c a table with its columns, read and written there", async () => {
    const { map } = await buildFixture("c-inventory");
    const table = map.nodes.find((n) => n.kind === "table")!;
    assert.equal(table.name, "items");
    assert.deepEqual(table.columns?.map((c) => c.name), ["name", "count"]);
    const kinds = map.edges.filter((e) => e.to === table.id).map((e) => `${e.kind} ${e.from}`).sort();
    assert.deepEqual(kinds, ["defines file:src/db.c", "reads file:src/db.c", "writes file:src/db.c"]);
    assert.equal(map.nodes.find((n) => n.id === "file:src/db.c")?.layer, "data");
    assert.equal(map.nodes.find((n) => n.id === "file:src/stock.c")?.layer, "logic");
  });
});

describe("a C++ project end to end (fixtures/cpp-shop)", () => {
  it("follows shop::Cart::empty(), shop::total() and a method called on a Cart to cart.cpp, and a header-only template to its header", async () => {
    const { map } = await buildFixture("cpp-shop");
    assert.deepEqual(imports(map), [
      "src/basket.cpp -> src/basket.hpp",
      // total() calls cart.all(), written in the class body.
      "src/cart.cpp -> src/cart.hpp [all]",
      "src/cart.hpp -> src/basket.hpp",
      // cart.add() on the Checkout's own Cart, and on the one its unique_ptr holds.
      "src/checkout.cpp -> src/cart.cpp [add]",
      "src/checkout.cpp -> src/checkout.hpp",
      "src/checkout.cpp -> src/receipt.cc [print_receipt]",
      "src/checkout.cpp -> src/receipt.h",
      "src/checkout.hpp -> src/cart.hpp",
      // gift.add() on a `shop::Cart gift`; `auto cart = shop::Cart::empty()` says no class, so cart.add() is left out.
      // gift.note(): Cart does not name note(), its base Basket does, and basket.cpp defines it.
      "src/main.cpp -> src/basket.cpp [note]",
      "src/main.cpp -> src/cart.cpp [empty,add,total]",
      "src/main.cpp -> src/cart.hpp",
      "src/main.cpp -> src/checkout.cpp [pay]",
      "src/main.cpp -> src/checkout.hpp",
      "src/main.cpp -> src/receipt.cc [print_receipt]",
      "src/main.cpp -> src/receipt.h",
      // total() reaches receipt.cc through receipt.h, which includes cart.hpp.
      "src/receipt.cc -> src/cart.cpp [total]",
      "src/receipt.cc -> src/money.h [format,with_tax]",
      "src/receipt.cc -> src/receipt.h",
      "src/receipt.h -> src/cart.hpp",
    ]);
    assert.deepEqual(map.nodes.map((n) => n.name).sort(), ["basket.cpp", "basket.hpp", "cart.cpp", "cart.hpp", "checkout.cpp", "checkout.hpp", "main.cpp", "money.h", "receipt.cc", "receipt.h"]);
    assert.equal(map.stats.otherCode, undefined);
  });
});
