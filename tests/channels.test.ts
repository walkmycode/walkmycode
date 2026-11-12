// Queues, topics, gRPC and API descriptions (SERVICES.md §3, §5 "Other link
// kinds", §9 task 11): the extractors' channel and rpc facts, the .proto,
// OpenAPI and AsyncAPI readers, and the chan:/rpc: nodes and links they make.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildMap } from "../src/analyzer/build";
import { readAsyncApi, readOpenApi } from "../src/analyzer/config/openapi";
import { readProto } from "../src/analyzer/config/proto";
import type { ChannelFact } from "../src/analyzer/facts";
import type { CodeMap, SourceFile } from "../src/analyzer/types";
import { buildFixture, factsOf } from "./analyzer.helpers";

const f = (path: string, content: string): SourceFile => ({ path, content });
const brief = (cs: ChannelFact[]) => cs.map((c) => `${c.op} ${c.tech} ${c.channel}${c.literal ? "" : " ?"}${c.varName ? ` $${c.varName}` : ""}`);

describe("channel facts from JavaScript", () => {
  it("kafkajs: send({topic}) puts on a topic, subscribe({topic|topics}) picks up", async () => {
    const facts = await factsOf(
      "a.js",
      [
        'const { Kafka } = require("kafkajs");',
        "const TOPIC = process.env.EVENTS_TOPIC;",
        'await producer.send({ topic: "orders.created", messages: [] });',
        'await consumer.subscribe({ topics: ["users.changed", "users.deleted"] });',
        "await producer.send({ topic: TOPIC, messages: [] });",
        "await producer.send({ topic: `orders.${region}`, messages: [] });",
      ].join("\n"),
    );
    assert.deepEqual(brief(facts.channels), ["publish kafka orders.created", "consume kafka users.changed", "consume kafka users.deleted", "publish kafka EVENTS_TOPIC ? $EVENTS_TOPIC", "publish kafka orders.* ?"]);
    assert.equal(facts.channels[0].line, 3);
  });

  it("does nothing in a file that imports no messaging library", async () => {
    const facts = await factsOf("b.js", 'await producer.send({ topic: "orders.created" });\nclient.publish("x", "y", "z");\n');
    assert.deepEqual(facts.channels, []);
  });

  it("amqplib: sendToQueue, publish(exchange, key), consume, bindQueue", async () => {
    const facts = await factsOf(
      "c.ts",
      [
        'import amqp from "amqplib";',
        'ch.sendToQueue("jobs", Buffer.from("x"));',
        'ch.publish("events", "user.created", Buffer.from("x"));',
        'ch.consume("jobs", onJob);',
        'ch.bindQueue("audit", "events", "user.*");',
      ].join("\n"),
    );
    assert.deepEqual(brief(facts.channels), ["publish rabbitmq jobs", "publish rabbitmq events/user.created", "consume rabbitmq jobs", "consume rabbitmq events/user.* ?"]);
  });

  it("SQS and SNS: the queue is the last segment of its URL, the topic the last part of its ARN", async () => {
    const facts = await factsOf(
      "d.ts",
      [
        'import { SQSClient, SendMessageCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";',
        'import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";',
        'await sqs.send(new SendMessageCommand({ QueueUrl: "https://sqs.eu-west-1.amazonaws.com/123/orders", MessageBody: "x" }));',
        "await sqs.send(new ReceiveMessageCommand({ QueueUrl: process.env.ORDERS_QUEUE_URL }));",
        'await sns.send(new PublishCommand({ TopicArn: "arn:aws:sns:eu-west-1:123:user-events", Message: "x" }));',
      ].join("\n"),
    );
    assert.deepEqual(brief(facts.channels), ["publish sqs orders", "consume sqs ORDERS_QUEUE_URL ? $ORDERS_QUEUE_URL", "publish sns user-events"]);
  });

  it("NATS and Redis: subjects and channels, patterns are guesses", async () => {
    const nats = await factsOf("e.ts", 'import { connect } from "nats";\nnc.publish("orders.created", data);\nnc.subscribe("orders.*");\n');
    assert.deepEqual(brief(nats.channels), ["publish nats orders.created", "consume nats orders.* ?"]);
    const redis = await factsOf(
      "f.ts",
      ['import Redis from "ioredis";', 'redis.publish("news", "x");', 'sub.psubscribe("news.*");', 'redis.xadd("audit", "*", "k", "v");', 'redis.xreadgroup("GROUP", "g", "c", "STREAMS", "audit", ">");'].join("\n"),
    );
    assert.deepEqual(brief(redis.channels), ["publish redis news", "consume redis news.* ?", "publish redis audit", "consume redis audit"]);
  });

  it("BullMQ: a Queue's add() sends, a Worker on the same name receives", async () => {
    const facts = await factsOf("g.ts", 'import { Queue, Worker } from "bullmq";\nconst emails = new Queue("emails");\nawait emails.add("welcome", { to });\nnew Worker("emails", async (job) => {});\n');
    assert.deepEqual(brief(facts.channels).sort(), ["consume bullmq emails", "publish bullmq emails"]);
  });

  it("gRPC in Node: addService implements, new pkg.Users(host) calls", async () => {
    const facts = await factsOf(
      "h.js",
      ['const grpc = require("@grpc/grpc-js");', "server.addService(proto.users.Users.service, { getUser });", 'const client = new proto.users.Users("users:50051", grpc.credentials.createInsecure());'].join("\n"),
    );
    assert.deepEqual(facts.rpc, [
      { service: "Users", role: "implements", line: 2 },
      { service: "Users", role: "calls", host: "users:50051", line: 3 },
    ]);
  });
});

