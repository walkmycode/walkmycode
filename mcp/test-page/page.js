// A minimal page for trying WalkMyCode for Claude's bridge by hand (docs/MCP.md §8 A):
// it connects to the local server, shows what Claude sends, acknowledges every
// command, and sends the requests the real page will (Explain, Trace it, Tour,
// typed and spoken questions). The real front-end is phase B's `mcp` target.
// Everything from Claude is shown as text, never as HTML.
const PROTOCOL = 1;
const $ = (id) => document.getElementById(id);
let socket = null;
let retries = 0;
let refs = 0;
let lastActivity = 0;

function setConn(text) {
  $("conn").textContent = text;
}

function connect() {
  socket = new WebSocket(`ws://${location.host}/bridge`);
  socket.addEventListener("open", () => {
    retries = 0;
    setConn("connected");
    socket.send(JSON.stringify({ type: "hello", protocol: PROTOCOL }));
  });
  socket.addEventListener("close", (ev) => {
    if (ev.code === 4001) return setConn("WalkMyCode was opened in another tab.");
    setConn("disconnected: retrying…");
    setTimeout(connect, Math.min(10_000, 500 * 2 ** retries++));
  });
  socket.addEventListener("message", (ev) => handle(JSON.parse(ev.data)));
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function handle(m) {
  switch (m.type) {
    case "welcome":
      showWorkspace(m.workspace);
      showClaude(m.claude);
      break;
    case "status":
      showClaude(m.claude);
      break;
    case "command":
      run(m.command);
      send({ type: "ack", id: m.id, ok: true });
      break;
    case "queued":
    case "taken":
    case "dropped":
    case "rejected":
      addItem("requests", `${m.type}${m.id ? ` ${m.id}` : ""}${m.ref ? ` (${m.ref})` : ""}${m.reason || m.error ? `: ${m.reason || m.error}` : ""}`);
      break;
    case "replaced":
      setConn("WalkMyCode was opened in another tab.");
      break;
  }
}

function showClaude(c) {
  const stale = c.lastPollAt && Date.now() - Date.parse(c.lastPollAt) > 75_000;
  const text = c.listening
    ? "Claude is listening"
    : c.working.length
      ? `Claude is working on ${c.working.join(", ")}`
      : stale || !c.lastPollAt
        ? "Claude isn't listening: say “continue” in Claude"
        : "";
  $("claude").textContent = `${text}${c.queued ? ` · ${c.queued} waiting` : ""}`;
}

async function showWorkspace(info) {
  if (!info) return;
  $("workspace").textContent = `${info.name}: ${info.files} files (${info.repos.join(", ")}), mapped ${new Date(info.mappedAt).toLocaleTimeString()}`;
  try {
    const { map } = await (await fetch("/api/workspace")).json();
    const list = $("nodes");
    list.replaceChildren(
      ...map.nodes.slice(0, 500).map((n) => {
        const o = document.createElement("option");
        o.value = n.id;
        o.label = n.name;
        return o;
      }),
    );
    $("workspace").textContent += ` · ${map.stats.routes} routes, ${map.stats.tables} tables, ${map.stats.edges} links`;
  } catch {
    // the summary above is enough
  }
}

function run(c) {
  if (c.name === "workspace") showWorkspace(c.workspace);
  if (c.name === "narrate" && "speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(c.text));
  const { name, ...rest } = c;
  const body = name === "answer" ? `${rest.markdown}\n\ncitations: ${rest.citations.map((x) => `${x.path}:${x.from}-${x.to}`).join(", ") || "none"}` : JSON.stringify(rest);
  addItem("log", `${name}${rest.requestId ? ` (${rest.requestId})` : ""}`, body);
}

function addItem(listId, title, body) {
  const li = document.createElement("li");
  li.textContent = title;
  if (body) {
    const pre = document.createElement("pre");
    pre.textContent = body;
    li.append(pre);
  }
  $(listId).prepend(li);
}

function num(id) {
  const v = Number($(id).value);
  return Number.isInteger(v) && v > 0 ? v : undefined;
}

$("ask").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const kind = $("kind").value;
  const text = $("question").value.trim();
  const file = $("file").value.trim() || undefined;
  const from = num("from");
  const to = num("to") ?? from;
  const nodeId = $("node").value.trim() || undefined;
  const payload =
    kind === "explain"
      ? { path: file, from, to, nodeId, text: text || undefined }
      : kind === "trace"
        ? { from: nodeId, to: $("toNode").value.trim() || undefined }
        : kind === "tour"
          ? { topic: text || undefined }
          : { text };
  const context = { file, lines: from ? { from, to } : undefined, nodeId };
  const ref = `p${++refs}`;
  send({ type: "request", ref, request: { kind, payload, context } });
  addItem("requests", `sent ${kind} (${ref})`);
});

// The user is still here: keeps Claude listening (at most once every 30 s).
for (const type of ["pointerdown", "keydown", "scroll"]) {
  addEventListener(type, () => {
    if (Date.now() - lastActivity < 30_000) return;
    lastActivity = Date.now();
    send({ type: "activity" });
  });
}

connect();
