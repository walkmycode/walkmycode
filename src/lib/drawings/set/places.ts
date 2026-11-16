// Places, transport, and money and trade: where an analogy happens and what changes hands there.
import type { DrawingSet } from "../types";

const wheels = (a: number, b: number, y = 49, r = 6.5) =>
  [a, b].map((x) => `<circle class="d-ink" cx="${x}" cy="${y}" r="${r}"/><circle class="d-w2" cx="${x}" cy="${y}" r="2.6"/>`).join("");
const sh = (rx: number, cy = 57.5, cx = 32) => `<ellipse class="d-sh" cx="${cx}" cy="${cy}" rx="${rx}" ry="2.3"/>`;

export const PLACES: DrawingSet = {
  house: { also: ["a home", "a household", "a family", "a dwelling", "an address", "a settlement"], tint: "#dd6f5e", svg:
    sh(26) + '<rect class="d-t2" x="41" y="10" width="7" height="14" rx="1"/><rect class="d-cream" x="11" y="30" width="42" height="27" rx="1.5"/>' +
    '<path class="d-t" d="M4 33L32 8l28 25z"/><path class="d-t2" d="M11 33h42v3h-42z"/><circle class="d-sky" cx="32" cy="23" r="4"/>' +
    '<rect class="d-wood" x="27" y="41" width="10" height="16" rx="1"/><circle class="d-y" cx="34.5" cy="49.5" r="1.3"/>' +
    '<rect class="d-sky" x="15" y="40" width="8.5" height="8.5" rx="1"/><rect class="d-sky" x="40.5" y="40" width="8.5" height="8.5" rx="1"/>' },
  school: { also: ["a classroom", "a college", "a university", "an academy", "education", "a lesson"], tint: "#e8a35c", svg:
    sh(27) + '<path class="d-line grey thin" d="M32 14V5"/><path class="d-rd" d="M32 5l7 2.5-7 2.5z"/>' +
    '<rect class="d-t" x="5" y="33" width="54" height="24" rx="1.5"/><rect class="d-t2" x="4" y="31" width="56" height="4" rx="1"/>' +
    [9, 15.5, 43.5, 50].map((x) => `<rect class="d-sky" x="${x}" y="40" width="5" height="8" rx="1"/>`).join("") +
    '<rect class="d-t3" x="21" y="24" width="22" height="33"/><path class="d-t2" d="M18 25L32 12l14 13z"/><circle class="d-w" cx="32" cy="32" r="5"/><path class="d-line thin" d="M32 29v3l2.2 1.2"/>' +
    '<path class="d-wood" d="M27 57v-10a5 5 0 0 1 10 0v10z"/>' },
  bank: { also: ["a vault", "the treasury", "a court", "a museum", "the government", "a temple", "the central bank"], tint: "#9fb0c8", svg:
    sh(27, 58) + '<rect class="d-t2" x="5" y="52" width="54" height="5" rx="1"/><rect class="d-t" x="8" y="48" width="48" height="4.5" rx="1"/><rect class="d-t2" x="12" y="26" width="40" height="22"/>' +
    [14, 24.5, 35, 45.5].map((x) => `<rect class="d-w" x="${x}" y="27" width="4.5" height="21" rx="1"/>`).join("") +
    '<rect class="d-t3" x="8" y="22" width="48" height="5" rx="1"/><path class="d-t" d="M6 22L32 7l26 15z"/><circle class="d-y" cx="32" cy="16.5" r="3.6"/>' },
  hospital: { also: ["a clinic", "a doctor's surgery", "first aid", "health care", "an infirmary", "a pharmacy"], tint: "#eef1f5", svg:
    sh(27) + '<rect class="d-t2" x="5" y="30" width="54" height="27" rx="1.5"/><rect class="d-t" x="18" y="8" width="28" height="49" rx="2"/>' +
    '<path class="d-rd" d="M29 12h6v5h5v6h-5v5h-6v-5h-5v-6h5z"/>' +
    [8.5, 49.5].map((x) => `<rect class="d-sky" x="${x}" y="35" width="6" height="6" rx="1"/><rect class="d-sky" x="${x}" y="45" width="6" height="6" rx="1"/>`).join("") +
    '<rect class="d-sky" x="22" y="33" width="7" height="6" rx="1"/><rect class="d-sky" x="35" y="33" width="7" height="6" rx="1"/><rect class="d-bl2" x="26" y="44" width="12" height="13" rx="1"/><rect class="d-w" x="31.4" y="44" width="1.2" height="13"/>' },
  factory: { also: ["a workshop", "a mill", "industry", "a producer", "a plant", "manufacturing", "a build step"], tint: "#8d99a8", svg:
    sh(27) + '<circle class="d-w3" cx="50" cy="10" r="3.6"/><circle class="d-w3" cx="55.5" cy="7.5" r="2.4" opacity=".7"/>' +
    '<rect class="d-t2" x="45" y="16" width="9" height="30"/><rect class="d-rd" x="45" y="19" width="9" height="3.5"/>' +
    '<path class="d-t" d="M6 57V33l12-9v9l12-9v9l12-9v9h16v24z"/><rect class="d-t2" x="6" y="52.5" width="52" height="4.5"/>' +
    [10.5, 22.5, 34.5].map((x) => `<rect class="d-y" x="${x}" y="39" width="7.5" height="7" rx="1"/>`).join("") + '<rect class="d-dk" x="46.5" y="42" width="8" height="15" rx="1"/>' },
  library: { also: ["a bookshelf", "a bookcase", "an archive", "a collection", "a store of knowledge", "a package registry"], tint: "#b07f52", svg:
    '<rect class="d-t" x="8" y="6" width="48" height="52" rx="3"/>' + [10, 26, 42].map((y) => `<rect class="d-t2" x="12" y="${y}" width="40" height="13"/>`).join("") +
    Object.entries({ rd: [[13, 4, 11, 0], [33, 4, 11, 1], [44, 3.5, 10.5, 2]], bl: [[17.5, 3.5, 9, 0], [37.5, 4.5, 9.5, 1]], y: [[21.5, 4.5, 11.5, 0], [42.5, 3.5, 11, 1], [13, 4, 9, 2]],
      gr: [[26.5, 3.5, 9.5, 0], [26.5, 4, 11.5, 2]], pu: [[38, 4, 11, 0], [46.5, 4.5, 10, 1]], or: [[42.5, 4, 8.5, 0], [18, 3.5, 11.5, 1]], bl2: [[47, 4, 11, 0], [17.5, 4.5, 11, 2]],
      gr2: [[13, 4.5, 10, 1], [48, 3.5, 9, 2]], w: [[22, 4, 9, 1], [31, 4, 9, 2]], pk: [[22.5, 3.5, 10, 2]] })
      .map(([c, bs]) => `<path class="d-${c}" d="${bs.map(([x, w, h, r]) => `M${x} ${23 + 16 * r}v-${h}h${w}v${h}z`).join("")}"/>`).join("") +
    '<rect class="d-bl" x="31" y="12.5" width="4" height="10.5" rx=".8" transform="rotate(16 33 23)"/><rect class="d-or" x="27" y="28.5" width="4" height="10.5" rx=".8" transform="rotate(-14 29 39)"/><circle class="d-y" cx="39" cy="51.5" r="3"/>' },
  castle: { also: ["a fortress", "a kingdom", "a stronghold", "the monarchy", "a walled city", "a firewall"], tint: "#a9a4b8", svg:
    sh(28) + '<path class="d-line grey thin" d="M32 26V7"/><path class="d-rd" d="M32 7l9 3-9 3z"/>' +
    '<path class="d-t2" d="M20 57V25h4v3h4v-3h8v3h4v-3h4v32z"/><path class="d-dk" d="M26 57V46a6 6 0 0 1 12 0v11z"/>' +
    [4, 42].map((x) => `<path class="d-t" d="M${x + 2} 57V23h-2v-9h4v3.5h3V14h4v3.5h3V14h4v9h-2v34z"/><rect class="d-dk" x="${x + 7}" y="29" width="4" height="8" rx="2"/>`).join("") },
  bridge: { also: ["a crossing", "a link", "a connection", "a trade route", "an interface", "an adapter"], tint: "#e07f5f", svg:
    '<rect class="d-bl2" x="4" y="50" width="56" height="7" rx="3.5"/>' +
    '<path class="d-line tint thin" d="M10 31.5v7M24 23v15M28 27.5v10M32 29v9M36 27.5v10M40 23v15M54 31.5v7"/>' +
    '<path class="d-line tint" d="M4 37Q11 30 18.5 11Q32 46 45.5 11Q53 30 60 37"/>' +
    '<rect class="d-t" x="16" y="9" width="5" height="44" rx="1"/><rect class="d-t" x="43" y="9" width="5" height="44" rx="1"/><rect class="d-t2" x="4" y="38" width="56" height="4.5" rx="1.5"/>' +
    '<rect class="d-bl" x="12" y="51.5" width="13" height="2" rx="1"/><rect class="d-bl" x="39" y="51.5" width="13" height="2" rx="1"/>' },
  road: { also: ["a street", "a route", "a path", "a motorway", "a journey", "a pipeline", "a way through"], tint: "#70778a", svg:
    '<path class="d-gr2" d="M17 8h30l15 50H2z"/><path class="d-t" d="M24 8h16l17 50H7z"/><path class="d-w" d="M24 8h1.3L10.5 58H7zM40 8h-1.3l14.8 50H57z"/>' +
    '<path class="d-y" d="M31.3 11h1.4l.3 6h-2zM30.8 23h2.4l.5 9h-3.4zM30 39h4l.8 13h-5.6z"/>' },
  tower: { also: ["a lighthouse", "a lookout", "a watchtower", "a beacon", "a signal", "a warning", "a landmark"], tint: "#e2665c", svg:
    sh(20, 58) + '<path class="d-y" d="M27 15.5L5 10v11zM37 15.5l22-5.5v11z" opacity=".7"/>' +
    '<path class="d-t" d="M25 22h14l5 35H20z"/><path class="d-w" d="M23.9 30h16.2l1 7H22.9zM21.9 44h20.2l1 7H20.9z"/>' +
    '<rect class="d-dk" x="21.5" y="20" width="21" height="3.5" rx="1"/><rect class="d-y" x="26" y="11" width="12" height="9"/><rect class="d-dk" x="31.2" y="11" width="1.6" height="9"/><path class="d-t2" d="M23.5 12L32 4.5l8.5 7.5z"/>' +
    '<path class="d-dk" d="M29 57v-5a3 3 0 0 1 6 0v5z"/>' },
  tent: { also: ["a camp", "a shelter", "a temporary home", "a nomad's home", "a campsite", "a sandbox"], tint: "#f0a94b", svg:
    sh(28) + '<path class="d-line grey thin" d="M29.5 5l5 9M34.5 5l-5 9M13 44L4 56M51 44l9 12"/>' +
    '<path class="d-t" d="M32 9l26 47H6z"/><path class="d-t2" d="M32 9l26 47H45z"/><path class="d-dk" d="M32 24l10 32H22z"/><path class="d-t3" d="M32 24L22 56h5.5z"/>' },
  island: { also: ["a desert island", "an isolated place", "a colony", "a habitat", "an atoll", "a container"], tint: "#f0d58a", svg:
    '<ellipse class="d-bl2" cx="32" cy="50" rx="28" ry="8"/><ellipse class="d-bl" cx="32" cy="49" rx="23" ry="5.5"/>' +
    '<path class="d-t" d="M11 49Q32 27 53 49Q32 54 11 49z"/><path class="d-t2" d="M11 49q21 5 42 0q-21 1.5-42 0z"/>' +
    '<path class="d-wood" d="M31 42q-2.5-13 2.5-24l3 1.2q-4 10-1.5 22.8z"/>' +
    '<path class="d-gr2" d="M35 18Q23 9 12 19Q24 14.5 35 18zM35 18Q47 9 58 19Q46 14.5 35 18z"/><path class="d-gr" d="M35 18Q30 6 17 6Q29 10 35 18zM35 18Q40 6 53 6Q41 10 35 18zM35 18Q32 9 36 3Q38.5 10 35 18z"/>' +
    '<circle class="d-wood" cx="33" cy="19.5" r="2.2"/><circle class="d-wood" cx="37" cy="19.5" r="2.2"/>' },
  car: { also: ["a taxi", "a vehicle", "a driver", "a commuter", "traffic", "a private journey"], tint: "#e2665c", svg:
    sh(27, 55.5) + '<path class="d-t" d="M4 46v-9q0-3 3-3.5l9-1.5 6-9q1.5-2 4-2h14q2.5 0 4.5 2l7 9 5.5 1.5q3 1 3 4v8.5q0 2-2 2H6q-2 0-2-2z"/>' +
    '<path class="d-sky" d="M24.5 24.5H31V32H19.5zM34 24.5h6.5L46 32H34z"/><rect class="d-t2" x="4" y="42" width="56" height="5" rx="1.5"/>' +
    '<rect class="d-y" x="56" y="36" width="4" height="3.5" rx="1.5"/><rect class="d-t2" x="35" y="35.5" width="5" height="1.8" rx=".9"/>' + wheels(17, 47) },
  bus: { also: ["a school bus", "a coach", "public transport", "passengers", "a shared ride", "a data bus"], tint: "#f3c545", svg:
    sh(27, 55.5) + '<rect class="d-t" x="4" y="13" width="56" height="35" rx="5"/>' +
    [8, 19, 30, 41].map((x) => `<rect class="d-sky" x="${x}" y="19" width="9" height="11" rx="1.5"/>`).join("") +
    '<path class="d-sky" d="M52.5 19H58q2 0 2 2v12h-7.5z"/><rect class="d-t2" x="4" y="35.5" width="56" height="3.5"/><rect class="d-t2" x="4" y="43" width="56" height="5" rx="1.5"/>' +
    '<rect class="d-w" x="56.5" y="39.5" width="3.5" height="3" rx="1"/><rect class="d-rd" x="4" y="39.5" width="2.5" height="3" rx="1"/>' + wheels(17, 46) },
  train: { also: ["a locomotive", "a railway", "an engine", "the industrial revolution", "a steam engine", "a freight line"], tint: "#4f9d8a", svg:
    '<rect class="d-w2" x="3" y="56.5" width="58" height="2" rx="1"/><circle class="d-w3" cx="47" cy="7.5" r="3.4"/><circle class="d-w3" cx="53.5" cy="6" r="2.3" opacity=".7"/>' +
    '<path class="d-dk" d="M39.5 26v-9.5h-2V13h10v3.5h-2V26z"/><path class="d-y" d="M27.5 25.5a4.5 4.5 0 0 1 9 0z"/>' +
    '<rect class="d-t" x="22" y="25" width="31" height="20" rx="4"/><rect class="d-t2" x="7" y="15" width="18" height="30" rx="2"/><rect class="d-dk" x="5" y="12" width="22" height="4.5" rx="2"/>' +
    '<rect class="d-sky" x="11" y="21" width="10" height="9" rx="1"/><circle class="d-y" cx="52.5" cy="31" r="2.8"/><rect class="d-rd" x="5" y="43" width="51" height="5" rx="1.5"/><path class="d-rd" d="M54 43h3.5l3.5 11h-7z"/>' +
    wheels(16, 16, 49.5, 7) + wheels(32, 45, 51.5, 5) },
  ship: { also: ["a boat", "a ferry", "a cargo ship", "trade by sea", "a voyage", "an explorer", "a deployment"], tint: "#e2665c", svg:
    '<path class="d-line grey thin" d="M50 38V25"/><path class="d-y" d="M50 25l6 2.2-6 2.2z"/>' +
    '<rect class="d-t" x="23" y="9" width="8" height="11" rx="1"/><rect class="d-dk" x="23" y="9" width="8" height="3.5" rx="1"/><rect class="d-w3" x="18" y="19" width="18" height="9" rx="1.5"/><rect class="d-sky" x="21" y="21.5" width="12" height="3.5" rx="1"/>' +
    '<rect class="d-w" x="13" y="27" width="32" height="12" rx="1.5"/><circle class="d-bl2" cx="20" cy="32.5" r="2"/><circle class="d-bl2" cx="29" cy="32.5" r="2"/><circle class="d-bl2" cx="38" cy="32.5" r="2"/>' +
    '<path class="d-t" d="M4 38h56l-8 13q-1.2 2-3.5 2h-35q-2.3 0-3.2-2z"/><path class="d-t2" d="M7.9 46h47.2l-3.1 5q-1.2 2-3.5 2h-35q-2.3 0-3.2-2z"/>' +
    '<path class="d-bl" d="M3 54q4.8-4 9.6 0t9.7 0 9.7 0 9.7 0 9.7 0 9.6 0v2q0 2-2 2H5q-2 0-2-2z"/>' },
  plane: { also: ["an aeroplane", "a flight", "air travel", "a long journey", "an import", "an airline"], tint: "#e9edf3", svg:
    '<path class="d-bl2" d="M9 27L5 12h7l10 14z"/><path class="d-t2" d="M7 33h10l-5 8H8.5z"/>' +
    '<path class="d-t" d="M6 31q0-6 7-6h29q12 0 17 6.5q-5 6.5-17 6.5H14q-8 0-8-7z"/><path class="d-sky" d="M47.5 27.5q5 .5 8 3.5h-8z"/>' +
    [20, 26, 32, 38].map((x) => `<circle class="d-bl2" cx="${x}" cy="29.5" r="1.6"/>`).join("") +
    '<path class="d-t2" d="M27 33.5h13L29 52h-7z"/><rect class="d-bl2" x="30" y="38" width="9" height="5" rx="2.5"/>' },
  bicycle: { also: ["a bike", "a cyclist", "a short trip", "pedal power", "a simple machine", "a gear"], tint: "#e2665c", svg:
    sh(26, 56.5) + '<circle class="d-line grey thick" cx="15" cy="43" r="10"/><circle class="d-line grey thick" cx="49" cy="43" r="10"/>' +
    '<path class="d-line grey" d="M43 26l-1.5-6.5h5.5M25.5 26l-1-4"/><path class="d-line tint thick" d="M15 43h15l-4.5-17h17.5L30 43M15 43l10.5-17M43 26l6 17"/>' +
    '<rect class="d-wood" x="19" y="19.5" width="11" height="3.6" rx="1.8"/><circle class="d-w2" cx="15" cy="43" r="2.2"/><circle class="d-w2" cx="49" cy="43" r="2.2"/><circle class="d-y" cx="30" cy="43" r="3"/>' },
  rocket: { also: ["a spaceship", "a launch", "space travel", "a satellite launch", "lift-off", "a release"], tint: "#e9edf3", svg:
    '<path class="d-or" d="M25 46h14q-1 8-7 12.5q-6-4.5-7-12.5z"/><path class="d-y" d="M28.5 46h7q-.5 4.5-3.5 7.5q-3-3-3.5-7.5z"/>' +
    '<path class="d-rd" d="M22 30L11 47h11zM42 30l11 17H42z"/><path class="d-t" d="M32 4q11 10 11 25v14H21V29q0-15 11-25z"/><path class="d-rd" d="M32 4q5.8 5.3 8.6 12H23.4q2.8-6.7 8.6-12z"/>' +
    '<rect class="d-w2" x="21" y="41" width="22" height="5" rx="1.5"/><circle class="d-bl2" cx="32" cy="27" r="5.5"/><circle class="d-sky" cx="32" cy="27" r="3.5"/>' },
  coin: { also: ["money", "a token", "gold", "a penny", "currency", "a price", "a credit"], tint: "#f3c84b", svg:
    sh(17, 59.5) + '<circle class="d-t2" cx="32" cy="33.5" r="24"/><circle class="d-t" cx="32" cy="30.5" r="24"/><circle class="d-t3" cx="32" cy="30.5" r="19"/><circle class="d-t" cx="32" cy="30.5" r="16"/>' +
    '<path class="d-t2" d="M32 19.5l3.3 7 7.7.9-5.7 5.3 1.5 7.6-6.8-3.7-6.8 3.7 1.5-7.6-5.7-5.3 7.7-.9z"/>' },
  banknote: { also: ["cash", "paper money", "a bill", "wages", "a payment", "savings", "the budget"], tint: "#7fc48f", svg:
    sh(25, 54) + '<rect class="d-t2" x="11" y="13" width="48" height="27" rx="3"/><rect class="d-t" x="5" y="21" width="50" height="29" rx="3"/><rect class="d-t3" x="8.5" y="24.5" width="43" height="22" rx="1.5"/><rect class="d-t" x="10.5" y="26.5" width="39" height="18" rx="1"/>' +
    '<circle class="d-t3" cx="30" cy="35.5" r="7"/><circle class="d-t2" cx="30" cy="35.5" r="3.5"/><circle class="d-t2" cx="16" cy="35.5" r="2"/><circle class="d-t2" cx="44" cy="35.5" r="2"/>' },
  wallet: { also: ["a purse", "pocket money", "an account", "your balance", "spending money", "a budget holder"], tint: "#a8694a", svg:
    sh(25, 57) + '<rect class="d-gr2" x="17" y="9" width="34" height="14" rx="2"/><rect class="d-gr" x="12" y="13" width="34" height="14" rx="2"/><circle class="d-gr2" cx="29" cy="18" r="2.5"/>' +
    '<rect class="d-t" x="6" y="20" width="52" height="35" rx="5"/><rect class="d-t3" x="6" y="20" width="52" height="5" rx="2.5"/><rect class="d-t2" x="6" y="49" width="52" height="6" rx="3"/>' +
    '<path class="d-t2" d="M60 31.5H43a6 6 0 0 0 0 12h17z"/><circle class="d-y" cx="45" cy="37.5" r="2.7"/>' },
  piggybank: { also: ["savings", "a money box", "saving up", "a reserve", "a fund", "a cache"], tint: "#f2a0b0", svg:
    sh(21, 58) + '<circle class="d-y" cx="29" cy="14.5" r="7"/><circle class="d-y2" cx="29" cy="14.5" r="4"/><path class="d-line tint" d="M11 35q-5 0-5-4t4-3"/>' +
    '<rect class="d-t2" x="16" y="46" width="7" height="11" rx="2.5"/><rect class="d-t2" x="38" y="46" width="7" height="11" rx="2.5"/><path class="d-t2" d="M38 25l9-7 1 11z"/>' +
    '<ellipse class="d-t" cx="31" cy="37" rx="22" ry="16.5"/><rect class="d-t3" x="48" y="31" width="10" height="12" rx="5"/><circle class="d-t2" cx="51.5" cy="37" r="1.3"/><circle class="d-t2" cx="55" cy="37" r="1.3"/>' +
    '<rect class="d-t2" x="22" y="23.5" width="14" height="2.8" rx="1.4"/><circle class="d-ink" cx="43" cy="31" r="1.8"/>' },
  scales: { also: ["a balance", "fairness", "justice", "an equation", "supply and demand", "a comparison", "a trade-off"], tint: "#d9b25a", svg:
    sh(14, 58) + '<path class="d-line grey thin" d="M12 15L5 37M12 15l7 22M52 15l-7 22M52 15l7 22"/>' +
    '<path class="d-t2" d="M21 57q0-4.5 5-4.5h12q5 0 5 4.5z"/><rect class="d-t2" x="30.2" y="12" width="3.6" height="42"/><rect class="d-t" x="8" y="12.5" width="48" height="4" rx="2"/><circle class="d-t3" cx="32" cy="12.5" r="4.5"/>' +
    '<path class="d-t" d="M3 37h18q-1 8-9 8t-9-8zM43 37h18q-1 8-9 8t-9-8z"/>' },
  basket: { also: ["a shopping basket", "a cart", "groceries", "a bundle of goods", "consumer goods", "an order of items"], tint: "#e2665c", svg:
    sh(23, 58) + '<path class="d-line tint thick" d="M14 30Q32 0 50 30"/>' +
    '<rect class="d-or" x="36" y="10" width="7" height="24" rx="3.5" transform="rotate(18 39.5 22)"/><rect class="d-w" x="26" y="14" width="9" height="18" rx="1"/><rect class="d-bl" x="26" y="19" width="9" height="5"/><circle class="d-gr" cx="19" cy="25" r="6"/>' +
    '<path class="d-t" d="M7 30h50l-4 24q-.5 3-3.5 3h-35q-3 0-3.5-3z"/><rect class="d-t2" x="5" y="28" width="54" height="6" rx="3"/>' +
    [15.5, 23, 30.5, 38, 45.5].map((x) => `<rect class="d-t2" x="${x}" y="38" width="3" height="14" rx="1.5"/>`).join("") },
  receipt: { also: ["a till slip", "an invoice", "proof of purchase", "a record", "a log", "the total", "a ledger entry"], tint: "#f4f5f7", svg:
    sh(17, 59) + '<path class="d-t" d="M15 6h34v50l-4.25-3-4.25 3-4.25-3L32 56l-4.25-3-4.25 3-4.25-3L15 56z"/><rect class="d-bl" x="24" y="11" width="16" height="4" rx="2"/>' +
    [21, 27, 33].map((y, i) => `<rect class="d-w2" x="20" y="${y}" width="${[14, 10, 12][i]}" height="2.6" rx="1.3"/><rect class="d-w2" x="38" y="${y}" width="6" height="2.6" rx="1.3"/>`).join("") +
    '<rect class="d-w2" x="20" y="39.5" width="24" height="1"/><rect class="d-dk" x="20" y="43.5" width="10" height="3.5" rx="1.7"/><rect class="d-gr2" x="35" y="43.5" width="9" height="3.5" rx="1.7"/>' },
  stall: { also: ["a market stall", "a market", "a seller", "a trader", "a vendor", "a stand", "the marketplace"], tint: "#5fae7a", svg:
    sh(28) + '<rect class="d-wood" x="8" y="20" width="3" height="37"/><rect class="d-wood" x="53" y="20" width="3" height="37"/>' +
    '<path class="d-t2" d="M4 22h56a7 5 0 0 1-14 0 7 5 0 0 1-14 0 7 5 0 0 1-14 0 7 5 0 0 1-14 0z"/><path class="d-t" d="M4 22.5L9 8h46l5 14.5z"/>' +
    '<path class="d-w" d="M14.75 8h5.75L18 22.5h-7zM26.25 8H32v14.5h-7zM37.75 8h5.75L46 22.5h-7zM49.25 8H55l5 14.5h-7z" opacity=".92"/>' +
    '<circle class="d-or" cx="15" cy="35" r="3.6"/><circle class="d-or" cx="22" cy="35" r="3.6"/><circle class="d-or" cx="18.5" cy="30" r="3.6"/><circle class="d-rd" cx="32" cy="35" r="3.6"/><circle class="d-rd" cx="39" cy="35" r="3.6"/><circle class="d-gr" cx="48" cy="34" r="4.6"/>' +
    '<rect class="d-wood" x="6" y="40" width="52" height="17" rx="1.5"/><rect class="d-cream" x="4" y="37.5" width="56" height="4.5" rx="1.5"/><rect class="d-y" x="26" y="45.5" width="12" height="7" rx="1.5"/>' },
  flag: { also: ["a country", "a nation", "a team", "a marker", "a finish line", "a claim", "a feature switch"], tint: "#e2665c", svg:
    sh(9, 58, 14) + '<rect class="d-w2" x="12" y="8" width="3.4" height="50" rx="1.7"/><circle class="d-y" cx="13.7" cy="7.5" r="3.2"/>' +
    '<path class="d-t" d="M15.4 13q11-5 22 0t21 0v24q-10 5-21 0t-22 0z"/><path class="d-t2" d="M37.4 13q6 2.7 11 2.5v24q-5 .2-11-2.5z"/><circle class="d-w" cx="27" cy="24" r="4.5"/>' },
  globe: { also: ["the world", "the earth", "a planet", "countries", "geography", "a map", "worldwide"], tint: "#5aa7e0", svg:
    sh(13, 58.5) + '<path class="d-wood" d="M21 58q0-4.5 5-4.5h12q5 0 5 4.5z"/><rect class="d-wood" x="30.3" y="47" width="3.4" height="8"/><path class="d-line yel thick" d="M19 8A23 23 0 0 0 32 50"/>' +
    '<circle class="d-t" cx="32" cy="27" r="19"/><path class="d-gr" d="M20 17q6-6 12-2-1 5-5 6 1 6-3 9-6-4-4-13zM38 21q6-2 9 3 1 7-4 11-5-3-5-14zM27 38q4-1 5 3-2 3-5 2z"/><ellipse class="d-w" cx="24" cy="15.5" rx="5" ry="2.5" opacity=".3" transform="rotate(-35 24 15.5)"/>' },
};
