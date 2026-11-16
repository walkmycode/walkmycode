// Home and everyday things: what is in a house and on a desk. Same hand as base.ts.
import type { DrawingSet } from "../types";

const r1 = (n: number) => Math.round(n * 10) / 10;
const sh = (rx: number, cy = 58.5, cx = 32) => `<ellipse class="d-sh" cx="${cx}" cy="${cy}" rx="${rx}" ry="2"/>`;
/** A ring: a circle with a round hole in it. */
const ring = (cx: number, cy: number, r: number, h: number) =>
  `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0-${2 * r}zM${cx} ${cy - h}a${h} ${h} 0 1 0 0 ${2 * h}a${h} ${h} 0 1 0 0-${2 * h}z`;
/** A small flame standing at (x, y): its tip at y, its round foot 10 below. */
const flame = (x: number, y: number) =>
  `<path class="d-or" d="M${x} ${y}q4 4 3.5 6.5a3.5 3.5 0 0 1-7 0q-.5-2.5 3.5-6.5z"/><path class="d-y" d="M${x} ${y + 4}q2 2.5 1.7 3.7a1.7 1.7 0 0 1-3.4 0q-.3-1.2 1.7-3.7z"/>`;
/** One half of a pair of scissors, turned by a degrees about the pivot. */
const blade = (a: number, front: boolean) =>
  `<g transform="rotate(${a} 32 26)"><path class="d-w2" d="M29.5 27L31 4q1-2 2 0l2.5 23z"/>${front ? '<path class="d-w" d="M31.8 24l.6-18 .6 18z"/>' : ""}` +
  `<rect class="d-w2" x="30" y="26" width="4" height="16"/><path class="d-t" d="${ring(32, 48, 7.5, 4)}"/></g>`;
/** A ladder's rung at height y, from one rail to the other. */
const rung = (y: number) => {
  const x = r1(23 - (6.5 * (y + 2 - 4)) / 54);
  return `<rect class="d-t2" x="${x}" y="${y}" width="${r1(64 - 2 * x)}" height="4" rx="1"/>`;
};

