// An app's own settings files (src/analyzer/config/settings.ts): Spring's application.properties
// and application.yml, ASP.NET Core's appsettings.json. Their keys are settings the map knows by
// the name the code reads them with, a value that points at the environment takes the
// environment's, and nothing that could be a secret is kept or shown.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { configKindOfPath, extractConfig, redactConfigText, redactValue } from "../src/analyzer/config";
import { profileOf, readProperties, readSettings, readTree } from "../src/analyzer/config/settings";
import type { CodeMap } from "../src/analyzer/types";
import "./analyzer.helpers";

const mapOf = async (files: Record<string, string>): Promise<CodeMap> => (await buildMap(Object.entries(files).map(([path, content]) => ({ path, content })), { name: "t" })).map;
const config = (files: Record<string, string>) => extractConfig(Object.entries(files).map(([path, content]) => ({ path, content }))).facts;

describe("settings files", () => {
  it("are config files the readers keep, by name", () => {
    for (const p of ["src/main/resources/application.properties", "src/main/resources/application.yml", "config/application-dev.yaml", "Api/appsettings.json", "appsettings.Development.json"]) assert.equal(configKindOfPath(p), "settings", p);
    for (const p of ["src/main/resources/messages.properties", "settings.json", "app/application.py", "appsettings.txt"]) assert.notEqual(configKindOfPath(p), "settings", p);
    assert.equal(profileOf("src/main/resources/application.properties"), null);
    assert.equal(profileOf("src/main/resources/application-dev.yml"), "dev");
    assert.equal(profileOf("appsettings.Development.json"), "Development");
  });

  it("reads application.properties: keys as written, comments left out, a secret hidden", () => {
    const lines = readProperties("# services\nusers.url=http://users:8080\npayments.url : https://pay.example.com\n! old\nspring.datasource.password=hunter2\nempty=\nusers.env=${USERS_URL}\nusers.both=${USERS_URL:http://localhost:8081}\n");
    assert.deepEqual(lines, [
      { name: "users.url", line: 2, value: "http://users:8080" },
      { name: "payments.url", line: 3, value: "https://pay.example.com" },
      { name: "spring.datasource.password", line: 5, value: "•••" },
      { name: "empty", line: 6, value: "" },
      { name: "users.env", line: 7, ref: "USERS_URL" },
      { name: "users.both", line: 8, value: "http://localhost:8081", ref: "USERS_URL" },
    ]);
  });

  it("reads application.yml as dotted keys, every document of it", () => {
    const lines = readTree("users:\n  url: http://users:8080\n  retries: 3\nspring:\n  datasource:\n    password: hunter2\n  profiles: [dev]\n---\nusers:\n  timeout: 5s\n", ".");
    assert.deepEqual(lines.map((l) => `${l.name}=${l.value}@${l.line}`), ["users.url=http://users:8080@2", "users.retries=3@3", "spring.datasource.password=•••@6", "users.timeout=5s@10"]);
  });

  it("reads appsettings.json as Section:Key, comments and all", () => {
    const lines = readTree('{\n  // services\n  "Users": {\n    "Url": "http://users:8080",\n    "Retry": { "Count": 3 }\n  },\n  "ConnectionStrings": { "Default": "Server=db;User Id=sa;Password=hunter2;" },\n  "Jwt": { "Key": "abc" },\n  "AllowedHosts": "*"\n}\n', ":");
    assert.deepEqual(lines.map((l) => `${l.name}=${l.value}@${l.line}`), [
      "Users:Url=http://users:8080@4",
      "Users:Retry:Count=3@5",
      "ConnectionStrings:Default=Server=db;User Id=sa;Password=•••;@7",
      "Jwt:Key=•••@8",
      "AllowedHosts=*@9",
    ]);
    assert.deepEqual(readTree("{ not json", ":"), [], "a broken file gives nothing, and breaks nothing");
  });

  it("marks a profile's values as one way the app can run", () => {
    assert.deepEqual(readSettings("application-dev.properties", "users.url=http://localhost:8081\n").values, [{ name: "users.url", value: "http://localhost:8081", file: "application-dev.properties", line: 1, likely: "in the dev profile's settings" }]);
    assert.equal(readSettings("application.properties", "users.url=http://users:8080\n").values[0].likely, undefined);
  });

  it("gives a setting that points at the environment the environment's value, else its own default", () => {
    const withEnv = config({
      "docker-compose.yml": "services:\n  orders:\n    build: .\n    environment:\n      USERS_URL: http://users-svc:9000\n",
      "src/main/resources/application.properties": "users.url=${USERS_URL:http://localhost:8081}\n",
    });
    const hit = withEnv.envValues.filter((v) => v.name === "users.url");
    assert.deepEqual(hit.map((v) => `${v.value} ${v.file}:${v.line}`), ["http://users-svc:9000 docker-compose.yml:5"]);
    const alone = config({ "src/main/resources/application.properties": "users.url=${USERS_URL:http://localhost:8081}\nother.url=${OTHER_URL}\n" });
    assert.deepEqual(alone.envValues.map((v) => `${v.name}=${v.value}`), ["users.url=http://localhost:8081"], "no value anywhere: the setting has none");
  });

  it("hides passwords in what the file shows, connection strings included", () => {
    assert.equal(redactValue("Default", "Server=db;User Id=sa;Password=hunter2;Encrypt=true"), "Server=db;User Id=sa;Password=•••;Encrypt=true");
    assert.equal(redactValue("url", "jdbc:mysql://db/orders?user=app&password=hunter2&ssl=true"), "jdbc:mysql://db/orders?user=app&password=•••&ssl=true");
    const shown = redactConfigText('{\n  "ConnectionStrings": { "Default": "Server=db;Pwd=hunter2;" },\n  "Jwt": {\n    "Key": "0123456789abcdef"\n  }\n}\n', "appsettings.json");
    assert.ok(!shown.includes("hunter2") && !shown.includes("0123456789abcdef"), shown);
    assert.equal(shown.split("\n").length, 7, "line for line");
    const props = redactConfigText("users.url=http://users:8080\nspring.datasource.password=hunter2\napi.token=abc123\n", "application.properties");
    assert.equal(props, "users.url=http://users:8080\nspring.datasource.password=•••\napi.token=•••\n");
  });
});

