// Queues, topics and subjects (docs/SERVICES.md §3 "Channels"): one table of
// matchers shared by the JavaScript and Python extractors. Each extractor
// turns a call into a CallInfo (callee, arguments as plain values); the
// table says whether it puts messages on a channel or picks them up, and
// which channel. A matcher only fires in a file that imports that library,
// so a `.send()` or `.publish()` elsewhere is never taken for a message.
import type { ChannelFact } from "../facts";

export type Tech = ChannelFact["tech"];

/** An argument as far as the matchers care: a string, a string with `*` for
 * interpolated parts, a list, an object, or an env setting. */
export interface Arg {
  str?: string;
  /** Template/f-string with `*` where code is interpolated. */
  pattern?: string;
  list?: Arg[];
  obj?: Record<string, Arg>;
  /** process.env.X / os.environ["X"] (directly or through a module constant). */
  env?: string;
}

export interface CallInfo {
  /** The method or function name: "send", "subscribe", "SendMessageCommand". */
  name: string;
  /** The receiver's text ("producer", "this.channel"), when there is one. */
  object?: string;
  args: Arg[];
  kwargs: Record<string, Arg>;
  isNew: boolean;
  line: number;
}

const JS_LIBS: [RegExp, Tech[]][] = [
  [/^(kafkajs|node-rdkafka|kafka-node|@confluentinc\/kafka-javascript)$/, ["kafka"]],
  [/^(amqplib|amqplib\/callback_api|amqp-connection-manager)$/, ["rabbitmq"]],
  [/^(@aws-sdk\/client-sqs|sqs-consumer|sqs-producer)$/, ["sqs"]],
  [/^@aws-sdk\/client-sns$/, ["sns"]],
  [/^aws-sdk(\/.*)?$/, ["sqs", "sns"]],
  [/^(nats|nats\.ws)$/, ["nats"]],
  [/^(redis|ioredis|@redis\/client)$/, ["redis"]],
  [/^(bullmq|bull)$/, ["bullmq"]],
];
const PY_LIBS: [RegExp, Tech[]][] = [
  [/^(confluent_kafka|aiokafka|kafka)(\.|$)/, ["kafka"]],
  [/^(pika|aio_pika|kombu)(\.|$)/, ["rabbitmq"]],
  [/^(boto3|aioboto3|aiobotocore)(\.|$)/, ["sqs", "sns"]],
  [/^nats(\.|$)/, ["nats"]],
  [/^(redis|aioredis)(\.|$)/, ["redis"]],
  [/^celery(\.|$)/, ["celery"]],
];

/** The messaging libraries a file imports, from its import specifiers. */
export function techsOf(specs: string[], lang: "js" | "py"): Set<Tech> {
  const out = new Set<Tech>();
  for (const s of specs) for (const [re, techs] of lang === "js" ? JS_LIBS : PY_LIBS) if (re.test(s)) for (const t of techs) out.add(t);
  return out;
}

/** The words a beginner reads on a channel card. */
export const TECH_LABEL: Record<Tech, string> = {
  kafka: "kafka topic",
  rabbitmq: "rabbitmq queue",
  sqs: "sqs queue",
  sns: "sns topic",
  nats: "nats subject",
  redis: "redis channel",
  bullmq: "bullmq queue",
  celery: "celery queue",
};

interface Named {
  name: string;
  literal: boolean;
  varName?: string;
}

/** A channel name from an argument: a literal, a pattern (a guess), or an env setting (resolved later). */
function nameOf(a: Arg | undefined, lastSegment?: "url" | "arn"): Named | null {
  if (!a) return null;
  const tidy = (s: string) => (lastSegment === "url" ? s.replace(/\/+$/, "").split("/").pop()! : lastSegment === "arn" ? s.split(":").pop()! : s);
  if (a.str !== undefined) return a.str ? { name: tidy(a.str), literal: true } : null;
  if (a.pattern !== undefined) {
    const n = tidy(a.pattern);
    return n && n !== "*" ? { name: n, literal: false } : null;
  }
  if (a.env) return { name: a.env, literal: false, varName: a.env };
  return null;
}

function names(a: Arg | undefined): Named[] {
  if (!a) return [];
  if (a.list) return a.list.map((x) => nameOf(x)).filter((x): x is Named => !!x);
  const n = nameOf(a);
  return n ? [n] : [];
}

/** Exchange + routing key → one channel name: the default exchange ("") routes straight to the queue. */
function exchangeKey(ex: Arg | undefined, key: Arg | undefined): Named | null {
  const e = nameOf(ex) ?? (ex?.str === "" ? { name: "", literal: true } : null);
  const k = nameOf(key);
  if (!e || !k) return null;
  if (e.name === "") return k;
  return { name: `${e.name}/${k.name}`, literal: e.literal && k.literal, varName: e.varName ?? k.varName };
}