export const HOME: DrawingSet = {
  door: { also: ["a doorway", "a doorstep", "an exit", "an entry point", "a threshold", "a portal"], tint: "#5f86b3", svg:
    sh(24, 59.5) + '<rect class="d-w2" x="9" y="56" width="46" height="3.5" rx="1.5"/><rect class="d-cream" x="12" y="4" width="40" height="53" rx="2"/>' +
    '<rect class="d-t" x="16" y="8" width="32" height="49" rx="1"/><rect class="d-t2" x="20" y="12" width="24" height="16" rx="1.5"/><rect class="d-t2" x="20" y="34" width="24" height="18" rx="1.5"/>' +
    '<rect class="d-t3" x="20" y="12" width="24" height="2.5" rx="1.2"/><rect class="d-t3" x="20" y="34" width="24" height="2.5" rx="1.2"/>' +
    '<rect class="d-y2" x="26" y="41" width="12" height="3.5" rx="1"/><circle class="d-y2" cx="42.5" cy="31.5" r="3"/><circle class="d-y" cx="42" cy="31" r="2.3"/>' },
  window: { also: ["a window pane", "a viewport", "a view outside", "a pane of glass", "a skylight", "a glimpse"], tint: "#e07f73", svg:
    '<rect class="d-w2" x="11" y="8" width="42" height="42" rx="2.5"/><rect class="d-w" x="12" y="9" width="40" height="40" rx="2"/><rect class="d-sky" x="15.5" y="12.5" width="33" height="33" rx="1"/>' +
    '<path class="d-w" d="M18 25l7-10h4l-7 10zM35 43l7-10h3l-7 10z" opacity=".6"/><rect class="d-w" x="30.5" y="12.5" width="3" height="33"/><rect class="d-w" x="15.5" y="27.5" width="33" height="3"/>' +
    '<rect class="d-w2" x="8" y="49" width="48" height="5" rx="1.5"/><rect class="d-dk" x="4" y="5" width="56" height="3" rx="1.5"/>' +
    '<path class="d-t" d="M5 8h11q-1 15 2 25q-5 8-6 19H5zM59 8H48q1 15-2 25q5 8 6 19h7z"/><path class="d-t2" d="M8.5 8h2.2v44H8.5zM53.3 8h2.2v44h-2.2z"/>' +
    '<rect class="d-y" x="4.5" y="31" width="14" height="3.5" rx="1.7"/><rect class="d-y" x="45.5" y="31" width="14" height="3.5" rx="1.7"/>' },
  ladder: { also: ["a career ladder", "climbing up", "a rung", "a ranking", "a pecking order", "promotion"], tint: "#c9935b", svg:
    sh(20, 59.5) + [9, 19, 29, 39, 49].map(rung).join("") +
    '<path class="d-t" d="M14 58L20.5 4h5L19 58zM50 58L43.5 4h-5L45 58z"/><path class="d-t3" d="M15.6 56l6-50h1.4l-6 50zM45.5 56l-6-50h1.4l6 50z" opacity=".7"/>' },
  stairs: { also: ["a staircase", "steps", "levels", "a flight of stairs", "going upstairs", "stages"], tint: "#e8a35c", svg:
    sh(27, 59.5) + '<path class="d-line grey thin" d="M11.2 50V39M21.6 41V30M32 32V21M42.4 23V12M52.8 14V3"/><path class="d-line grey" d="M8 42l48-41.5"/>' +
    '<path class="d-t" d="M6 58V50h10.4V41h10.4V32h10.4V23h10.4V14H58v44z"/><path class="d-t2" d="M54 14h4v44H6v-3.5h48z"/>' +
    [0, 1, 2, 3, 4].map((i) => `<rect class="d-t3" x="${r1(6 + 10.4 * i)}" y="${50 - 9 * i}" width="${i === 4 ? 12 : 10.4}" height="3"/>`).join("") },
  tap: { also: ["a faucet", "running water", "a water supply", "a dripping tap", "a leak", "turning on the flow"], tint: "#8e929c", svg:
    sh(22) + '<ellipse class="d-bl" cx="46" cy="57.5" rx="5" ry="1.5" opacity=".8"/><rect class="d-t2" x="15" y="51" width="22" height="6" rx="2.5"/>' +
    '<g transform="rotate(25 22 35)"><rect class="d-t2" x="8" y="33" width="16" height="4.5" rx="2.2"/><circle class="d-bl" cx="11" cy="35.2" r="1.5"/></g>' +
    '<rect class="d-t" x="21" y="21" width="10" height="32" rx="2"/><rect class="d-t3" x="23" y="25" width="2.5" height="24" rx="1.2"/>' +
    '<path class="d-t" d="M21 22a14 14 0 0 1 28 0v6h-6v-6a8 8 0 0 0-16 0z"/><path class="d-t3" d="M24 18a11 11 0 0 1 9-7v2.5a8.5 8.5 0 0 0-6.5 5.5z"/><rect class="d-t2" x="42" y="27" width="8" height="3.5" rx="1.5"/>' +
    '<path class="d-bl" d="M46 34q-4.5 6-4.5 9a4.5 4.5 0 0 0 9 0q0-3-4.5-9z"/><circle class="d-w" cx="44.4" cy="43.4" r="1.1" opacity=".8"/>' },
  kettle: { also: ["boiling water", "heating up", "a jug", "a teapot", "making tea", "a hot drink"], tint: "#63c2a2", svg:
    sh(22) + '<path class="d-line grey" d="M9 11q-2.5-3 0-6M14 12q-2.5-3 0-6"/><path class="d-t2" d="M42 17h6q7 0 7 7v16q0 7-7 7h-3v-6h3q1 0 1-1v-16q0-1-1-1h-6z"/>' +
    '<path class="d-t" d="M20 22L7 15q-2-1-1.5 1.5L18 34z"/><path class="d-t" d="M15 52l4-32q.5-4 4.5-4h17q4 0 4.5 4l4 32z"/><path class="d-t2" d="M39.5 16h1q4 0 4.5 4l4 32h-6.5z"/>' +
    '<rect class="d-sky" x="22.5" y="25" width="5.5" height="21" rx="2.7"/><rect class="d-bl" x="22.5" y="35" width="5.5" height="11" rx="2.7"/>' +
    '<rect class="d-t3" x="20" y="12" width="24" height="5" rx="2.5"/><rect class="d-dk" x="28" y="8" width="8" height="5" rx="2"/><rect class="d-dk" x="12" y="51" width="40" height="7" rx="3"/><circle class="d-y" cx="18.5" cy="54.5" r="1.4"/>' },
  saucepan: { also: ["a pan", "a pot", "cooking", "a stew", "something simmering", "a cooking pot", "a stove", "a hob"], tint: "#e2665c", svg:
    sh(25) + '<path class="d-line grey" d="M19 15q-3-4 0-8M27 15q-3-4 0-8M35 15q-3-4 0-8"/><rect class="d-dk" x="4" y="54" width="46" height="4.5" rx="2"/>' +
    flame(15, 45) + flame(25, 45) + flame(35, 45) +
    '<rect class="d-dk" x="42" y="24.5" width="19" height="5" rx="2.5"/><rect class="d-t2" x="40.5" y="23.5" width="5" height="7" rx="1"/>' +
    '<path class="d-t" d="M8 23h34v16q0 7-7 7H15q-7 0-7-7z"/><path class="d-t2" d="M36 23h6v16q0 7-7 7h-3q4-2 4-7z"/><rect class="d-t3" x="11.5" y="27" width="3" height="14" rx="1.5"/>' +
    '<rect class="d-t3" x="6" y="20" width="38" height="4.5" rx="2.2"/>' },
  fridge: { also: ["a refrigerator", "a freezer", "cold storage", "keeping food fresh", "a cooler", "a larder"], tint: "#9fd0ea", svg:
    sh(21, 59) + '<rect class="d-dk" x="17" y="54" width="5" height="5" rx="1"/><rect class="d-dk" x="42" y="54" width="5" height="5" rx="1"/>' +
    '<rect class="d-t" x="14" y="4" width="36" height="53" rx="5"/><path class="d-t2" d="M44 4h1q5 0 5 5v43q0 5-5 5h-1zM14 21h36v2.5H14z"/>' +
    '<rect class="d-w" x="18" y="9" width="3" height="9" rx="1.5"/><rect class="d-w" x="18" y="28" width="3" height="15" rx="1.5"/>' +
    '<path class="d-line white" d="M33 8v9M29.1 10.2l7.8 4.6M29.1 14.8l7.8-4.6"/>' +
    '<g transform="rotate(6 34 37)"><rect class="d-w" x="27.5" y="30" width="13" height="15" rx="1"/><rect class="d-w2" x="30" y="35.5" width="8" height="1.8" rx=".9"/><rect class="d-w2" x="30" y="39.5" width="6" height="1.8" rx=".9"/></g><circle class="d-rd" cx="33.5" cy="30.5" r="2"/>' },
  washer: { also: ["a washing machine", "laundry", "a wash cycle", "a spin cycle", "a launderette", "a wash"], tint: "#eef1f5", svg:
    sh(24, 59) + '<rect class="d-dk" x="13" y="55" width="6" height="4" rx="1"/><rect class="d-dk" x="45" y="55" width="6" height="4" rx="1"/>' +
    '<rect class="d-t2" x="9" y="5" width="46" height="52" rx="4"/><rect class="d-t" x="9" y="5" width="44" height="48" rx="4"/><rect class="d-t2" x="9" y="16" width="44" height="1.5"/>' +
    '<rect class="d-w2" x="14" y="8" width="12" height="5" rx="1"/><circle class="d-gr" cx="33" cy="10.5" r="1.6"/><circle class="d-dk" cx="45" cy="10.5" r="3.6"/><rect class="d-w2" x="44.3" y="7.5" width="1.4" height="3" rx=".7"/>' +
    '<circle class="d-w2" cx="31" cy="35.5" r="15.5"/><circle class="d-dk2" cx="31" cy="35.5" r="12"/>' +
    '<path class="d-bl" d="M19.4 38.5a12 12 0 0 0 23.2 0q-2.9-2.5-5.8 0t-5.8 0t-5.8 0t-5.8 0z"/><ellipse class="d-pk" cx="27" cy="43" rx="3.5" ry="2"/><ellipse class="d-y" cx="35.5" cy="44.5" rx="3" ry="1.8"/>' +
    '<path class="d-line white" d="M23.5 31a8.5 8.5 0 0 1 5-4.5" opacity=".55"/>' },
  lamp: { also: ["a desk lamp", "a reading lamp", "a spotlight", "lighting", "a focus", "shining a light"], tint: "#b79cf0", svg:
    sh(24, 58.5, 34) + '<ellipse class="d-y" cx="19" cy="57" rx="11" ry="2" opacity=".85"/><path class="d-line yel" d="M11 27.5l-5 2.5M18.5 34l-3 5M28 37l.5 5.5"/>' +
    '<rect class="d-t2" x="31" y="52" width="22" height="6" rx="3"/><rect class="d-t" x="34" y="49.5" width="16" height="4" rx="2"/>' +
    '<path class="d-t" d="M40.1 50.3l8-21 3.8 1.4-8 21zM51.2 28.4l-20-15-2.4 3.2 20 15z"/>' +
    '<g transform="rotate(30 30 15)"><circle class="d-y" cx="30" cy="28.5" r="5"/><rect class="d-t2" x="26.5" y="8.5" width="7" height="7" rx="1.5"/><path class="d-t" d="M25 14h10l6 14H19z"/><path class="d-t3" d="M26.5 16h2.5l-3 10h-2.6z"/><rect class="d-t2" x="19" y="26.5" width="22" height="2" rx="1"/></g>' +
    '<circle class="d-dk" cx="42" cy="51" r="2"/><circle class="d-dk" cx="50" cy="30" r="2.4"/><circle class="d-dk" cx="30" cy="15" r="2.2"/>' },
  candle: { also: ["a candle flame", "candlelight", "a birthday candle", "a vigil", "a wick", "melting wax"], tint: "#f2a0b0", svg:
    sh(20) + '<path class="d-line yel" d="M22 7l-3-2M42 7l3-2M20.5 14.5H17M43.5 14.5H47"/><ellipse class="d-y2" cx="32" cy="54" rx="18" ry="4.5"/><ellipse class="d-y" cx="32" cy="52.5" rx="18" ry="4"/>' +
    '<path class="d-t" d="M24 24h16v29H24z"/><path class="d-t2" d="M35 24h5v29h-5z"/><ellipse class="d-t3" cx="32" cy="24" rx="8" ry="2.5"/>' +
    '<path class="d-t3" d="M25.5 24h5v6a2.5 2.5 0 0 1-5 0zM33.5 24h3v10a1.5 1.5 0 0 1-3 0z"/><rect class="d-dk" x="31.3" y="18" width="1.4" height="6" rx=".6"/>' +
    '<path class="d-or" d="M32 3q7 8 6 13a6 6 0 0 1-12 0q-1-5 6-13z"/><path class="d-y" d="M32 10q3.5 5 3 8a3 3 0 0 1-6 0q-.5-3 3-8z"/>' },
  scissors: { also: ["cutting", "cutting out", "snipping", "trimming", "shears", "a pair of scissors"], tint: "#f0a94b", svg:
    sh(18, 59) + blade(22, false) + blade(-22, true) + '<circle class="d-dk" cx="32" cy="26" r="2.4"/><circle class="d-w2" cx="32" cy="26" r=".9"/>' },
  paperclip: { also: ["a clip", "an attachment", "attaching", "holding together", "a fastener", "a binder clip"], tint: "#7fbfe6", svg:
    '<g transform="translate(32 32) rotate(35) scale(2.2) translate(-5.5 -13.1)"><path class="d-line tint" d="M7.6 7V17a2.1 2.1 0 0 1-4.2 0V4.5a3.8 3.8 0 0 1 7.6 0V20a5.5 5.5 0 0 1-11 0V9"/></g>' },
  pencil: { also: ["writing", "a sketch", "a draft", "a pen", "taking notes", "editing"], tint: "#f3c14b", svg:
    sh(19) + '<g transform="rotate(45 32 32)"><rect class="d-pk" x="26" y="4" width="12" height="9" rx="2.5"/><rect class="d-w2" x="26" y="11" width="12" height="6"/><rect class="d-w" x="26" y="13" width="12" height="1.2"/>' +
    '<rect class="d-t3" x="26" y="17" width="4" height="27"/><rect class="d-t" x="30" y="17" width="4" height="27"/><rect class="d-t2" x="34" y="17" width="4" height="27"/>' +
    '<path class="d-cream" d="M26 44h12l-6 13z"/><path class="d-dk" d="M29.7 52h4.6L32 57z"/></g>' },
  mirror: { also: ["a reflection", "a copy", "a looking glass", "a mirror image", "reflecting", "a duplicate"], tint: "#d9b25a", svg:
    '<path class="d-y" d="M51 3q1 5 6 6q-5 1-6 6q-1-5-6-6q5-1 6-6z"/><rect class="d-t2" x="29" y="42" width="6" height="6"/><rect class="d-t" x="28" y="45" width="8" height="16" rx="3.5"/><rect class="d-t3" x="30" y="47.5" width="1.8" height="10" rx=".9"/>' +
    '<ellipse class="d-t2" cx="33" cy="25" rx="17" ry="20"/><ellipse class="d-t" cx="32" cy="24" rx="17" ry="20"/><ellipse class="d-sky" cx="32" cy="24" rx="13" ry="16"/>' +
    '<path class="d-w" d="M21 28l12-15h5L26 28zM28 33l12-15h2L30 33z" opacity=".7"/>' },
  glasses: { also: ["spectacles", "reading glasses", "eyesight", "seeing clearly", "a closer look", "sunglasses"], tint: "#d9534f", svg:
    '<rect class="d-t2" x="1" y="22" width="6" height="4" rx="2"/><rect class="d-t2" x="57" y="22" width="6" height="4" rx="2"/><path class="d-t" d="M27.5 27q4.5-5 9 0v4q-4.5-4.5-9 0z"/>' +
    [4, 35].map((x) => `<rect class="d-t" x="${x}" y="20" width="25" height="22" rx="8"/><rect class="d-sky" x="${x + 3.5}" y="23.5" width="18" height="15" rx="5"/><path class="d-w" d="M${x + 6} 35l7-8.5h3.5l-7 8.5z" opacity=".75"/>`).join("") },
};