describe("settings on the map", () => {
  it("follows a Spring @Value to application.yml, and from there to the service it names", async () => {
    const m = await mapOf({
      "docker-compose.yml": "services:\n  orders:\n    build: ./orders\n  users:\n    build: ./users\n",
      "orders/src/main/resources/application.yml": "users:\n  url: http://users:8080\n",
      "orders/src/main/java/app/UserClient.java": 'package app;\npublic class UserClient {\n  @Value("${users.url}")\n  private String usersUrl;\n  private final RestTemplate rest = new RestTemplate();\n  void check(long id) { rest.getForObject(usersUrl + "/api/users/" + id, String.class); }\n}\n',
      "users/src/main/java/app/UserController.java": 'package app;\n@RestController\npublic class UserController {\n  @GetMapping("/api/users/{id}")\n  public String one() { return ""; }\n}\n',
    });
    const call = m.edges.find((e) => e.kind === "calls-route");
    assert.ok(call, m.edges.map((e) => `${e.kind} ${e.from} -> ${e.to}`).join("\n"));
    assert.equal(call.from, "file:orders/src/main/java/app/UserClient.java");
    assert.equal(call.to, "route:users/src/main/java/app/UserController.java#GET /api/users/{id}");
    assert.ok(call.evidence.some((v) => v.file === "orders/src/main/resources/application.yml" && v.line === 2), "the settings line is part of the proof");
    assert.equal(m.files.find((f) => f.path.endsWith("application.yml"))?.configKind, "settings");
  });

  it("follows IConfiguration to appsettings.json the same way", async () => {
    const m = await mapOf({
      "docker-compose.yml": "services:\n  todos:\n    build: ./todos\n  users:\n    build: ./users\n",
      "todos/appsettings.json": '{\n  "Users": {\n    "Url": "http://users:8080"\n  }\n}\n',
      "todos/UserClient.cs": 'namespace Todos;\npublic class UserClient {\n  private readonly HttpClient _http;\n  private readonly string _base;\n  public UserClient(HttpClient http, IConfiguration config) { _http = http;\n    _base = config["Users:Url"];\n  }\n  public Task One(int id) => _http.GetAsync($"{_base}/api/users/{id}");\n}\n',
      "users/UsersController.cs": 'namespace Users;\n[ApiController]\n[Route("api/[controller]")]\npublic class UsersController : ControllerBase {\n  [HttpGet("{id}")]\n  public string One(int id) => "";\n}\n',
    });
    const call = m.edges.find((e) => e.kind === "calls-route");
    assert.ok(call, m.edges.map((e) => `${e.kind} ${e.from} -> ${e.to}`).join("\n"));
    assert.equal(call.to, "route:users/UsersController.cs#GET /api/users/{id}");
    assert.ok(call.evidence.some((v) => v.file === "todos/appsettings.json" && v.line === 3));
  });
});
