// History, government, law and the world: what people rule, record, vote for, travel and build with. Same hand as base.ts.
import type { DrawingSet } from "../types";

const sh = (rx: number, cy = 58.5, cx = 32) => `<ellipse class="d-sh" cx="${cx}" cy="${cy}" rx="${rx}" ry="2"/>`;
/** A ring: a disc of radius r with a hole of radius h (the two arcs wind opposite ways). */
const ring = (cx: number, cy: number, r: number, h: number) =>
  `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0-${2 * r}zM${cx} ${cy - h}a${h} ${h} 0 1 0 0 ${2 * h}a${h} ${h} 0 1 0 0-${2 * h}z`;
/** A five-pointed star whose top point is at x, y (19 wide, 18 tall). */
const star = (x: number, y: number) => `M${x} ${y}l2.6 6.4 6.9.5-5.3 4.5 1.7 6.7-5.9-3.7-5.9 3.7 1.7-6.7-5.3-4.5 6.9-.5z`;

export const SOCIETY: DrawingSet = {
  scroll: { also: ["a decree", "a treaty", "an old document", "a charter", "a proclamation", "ancient writing", "a constitution"], tint: "#e8c27e", svg:
    sh(21, 59.5) + '<rect class="d-t3" x="15" y="12" width="34" height="38"/>' +
    [19, 25, 31].map((y) => `<rect class="d-t2" x="20" y="${y}" width="24" height="2.6" rx="1.3"/>`).join("") + '<rect class="d-t2" x="20" y="37" width="12" height="2.6" rx="1.3"/>' +
    '<path class="d-rd" d="M37.5 44l-2.5 8.5 3.5-1.5 1.5 3.5 1.5-9z"/><circle class="d-rd" cx="40" cy="41.5" r="4.5"/><circle class="d-pk" cx="40" cy="41.5" r="2"/>' +
    '<rect class="d-t" x="10" y="5" width="44" height="10" rx="5"/><rect class="d-t3" x="13" y="7" width="36" height="2" rx="1"/><ellipse class="d-t2" cx="51" cy="10" rx="3" ry="5"/>' +
    '<rect class="d-t" x="10" y="46" width="44" height="11" rx="5.5"/><rect class="d-t3" x="13" y="48" width="36" height="2" rx="1"/><ellipse class="d-t2" cx="51" cy="51.5" rx="3" ry="5.5"/><circle class="d-t3" cx="51" cy="51.5" r="1.4"/>' },
  sword: { also: ["a blade", "a battle", "a war", "a weapon", "a knight", "conflict", "a fight"], tint: "#d9b25a", svg:
    '<g transform="rotate(45 32 32)"><path class="d-w" d="M28 39V10l4-8 4 8v29z"/><path class="d-w2" d="M32 2l4 8v29h-4z"/><rect class="d-w2" x="31.2" y="11" width="1.6" height="25" rx=".8"/>' +
    '<rect class="d-wood" x="29.5" y="43" width="5" height="12" rx="1.5"/><path class="d-line thin" d="M29.8 47h4.4M29.8 51h4.4"/>' +
    '<rect class="d-t" x="16" y="38.5" width="32" height="5.5" rx="2.7"/><rect class="d-t2" x="16" y="41.5" width="32" height="2.5" rx="1.2"/><circle class="d-rd" cx="32" cy="41.2" r="2.2"/>' +
    '<circle class="d-t" cx="32" cy="57.5" r="3.6"/><circle class="d-t3" cx="31" cy="56.5" r="1.2"/></g>' },
  crown: { also: ["royalty", "the throne", "a reign", "an empire", "a coronation", "the crown jewels", "a tiara"], tint: "#f3c14b", svg:
    sh(25) + '<path class="d-t" d="M9 46L5 18l13.5 12L32 10l13.5 20L59 18l-4 28z"/><path class="d-t2" d="M32 10l13.5 20L59 18l-4 28H32z"/>' +
    '<path class="d-t3" d="M9 23l2.5 19h3.5l-2-15.5z"/><path class="d-rd" d="M32 25l4 6-4 6-4-6z"/>' +
    '<g class="d-t3"><circle cx="5" cy="17.5" r="3"/><circle cx="32" cy="9.5" r="3.5"/><circle cx="59" cy="17.5" r="3"/></g>' +
    '<rect class="d-t2" x="7" y="44" width="50" height="11" rx="2"/><rect class="d-t3" x="7" y="44" width="50" height="2.5" rx="1"/>' +
    '<circle class="d-rd" cx="32" cy="50" r="3"/><circle class="d-bl" cx="19" cy="50" r="2.3"/><circle class="d-bl" cx="45" cy="50" r="2.3"/>' },
  ballot: { also: ["a ballot box", "a vote", "voting", "an election", "democracy", "a poll", "a referendum"], tint: "#6e9ad0", svg:
    sh(25) + '<path class="d-t3" d="M10 29l6-8h32l6 8z"/><rect class="d-dk" x="23" y="23" width="18" height="3.5" rx="1.7"/>' +
    '<rect class="d-w" x="25.5" y="4" width="13" height="21" rx="1"/><rect class="d-w2" x="28" y="7.5" width="5" height="5" rx="1"/><path class="d-line thin" d="M28.5 10l1.8 1.8 3.5-4M28.5 16h7"/>' +
    '<rect class="d-t" x="10" y="29" width="44" height="28" rx="2"/><rect class="d-t2" x="10" y="51.5" width="44" height="5.5" rx="2"/>' +
    '<rect class="d-w" x="21" y="35" width="22" height="12" rx="2"/><path class="d-line tint thick" d="M27 41l3.5 3.5 6.5-7"/>' },
  parliament: { also: ["congress", "the senate", "a legislature", "a capitol", "lawmakers", "a parliament building", "the state house"], tint: "#cdb98f", svg:
    sh(28) + '<rect class="d-t2" x="4" y="53" width="56" height="4.5" rx="1"/><rect class="d-t" x="7" y="49.5" width="50" height="4" rx="1"/><rect class="d-t2" x="9" y="33" width="46" height="17"/>' +
    [12, 18.7, 25.3, 32, 38.7, 45.3, 52].map((x) => `<rect class="d-w" x="${x - 1.5}" y="34" width="3" height="16" rx="1"/>`).join("") +
    '<rect class="d-t3" x="6" y="29.5" width="52" height="4.5" rx="1"/><rect class="d-t" x="20" y="22" width="24" height="8"/>' +
    [23.5, 29.5, 35.5].map((x) => `<rect class="d-t2" x="${x}" y="24" width="5" height="4" rx="1"/>`).join("") +
    '<path class="d-t" d="M18 22a14 14 0 0 1 28 0z"/><path class="d-t2" d="M32 8a14 14 0 0 1 14 14H32z"/><rect class="d-t3" x="17" y="20.5" width="30" height="2.5" rx="1"/>' +
    '<rect class="d-t3" x="30" y="4.5" width="4" height="5" rx="1"/><circle class="d-y" cx="32" cy="3.5" r="2"/>' },
  gavel: { also: ["the law", "a ruling", "a verdict", "a courtroom", "a trial", "order in court", "an auction"], tint: "#b07f52", svg:
    sh(23, 59, 27) + '<path class="d-t2" d="M5 46v5.5a17 4.5 0 0 0 34 0V46z"/><ellipse class="d-t" cx="22" cy="46" rx="17" ry="4.5"/><ellipse class="d-t3" cx="17" cy="45" rx="7" ry="1.5"/>' +
    '<g transform="rotate(-40 26 20)"><rect class="d-t2" x="23.8" y="24" width="4.4" height="32" rx="2"/><rect class="d-t" x="13" y="13.5" width="26" height="13" rx="2"/><rect class="d-t3" x="15" y="15.5" width="22" height="2.5" rx="1.2"/>' +
    '<rect class="d-y" x="8.5" y="12" width="5.5" height="16" rx="1.5"/><rect class="d-y" x="38" y="12" width="5.5" height="16" rx="1.5"/><rect class="d-y2" x="24" y="13.5" width="4" height="13"/></g>' },
  map: { also: ["a treasure map", "a street map", "an atlas", "a route plan", "a sea chart", "cartography", "the way there"], tint: "#ecd69c", svg:
    sh(27) + '<path class="d-t" d="M5 15l18-6v42l-18 6z"/><path class="d-t2" d="M23 9l18 6v42l-18-6z"/><path class="d-t" d="M41 15l18-6v42l-18 6z"/>' +
    '<ellipse class="d-gr2" cx="14" cy="27" rx="5" ry="4"/><ellipse class="d-bl" cx="50" cy="44" rx="5" ry="3.5"/><ellipse class="d-gr" cx="32" cy="45" rx="4" ry="3"/>' +
    '<path class="d-line thin" d="M10 49l3-3M16.5 42.5l3.5-2M23.5 39l3.5-1M30.5 36.5l3-2M36.5 32.5l3-2M42.5 28.5l2.5-2"/>' +
    '<rect class="d-rd" x="47" y="17" width="3.4" height="13" rx="1.7" transform="rotate(45 48.7 23.5)"/><rect class="d-rd" x="47" y="17" width="3.4" height="13" rx="1.7" transform="rotate(-45 48.7 23.5)"/>' },
  compass: { also: ["north", "the cardinal points", "navigation", "finding the way", "a bearing", "a heading", "true north"], tint: "#c9935b", svg:
    sh(17, 60) + `<path class="d-t2" d="${ring(32, 8, 4.5, 2.3)}"/>` + '<circle class="d-t" cx="32" cy="34" r="24"/><circle class="d-t2" cx="32" cy="34" r="20.5"/><circle class="d-w" cx="32" cy="34" r="18.5"/>' +
    '<path class="d-w2" d="M31 47h2v4h-2zM45 33v2h4v-2zM19 33v2h-4v-2z"/><path class="d-line thin" d="M29.8 22.5v-5.5l4.4 5.5v-5.5"/>' +
    '<g transform="rotate(35 32 34)"><path class="d-rd" d="M32 16l4.5 18h-9z"/><path class="d-dk" d="M27.5 34h9L32 52z"/></g><circle class="d-y" cx="32" cy="34" r="2.4"/>' },
  anchor: { also: ["a ship's anchor", "a harbour", "a dock", "mooring", "staying put", "holding steady", "sailors"], tint: "#5f86b3", svg:
    sh(20, 60) + `<path class="d-t" d="${ring(32, 8.5, 5.5, 2.8)}"/>` + '<rect class="d-t" x="29.5" y="13" width="5" height="40" rx="2"/><rect class="d-t3" x="30.4" y="24" width="1.5" height="24" rx=".7"/>' +
    '<rect class="d-t2" x="18" y="18" width="28" height="5" rx="2.5"/>' +
    '<path class="d-t" d="M8 36Q10 57 32 57Q54 57 56 36h-4.5Q50 52 32 52Q14 52 12.5 36z"/><path class="d-t" d="M3.5 40L10 28l6.5 10zM60.5 40L54 28l-6.5 10z"/>' },
  pyramid: { also: ["ancient egypt", "a pharaoh's tomb", "the pharaohs", "a tomb", "ancient history", "a monument", "a hierarchy"], tint: "#e0a95c", svg:
    '<circle class="d-y" cx="51" cy="11" r="5"/><path class="d-t" d="M48 24L36 54h15z"/><path class="d-t2" d="M48 24l3 30 11-1z"/>' +
    '<path class="d-t" d="M26 11L3 52l32 3z"/><path class="d-t2" d="M26 11l9 44 16-4z"/><path class="d-t3" d="M26 11l-4 7.5 6 .5z"/>' +
    '<path class="d-y" d="M2 53q15-4 30-1t30-1v6q0 2-2 2H4q-2 0-2-2z"/><path class="d-y2" d="M8 56q6-2 12 0zM40 55.5q6-2 12 0z"/>' },
  newspaper: { also: ["the news", "a headline", "the press", "journalism", "a news story", "the media", "a gazette"], tint: "#9aa3b5", svg:
    sh(24, 60, 33) + '<rect class="d-w2" x="13" y="9" width="44" height="49" rx="2"/><rect class="d-w" x="8" y="5" width="44" height="49" rx="2"/>' +
    '<rect class="d-dk" x="13" y="10" width="34" height="6" rx="1"/><rect class="d-w2" x="13" y="19" width="34" height="1.5"/>' +
    '<rect class="d-t" x="13" y="24" width="16" height="13" rx="1"/><path class="d-t3" d="M14.5 35.5l5-6 3.5 4 2-2 3 4z"/><circle class="d-t3" cx="25" cy="27.5" r="1.6"/>' +
    [24, 28.5, 33].map((y) => `<rect class="d-w2" x="32" y="${y}" width="15" height="2.2" rx="1.1"/>`).join("") +
    [41, 45.5].map((y) => `<rect class="d-w2" x="13" y="${y}" width="15" height="2.2" rx="1.1"/><rect class="d-w2" x="32" y="${y}" width="15" height="2.2" rx="1.1"/>`).join("") },
  megaphone: { also: ["an announcement", "a protest", "a loudhailer", "a bullhorn", "a rally", "a campaign", "shouting"], tint: "#e2665c", svg:
    sh(20, 58, 28) + '<path class="d-dk" d="M21 37h6l-1.5 14h-5z"/><rect class="d-t2" x="6" y="24" width="9" height="16" rx="2"/>' +
    '<path class="d-t" d="M14 26l30-14v40l-30-14z"/><path class="d-w" d="M26 20.4l4-1.9v27l-4-1.9z"/>' +
    '<ellipse class="d-t2" cx="44" cy="32" rx="4" ry="20"/><ellipse class="d-dk" cx="44.5" cy="32" rx="2.3" ry="16.5"/>' +
    '<path class="d-line grey" d="M51 25q3.5 7 0 14M56 19q6.5 13 0 26"/>' },
  medal: { also: ["an award", "a gold medal", "an honour", "a decoration", "a winner", "a badge of honour", "an achievement"], tint: "#f3c14b", svg:
    sh(14, 60.5) + '<path class="d-bl2" d="M15 3h11l11 24H26z"/><path class="d-rd" d="M49 3H38L27 27h11z"/><rect class="d-t2" x="27.5" y="23" width="9" height="5" rx="1.5"/>' +
    '<circle class="d-t2" cx="32" cy="42" r="16.5"/><circle class="d-t" cx="32" cy="42" r="13"/>' +
    `<path class="d-t3" d="${star(32, 32.5)}"/>` + '<path class="d-t3" d="M20 37a13 13 0 0 1 6-7.5l.8 1.5a11.5 11.5 0 0 0-5.3 6.6z"/>' },
  passport: { also: ["travel", "citizenship", "identity", "an id", "a travel document", "a visa", "border control"], tint: "#b8566b", svg:
    sh(19, 59.5, 31) + '<rect class="d-w2" x="15" y="7" width="36" height="50" rx="3"/><rect class="d-t" x="12" y="5" width="36" height="50" rx="3"/><rect class="d-t2" x="12" y="5" width="4.5" height="50" rx="2"/>' +
    '<rect class="d-y" x="22" y="11" width="16" height="2.5" rx="1.2"/>' +
    '<circle class="d-line yel thin" cx="30" cy="27" r="8"/><ellipse class="d-line yel thin" cx="30" cy="27" rx="3.5" ry="8"/><path class="d-line yel thin" d="M22 27h16"/>' +
    '<rect class="d-y" x="22" y="40" width="16" height="2.5" rx="1.2"/><rect class="d-y" x="25" y="45" width="10" height="2" rx="1"/><rect class="d-y" x="26.5" y="49.5" width="7" height="3" rx="1"/>' },
  pin: { also: ["a location", "you are here", "a destination", "a map marker", "a spot", "a gps point", "where it is"], tint: "#e2665c", svg:
    sh(11, 59.5) + '<path class="d-t" d="M32 58C22 44 14 35 14 24a18 18 0 0 1 36 0c0 11-8 20-18 34z"/><path class="d-t2" d="M32 6a18 18 0 0 1 18 18c0 11-8 20-18 34z"/>' +
    '<circle class="d-w" cx="32" cy="24" r="7.5"/><ellipse class="d-t3" cx="20.5" cy="17" rx="2" ry="4" transform="rotate(35 20.5 17)"/>' },
  cactus: { also: ["a desert", "dry land", "a succulent", "drought", "a dry climate", "the wild west", "prickly"], tint: "#6cbf7a", svg:
    '<rect class="d-t" x="12" y="19" width="7" height="21" rx="3.5"/><rect class="d-t" x="14" y="33" width="13" height="7" rx="3.5"/>' +
    '<rect class="d-t" x="45" y="13" width="7" height="22" rx="3.5"/><rect class="d-t" x="37" y="28" width="13" height="7" rx="3.5"/>' +
    '<rect class="d-t" x="25" y="9" width="14" height="47" rx="7"/><rect class="d-t2" x="34" y="14" width="2" height="40" rx="1"/><rect class="d-t3" x="28" y="14" width="2" height="38" rx="1"/>' +
    '<rect class="d-t3" x="14.2" y="22" width="1.6" height="12" rx=".8"/><rect class="d-t3" x="47.2" y="16" width="1.6" height="12" rx=".8"/>' +
    '<circle class="d-pk" cx="32" cy="9" r="3.4"/><circle class="d-y" cx="32" cy="9" r="1.4"/>' +
    '<path class="d-y" d="M3 59q4-8 29-8t29 8z"/><path class="d-y2" d="M10 57.5q5-2 10 0zM44 57.5q5-2 10 0z"/>' },
  turbine: { also: ["a wind turbine", "wind power", "a windmill", "renewable energy", "clean energy", "a wind farm", "green energy"], tint: "#d3dbe5", svg:
    '<path class="d-gr2" d="M2 60q30-12 60 0z"/><path class="d-t" d="M30.5 24h3l2.5 32h-8z"/><path class="d-t2" d="M32 24h1.5l2.5 32h-4z"/>' +
    [15, 135, 255].map((a) => `<path class="d-t" d="M32 22q-6-9-1-20q4.5 10 1 20z" transform="rotate(${a} 32 22)"/><path class="d-t2" d="M32 22q3.2-9-1-20q4.5 10 1 20z" transform="rotate(${a} 32 22)"/>`).join("") +
    '<circle class="d-t2" cx="32" cy="22" r="3.6"/><circle class="d-t3" cx="32" cy="22" r="1.6"/>' },
  solar: { also: ["a solar panel", "solar energy", "a solar farm", "a photovoltaic cell", "sunlight to electricity", "renewables", "a sun-powered panel"], tint: "#4f7fb0", svg:
    sh(17, 59.5) + '<circle class="d-y" cx="13" cy="12" r="5.5"/><path class="d-line yel" d="M5 12H2.5M13 4V1.5M21 12h2.5M13 20v2.5M18.7 6.3l1.7-1.7M7.3 6.3L5.6 4.6M7.3 17.7l-1.7 1.7M18.7 17.7l1.7 1.7"/>' +
    '<rect class="d-w2" x="30" y="43" width="4" height="12"/><rect class="d-dk" x="21" y="54" width="22" height="3.5" rx="1.5"/>' +
    '<path class="d-w2" d="M5 45l12-22h42L47 45z"/><path class="d-t" d="M8.5 43l10.1-18h36.9L45.4 43z"/><path class="d-t3" d="M22 25h6l-10 18h-6z" opacity=".35"/>' +
    '<path class="d-line thin2" d="M13.5 34h37M17.7 43l10.1-18M27 43l10-18M36.2 43l10.1-18"/>' },
  recycle: { also: ["recycling", "a recycling bin", "the environment", "reuse", "sustainability", "going green", "a circular economy"], tint: "#5fb36f", svg:
    sh(22, 60) + '<path class="d-t" d="M13 21h38l-3 33q-.3 3-3.3 3H19.3q-3 0-3.3-3z"/><path class="d-t2" d="M44 21h7l-3 33q-.3 3-3.3 3H41z"/>' +
    '<rect class="d-t2" x="26" y="9" width="12" height="6" rx="2"/><rect class="d-t2" x="10" y="14" width="44" height="8" rx="3"/><rect class="d-t3" x="13" y="15.5" width="38" height="2" rx="1"/>' +
    '<path class="d-line white" d="M27.1 30A8.5 8.5 0 0 1 40.5 37.7M36.9 44A8.5 8.5 0 0 1 23.5 36.3"/><path class="d-w" d="M40.1 42.2l3.6-4.2-6.4-.6zM23.9 31.8l-3.6 4.2 6.4.6z"/>' +
    '<circle class="d-dk" cx="19" cy="57" r="3.2"/><circle class="d-dk" cx="45" cy="57" r="3.2"/>' },
};