describe("channel facts from Python", () => {
  it("confluent-kafka, kafka-python and aiokafka", async () => {
    const facts = await factsOf(
      "a.py",
      [
        "from confluent_kafka import Producer, Consumer",
        "from kafka import KafkaConsumer",
        'producer.produce(topic="orders.created", value=b"x")',
        'consumer.subscribe(["users.changed"])',
        'c = KafkaConsumer("audit")',
        'await producer.send_and_wait("orders.paid", b"x")',
      ].join("\n"),
    );
    assert.deepEqual(brief(facts.channels), ["publish kafka orders.created", "consume kafka users.changed", "consume kafka audit", "publish kafka orders.paid"]);
  });

  it("pika: basic_publish to the default exchange is the queue itself", async () => {
    const facts = await factsOf("b.py", 'import pika\nch.basic_publish(exchange="", routing_key="tasks", body=b"x")\nch.basic_consume(queue="tasks", on_message_callback=cb)\n');
    assert.deepEqual(brief(facts.channels), ["publish rabbitmq tasks", "consume rabbitmq tasks"]);
  });

  it("boto3 SQS with the queue URL in a setting", async () => {
    const facts = await factsOf("c.py", 'import os\nimport boto3\nsqs.send_message(QueueUrl=os.environ["JOBS_QUEUE_URL"], MessageBody="x")\n');
    assert.deepEqual(brief(facts.channels), ["publish sqs JOBS_QUEUE_URL ? $JOBS_QUEUE_URL"]);
  });

  it("Celery: a task receives from its queue; delay() and send_task() send, task names kept apart", async () => {
    const facts = await factsOf(
      "d.py",
      ["from celery import Celery", 'app = Celery("x")', "", '@app.task(queue="mail")', "def send_email(to):", "    pass", "", "send_email.delay(1)", 'app.send_task("billing.charge")'].join("\n"),
    );
    const got = facts.channels.map((c) => [c.op, c.channel, c.task, c.sendTask ?? false]);
    assert.deepEqual(got, [
      ["consume", "mail", "send_email", false],
      ["publish", "celery", "send_email", false],
      ["publish", "celery", "billing.charge", true],
    ]);
  });

  it("gRPC in Python: add_…Servicer_to_server implements, …Stub(channel) calls with the channel's host", async () => {
    const facts = await factsOf(
      "e.py",
      [
        "import grpc",
        "import users_pb2_grpc",
        "",
        "def serve():",
        "    users_pb2_grpc.add_UsersServicer_to_server(UsersServicer(), server)",
        "",
        "def call():",
        '    channel = grpc.insecure_channel("users:50051")',
        "    stub = users_pb2_grpc.UsersStub(channel)",
      ].join("\n"),
    );
    assert.deepEqual(facts.rpc, [
      { service: "Users", role: "implements", line: 5 },
      { service: "Users", role: "calls", host: "users:50051", line: 9 },
    ]);
  });
});

