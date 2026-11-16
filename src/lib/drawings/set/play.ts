// The arts, games and sport: making, performing, playing and keeping score. Same hand as base.ts.
import type { DrawingSet } from "../types";

/** A number to one decimal place, as the drawings write them. */
const n = (v: number) => +v.toFixed(1);

/** A theatre mask's face, centred on 0, 0: wide at the brow, narrowing to the chin. */
const mask = "M-14-13q0-4 4-4.6 10-2.2 20 0 4 .6 4 4.6v7q0 19-14 24-14-5-14-24z";

export const PLAY: DrawingSet = {
  palette: { also: ["a paint palette", "painting", "an art class", "paints", "mixing colours", "a painter"], tint: "#c9935b", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="24" ry="2"/>' +
    '<path class="d-t2" d="M32 10c-15 0-27 10-27 23s11 23 25 23c5 0 7-3 6-7-1-4 2-7 6-7h6c7 0 11-4 11-10C59 20 47 10 32 10z"/>' +
    '<path class="d-t" d="M32 8c-15 0-27 10-27 23s11 22 25 22c5 0 7-3 6-7-1-4 2-7 6-7h6c7 0 11-4 11-10C59 18 47 8 32 8z"/>' +
    '<ellipse class="d-t2" cx="17" cy="40" rx="4.5" ry="4"/><path class="d-t3" d="M16 14q8-4 16-4v3q-8 0-14 3z"/>' +
    '<circle class="d-rd" cx="15" cy="27" r="4.5"/><circle class="d-y" cx="24" cy="18.5" r="4.5"/><circle class="d-bl" cx="36" cy="16" r="4.5"/><circle class="d-gr" cx="47" cy="21" r="4.5"/>' +
    '<g transform="rotate(-45 44 44)"><rect class="d-wood" x="42" y="40" width="4" height="22" rx="2"/><rect class="d-w2" x="41.5" y="34" width="5" height="7" rx="1"/><path class="d-pu" d="M41.5 34q0-6 2.5-10 2.5 4 2.5 10z"/></g>' },
  music: { also: ["a song", "a tune", "a melody", "a musical note", "a soundtrack", "a sound to play"], tint: "#b79cf0", svg:
    '<path class="d-t2" d="M23.5 16l29.5-6v8l-29.5 6z"/><rect class="d-t" x="23.5" y="16" width="3.5" height="33"/><rect class="d-t" x="49.5" y="10" width="3.5" height="33"/><path class="d-t" d="M23.5 16l29.5-6v4l-29.5 6z"/>' +
    '<ellipse class="d-t" cx="19" cy="49" rx="8" ry="6" transform="rotate(-20 19 49)"/><ellipse class="d-t" cx="45" cy="43" rx="8" ry="6" transform="rotate(-20 45 43)"/>' +
    '<ellipse class="d-t3" cx="16.5" cy="47.5" rx="3" ry="1.8" transform="rotate(-20 16.5 47.5)"/><ellipse class="d-t3" cx="42.5" cy="41.5" rx="3" ry="1.8" transform="rotate(-20 42.5 41.5)"/>' },
  guitar: { also: ["an acoustic guitar", "an instrument", "a band", "strumming", "a string instrument", "a rock song"], tint: "#f0a94b", svg:
    '<ellipse class="d-sh" cx="30" cy="59" rx="20" ry="2"/><g transform="rotate(35 32 30)">' +
    '<circle class="d-t2" cx="33.5" cy="45.5" r="13"/><circle class="d-t2" cx="33.5" cy="27.5" r="10"/><circle class="d-t" cx="32" cy="44" r="13"/><circle class="d-t" cx="32" cy="26" r="10"/>' +
    '<rect class="d-wood" x="29.5" y="2" width="5" height="30" rx="1"/><g class="d-w2"><circle cx="27" cy="-1" r="1.4"/><circle cx="27" cy="3" r="1.4"/><circle cx="37" cy="-1" r="1.4"/><circle cx="37" cy="3" r="1.4"/></g><rect class="d-t2" x="28" y="-4" width="8" height="10" rx="2"/>' +
    '<circle class="d-dk2" cx="32" cy="34" r="5"/><rect class="d-dk2" x="25" y="46" width="14" height="3.5" rx="1.7"/><path class="d-line thin2" d="M31 2v46M33 2v46"/></g>' },
  piano: { also: ["piano keys", "a keyboard instrument", "black and white keys", "playing the piano", "a grand piano", "practice"], tint: "#4b4f58", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="26" ry="2"/><rect class="d-t2" x="9" y="48" width="5" height="10" rx="1.5"/><rect class="d-t2" x="50" y="48" width="5" height="10" rx="1.5"/>' +
    '<rect class="d-t" x="4" y="12" width="56" height="38" rx="4"/><rect class="d-t3" x="4" y="12" width="56" height="5" rx="2.5"/><rect class="d-rd" x="8" y="21" width="48" height="2.5"/>' +
    '<rect class="d-w" x="8" y="23.5" width="48" height="22" rx="1.5"/>' +
    `<path class="d-line thin2" d="${[1, 2, 3, 4, 5, 6].map((k) => `M${n(8 + 6.86 * k)} 24v21`).join("")}"/>` +
    [1, 2, 4, 5, 6].map((k) => `<rect class="d-ink" x="${n(8 + 6.86 * k - 2.2)}" y="23.5" width="4.4" height="13" rx="1"/>`).join("") },
  drum: { also: ["a beat", "rhythm", "a drum kit", "a drummer", "a drumbeat", "a marching band", "a tempo"], tint: "#5f86b3", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="24" ry="2"/>' +
    '<g transform="rotate(-38 22 16)"><rect class="d-wood" x="20.5" y="2" width="3.4" height="27" rx="1.7"/><circle class="d-cream" cx="22.2" cy="29" r="2.6"/></g>' +
    '<path class="d-t" d="M10 30v19a22 7 0 0 0 44 0v-19z"/><path class="d-t2" d="M54 30v19a22 7 0 0 1-10 5.9v-19a22 7 0 0 0 10-5.9z"/>' +
    '<path class="d-line yel" d="M13 35l8 15 8-15 8 15 8-15 7 13"/>' +
    '<path class="d-w2" d="M10 46.5a22 7 0 0 0 44 0v3a22 7 0 0 1-44 0z"/><ellipse class="d-w2" cx="32" cy="30" rx="22" ry="7"/><ellipse class="d-w" cx="32" cy="29.3" rx="20" ry="5.6"/>' +
    '<g transform="rotate(38 42 16)"><rect class="d-wood" x="40.3" y="2" width="3.4" height="27" rx="1.7"/><circle class="d-cream" cx="42" cy="29" r="2.6"/></g>' },
  masks: { also: ["drama", "a play", "the theatre", "acting", "comedy and tragedy", "a performance", "a stage show"], tint: "#f3c14b", svg:
    `<g transform="translate(42 36) rotate(14)"><path class="d-bl" d="${mask}"/><path class="d-bl2" d="M0 -18.5q8 0 10 1.5 4 .6 4 4.6v7q0 19-14 24z" opacity=".5"/>` +
    '<path class="d-ink" d="M-2.5-6q-4-.5-7 4 5 .5 7-4zM2.5-6q4-.5 7 4-5 .5-7-4zM-7 12q7-10 14 0-7-4-14 0z"/></g>' +
    `<g transform="translate(22 28) rotate(-14)"><path class="d-t" d="${mask}"/><path class="d-t2" d="M0 -18.5q8 0 10 1.5 4 .6 4 4.6v7q0 19-14 24z" opacity=".5"/><path class="d-t3" d="M-10-14q6-1.5 10-1.5v3q-5 0-10 1.5z"/>` +
    '<path class="d-ink" d="M-10-4q3.5-5 7 0-3.5-2-7 0zM3-4q3.5-5 7 0-3.5-2-7 0zM-8 4q8 11 16 0-8 3.5-16 0z"/><circle class="d-blush" cx="-9" cy="3" r="2.4"/><circle class="d-blush" cx="9" cy="3" r="2.4"/></g>' },
  speech: { also: ["a speech bubble", "talking", "a conversation", "a chat", "a chat message", "a reply", "a comment", "someone typing"], tint: "#7fbfe6", svg:
    '<path class="d-t2" d="M12 11h40q6 0 6 6v23q0 6-6 6h-23l-12 10v-10h-5q-6 0-6-6v-23q0-6 6-6z"/>' +
    '<path class="d-t" d="M12 8h40q6 0 6 6v23q0 6-6 6h-23l-12 10v-10h-5q-6 0-6-6v-23q0-6 6-6z"/><path class="d-t3" d="M10 14q0-3 3-3h12v3h-12q-1 0-1 1v6h-2z"/>' +
    '<circle class="d-w" cx="20" cy="26" r="4"/><circle class="d-w" cx="32" cy="26" r="4"/><circle class="d-w" cx="44" cy="26" r="4"/>' },
  whistle: { also: ["a referee's whistle", "a signal to stop", "a foul", "a penalty", "half time", "the end of the game", "blowing the whistle"], tint: "#8e929c", svg:
    '<ellipse class="d-sh" cx="30" cy="59" rx="22" ry="2"/><path class="d-line yel" d="M28 9v6M36.5 10.5l-3 5M20 11.5l3 4.5"/>' +
    '<path class="d-rd" d="M9 23a6 6 0 1 1 0 12a6 6 0 1 1 0-12zM9 26a3 3 0 1 0 0 6a3 3 0 1 0 0-6z"/>' +
    '<circle class="d-t2" cx="25" cy="41" r="16"/><circle class="d-t" cx="24" cy="40" r="15.5"/><rect class="d-t" x="22" y="24.5" width="37" height="13" rx="3"/><rect class="d-t2" x="22" y="34" width="37" height="3.5" rx="1.5"/>' +
    '<rect class="d-dk2" x="27" y="24.5" width="9" height="5" rx="1"/><path class="d-t3" d="M13 37a11 11 0 0 1 6-8l1.5 2.5a8 8 0 0 0-4.5 6z"/><rect class="d-t3" x="40" y="27.5" width="15" height="2.5" rx="1.2"/>' },
  stopwatch: { also: ["timing", "a race", "a lap time", "how long it takes", "a countdown", "a benchmark", "a personal best"], tint: "#63c2a2", svg:
    '<ellipse class="d-sh" cx="32" cy="60" rx="18" ry="2"/><rect class="d-t2" x="29" y="8" width="6" height="8"/><rect class="d-t" x="24" y="3.5" width="16" height="6" rx="2"/>' +
    '<rect class="d-t2" x="47" y="13" width="6" height="7" rx="1.5" transform="rotate(45 50 16.5)"/>' +
    '<circle class="d-t2" cx="33" cy="38" r="21"/><circle class="d-t" cx="32" cy="37" r="21"/><circle class="d-w" cx="32" cy="37" r="16.5"/>' +
    '<path class="d-t3" d="M32 37V20.5a16.5 16.5 0 0 1 14.3 8.3z"/><path class="d-line thin" d="M32 21.5v3M32 49.5v3M16.5 37h3M44.5 37h3"/><path class="d-line" d="M32 37l12.5-7"/><circle class="d-rd" cx="32" cy="37" r="2.4"/>' },
  shoe: { also: ["a trainer", "a running shoe", "a sneaker", "running", "a jog", "a footstep", "sport"], tint: "#e07f73", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="27" ry="2"/>' +
    '<path class="d-t" d="M7 46v-18q0-4 4-4h9q3 0 4 3 2 5 9 6l13 3q12 3 13 10z"/><path class="d-t2" d="M7 28v18h7v-18q0-4-3-4z"/><path class="d-dk2" d="M11 24h9q3 0 4 3l-2 1q-1-1.5-3-1.5h-8z"/>' +
    '<path class="d-t2" d="M43 35.3l3 .7q12 3 13 10h-10q-1-6-6-10.7z"/>' +
    '<path class="d-w" d="M16 42l10-9h5l-10 9zM25 42l9-7.5h4.5l-9 7.5z"/><path class="d-line white" d="M23.5 30.5l2.5-2.5M28 33l2.5-2.5"/>' +
    '<path class="d-w" d="M5 46h55q0 7-6 7h-45q-4 0-4-4z"/><rect class="d-w2" x="5" y="50" width="55" height="3" rx="1.5"/>' },
  chess: { also: ["a chess knight", "strategy", "a board game", "a chess piece", "a clever move", "a tactic", "a pawn", "thinking ahead"], tint: "#9a7652", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="26" ry="2"/>' +
    '<circle class="d-cream" cx="50" cy="32" r="5.5"/><path class="d-cream" d="M46 38h8l3 13h-14z"/><rect class="d-cream" x="42" y="50" width="16" height="7" rx="2.5"/><path class="d-w2" d="M51 38h3l3 13h-4z"/><rect class="d-w2" x="42" y="54" width="16" height="3" rx="1.5"/>' +
    '<path class="d-t" d="M13 46c0-8 4-13 10-17l-8 2q-4 1-6-2l-2-3q-1-2 1-4l12-11q2-6 6-7l1 4q14 2 15 22l1 16z"/>' +
    '<path class="d-t2" d="M27 9q14 2 15 22l1 15h-6l-1-15q-1-17-9-21z"/><circle class="d-ink" cx="22" cy="18.5" r="1.8"/><path class="d-t3" d="M12 23l10-9 1.5 1.5-10 9z"/>' +
    '<rect class="d-t2" x="10" y="44" width="36" height="5" rx="2"/><rect class="d-t" x="6" y="49" width="44" height="8" rx="3"/><rect class="d-t2" x="6" y="54" width="44" height="3" rx="1.5"/>' },
  kite: { also: ["a flying kite", "the wind", "a breeze", "a windy day", "flying high", "something on a string"], tint: "#7fd08a", svg:
    '<path class="d-line thin" d="M31 44q-7 3-3 8t-9 8"/>' +
    '<path class="d-pk" d="M22.8 45v5l8-5v5zM22.8 54v5l8-5v5z"/>' +
    '<g transform="rotate(25 40 24)"><path class="d-t" d="M40 4l-15 14 15 0z"/><path class="d-y" d="M40 4l15 14-15 0z"/><path class="d-y" d="M25 18l15 28v-28z"/><path class="d-t" d="M55 18l-15 28v-28z"/>' +
    '<path class="d-line thin" d="M40 5v40M26 18h28"/></g>' },
  balloon: { also: ["a party balloon", "a party", "a celebration", "floating up", "a hot air balloon", "something light"], tint: "#e0564f", svg:
    '<path class="d-line thin" d="M32 46q-5 4 0 8t-1 8"/><path class="d-t2" d="M32 42l-3 5h6z"/>' +
    '<ellipse class="d-t" cx="32" cy="24" rx="18" ry="21"/><path class="d-t2" d="M41 6.2a18 21 0 0 1-9 38.8 16 20 0 0 0 9-38.8z"/>' +
    '<ellipse class="d-t3" cx="24" cy="14" rx="3.5" ry="6" transform="rotate(28 24 14)"/>' },
  goal: { also: ["a football goal", "scoring", "an aim", "an objective", "a score", "the back of the net", "a match"], tint: "#f4f5f7", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="28" ry="2"/><rect class="d-gr2" x="2" y="50" width="60" height="7" rx="3"/>' +
    '<rect class="d-dk2" x="10" y="15" width="44" height="37" opacity=".35"/>' +
    `<path class="d-line thin2" d="${[16, 22, 28, 34, 40, 46].map((x) => `M${x} 15v37`).join("")}${[21, 27, 33, 39, 45].map((y) => `M10 ${y}h44`).join("")}"/>` +
    '<circle class="d-w" cx="42" cy="45" r="6"/><path class="d-ink" d="M42 42.5l2.4 1.7-.9 2.8h-3l-.9-2.8z"/>' +
    '<path class="d-t2" d="M7.5 54v-39.5q0-3 3-3h46q3 0 3 3v39.5h-4.5v-38h-43v38z"/><path class="d-t" d="M6 54v-41q0-3 3-3h46q3 0 3 3v41h-4.5v-39.5h-43v39.5z"/><path class="d-t2" d="M10.5 14.5h43v2h-43zM6 52h4.5v2h-4.5zM53.5 52h4.5v2h-4.5z"/>' },
};
