// Physics, chemistry, earth science and maths: instruments, forces, weather and the shapes of numbers. Same hand as base.ts.
import type { DrawingSet } from "../types";

const r1 = (n: number) => Math.round(n * 10) / 10;
/** A test tube at x with its liquid (class c) filled up to y = lvl. */
const tube = (x: number, lvl: number, c: string) =>
  `<path class="d-glass" d="M${x} 9h9v35.5a4.5 4.5 0 0 1-9 0z"/><path class="${c}" d="M${x + 1} ${lvl}h7v${44.5 - lvl}a3.5 3.5 0 0 1-7 0z"/><rect class="d-w2" x="${x - 1}" y="7" width="11" height="3" rx="1.5"/>`;
/** One turn of a coil, back half or front half, centred on y. */
const coil = (y: number, front: boolean) =>
  `M19 ${y}a13 4.5 0 0 ${front ? 0 : 1} 26 0h-3a10 2 0 0 ${front ? 1 : 0}-20 0z`;
/** One band of a rainbow of outer radius r, centred on (32, 46). */
const band = (r: number, c: string) =>
  `<path class="${c}" d="M${r1(32 - r)} 46A${r} ${r} 0 0 1 ${r1(32 + r)} 46h-3.4A${r1(r - 3.4)} ${r1(r - 3.4)} 0 0 0 ${r1(32 - r + 3.4)} 46z"/>`;
/** A small puffy cloud whose flat bottom sits at y + 4. */
const puff = (x: number, y: number) => `M${x - 10} ${y + 4}a4.5 4.5 0 0 1 1.5-8.5a6 6 0 0 1 11.5-1a6 6 0 0 1 6 9.5z`;
/** A big cloud: its outline, shifted down by dy. */
const bigCloud = (dy: number) => `M12 ${30 + dy}a9 9 0 0 1 1-18a13 13 0 0 1 25-3a10 10 0 0 1 14 9a7 7 0 0 1-1 12z`;
const drip = (x: number, y: number) => `<path class="d-bl" d="M${x} ${y}q-3.5 5-3.5 7.5a3.5 3.5 0 0 0 7 0q0-2.5-3.5-7.5z"/>`;
/** The ticks of a protractor centred on (32, 50): a long one every 30 degrees. */
const ticks = Array.from({ length: 19 }, (_, i) => {
  const a = (i * 10 * Math.PI) / 180, r = i % 3 ? 23.5 : 20.5;
  return `M${r1(32 + 26.5 * Math.cos(a))} ${r1(50 - 26.5 * Math.sin(a))}L${r1(32 + r * Math.cos(a))} ${r1(50 - r * Math.sin(a))}`;
}).join("");
/** A row of five abacus beads on the rod at y, n of them pushed to the left. */
const beads = (y: number, n: number, c: string) =>
  `<g class="${c}">` + [0, 1, 2, 3, 4].map((i) => `<circle cx="${r1(i < n ? 15 + i * 6.8 : 49 - (4 - i) * 6.8)}" cy="${y}" r="3.4"/>`).join("") + "</g>";