describe("API description readers", () => {
  it(".proto: services, their methods and the line they start on; comments ignored", () => {
    const got = readProto(
      "proto/users.proto",
      ['syntax = "proto3";', "// service Old { rpc Gone(A) returns (B); }", "service Users {", "  rpc GetUser (GetUserRequest) returns (User);", "  rpc ListUsers (Empty) returns (stream User);", "}", "service Health { rpc Check (Empty) returns (Empty); }"].join("\n"),
    );
    assert.deepEqual(got, [
      { name: "Users", methods: ["GetUser", "ListUsers"], file: "proto/users.proto", line: 3 },
      { name: "Health", methods: ["Check"], file: "proto/users.proto", line: 7 },
    ]);
  });

  it("OpenAPI 3: paths × methods under the server's base path, with operationId", () => {
    const { routes, warnings } = readOpenApi(
      "openapi.yaml",
      ["openapi: 3.0.0", "servers:", "  - url: http://users:8080/v1", "paths:", "  /users/{id}:", "    get:", "      operationId: getUser", "    delete: {}", "  /health:", "    get: {}"].join("\n"),
    );
    assert.deepEqual(warnings, []);
    assert.deepEqual(
      routes.map((r) => [r.method, r.path, r.operationId, r.line, r.serverUrl]),
      [
        ["GET", "/v1/users/{id}", "getUser", 6, "http://users:8080/v1"],
        ["DELETE", "/v1/users/{id}", undefined, 8, "http://users:8080/v1"],
        ["GET", "/v1/health", undefined, 10, "http://users:8080/v1"],
      ],
    );
  });

  it("Swagger 2 in JSON: host + basePath", () => {
    const { routes } = readOpenApi("swagger.json", JSON.stringify({ swagger: "2.0", host: "orders:9000", basePath: "/api", paths: { "/orders": { post: {} } } }, null, 2));
    assert.deepEqual(
      routes.map((r) => [r.method, r.path, r.serverUrl]),
      [["POST", "/api/orders", "http://orders:9000/api"]],
    );
  });

  it("AsyncAPI 3 (operations + channel refs) and 2 (the reader's verbs)", () => {
    const v3 = readAsyncApi(
      "asyncapi.yaml",
      [
        "asyncapi: 3.0.0",
        "servers:",
        "  prod:",
        "    host: kafka:9092",
        "    protocol: kafka",
        "channels:",
        "  orderCreated:",
        "    address: orders.created",
        "operations:",
        "  sendOrderCreated:",
        "    action: send",
        "    channel:",
        "      $ref: '#/channels/orderCreated'",
      ].join("\n"),
    );
    assert.equal(v3.protocol, "kafka");
    assert.deepEqual(v3.channels, [{ name: "orders.created", op: "publish", file: "asyncapi.yaml", line: 10 }]);
    const v2 = readAsyncApi("asyncapi.yml", ["asyncapi: 2.6.0", "channels:", "  user/signedup:", "    subscribe: {}", "    publish: {}"].join("\n"));
    assert.deepEqual(
      v2.channels.map((c) => [c.name, c.op]),
      [
        ["user/signedup", "publish"],
        ["user/signedup", "consume"],
      ],
    );
  });
});