function fact(tech: Tech, op: ChannelFact["op"], n: Named, line: number, extra: Partial<ChannelFact> = {}): ChannelFact {
  // A name with a wildcard (a pattern subscription) is never certain.
  const literal = n.literal && !/[*>#?]/.test(n.name);
  const f: ChannelFact = { channel: n.name, op, tech, line, literal, ...extra };
  if (n.varName) f.varName = n.varName;
  return f;
}

const kw = (c: CallInfo, ...keys: string[]): Arg | undefined => {
  for (const k of keys) if (c.kwargs[k]) return c.kwargs[k];
  return undefined;
};
const field = (a: Arg | undefined, ...keys: string[]): Arg | undefined => {
  for (const k of keys) if (a?.obj?.[k]) return a.obj[k];
  return undefined;
};

/** Channel facts for one call, given the libraries its file imports. */
export function matchChannel(c: CallInfo, techs: Set<Tech>): ChannelFact[] {
  const out: ChannelFact[] = [];
  const push = (tech: Tech, op: ChannelFact["op"], n: Named | null) => {
    if (n) out.push(fact(tech, op, n, c.line));
  };
  const a0 = c.args[0];

  if (techs.has("kafka")) {
    if (c.isNew && /^(KafkaConsumer|AIOKafkaConsumer)$/.test(c.name)) for (const a of c.args) push("kafka", "consume", nameOf(a));
    else if (c.name === "send" && field(a0, "topic")) push("kafka", "publish", nameOf(field(a0, "topic"))); // kafkajs producer.send({ topic })
    else if (c.name === "subscribe" && (field(a0, "topic") || field(a0, "topics"))) for (const n of names(field(a0, "topic") ?? field(a0, "topics"))) push("kafka", "consume", n);
    else if (c.name === "subscribe" && (a0?.list || kw(c, "topics"))) for (const n of names(a0?.list ? a0 : kw(c, "topics"))) push("kafka", "consume", n);
    else if (c.name === "produce") push("kafka", "publish", nameOf(kw(c, "topic") ?? a0));
    else if (/^(send|send_and_wait)$/.test(c.name) && (kw(c, "topic") || ((a0?.str !== undefined || a0?.pattern !== undefined) && /producer|kafka/i.test(c.object ?? "")))) push("kafka", "publish", nameOf(kw(c, "topic") ?? a0));
    if (out.length) return out;
  }
  if (techs.has("rabbitmq")) {
    if (c.name === "sendToQueue") push("rabbitmq", "publish", nameOf(a0));
    else if (c.name === "publish" && c.args.length >= 3 && !kw(c, "TopicArn")) push("rabbitmq", "publish", exchangeKey(a0, c.args[1])); // amqplib: (exchange, key, content)
    else if (c.name === "consume" && a0) push("rabbitmq", "consume", nameOf(a0));
    else if (c.name === "bindQueue") push("rabbitmq", "consume", exchangeKey(c.args[1], c.args[2]));
    else if (c.name === "basic_publish") push("rabbitmq", "publish", exchangeKey(kw(c, "exchange") ?? a0, kw(c, "routing_key") ?? c.args[1]));
    else if (c.name === "basic_consume") push("rabbitmq", "consume", nameOf(kw(c, "queue") ?? a0));
    else if (c.name === "queue_bind") push("rabbitmq", "consume", exchangeKey(kw(c, "exchange") ?? c.args[1], kw(c, "routing_key") ?? c.args[2]));
    if (out.length) return out;
  }
  if (techs.has("sqs")) {
    const url = field(a0, "QueueUrl") ?? kw(c, "QueueUrl");
    if (/^(SendMessageCommand|SendMessageBatchCommand|sendMessage|sendMessageBatch|send_message|send_message_batch)$/.test(c.name)) push("sqs", "publish", nameOf(url, "url"));
    else if (/^(ReceiveMessageCommand|receiveMessage|receive_message)$/.test(c.name)) push("sqs", "consume", nameOf(url, "url"));
    else if (c.name === "create" && c.object === "Consumer") push("sqs", "consume", nameOf(field(a0, "queueUrl"), "url")); // sqs-consumer
    if (out.length) return out;
  }
  if (techs.has("sns")) {
    const arn = field(a0, "TopicArn") ?? kw(c, "TopicArn");
    if (arn && /^(PublishCommand|PublishBatchCommand|publish|publish_batch)$/.test(c.name)) push("sns", "publish", nameOf(arn, "arn"));
    if (out.length) return out;
  }
  // NATS and Redis share verbs: with both imported, the receiver's name decides.
  const natsFirst = techs.has("nats") && (!techs.has("redis") || /\b(nc|nats|js|jetstream)\b/i.test(c.object ?? ""));
  if (natsFirst && a0) {
    if (c.name === "publish" || c.name === "request") push("nats", "publish", nameOf(a0));
    else if (c.name === "subscribe") push("nats", "consume", nameOf(a0));
    if (out.length) return out;
  }
  if (techs.has("redis") && a0) {
    if (c.name === "publish") push("redis", "publish", nameOf(a0));
    else if (c.name === "subscribe" || c.name === "psubscribe" || c.name === "ssubscribe") {
      for (const a of c.args) {
        const n = nameOf(a);
        if (n) out.push(fact("redis", "consume", c.name === "psubscribe" ? { ...n, literal: false } : n, c.line));
      }
    } else if (c.name === "xadd") push("redis", "publish", nameOf(a0));
    else if (c.name === "xreadgroup" || c.name === "xread") {
      // ioredis: ("GROUP", g, c, "STREAMS", "s", ">"); redis-py: (group, consumer, {"s": ">"}).
      const i = c.args.findIndex((a) => a.str?.toUpperCase() === "STREAMS");
      if (i >= 0) {
        const rest = c.args.slice(i + 1);
        for (const a of rest.slice(0, Math.floor(rest.length / 2))) push("redis", "consume", nameOf(a));
      } else {
        const streams = c.args.find((a) => a.obj) ?? kw(c, "streams");
        for (const k of Object.keys(streams?.obj ?? {})) push("redis", "consume", { name: k, literal: true });
      }
    }
    if (out.length) return out;
  }
  if (techs.has("bullmq") && c.isNew && c.name === "Worker") push("bullmq", "consume", nameOf(a0));
  return out;
}
