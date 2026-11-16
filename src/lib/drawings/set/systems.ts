// System design and the cloud: what a request meets on its way through servers, networks and stores. Same hand as base.ts.
import type { DrawingSet } from "../types";

const r1 = (n: number) => Math.round(n * 10) / 10;
const ring = (cx: number, cy: number, r: number, h: number) =>
  `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0-${2 * r}zM${cx} ${cy - h}a${h} ${h} 0 1 0 0 ${2 * h}a${h} ${h} 0 1 0 0-${2 * h}z`;

/** A tall database jar standing at cx: body, two bands and a lid. */
const jar = (cx: number) =>
  `<path class="d-t" d="M${cx - 11} 14v36a11 4 0 0 0 22 0v-36z"/><path class="d-t2" d="M${cx - 11} 26a11 4 0 0 0 22 0v2.5a11 4 0 0 1-22 0zM${cx - 11} 38a11 4 0 0 0 22 0v2.5a11 4 0 0 1-22 0z"/><ellipse class="d-t3" cx="${cx}" cy="14" rx="11" ry="4"/>`;

/** One upright slice (x a to b) of a wide database jar, moved s sideways, with a coloured light. */
const slice = (a: number, b: number, s: number, c: string) => {
  const dy = (x: number) => r1(6 * Math.sqrt(Math.max(0, 1 - ((x - 32) / 22) ** 2)));
  const A = dy(a), B = dy(b), arc = "A22 6 0 0";
  return `<g transform="translate(${s} 0)"><path class="d-t" d="M${a} ${r1(14 - A)}${arc} 1 ${b} ${r1(14 - B)}V${r1(50 + B)}${arc} 1 ${a} ${r1(50 + A)}z"/>` +
    `<path class="d-t2" d="M${a} ${r1(29 + A)}${arc} 0 ${b} ${r1(29 + B)}v3${arc} 1 ${a} ${r1(32 + A)}z"/>` +
    `<path class="d-t3" d="M${a} ${r1(14 - A)}${arc} 1 ${b} ${r1(14 - B)}V${r1(14 + B)}${arc} 1 ${a} ${r1(14 + A)}z"/><circle class="${c}" cx="${(a + b) / 2}" cy="43" r="2"/></g>`;
};