describe("compose-shop: the orders.created topic", () => {
  let map: CodeMap;
  before(async () => {
    map = (await buildFixture("compose-shop")).map;
  });

  it("is one kafka channel node, owned by the broker compose names", () => {
    const chans = map.nodes.filter((n) => n.kind === "channel");
    assert.deepEqual(
      chans.map((n) => [n.id, n.layer, n.service, n.tech]),
      [["chan:kafka/orders.created", "external", "svc-kafka", "kafka topic"]],
    );
  });

  it("orders publishes and users consumes, both certain with the code line", () => {
    const pub = map.edges.find((e) => e.id === "publishes:route:services/orders/app/main.py#POST /orders->chan:kafka/orders.created");
    const sub = map.edges.find((e) => e.id === "consumes:file:services/users/src/consumer.js->chan:kafka/orders.created");
    assert.ok(pub && sub);
    assert.equal(pub.confidence, "certain");
    assert.equal(sub.confidence, "certain");
    assert.deepEqual(
      pub.evidence.map((e) => e.file),
      ["services/orders/app/main.py"],
    );
    assert.match(pub.evidence[0].text, /producer\.produce\(topic="orders\.created"/);
    assert.match(sub.evidence[0].text, /consumer\.subscribe\(\{ topic: "orders\.created" \}\)/);
  });

  it("derives exactly one orders → users link through the channel, as a guess", () => {
    const via = map.system.links.filter((l) => l.via === "chan:kafka/orders.created");
    assert.equal(via.length, 1);
    assert.equal(via[0].id, "publishes:svc-orders->svc-users@chan:kafka/orders.created");
    assert.equal(via[0].confidence, "likely");
    assert.ok(via[0].note);
    assert.deepEqual([...via[0].edgeIds].sort(), ["consumes:file:services/users/src/consumer.js->chan:kafka/orders.created", "publishes:route:services/orders/app/main.py#POST /orders->chan:kafka/orders.created"]);
  });
});

describe("gRPC, OpenAPI and AsyncAPI in a map", () => {
  const compose = ["services:", "  web:", "    build: ./web", "  users:", "    build: ./users", ""].join("\n");
  const proto = ['syntax = "proto3";', "service Users {", "  rpc GetUser (Req) returns (Res);", "}", "service Billing {", "  rpc Charge (Req) returns (Res);", "}", ""].join("\n");
  let map: CodeMap;
  before(async () => {
    const sources = [
      f("docker-compose.yml", compose),
      f("proto/users.proto", proto),
      f("web/requirements.txt", "grpcio\nfastapi\n"),
      f("web/app/main.py", ["import grpc", "from fastapi import FastAPI", "import users_pb2_grpc", "", "app = FastAPI()", "", '@app.get("/")', "def home():", '    channel = grpc.insecure_channel("users:50051")', "    stub = users_pb2_grpc.UsersStub(channel)", "    b = users_pb2_grpc.BillingStub(channel)", "    return {}", ""].join("\n")),
      f("users/requirements.txt", "grpcio\n"),
      f("users/server.py", ["import grpc", "import users_pb2_grpc", "", "def serve():", "    server = grpc.server(None)", "    users_pb2_grpc.add_UsersServicer_to_server(UsersServicer(), server)", ""].join("\n")),
      f("users/users_pb2_grpc.py", "# generated\nclass UsersStub: pass\n"),
      f("users/openapi.yaml", ["openapi: 3.0.0", "paths:", "  /users/{id}:", "    get:", "      operationId: getUser", ""].join("\n")),
      f("users/asyncapi.yaml", ["asyncapi: 3.0.0", "servers:", "  k:", "    host: kafka:9092", "    protocol: kafka", "channels:", "  c:", "    address: users.changed", "operations:", "  o:", "    action: send", "    channel:", "      $ref: '#/channels/c'", ""].join("\n")),
    ];
    map = (await buildMap(sources, { name: "grpc" })).map;
  });

  it("makes one rpc node per gRPC service, owned by the service that implements it", () => {
    const users = map.nodes.find((n) => n.id === "rpc:proto/users.proto#Users");
    assert.ok(users);
    assert.equal(users.kind, "rpc");
    assert.equal(users.layer, "api");
    assert.equal(users.service, "svc-users");
    assert.equal(users.tech, "gRPC service");
    assert.match(users.note ?? "", /users\/server\.py:6/);
  });

  it("calls-rpc is certain when the host is the implementer", () => {
    const e = map.edges.find((x) => x.id === "calls-rpc:route:web/app/main.py#GET /->rpc:proto/users.proto#Users");
    assert.ok(e);
    assert.equal(e.confidence, "certain");
    assert.ok(e.evidence.some((x) => x.file === "web/app/main.py" && x.line === 10));
    assert.ok(e.evidence.some((x) => x.file === "docker-compose.yml" && x.role === "config"), "the line that names the users host");
    assert.ok(map.system.links.some((l) => l.id === "calls-rpc:svc-web->svc-users"));
  });

  it("a .proto service nobody here implements belongs to a service I can't see", () => {
    const b = map.nodes.find((n) => n.id === "rpc:proto/users.proto#Billing");
    assert.ok(b);
    assert.equal(b.service, "svc-billing");
    assert.equal(map.services.find((s) => s.id === "svc-billing")?.kind, "placeholder");
    assert.match(b.note ?? "", /did not find the code that implements it/);
    const e = map.edges.find((x) => x.to === b.id);
    assert.ok(e && e.confidence === "likely" && e.note, "a guess, with its reason");
  });

  it("never parses generated protobuf code", () => {
    assert.equal(map.files.find((x) => x.path === "users/users_pb2_grpc.py")?.skipped, "generated");
  });

  it("keeps a door only an OpenAPI file describes, saying so", () => {
    const r = map.nodes.find((n) => n.id === "route:users/openapi.yaml#GET /users/{id}");
    assert.ok(r);
    assert.equal(r.service, "svc-users");
    assert.match(r.note ?? "", /described in openapi\.yaml \(getUser\); I did not find the code/);
  });

  it("an AsyncAPI channel no code names is a card, with a note", () => {
    const c = map.nodes.find((n) => n.id === "chan:kafka/users.changed");
    assert.ok(c);
    assert.match(c.note ?? "", /described in asyncapi\.yaml:\d+; I did not find the code/);
  });

  it("an AsyncAPI file with no protocol takes the broker compose runs, or says why it drew nothing", async () => {
    const api = ["asyncapi: 3.0.0", "channels:", "  c:", "    address: orders.created", "operations:", "  o:", "    action: send", "    channel:", "      $ref: '#/channels/c'", ""].join("\n");
    const app = [f("package.json", '{ "name": "a", "dependencies": { "express": "4.0.0" } }'), f("index.js", 'const express = require("express");\nconst app = express();\napp.get("/x", (req, res) => res.json({}));\napp.listen(3000);\n')];
    const withKafka = (await buildMap([f("asyncapi.yaml", api), f("docker-compose.yml", "services:\n  a:\n    build: .\n  kafka:\n    image: redpanda\n  cache:\n    image: redis\n"), ...app], { name: "a" })).map;
    const c = withKafka.nodes.find((n) => n.id === "chan:kafka/orders.created");
    assert.ok(c, "kafka is the only broker");
    assert.equal(c.service, "svc-kafka");
    const bare = (await buildMap([f("asyncapi.yaml", api), ...app], { name: "a" })).map;
    assert.ok(!bare.nodes.some((n) => n.kind === "channel"));
    assert.ok(bare.warnings.some((w) => w.includes("asyncapi.yaml:6") && w.includes("orders.created")), bare.warnings.join("\n"));
  });
});
