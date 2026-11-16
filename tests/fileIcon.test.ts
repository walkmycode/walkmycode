// Every file in Files wears a drawing from the analogy scenes' set (src/lib/fileIcon.ts): found by what the
// file is before its extension, code in its language's colour, and only ever a drawing the set has.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileIcon, folderIcon, LANGUAGES } from "../src/lib/fileIcon";
import { DRAWING_NAMES } from "../src/lib/drawings/names";

const name = (p: string) => fileIcon(p).name;

describe("file icons: what a file is", () => {
  it("knows the files a project is built and shipped with", () => {
    assert.equal(name("Dockerfile"), "container");
    assert.equal(name("api/Dockerfile.dev"), "container");
    assert.equal(name("docker-compose.yml"), "container");
    assert.equal(name("compose.yaml"), "container");
    assert.equal(name(".github/workflows/ci.yml"), "conveyor", "a workflow is CI, not just YAML");
    assert.equal(name(".gitlab-ci.yml"), "conveyor");
    assert.equal(name("Makefile"), "toolbox");
    assert.equal(name("package.json"), "package");
    assert.equal(name("api/Cargo.toml"), "package");
    assert.equal(name("pyproject.toml"), "package");
    assert.equal(name("App.csproj"), "package");
    assert.equal(name("package-lock.json"), "chain", "a lock file is the chain, not data");
    assert.equal(name("Cargo.lock"), "chain");
    assert.equal(name("go.sum"), "chain");
  });

  it("knows tests by their name and by their folder", () => {
    for (const p of ["web/cart.test.ts", "api/tests/orders.rs", "src/__tests__/a.js", "pkg/orders_test.go", "test_orders.py", "app.spec.tsx"]) assert.equal(name(p), "checklist", p);
    assert.equal(name("src/contest.ts"), "code", "a word that ends in test is not a test");
  });

  it("knows the words, the settings and the secrets", () => {
    assert.equal(name("README.md"), "book");
    assert.equal(name("docs/readme.txt"), "book");
    assert.equal(name("LICENSE"), "certificate");
    assert.equal(name("CHANGELOG.md"), "tag");
    assert.equal(name("docs/architecture.md"), "page");
    assert.equal(name(".gitignore"), "branch");
    assert.equal(name(".env"), "padlock");
    assert.equal(name(".env.local"), "padlock");
    assert.equal(name("certs/server.pem"), "padlock");
    assert.equal(name("tsconfig.json"), "json");
    assert.equal(name("config/app.yaml"), "gear");
    assert.equal(name("nginx.conf"), "router");
  });

  it("knows data, the web and media", () => {
    assert.equal(name("migrations/001_init.sql"), "database");
    assert.equal(name("db/schema.sql"), "database");
    assert.equal(name("data/orders.csv"), "barchart");
    assert.equal(name("schema.graphql"), "api");
    assert.equal(name("index.html"), "browser");
    assert.equal(name("styles.scss"), "palette");
    assert.equal(name("public/logo.svg"), "camera");
    assert.equal(name("sounds/ding.mp3"), "music");
    assert.equal(name("fonts/Inter.woff2"), "pencil");
    assert.equal(name("server.log"), "logs");
    assert.equal(name("release.zip"), "box");
    assert.equal(name("notebook.ipynb"), "linechart");
    assert.equal(name("pkg/app.wasm"), "chip");
    assert.equal(name("NOTES"), "page", "anything else is the plain page");
  });

  it("draws code as one drawing in its language's colour", () => {
    const rust = fileIcon("src/main.rs"), ts = fileIcon("src/App.tsx"), py = fileIcon("seed.py");
    for (const i of [rust, ts, py]) assert.equal(i.name, "code");
    assert.equal(rust.what, "Rust code");
    assert.notEqual(rust.tint, ts.tint);
    assert.notEqual(ts.tint, py.tint);
    for (const [ext, [lang, tint]] of Object.entries(LANGUAGES)) {
      assert.match(tint, /^#[0-9a-f]{6}$/, ext);
      assert.ok(lang.length > 0, ext);
    }
  });

  it("says in a few plain words what each file is", () => {
    for (const p of ["Dockerfile", ".env", "src/main.rs", "a/b/c.unknownext", "README.md"]) assert.match(fileIcon(p).what, /^[A-Z][^.]*$/, p);
  });
});

describe("file icons: folders", () => {
  it("gives a folder with a job that job's drawing, and every other the folder", () => {
    assert.equal(folderIcon("tests").name, "checklist");
    assert.equal(folderIcon("docs").name, "book");
    assert.equal(folderIcon("scripts").name, "terminal");
    assert.equal(folderIcon("migrations").name, "database");
    assert.equal(folderIcon("workflows").name, "conveyor");
    assert.equal(folderIcon("public").name, "palette");
    assert.equal(folderIcon("src").name, "folder");
    assert.equal(folderIcon("Components").name, "folder");
  });
});

describe("file icons: only drawings the set has", () => {
  it("never names a drawing the set does not draw", () => {
    const set = new Set<string>(DRAWING_NAMES);
    const samples = ["Dockerfile", ".github/workflows/x.yml", "a.test.ts", "Cargo.lock", "package.json", "README", "LICENSE", "CHANGELOG", ".gitignore", ".env", "Makefile", "nginx.conf", "x.sql",
      "x.html", "x.css", "x.json", "x.yml", "x.md", "x.sh", "x.png", "x.mp3", "x.csv", "x.log", "x.woff2", "x.zip", "x.proto", "x.ipynb", "x.wasm", "x.rs", "x"];
    for (const p of samples) assert.ok(set.has(fileIcon(p).name), `${p} → ${fileIcon(p).name}`);
    for (const f of ["tests", "docs", "scripts", "bin", "migrations", "public", "assets", "static", "workflows", "logs", "config", ".vscode", "src"]) assert.ok(set.has(folderIcon(f).name), f);
  });
});
