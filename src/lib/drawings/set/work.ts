// Business and work: deals, offices, selling, stock and the money that moves between them. Same hand as base.ts.
import type { DrawingSet } from "../types";

/** A soft ground shadow under a drawing. */
const sh = (rx: number, cy = 58) => `<ellipse class="d-sh" cx="32" cy="${cy}" rx="${rx}" ry="2"/>`;
/** A ring (a circle with a hole) as one path. */
const ring = (cx: number, cy: number, r: number, h: number) =>
  `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0-${2 * r}zM${cx} ${cy - h}a${h} ${h} 0 1 0 0 ${2 * h}a${h} ${h} 0 1 0 0-${2 * h}z`;
const arrow = "M6.3 47.3L23 30.6L32 39.6L43.3 28.3L39.3 24.3L55.2 21.8L52.7 37.7L48.7 33.7L32 50.4L23 41.4L11.7 52.7z";

export const WORK: DrawingSet = {
  handshake: { also: ["a deal", "an agreement", "a partnership", "shaking hands", "a truce", "a promise kept"], tint: "#5f86b3", svg:
    '<g transform="translate(0 -4)"><g transform="rotate(-35 18 37.5)"><rect class="d-t" x="3" y="29" width="15" height="17" rx="2"/><rect class="d-w" x="14" y="28" width="5" height="19" rx="1.5"/></g>' +
    '<g transform="rotate(35 46 37.5)"><rect class="d-dk" x="46" y="29" width="15" height="17" rx="2"/><rect class="d-w" x="45" y="28" width="5" height="19" rx="1.5"/></g>' +
    '<rect class="d-sk2" x="18" y="30" width="26" height="15" rx="6"/><path class="d-sk" d="M46 30v14l-9 2-6-2-4-14q6-4 12-4z"/>' +
    [[22, 28.5, 16], [19, 33, 19], [20, 37.5, 18], [23, 42, 14]].map(([x, y, w]) => `<rect class="d-sk" x="${x}" y="${y}" width="${w}" height="4" rx="2"/>`).join("") +
    '<path class="d-line thin" d="M25 33h4M24 37.5h4M26 42h3.5"/><rect class="d-sk2" x="25" y="23.5" width="16" height="5.5" rx="2.7" transform="rotate(-6 33 26)"/></g>' },
  contract: { also: ["an agreement on paper", "the terms", "signing", "a signature", "the small print", "a legal document"], tint: "#4b4f58", svg:
    sh(21) + '<rect class="d-w2" x="16" y="10" width="38" height="46" rx="1"/><path class="d-w" d="M12 6h28l10 10v42h-38z"/><path class="d-w2" d="M40 6v10h10z"/>' +
    '<rect class="d-w2" x="17" y="12" width="17" height="4" rx="2"/>' +
    [21, 26, 31].map((y, i) => `<rect class="d-w3" x="17" y="${y}" width="${[28, 24, 28][i]}" height="2.6" rx="1.3"/>`).join("") +
    '<path class="d-line" d="M17 46q3-9 5-3t3 2 4-5q1 4 3 3"/><rect class="d-w2" x="16" y="49" width="22" height="1.4"/><circle class="d-rd" cx="42" cy="47" r="5"/><circle class="d-pk" cx="42" cy="47" r="2.5"/>' +
    '<g transform="rotate(35 49 34)"><rect class="d-t" x="46" y="12" width="6" height="28" rx="2"/><rect class="d-t2" x="46" y="12" width="6" height="5" rx="2"/><path class="d-y" d="M46 40h6l-3 7z"/><rect class="d-t3" x="47.2" y="19" width="1.4" height="17" rx=".7"/></g>' },
  briefcase: { also: ["a job", "business", "work", "a career", "a profession", "going to work", "a work bag"], tint: "#9a7652", svg:
    sh(26) + '<path class="d-t2" d="M23 18v-5q0-4 4-4h10q4 0 4 4v5h-4.5v-4.5h-9v4.5z"/>' +
    '<rect class="d-t" x="5" y="18" width="54" height="38" rx="5"/><rect class="d-t2" x="5" y="34" width="54" height="22" rx="5"/><rect class="d-t" x="5" y="34" width="54" height="3"/><rect class="d-t3" x="5" y="18" width="54" height="4.5" rx="2.2"/>' +
    '<rect class="d-y" x="13" y="31" width="7" height="8" rx="1.5"/><rect class="d-y" x="44" y="31" width="7" height="8" rx="1.5"/><rect class="d-y2" x="15" y="34" width="3" height="3"/><rect class="d-y2" x="46" y="34" width="3" height="3"/>' },
  office: { also: ["a company", "headquarters", "an office block", "a firm", "a corporation", "a skyscraper", "a head office"], tint: "#5f86b3", svg:
    sh(24) + '<rect class="d-t2" x="38" y="16" width="16" height="42"/><rect class="d-t" x="12" y="6" width="30" height="52"/>' +
    '<rect class="d-sky" x="15" y="10" width="24" height="40"/><path class="d-w" d="M15 10h9l-9 14z" opacity=".55"/><path class="d-line tint" d="M15 16h24M15 22h24M15 28h24M15 34h24M15 40h24M15 46h24M23 10v40M31 10v40"/>' +
    [22, 30, 38, 46].map((y) => `<rect class="d-sky" x="44" y="${y}" width="6" height="4" opacity=".7"/>`).join("") +
    '<rect class="d-t2" x="10" y="4" width="34" height="3.5" rx="1"/><rect class="d-dk" x="22" y="50" width="10" height="8"/><path class="d-line thin2" d="M27 50.5v7"/>' },
  trolley: { also: ["a shopping trolley", "a supermarket", "a shopping cart", "a week's shop", "the weekly shop"], tint: "#e07f73", svg:
    sh(23, 59) + '<rect class="d-or" x="22" y="7" width="11" height="13" rx="1"/><rect class="d-gr" x="35" y="5" width="6" height="15" rx="2.5"/><circle class="d-rd" cx="47" cy="15" r="5"/><circle class="d-y" cx="28" cy="12" r="2"/>' +
    '<path class="d-line tint thick" d="M4 10h6l6 32h35"/><path class="d-t3" d="M12 19h47l-6 19h-35z"/><path class="d-line tint" d="M12 19h47l-6 19h-35zM22 19l2 19M31 19l1 19M40 19v19M49 19l-2 19M14 28.5h42"/>' +
    '<circle class="d-dk" cx="21" cy="52" r="5"/><circle class="d-dk" cx="47" cy="52" r="5"/><circle class="d-w2" cx="21" cy="52" r="2"/><circle class="d-w2" cx="47" cy="52" r="2"/><path class="d-line tint thick" d="M18 42l3 6M50 42l-3 6"/>' },
  trend: { also: ["economic growth", "profit", "a rising price", "going up", "an upturn", "a boom", "a line graph"], tint: "#4e9f63", svg:
    '<path class="d-line grey" d="M5 8v49h54"/><path class="d-line thin2" d="M12 44h44M12 32h44M12 20h44" opacity=".5"/>' +
    `<path class="d-t2" d="${arrow}" transform="translate(0 3)"/><path class="d-t" d="${arrow}"/>` },
  suitcase: { also: ["a holiday", "a trip", "a traveller", "packing", "a wheelie case", "a journey abroad"], tint: "#b79cf0", svg:
    sh(17, 60) + '<path class="d-line grey thick" d="M25 16v-9h14v9"/><rect class="d-dk" x="23" y="4" width="18" height="5" rx="2.5"/>' +
    '<rect class="d-t" x="14" y="15" width="36" height="39" rx="5"/><rect class="d-t2" x="38" y="15" width="12" height="39" rx="5"/><rect class="d-t" x="38" y="15" width="6" height="39"/>' +
    '<rect class="d-t2" x="21" y="20" width="3.5" height="29" rx="1.7"/><rect class="d-t2" x="30" y="20" width="3.5" height="29" rx="1.7"/><rect class="d-t3" x="14" y="15" width="36" height="4" rx="2"/>' +
    '<circle class="d-dk" cx="20" cy="57" r="3.2"/><circle class="d-dk" cx="44" cy="57" r="3.2"/>' },
  stamp: { also: ["approval", "an official stamp", "approved", "a seal of approval", "signed off", "a rubber stamp"], tint: "#d9534f", svg:
    sh(26, 59) + `<path class="d-t" d="${ring(19, 44, 12, 9.2)}"/><path class="d-line tint thick" d="M13.5 44.5l4 4 7.5-8.5"/>` +
    '<circle class="d-wood" cx="46" cy="9" r="6"/><rect class="d-wood" x="43" y="13" width="6" height="12"/><rect class="d-t" x="35" y="24" width="22" height="7" rx="2.5"/><rect class="d-t2" x="33" y="30" width="26" height="10" rx="2"/><rect class="d-dk" x="34" y="40" width="24" height="3.5" rx="1"/><circle class="d-y" cx="44" cy="7.5" r="1.8" opacity=".6"/>' },
  target: { also: ["an ambition", "an aim", "a bullseye", "a dartboard", "hitting the mark", "an objective"], tint: "#e0564f", svg:
    sh(18, 60) + '<circle class="d-t" cx="29" cy="35" r="23"/><circle class="d-w" cx="29" cy="35" r="17.5"/><circle class="d-t" cx="29" cy="35" r="12"/><circle class="d-w" cx="29" cy="35" r="6.5"/><circle class="d-t" cx="29" cy="35" r="2.8"/>' +
    '<g transform="rotate(-45 29 35)"><rect class="d-dk" x="29" y="33.6" width="28" height="2.8" rx="1.4"/><path class="d-y" d="M46 34l5-6.5h7l-4 6.5z"/><path class="d-y2" d="M46 36l5 6.5h7l-4-6.5z"/></g>' },
  easel: { also: ["a pitch", "a presentation", "a flip chart", "a talk", "a sales pitch", "a slideshow"], tint: "#f0a94b", svg:
    '<path class="d-line thick" d="M22 38l-10 21M42 38l10 21M32 38v19"/>' +
    '<rect class="d-wood" x="6" y="7" width="52" height="34" rx="2.5"/><rect class="d-w" x="9" y="10" width="46" height="28" rx="1"/><rect class="d-dk" x="27" y="4" width="10" height="5" rx="1.5"/>' +
    '<rect class="d-t3" x="14" y="27" width="6" height="7"/><rect class="d-t" x="23" y="23" width="6" height="11"/><rect class="d-t2" x="32" y="18" width="6" height="16"/>' +
    '<path class="d-line thin" d="M41 31l4-6 3 3 4-10"/><rect class="d-wood" x="4" y="40" width="56" height="3.5" rx="1.7"/>' },
  moneybag: { also: ["a bag of money", "a fortune", "riches", "a big win", "the takings", "a sack of cash"], tint: "#c9935b", svg:
    sh(22) + '<path class="d-t2" d="M22 22l-5-14q7 4 10 1 2-4 5-4t5 4q3 3 10-1l-5 14z"/>' +
    '<path class="d-t" d="M23 23q-17 12-15 23 1 11 24 11t24-11q2-11-15-23z"/><path class="d-t2" d="M41 23q17 12 15 23-1 8-14 10 9-6 7-16-2-9-11-17z"/>' +
    '<rect class="d-wood" x="20" y="20" width="24" height="5" rx="2.5"/><circle class="d-y" cx="31" cy="42" r="10"/><circle class="d-y2" cx="31" cy="42" r="7.5"/><circle class="d-y" cx="31" cy="42" r="6.3"/>' +
    '<path class="d-line thin" d="M34 38.8q-1-1-3-1q-3 0-3 2.2t3 2.1 3 2.1-3 2.2q-2 0-3-1M31 36v12"/>' },
  till: { also: ["a cash register", "a checkout", "a sale", "the cash desk", "paying for shopping", "a point of sale"], tint: "#63c2a2", svg:
    sh(27) + '<rect class="d-w2" x="40" y="15" width="3" height="10"/><rect class="d-dk" x="33" y="6" width="19" height="11" rx="2"/><rect class="d-gr" x="36" y="9" width="13" height="5" rx="1"/>' +
    '<rect class="d-w" x="14" y="12" width="12" height="14"/><path class="d-w2" d="M16.5 16h7M16.5 19.5h5"/><rect class="d-w2" x="16.5" y="15.3" width="7" height="1.4"/><rect class="d-w2" x="16.5" y="19" width="5" height="1.4"/>' +
    '<path class="d-t" d="M10 45l5-21h34l5 21z"/><path class="d-t3" d="M15 24h34l.8 3.5h-35.6z"/>' +
    [[17, 31], [25, 31], [33, 31], [16, 37.5], [24, 37.5], [32, 37.5]].map(([x, y]) => `<rect class="d-w" x="${x}" y="${y}" width="6" height="4" rx="1"/>`).join("") + '<rect class="d-y" x="41" y="31" width="7" height="10.5" rx="1"/>' +
    '<rect class="d-t2" x="6" y="45" width="52" height="12" rx="2"/><rect class="d-t" x="6" y="45" width="52" height="2.5"/><rect class="d-w2" x="26" y="50" width="12" height="3" rx="1.5"/>' },
  shelves: { also: ["stock", "inventory", "a storeroom", "the stockroom", "supplies", "goods on shelves", "a stock check"], tint: "#7b7fb5", svg:
    sh(28, 59) + '<rect class="d-t2" x="5" y="5" width="4" height="53" rx="1"/><rect class="d-t2" x="55" y="5" width="4" height="53" rx="1"/>' +
    '<rect class="d-or" x="10" y="8" width="13" height="11" rx="1"/><rect class="d-cream" x="25" y="11" width="9" height="8" rx="1"/><rect class="d-bl" x="36" y="6" width="9" height="13" rx="1"/><rect class="d-or" x="46" y="12" width="8" height="7" rx="1"/>' +
    '<rect class="d-cream" x="10" y="27" width="10" height="9" rx="1"/><rect class="d-gr" x="22" y="24" width="14" height="12" rx="1"/><rect class="d-or" x="38" y="27" width="16" height="9" rx="1"/>' +
    '<rect class="d-bl" x="10" y="42" width="8" height="11" rx="1"/><rect class="d-or" x="20" y="45" width="15" height="8" rx="1"/><rect class="d-cream" x="37" y="41" width="10" height="12" rx="1"/><rect class="d-pk" x="48" y="46" width="6" height="7" rx="1"/>' +
    [19, 36, 53].map((y) => `<rect class="d-t" x="4" y="${y}" width="56" height="3.5" rx="1"/>`).join("") +
    '<path class="d-y2" d="M14 8h5v4h-5zM40 6h1.5v13H40zM26 27h1.5v9H26zM42 27h1.5v9H42zM24 45h1.5v8H24z" opacity=".55"/>' },
};