export const SYSTEMS: DrawingSet = {
  loadbalancer: { also: ["a load balancer", "the traffic splitter", "spreading the load", "sharing the work", "round robin", "a traffic cop"], tint: "#63c2a2", svg:
    '<ellipse class="d-sh" cx="32" cy="60" rx="27" ry="2"/><path class="d-line thick grey" d="M25 32C32 32 31 13 38 13M25 32h13M25 32C32 32 31 51 38 51"/>' +
    [7, 26, 45].map((y) => `<rect class="d-w2" x="38" y="${y}" width="22" height="12" rx="2.5"/><rect class="d-w3" x="38" y="${y}" width="22" height="8.5" rx="2.5"/><circle class="d-gr" cx="43" cy="${y + 4.5}" r="1.8"/><rect class="d-w2" x="47" y="${y + 3.5}" width="9" height="2" rx="1"/>`).join("") +
    '<path class="d-y" d="M3 28h6v-5l8 9-8 9v-5h-6z"/><circle class="d-t" cx="25" cy="32" r="8.5"/><path class="d-t2" d="M33.5 32a8.5 8.5 0 0 1-17 0z"/><circle class="d-t3" cx="22" cy="28.5" r="2.4"/>' },
  gateway: { also: ["an api gateway", "the main entrance", "a single way in", "a turnstile", "an archway", "a reverse proxy"], tint: "#6fa3b8", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="28" ry="2"/><path class="d-t" d="M7 58V30a25 25 0 0 1 50 0v28h-11V30a14 14 0 0 0-28 0v28z"/><path class="d-t2" d="M46 30h11v28h-11z"/>' +
    '<path class="d-dk2" d="M18 58V30a14 14 0 0 1 28 0v28z"/><path class="d-t3" d="M7 30h11v3h-11z"/><rect class="d-t3" x="28.5" y="3.5" width="7" height="10" rx="1.5"/>' +
    '<rect class="d-w2" x="19" y="37" width="4.5" height="21" rx="1"/><rect class="d-w" x="21" y="39" width="24" height="5" rx="2.5"/><path class="d-rd" d="M27 39h4v5h-4zM36 39h4v5h-4z"/><circle class="d-rd" cx="21.2" cy="35.5" r="2.2"/>' },
  api: { also: ["a serving hatch", "an api call", "a rest api", "request and response", "the menu of a service", "a socket"], tint: "#5f86b3", svg:
    '<ellipse class="d-sh" cx="38" cy="59.5" rx="21" ry="2"/><rect class="d-t" x="18" y="6" width="40" height="51" rx="5"/><path class="d-t2" d="M48 6h5q5 0 5 5v41q0 5-5 5h-5z"/>' +
    '<rect class="d-dk2" x="24" y="12" width="28" height="36" rx="3"/><path class="d-w2" d="M38 16h10v2.5h-10zM38 21h7v2.5h-7z"/><rect class="d-t3" x="21" y="46" width="34" height="5" rx="2.5"/>' +
    '<path class="d-y" d="M4 16h20v-5l10 9-10 9v-5h-20z"/><path class="d-gr" d="M44 32h-30v-5l-10 9 10 9v-5h30z"/>' },
  cache: { also: ["the quick shelf", "a nearby store", "fast storage", "kept close at hand", "a shortcut copy", "memoisation"], tint: "#4e8f7a", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="25" ry="2"/><rect class="d-t" x="9" y="20" width="46" height="37" rx="3"/><path class="d-t2" d="M44 20h8q3 0 3 3v31q0 3-3 3h-8z"/>' +
    '<rect class="d-t2" x="9" y="22" width="46" height="4"/><rect class="d-t3" x="6" y="14" width="52" height="9" rx="3"/><path class="d-y" d="M36 28l-12 14h7.5l-3 11 12.5-15.5h-7.5l3.5-9.5z"/>' },
  cdn: { also: ["a content delivery network", "copies near the user", "edge servers", "the edge", "a nearby copy", "worldwide delivery"], tint: "#5aa7e0", svg:
    '<path class="d-dash" d="M11 11L53 53M53 11L11 53"/>' +
    [[5, 5], [47, 5], [5, 47], [47, 47]].map(([x, y]) => `<rect class="d-y" x="${x}" y="${y}" width="12" height="12" rx="2"/><rect class="d-y2" x="${x}" y="${y}" width="12" height="4" rx="2"/>`).join("") +
    '<circle class="d-t" cx="32" cy="32" r="15"/><path class="d-t2" d="M32 17a15 15 0 0 1 0 30a20 20 0 0 0 0-30z"/>' +
    '<path class="d-gr" d="M23 25q4-6 10-3-1 4-5 5 1 5-3 7-4-3-2-9zM36 31q5-1 7 3-1 5-4 7-4-3-3-10zM27 40q4-1 5 2-2 3-5 2z"/><ellipse class="d-w" cx="25" cy="22" rx="4.5" ry="2.2" opacity=".35" transform="rotate(-35 25 22)"/>' },
  broker: { also: ["a message broker", "an event bus", "pub-sub", "publish and subscribe", "a noticeboard", "a sorting office"], tint: "#e07f73", svg:
    [[0, "d-pk"], [90, "d-y"], [180, "d-gr"], [270, "d-bl"]].map(([a, c]) => `<g transform="rotate(${a} 32 32)"><path class="d-line thick grey" d="M32 22v-3"/><path class="d-w2" d="M27.5 20l4.5-5.5 4.5 5.5z"/><rect class="${c}" x="25" y="2" width="14" height="11" rx="2.5"/></g>`).join("") +
    '<rect class="d-t2" x="21" y="23" width="22" height="20" rx="5"/><rect class="d-t" x="21" y="21" width="22" height="20" rx="5"/><rect class="d-w" x="25.5" y="26" width="13" height="9" rx="1.5"/><path class="d-line thin tint" d="M26.5 27.5l5.5 4 5.5-4"/>' },
  container: { also: ["a docker container", "a shipping container", "a packed app", "runs anywhere", "a portable box"], tint: "#f0a94b", svg:
    '<ellipse class="d-sh" cx="32" cy="57.5" rx="29" ry="2"/><rect class="d-t" x="4" y="16" width="56" height="38" rx="2"/>' +
    `<path class="d-t2" d="${[9, 15, 21, 27, 33, 39].map((x) => `M${x} 22h2.5v26h-2.5z`).join("")}M44 20h1.5v30h-1.5z"/>` +
    '<rect class="d-t3" x="4" y="16" width="56" height="4"/><rect class="d-t2" x="4" y="50" width="56" height="4"/><path class="d-w2" d="M48.5 20h2v30h-2zM54.5 20h2v30h-2z"/><path class="d-w" d="M47 32h5v2.5h-5zM53 37h5v2.5h-5z"/>' +
    '<path class="d-dk" d="M4 16h4v4h-4zM56 16h4v4h-4zM4 50h4v4h-4zM56 50h4v4h-4z"/>' },
  cluster: { also: ["kubernetes", "a fleet", "a group of machines", "a pod", "orchestration", "a swarm"], tint: "#5f86b3", svg:
    '<path class="d-t" d="M32 4l24.2 14v28L32 60 7.8 46V18z"/><path class="d-t2" d="M32 4l24.2 14v28L32 60z"/><path class="d-t3" d="M32 10l19.1 11v22L32 54 12.9 43V21z"/>' +
    [[23, 16, "d-or"], [14, 31, "d-pk"], [32, 31, "d-y"]].map(([x, y, c]) => `<rect class="${c}" x="${x}" y="${y}" width="18" height="12" rx="1.5"/><path class="d-line thin" opacity=".3" d="M${+x + 4.5} ${+y + 3}v6M${+x + 9} ${+y + 3}v6M${+x + 13.5} ${+y + 3}v6"/>`).join("") },
  service: { also: ["a microservice", "one small job", "a backend service", "a daemon", "a worker service"], tint: "#63c2a2", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="24" ry="2"/><path class="d-t2" d="M8 34l12-20.8h24l12 20.8-12 20.8h-24z"/><path class="d-t" d="M8 28l12-20.8h24l12 20.8-12 20.8h-24z"/><path class="d-t3" d="M21 9.2h22l-1.2 2h-19.6z"/>' +
    '<g class="d-w">' + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect x="29.5" y="14.5" width="5" height="6" rx="1.2" transform="rotate(${a} 32 28)"/>`).join("") + `<path d="${ring(32, 28, 10, 4)}"/></g>` },
  serverless: { also: ["a lambda", "a cloud function", "functions as a service", "no server to manage", "pay per run"], tint: "#b79cf0", svg:
    '<path class="d-t2" d="M16 51a12 12 0 0 1 .5-24 16 16 0 0 1 31 3 10.5 10.5 0 0 1 0 21z"/><path class="d-t" d="M16 48a12 12 0 0 1 .5-24 16 16 0 0 1 31 3 10.5 10.5 0 0 1 0 21z"/>' +
    '<ellipse class="d-t3" cx="25" cy="19.5" rx="5" ry="2.3" transform="rotate(-20 25 19.5)"/><path class="d-w" d="M24.5 25h5l13 21h-5.6l-4.3-7-5.6 7h-5.6l8.3-11.6-3.2-5.4h-2z"/>' },
  webhook: { also: ["a callback", "a doorbell that rings you back", "a hook", "an event callback", "a push notification"], tint: "#8e929c", svg:
    `<g transform="translate(-2.5 4)"><path class="d-t" d="${ring(36, 11, 5.5, 2.5)}M33 14h6v24a13 13 0 0 1-26 0v-7l3-5 3 5v7a7 7 0 0 0 14 0z"/><rect class="d-t3" x="34" y="16" width="1.6" height="20" rx=".8"/>` +
    '<path class="d-line thick yel" d="M42 10Q56 11 56 27Q56 41 47 46"/><path class="d-y" d="M42.6 48.4L48.7 49 45.3 43z"/></g>' },
  ratelimiter: { also: ["a rate limit", "a throttle", "a speed limit", "a speedometer", "too many requests", "slow down"], tint: "#e07f73", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="27" ry="2"/><path class="d-t" d="M3 45a29 29 0 0 1 58 0v6q0 4-4 4h-50q-4 0-4-4z"/><path class="d-dk2" d="M8 45a24 24 0 0 1 48 0z"/>' +
    '<path class="d-gr" d="M11 45A21 21 0 0 1 21.5 26.8L24.5 32A15 15 0 0 0 17 45z"/><path class="d-y" d="M21.5 26.8A21 21 0 0 1 42.5 26.8L39.5 32A15 15 0 0 0 24.5 32z"/><path class="d-rd" d="M42.5 26.8A21 21 0 0 1 53 45h-6A15 15 0 0 0 39.5 32z"/>' +
    '<path class="d-w" d="M30.6 43.3L46.6 32.8 33.4 46.7z"/><circle class="d-w" cx="32" cy="45" r="3.5"/><circle class="d-dk2" cx="32" cy="45" r="1.3"/><rect class="d-t3" x="24" y="49.5" width="16" height="3" rx="1.5"/>' },
  replica: { also: ["a read replica", "a second copy", "a follower", "a standby", "a twin", "a clone"], tint: "#63c2a2", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="28" ry="2"/><g opacity=".35">' + jar(49) + '</g><path class="d-dash" d="M38 14v36a11 4 0 0 0 22 0v-36"/><ellipse class="d-dash" cx="49" cy="14" rx="11" ry="4"/>' +
    jar(15) + '<path class="d-y" d="M27.5 30h3.5v-4l6 6-6 6v-4h-3.5z"/>' },
  shard: { also: ["a partition", "sharding", "a slice of the data", "split data", "horizontal scaling"], tint: "#5f86b3", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="27" ry="2"/>' + slice(10, 24, -4, "d-pk") + slice(24, 40, 0, "d-y") + slice(40, 54, 4, "d-gr") },
  browser: { also: ["a web browser", "a website", "a browser tab", "the address bar", "surfing the web"], tint: "#5aa7e0", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="26" ry="2"/><path class="d-t2" d="M29 16l2-7q.5-1.5 2-1.5h13q1.5 0 2 1.5l2 7z"/><path class="d-t" d="M7 16l2-7q.5-1.5 2-1.5h13q1.5 0 2 1.5l2 7z"/>' +
    '<rect class="d-t" x="4" y="14" width="56" height="43" rx="4"/><circle class="d-t3" cx="10" cy="21.5" r="2.5"/><rect class="d-w" x="16" y="18" width="40" height="7" rx="3.5"/><circle class="d-gr" cx="20.5" cy="21.5" r="1.6"/><rect class="d-w2" x="24" y="20.5" width="18" height="2" rx="1"/>' +
    '<rect class="d-w" x="8" y="29" width="48" height="24" rx="1.5"/><rect class="d-sky" x="12" y="33" width="40" height="9" rx="1.5"/><path class="d-w2" d="M12 45h26v3h-26zM12 49.5h18v2h-18z"/>' },
  dns: { also: ["domain names", "a domain name system", "the phone book of the internet", "an address book", "a name lookup"], tint: "#dd6f5e", svg:
    '<ellipse class="d-sh" cx="31" cy="59" rx="22" ry="2"/><path class="d-y" d="M46 12h6q2 0 2 2v6h-8z"/><path class="d-gr" d="M46 24h6q2 0 2 2v6h-8z"/><path class="d-bl" d="M46 36h6q2 0 2 2v6h-8z"/>' +
    '<rect class="d-w" x="12" y="8" width="38" height="49" rx="2"/><rect class="d-t" x="10" y="6" width="38" height="50" rx="3"/><rect class="d-t2" x="10" y="6" width="7" height="50" rx="3"/><path class="d-line thick grey" d="M7 14h6M7 24h6M7 34h6M7 44h6"/>' +
    '<circle class="d-w" cx="33" cy="26" r="10"/><path class="d-line thin tint" d="M23 26h20M33 16v20M33 16q-7 10 0 20M33 16q7 10 0 20M24.5 21h17M24.5 31h17"/><rect class="d-t3" x="23" y="42" width="20" height="4" rx="2"/>' },
  router: { also: ["a home router", "a wifi box", "a modem", "a hub", "a network box"], tint: "#555a66", svg:
    '<ellipse class="d-sh" cx="32" cy="57" rx="27" ry="2"/><path class="d-line yel" d="M27 22a7 7 0 0 1 10 0M23.5 17.5a12 12 0 0 1 17 0"/>' +
    '<rect class="d-t" x="15" y="8" width="5" height="30" rx="2.5" transform="rotate(-10 17.5 38)"/><rect class="d-t" x="44" y="8" width="5" height="30" rx="2.5" transform="rotate(10 46.5 38)"/><path class="d-dk2" d="M10 52h8v4h-8zM46 52h8v4h-8z"/>' +
    '<rect class="d-t" x="5" y="32" width="54" height="21" rx="5"/><path class="d-t3" d="M5 37q0-5 5-5h44q5 0 5 5z"/><path class="d-t2" d="M5 47h54v1q0 5-5 5h-44q-5 0-5-5z"/>' +
    '<circle class="d-gr" cx="13" cy="42" r="2"/><circle class="d-gr" cx="20" cy="42" r="2"/><circle class="d-y" cx="27" cy="42" r="2"/><circle class="d-gr" cx="34" cy="42" r="2"/><path class="d-dk" d="M41 40.5h13v3h-13z"/>' },
  internet: { also: ["cyberspace", "the web", "the world wide web", "a global network", "online", "a mesh"], tint: "#5aa7e0", svg:
    '<circle class="d-t3" cx="32" cy="32" r="27" opacity=".35"/><path class="d-line thin2" d="M32 5a12 27 0 0 0 0 54a12 27 0 0 0 0-54M5 32h54"/><circle class="d-line tint" cx="32" cy="32" r="22"/>' +
    '<path class="d-line tint" d="M25 28L32 10M25 28L13 21M25 28L13 43M25 28L40 36L51 21M40 36L51 43M40 36L32 54"/>' +
    [[32, 10], [51, 21], [51, 43], [32, 54], [13, 43], [13, 21]].map(([x, y]) => `<circle class="d-t2" cx="${x}" cy="${y}" r="5"/><circle class="d-t" cx="${x}" cy="${y}" r="3.5"/>`).join("") +
    '<circle class="d-y" cx="25" cy="28" r="5.5"/><circle class="d-y" cx="40" cy="36" r="5.5"/>' },
  firewall: { also: ["a fire wall", "a security wall", "blocking traffic", "a wall against attacks", "network security"], tint: "#d9534f", svg:
    '<ellipse class="d-sh" cx="32" cy="59.5" rx="29" ry="2"/><path class="d-or" d="M32 3C36 11 48 16 47 28V33H17V28C16 21 21 17 23 14C23 19 25 21 27 21C26 14 28 9 32 3Z"/>' +
    '<path class="d-y" d="M32 14C35 19 41 22 40 28V33H24V28C24 24 27 22 28 20C29 22 30 23 31 23C30 20 31 17 32 14Z"/><rect class="d-w2" x="5" y="29" width="55" height="29" rx="1.5"/>' +
    `<path class="d-t" d="${[30, 44].map((y) => [6, 19.5, 33, 46.5].map((x) => `M${x} ${y}h12.5v6h-12.5z`).join("")).join("")}${[37, 51].map((y) => `M6 ${y}h6v6h-6zM53.5 ${y}h5.5v6h-5.5z` + [13, 26.5, 40].map((x) => `M${x} ${y}h12.5v6h-12.5z`).join("")).join("")}"/>` },
  vpn: { also: ["a virtual private network", "a private tunnel", "a secure tunnel", "a tunnel", "an encrypted connection", "a hidden passage"], tint: "#8fd69a", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="30" ry="2"/><path class="d-t" d="M2 57C4 30 16 14 32 14S60 30 62 57z"/><path class="d-t2" d="M32 14c16 0 28 16 30 43h-10c-2-20-10-36-20-43z"/>' +
    '<ellipse class="d-t3" cx="19" cy="27" rx="5" ry="2.3" transform="rotate(-40 19 27)"/><path class="d-w2" d="M14 57V40a18 18 0 0 1 36 0v17z"/><path class="d-dk" d="M19 57V40a13 13 0 0 1 26 0v17z"/><path class="d-dk2" d="M25 57V43a7 7 0 0 1 14 0v14z"/>' +
    '<path class="d-line thick yel" d="M27.5 42.5v-4a4.5 4.5 0 0 1 9 0v4"/><rect class="d-y" x="24" y="42" width="16" height="12" rx="2"/><circle class="d-ink" cx="32" cy="46.5" r="1.7"/><rect class="d-ink" x="31.2" y="47" width="1.6" height="4" rx=".8"/>' },
  certificate: { also: ["an ssl certificate", "a tls certificate", "https", "proof of identity", "a diploma", "a trust seal"], tint: "#f3c14b", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="24" ry="2"/><rect class="d-cream" x="4" y="4" width="56" height="40" rx="2.5"/><rect class="d-line thin2" x="8" y="8" width="48" height="32" rx="1"/>' +
    '<rect class="d-bl2" x="17" y="13" width="30" height="4.5" rx="2.2"/><path class="d-w2" d="M13 22h38v2.5h-38zM13 27.5h24v2.5h-24z"/><path class="d-rd" d="M41 42l-3.5 14 4.5-2.5 3 4 2-14zM51 42l3.5 14-4.5-2.5-3 4-2-14z"/>' +
    '<g class="d-t">' + [0, 36, 72, 108, 144, 180, 216, 252, 288, 324].map((a) => `<circle cx="${r1(46 + 8 * Math.cos((a * Math.PI) / 180))}" cy="${r1(38 + 8 * Math.sin((a * Math.PI) / 180))}" r="2.8"/>`).join("") +
    '<circle cx="46" cy="38" r="8"/></g><circle class="d-t2" cx="46" cy="38" r="5.5"/><circle class="d-t3" cx="46" cy="38" r="3"/>' },
  bucket: { also: ["a pail", "an s3 bucket", "object storage", "blob storage", "a bucket of files"], tint: "#7fbfe6", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="22" ry="2"/><path class="d-line thick grey" d="M10 24q0-20 22-20t22 20"/><ellipse class="d-t3" cx="32" cy="23" rx="22" ry="5"/><ellipse class="d-t2" cx="32" cy="23" rx="19" ry="3.5"/>' +
    '<rect class="d-y" x="17" y="11" width="11" height="13" rx="1.5" transform="rotate(-12 22.5 17.5)"/><circle class="d-pk" cx="35.5" cy="17" r="6"/><rect class="d-gr" x="41" y="12" width="8" height="11" rx="1.5" transform="rotate(10 45 17.5)"/>' +
    '<path class="d-t" d="M10 23h44l-5 31q-.5 3-3.5 3h-27q-3 0-3.5-3z"/><path class="d-t2" d="M45 23h9l-5 31q-.5 3-3.5 3h-3.5zM11 29h42l-.5 3h-41zM13.7 46h36.6l-.5 3h-35.6z"/><path class="d-t3" d="M10 23a22 5 0 0 0 44 0h-3a19 3.5 0 0 1-38 0z"/>' },
  datacenter: { also: ["a data centre", "a data center", "a server farm", "a server room", "the cloud provider", "a region"], tint: "#8e929c", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="29" ry="2"/>' +
    [8, 25, 42].map((x) => `<rect class="d-t2" x="${x}" y="13" width="14" height="10" rx="1.5"/><circle class="d-dk2" cx="${x + 7}" cy="18" r="3.6"/><circle class="d-w2" cx="${x + 7}" cy="18" r="1.4"/>`).join("") +
    '<rect class="d-t" x="4" y="22" width="56" height="35" rx="2"/><rect class="d-t3" x="4" y="22" width="56" height="4" rx="1.5"/>' +
    [9, 26, 43].map((x) => `<rect class="d-sky" x="${x}" y="30" width="12" height="23" rx="1"/>`).join("") +
    `<path class="d-dk" d="${[9, 26, 43].map((x) => [33, 39, 45].map((y) => `M${x + 1.5} ${y}h9v4h-9z`).join("")).join("")}"/>` +
    `<path class="d-gr" d="${[9, 26, 43].map((x) => [33, 39, 45].map((y) => `M${x + 2.5} ${y + 1.2}h1.6v1.6h-1.6z`).join("")).join("")}"/>` },
  rack: { also: ["a server rack", "a cabinet of servers", "stacked servers", "a rack unit", "hardware"], tint: "#555a66", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="20" ry="2"/><path class="d-dk2" d="M17 55h5v4h-5zM42 55h5v4h-5z"/><rect class="d-t" x="14" y="3" width="36" height="54" rx="3"/><path class="d-t2" d="M44 3h3q3 0 3 3v48q0 3-3 3h-3z"/><rect class="d-dk2" x="18" y="7" width="26" height="47" rx="1"/>' +
    `<path class="d-t3" d="${[9, 15.5, 22, 28.5, 35, 41.5, 48].map((y) => `M19.5 ${y}h23v5h-23z`).join("")}"/>` +
    `<path class="d-dk" d="${[9, 15.5, 22, 28.5, 35, 41.5, 48].map((y) => `M31 ${y + 2}h9v1.2h-9z`).join("")}"/>` +
    `<path class="d-gr" d="${[9, 15.5, 22, 28.5, 35, 41.5, 48].map((y) => `M21.5 ${y + 1.5}h2v2h-2z`).join("")}"/>` +
    `<path class="d-y" d="${[15.5, 35].map((y) => `M25.5 ${y + 1.5}h2v2h-2z`).join("")}"/><path class="d-bl" d="${[9, 28.5, 48].map((y) => `M25.5 ${y + 1.5}h2v2h-2z`).join("")}"/>` },
  backup: { also: ["a backup", "a restore", "a restore point", "a saved copy", "disaster recovery", "a safety copy"], tint: "#63c2a2", svg:
    '<path class="d-t" d="M50.4 13.6A26 26 0 1 1 7.6 23.1L13.2 25.2A20 20 0 1 0 46.1 17.9zM16 26.2L4.8 22.1 14.9 16.6z"/>' +
    '<rect class="d-dk" x="21" y="22" width="22" height="20" rx="3"/><circle class="d-w2" cx="30" cy="31.5" r="6.5"/><circle class="d-dk" cx="30" cy="31.5" r="1.5"/><path class="d-line thin yel" d="M39.5 25.5l-6.5 6"/><circle class="d-gr" cx="39" cy="38.5" r="1.3"/>' },
  logs: { also: ["logging", "a log file", "an event log", "a diary of events", "an audit trail", "a ledger"], tint: "#4e8f7a", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="22" ry="2"/><rect class="d-cream" x="10" y="8" width="44" height="50" rx="3"/><path class="d-t" d="M10 11q0-3 3-3h38q3 0 3 3v6h-44z"/><path class="d-line thick grey" d="M16 5v7M24 5v7M32 5v7M40 5v7M48 5v7"/>' +
    [[23, "d-gr", 19], [30, "d-gr", 14], [37, "d-y", 17], [44, "d-rd", 12], [51, "d-gr", 16]].map(([y, c]) => `<circle class="${c}" cx="15.5" cy="${+y + 1.5}" r="1.8"/>`).join("") +
    `<path class="d-t" d="${[23, 30, 37, 44, 51].map((y) => `M19 ${y}h9v3h-9z`).join("")}"/><path class="d-w2" d="${[[23, 19], [30, 14], [37, 17], [44, 12], [51, 16]].map(([y, w]) => `M31 ${y}h${w}v3h-${w}z`).join("")}"/>` },
  dashboard: { also: ["monitoring", "metrics", "a control panel", "observability", "a status page", "live charts"], tint: "#5f86b3", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="26" ry="2"/><rect class="d-t" x="4" y="9" width="56" height="45" rx="4"/><rect class="d-dk2" x="8" y="13" width="48" height="37" rx="2"/><rect class="d-dk" x="8" y="13" width="48" height="6" rx="2"/>' +
    '<circle class="d-gr" cx="12" cy="16" r="1.2"/><rect class="d-w2" x="15" y="15" width="12" height="2" rx="1"/>' +
    '<path class="d-t2" d="M11 39a9 9 0 0 1 18 0h-3.5a5.5 5.5 0 0 0-11 0z"/><path class="d-gr" d="M11 39A9 9 0 0 1 24.5 31.2L22.8 34.2A5.5 5.5 0 0 0 14.5 39z"/><path class="d-line white" d="M20 39l4-5"/><circle class="d-w" cx="20" cy="39" r="1.8"/><rect class="d-w2" x="13" y="43" width="14" height="2.5" rx="1.2"/>' +
    '<path class="d-bl" d="M34 38h3.5v7h-3.5zM39 33h3.5v12h-3.5zM49 29h3.5v16h-3.5z"/><path class="d-y" d="M44 36h3.5v9h-3.5z"/><path class="d-line net" d="M35.5 30l5-5 5 3 5.5-6"/>' },
  siren: { also: ["an alarm light", "an incident", "an outage", "an emergency", "a flashing light", "a pager alert"], tint: "#d9534f", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="23" ry="2"/><path class="d-line yel thick" d="M32 3v6M15 10l4 4.5M49 10l-4 4.5M5 26h6M53 26h6"/>' +
    '<path class="d-t" d="M17 46V31a15 15 0 0 1 30 0v15z"/><path class="d-t2" d="M38 17.3a15 15 0 0 1 9 13.7v15h-9z"/><rect class="d-y" x="28" y="27" width="8" height="19" rx="4"/><rect class="d-w" x="30" y="30" width="3" height="8" rx="1.5"/><rect class="d-t3" x="20.5" y="27" width="3.5" height="14" rx="1.7"/>' +
    '<rect class="d-w2" x="11" y="44" width="42" height="12" rx="3"/><rect class="d-w3" x="11" y="44" width="42" height="4" rx="2"/>' },
};