export const SCIENCE: DrawingSet = {
  microscope: { also: ["a lens that magnifies", "magnification", "looking at something tiny", "a lab microscope", "zooming in", "a specimen slide"], tint: "#5f86b3", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="20" ry="2"/><path class="d-t" d="M37 51q8-10 5-21-1-5-5-9l5-5q7 6 8.5 14 1.5 12-5.5 21z"/><rect class="d-t2" x="12" y="50" width="40" height="7" rx="3.5"/>' +
    '<rect class="d-w2" x="33.5" y="42" width="3" height="8"/><circle class="d-y" cx="35" cy="45.5" r="2.6"/><rect class="d-dk" x="19" y="38" width="28" height="4" rx="1.5"/><rect class="d-sky" x="26" y="35.5" width="13" height="2.5" rx=".8"/>' +
    '<circle class="d-t2" cx="37" cy="19.5" r="4.5"/><circle class="d-t3" cx="46" cy="31" r="3.4"/><circle class="d-t2" cx="46" cy="31" r="1.4"/>' +
    '<g transform="rotate(-25 30 22)"><rect class="d-w2" x="27.5" y="29" width="5" height="7" rx="1"/><rect class="d-t" x="24.5" y="8" width="11" height="22" rx="2.5"/><rect class="d-t2" x="24.5" y="26" width="11" height="4" rx="1.5"/>' +
    '<rect class="d-t3" x="26.5" y="10.5" width="2.5" height="13" rx="1.2"/><rect class="d-dk" x="25" y="3" width="10" height="6.5" rx="1.5"/></g>' },
  telescope: { also: ["a spyglass", "stargazing", "astronomy", "an observatory", "looking far away", "seeing distant things"], tint: "#b79cf0", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="19" ry="2"/><path class="d-dk" d="M30.5 31L15 57h4.5L33 33zM33.5 31L49 57h-4.5L31 33z"/><rect class="d-dk2" x="30.8" y="32" width="2.4" height="25" rx="1"/><rect class="d-dk" x="27" y="27" width="10" height="6" rx="2"/>' +
    '<g transform="rotate(-28 32 26)"><rect class="d-dk" x="4" y="23" width="7" height="6" rx="1.5"/><rect class="d-t" x="10" y="20.5" width="38" height="11" rx="2"/><rect class="d-t3" x="13" y="22.5" width="30" height="2.5" rx="1.2"/>' +
    '<rect class="d-t2" x="25" y="20.5" width="4" height="11"/><rect class="d-t2" x="45" y="18.5" width="12" height="15" rx="2.5"/></g>' +
    '<path class="d-y" d="M14 5q1 6 7 7-6 1-7 7-1-6-7-7 6-1 7-7z"/><circle class="d-y" cx="26" cy="7" r="1.4"/>' },
  testtube: { also: ["a tube rack", "a rack of tubes", "samples", "specimens", "a chemistry set", "lab samples"], tint: "#7fd08a", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="25" ry="2"/><rect class="d-wood" x="8" y="18" width="4.5" height="36" rx="1.5"/><rect class="d-wood" x="51.5" y="18" width="4.5" height="36" rx="1.5"/><rect class="d-wood" x="5" y="50" width="54" height="6" rx="2.5"/>' +
    tube(13.5, 27, "d-pk") + tube(27.5, 22, "d-t") + tube(41.5, 31, "d-bl") +
    '<rect class="d-wood" x="6" y="17" width="52" height="6" rx="2"/><rect class="d-cream" x="8" y="18" width="48" height="1.5" rx=".7" opacity=".35"/>' },
  pendulum: { also: ["a swing back and forth", "a swinging weight", "a clock pendulum", "a bob on a string", "a period of motion", "harmonic motion"], tint: "#e0564f", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="26" ry="2"/><rect class="d-w2" x="9" y="7" width="4.5" height="46"/><rect class="d-w2" x="9" y="7" width="33" height="4.5" rx="2"/><rect class="d-w2" x="5" y="51" width="54" height="6" rx="3"/>' +
    '<path class="d-dash" d="M18.5 40.1A33 33 0 0 0 49.5 40.1" opacity=".6"/><path class="d-line thin tint" d="M34 11L45.3 42"/><circle class="d-dk" cx="34" cy="11" r="1.8"/>' +
    '<circle class="d-t" cx="45.3" cy="42" r="6.5"/><path class="d-t2" d="M51.8 42a6.5 6.5 0 0 1-12 3.5 6.5 6.5 0 0 0 8.8-9.2 6.5 6.5 0 0 1 3.2 5.7z"/><circle class="d-t3" cx="43" cy="39.7" r="1.8"/>' },
  spring: { also: ["a coil", "elasticity", "tension", "a bounce", "springiness", "hooke's law", "a shock absorber"], tint: "#63c2a2", svg:
    '<ellipse class="d-sh" cx="32" cy="59.5" rx="19" ry="2"/><rect class="d-w2" x="14" y="52" width="36" height="5.5" rx="2.5"/>' +
    '<g transform="rotate(-6 32 31)"><path class="d-t2" d="' + [15, 21.5, 28, 34.5, 41, 47.5].map((y) => coil(y, false)).join("") + '"/>' +
    '<path class="d-t" d="' + [15, 21.5, 28, 34.5, 41, 47.5].map((y) => coil(y, true)).join("") + '"/></g>' +
    '<rect class="d-w2" x="14" y="5" width="36" height="5.5" rx="2.5"/><rect class="d-w" x="17" y="6.2" width="14" height="1.6" rx=".8"/>' },
  pulley: { also: ["a wheel and rope", "a hoist", "lifting a load", "a lifting wheel", "a block and tackle", "a winch"], tint: "#8e929c", svg:
    '<ellipse class="d-sh" cx="44" cy="58.5" rx="10" ry="1.8"/><rect class="d-wood" x="5" y="4" width="54" height="6" rx="2"/><rect class="d-w2" x="30" y="9" width="4" height="15"/>' +
    '<circle class="d-t" cx="32" cy="24" r="12"/><circle class="d-t2" cx="32" cy="24" r="8.5"/><circle class="d-t" cx="32" cy="24" r="5.5"/><circle class="d-w2" cx="32" cy="24" r="2.6"/><path class="d-t3" d="M22.5 19a10.5 10.5 0 0 1 6-5.5l.6 1.5a9 9 0 0 0-5.1 4.7z"/>' +
    '<path class="d-wood" d="M19 51V24a13 13 0 0 1 26 0v15h-2V24a11 11 0 0 0-22 0v27z"/><rect class="d-rd" x="17.5" y="49" width="5" height="7" rx="2"/>' +
    '<path class="d-t2" d="M37 57l2.5-16h9l2.5 16z"/><path class="d-dk" d="M44 41h4.5l2.5 16h-7z" opacity=".5"/><rect class="d-w3" x="40" y="47" width="8" height="2.2" rx="1"/>' },
  seesaw: { also: ["a lever", "a fulcrum", "a teeter-totter", "a pivot", "leverage", "a tipping point", "balancing weights"], tint: "#f0a94b", svg:
    '<ellipse class="d-sh" cx="32" cy="56.5" rx="22" ry="2"/><path class="d-t2" d="M32 30l11.5 26h-23z"/><path class="d-sh" d="M32 30l11.5 26H32z"/>' +
    '<g transform="rotate(-10 32 30)"><rect class="d-bl" x="7" y="12" width="14" height="13" rx="2"/><rect class="d-bl2" x="16" y="12" width="5" height="13" rx="1.5"/>' +
    '<rect class="d-pk" x="46" y="18" width="8" height="7" rx="1.5"/><rect class="d-t" x="3" y="25" width="58" height="5.5" rx="2.5"/><rect class="d-t2" x="3" y="28.5" width="58" height="2" rx="1"/></g>' +
    '<circle class="d-dk" cx="32" cy="31.5" r="1.6"/>' },
  prism: { also: ["light splitting", "a spectrum", "refraction", "white light into colours", "a glass prism", "optics", "dispersion"], tint: "#7fbfe6", svg:
    '<ellipse class="d-sh" cx="30" cy="56.5" rx="22" ry="2"/>' +
    [["d-rd", 27, 31.5], ["d-or", 31.5, 36], ["d-y", 36, 40.5], ["d-gr", 40.5, 45], ["d-bl", 45, 49.5], ["d-pu", 49.5, 54]].map(([c, a, b]) => `<path class="${c}" d="M32 37L62 ${a}V${b}z"/>`).join("") +
    '<path class="d-w2" d="M1.5 47l17.5-12.6 1 2.4L2.5 50z"/><path class="d-w" d="M2 47.8l17.2-12.3.4 1L2.5 49z"/>' +
    '<path class="d-t3" d="M30 14L51 54H9z"/><path class="d-t" d="M30 14l21 40h-9z"/>' +
    '<path class="d-w" d="M19 34.6L32 36v2l-12.3-1.2z" opacity=".6"/>' },
  rainbow: { also: ["colours of light", "a colour arc", "after the rain", "the colours of the spectrum", "a bow in the sky", "hope"], tint: "#ee8f86", svg:
    band(28, "d-rd") + band(24.6, "d-or") + band(21.2, "d-y") + band(17.8, "d-gr") + band(14.4, "d-bl") + band(11, "d-pu") +
    `<path class="d-w2" d="${puff(11, 48.5)}${puff(53, 48.5)}"/><path class="d-w" d="${puff(11, 47)}${puff(53, 47)}"/>` },
  volcano: { also: ["an eruption", "lava", "magma", "a volcanic mountain", "an explosion", "a blow-up", "plate tectonics"], tint: "#9a6b4b", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="28" ry="2"/><path class="d-t" d="M3 58L22 24h20l19 34z"/><path class="d-t2" d="M36 24h6l19 34H45z"/>' +
    '<path class="d-or" d="M22 24h20l2.5 4.5c-1.5 1.5-3 1.2-4-.3.2 5.5-1 9.5-3 9.5s-2.6-4-2.6-7.5c-.6 6.5-1.8 13-4.3 13s-3-7-2.4-13c-1.5 2.2-3.5 2.6-5.6.4z"/>' +
    '<path class="d-rd" d="M25 24c-3-6-1-11 3-13.5 1 3 2 4 4 4s3-1 4-4c4 2.5 6 7.5 3 13.5z"/><path class="d-y" d="M28.5 24c-1.5-3-.5-6 1.5-7.5.5 1.5 1 2 2 2s1.5-.5 2-2c2 1.5 3 4.5 1.5 7.5z"/>' +
    '<circle class="d-or" cx="18" cy="12" r="2.6"/><circle class="d-rd" cx="46" cy="10" r="2.4"/><circle class="d-or" cx="41" cy="3.5" r="1.8"/><circle class="d-rd" cx="22" cy="4.5" r="1.6"/>' },
  lightning: { also: ["a thunderstorm", "a storm", "a lightning bolt", "a spark", "a flash", "a power surge", "thunder", "static electricity"], tint: "#f6c945", svg:
    `<path class="d-w2" d="${bigCloud(2.5)}"/><path class="d-dk" d="${bigCloud(4)}"/><path class="d-dk2" d="M12 34a7 7 0 0 1-6-4.5h46a7 7 0 0 1-1 4.5z"/>` +
    '<path class="d-t2" d="M38 28l-14 19h9l-6 15 19-23h-9l7-11z" transform="translate(1.5 1)"/><path class="d-t" d="M38 28l-14 19h9l-6 15 19-23h-9l7-11z"/>' },
  snowflake: { also: ["snow", "ice", "winter", "frozen", "freezing", "an ice crystal", "something unique", "cold weather"], tint: "#6fb8ea", svg:
    '<g class="d-line thick tint">' + [0, 60, 120, 180, 240, 300].map((a) => `<path d="M32 32V5M32 12.5l-5.5-5.5M32 12.5l5.5-5.5M32 21l-7-6.5M32 21l7-6.5"${a ? ` transform="rotate(${a} 32 32)"` : ""}/>`).join("") +
    '</g><circle class="d-t" cx="32" cy="32" r="5.5"/><circle class="d-t3" cx="32" cy="32" r="2.5"/>' },
  raincloud: { also: ["rainy weather", "a shower", "a rain cloud", "precipitation", "a grey sky", "drizzle", "the water cycle"], tint: "#7d8fa8", svg:
    `<path class="d-t2" d="${bigCloud(4.5)}"/><path class="d-t" d="${bigCloud(2)}"/><circle class="d-t3" cx="20" cy="19" r="3"/><circle class="d-t3" cx="27" cy="14.5" r="1.8"/>` +
    drip(20, 39) + drip(32, 42) + drip(44, 39) + drip(26, 50.5) + drip(38, 51.5) },
  calculator: { also: ["arithmetic", "sums", "a calculation", "adding up", "maths", "working out the answer", "a pocket calculator"], tint: "#4b4f58", svg:
    '<ellipse class="d-sh" cx="32" cy="59.5" rx="20" ry="2"/><rect class="d-t" x="12" y="4" width="40" height="54" rx="5"/><rect class="d-t2" x="12" y="52" width="40" height="6" rx="3"/>' +
    '<rect class="d-gr" x="17" y="9" width="30" height="12" rx="2"/><path class="d-line thin" d="M36 12.5l1.5-1v7M40.5 12.5h4v3h-4v3h4"/>' +
    [25, 32, 39, 46].map((y) => [17, 25, 33, 41].map((x) => `<rect class="${x === 41 ? "d-or" : y === 25 ? "d-w2" : "d-w3"}" x="${x}" y="${y}" width="6" height="5" rx="1.5"/>`).join("")).join("") },
  shapes: { also: ["geometry", "a triangle", "flat shapes", "a square", "polygons", "basic shapes", "a shape sorter"], tint: "#ee8f86", svg:
    '<ellipse class="d-sh" cx="32" cy="57.5" rx="26" ry="2"/><path class="d-y" d="M30 4l16 28H14z"/><path class="d-y2" d="M14 32h32l-2.3-4H16.3z"/>' +
    '<rect class="d-bl" x="6" y="30" width="25" height="25" rx="2.5"/><rect class="d-bl2" x="6" y="50.5" width="25" height="4.5" rx="2"/>' +
    '<circle class="d-t" cx="45" cy="42" r="13"/><path class="d-t2" d="M58 42a13 13 0 0 1-23.5 7.7 13 13 0 0 0 21.6-14.5A13 13 0 0 1 58 42z"/><circle class="d-t3" cx="40" cy="36.5" r="2.4"/>' },
  protractor: { also: ["an angle", "measuring angles", "degrees", "a half circle", "geometry tools", "trigonometry"], tint: "#f3c84b", svg:
    '<ellipse class="d-sh" cx="32" cy="57.5" rx="28" ry="2"/><path class="d-t" d="M4 50A28 28 0 0 1 60 50z"/><path class="d-t3" d="M19 50a13 13 0 0 1 26 0z"/><rect class="d-t2" x="3" y="49.5" width="58" height="5" rx="2"/>' +
    `<path class="d-line thin" d="${ticks}"/><path class="d-pk" d="M32 50h11a11 11 0 0 0-5.5-9.5z"/><path class="d-line" d="M32 50l13-22.5"/><circle class="d-rd" cx="32" cy="50" r="2"/>` },
  abacus: { also: ["counting", "counting beads", "an old calculator", "place value", "tens and ones", "a counting frame"], tint: "#e0564f", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="26" ry="2"/><rect class="d-wood" x="6" y="7" width="5" height="49" rx="1.5"/><rect class="d-wood" x="53" y="7" width="5" height="49" rx="1.5"/>' +
    '<path class="d-line grey" d="M11 17h42M11 25.5h42M11 34h42M11 42.5h42"/>' + beads(17, 3, "d-t") + beads(25.5, 1, "d-y") + beads(34, 4, "d-gr") + beads(42.5, 2, "d-bl") +
    '<rect class="d-wood" x="4" y="6" width="56" height="5" rx="2.5"/><rect class="d-wood" x="4" y="49" width="56" height="6" rx="2.5"/>' },
  linechart: { also: ["a line graph", "data over time", "a rising line", "a time series", "a plot of points", "progress over time", "going up"], tint: "#63c2a2", svg:
    '<path class="d-line thin2" d="M9 20h50M9 32h50M9 44h50" opacity=".5"/><path class="d-t3" d="M12 45L22 36l10 4 10-13L53 13V55H12z" opacity=".45"/><path class="d-line grey" d="M7 6v50h52"/>' +
    '<path class="d-line thick tint" d="M12 45L22 36l10 4 10-13L53 13"/>' +
    [[12, 45], [22, 36], [32, 40], [42, 27], [53, 13]].map(([x, y]) => `<circle class="d-t" cx="${x}" cy="${y}" r="3.4"/><circle class="d-w" cx="${x}" cy="${y}" r="1.5"/>`).join("") },
};
