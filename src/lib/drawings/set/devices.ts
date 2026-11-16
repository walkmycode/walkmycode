// Devices and the digital everyday: the hardware people touch, and the things that prove who they are. Same hand as base.ts.
import type { DrawingSet } from "../types";

const r1 = (v: number) => +v.toFixed(1);
/** A row of n keys, h tall, spread from x0 to x1 with a small gap, as one path. */
const keys = (x0: number, x1: number, y: number, n: number, h = 5) => {
  const p = (x1 - x0 + 1.4) / n;
  return Array.from({ length: n }, (_, i) => `M${r1(x0 + i * p)} ${y}h${r1(p - 1.4)}v${h}h-${r1(p - 1.4)}z`).join("");
};
/** Small squares of side s at the given corners, as one path. */
const dots = (pts: number[][], s: number) => pts.map(([x, y]) => `M${x} ${y}h${s}v${s}h-${s}z`).join("");
/** A QR finder square: ring and centre. */
const finder = (x: number, y: number) =>
  `<rect class="d-t" x="${x}" y="${y}" width="15" height="15" rx="2"/><rect class="d-w" x="${x + 2.5}" y="${y + 2.5}" width="10" height="10" rx="1"/><rect class="d-t" x="${x + 5}" y="${y + 5}" width="5" height="5" rx=".8"/>`;
/** A drone rotor: blurred disc, blade and hub. */
const rotor = (x: number, y: number, a: number) =>
  `<circle class="d-w3" cx="${x}" cy="${y}" r="10" opacity=".45"/><rect class="d-w2" x="${x - 9}" y="${y - 1.3}" width="18" height="2.6" rx="1.3" transform="rotate(${a} ${x} ${y})"/><circle class="d-dk" cx="${x}" cy="${y}" r="3"/>`;

export const DEVICES: DrawingSet = {
  keyboard: { also: ["a computer keyboard", "typing", "a qwerty keyboard", "keystrokes", "user input", "the keys you type on"], tint: "#4b4f58", svg:
    '<ellipse class="d-sh" cx="32" cy="57.5" rx="28" ry="2"/><path class="d-t2" d="M4 46h56v5q0 3-3 3h-50q-3 0-3-3z"/><path class="d-t" d="M14 13h36q3 0 3.6 2.8l6.4 30.2h-56l6.4-30.2q.6-2.8 3.6-2.8z"/>' +
    `<path class="d-w3" d="${keys(14, 50, 17, 7)}${keys(12, 52, 24, 7)}${keys(10, 54, 31, 7)}M8.5 38h7v5.5h-7zM48.5 38h7v5.5h-7z"/><path class="d-w" d="M17 38h30v5.5h-30z"/><rect class="d-or" x="48.9" y="31" width="5.1" height="5"/>` },
  mouse: { also: ["a computer mouse", "clicking", "a pointing device", "a mouse click", "scrolling", "a scroll wheel"], tint: "#e9e4d8", svg:
    '<ellipse class="d-sh" cx="32" cy="59.5" rx="14" ry="2"/><path class="d-line thick tint" d="M32 22v-5q0-6 6-6h9q5 0 5-5v-2"/>' +
    '<path class="d-t" d="M32 21c8.5 0 13.5 6 13.5 16v7c0 9-6 14.5-13.5 14.5s-13.5-5.5-13.5-14.5v-7c0-10 5-16 13.5-16z"/><path class="d-t2" d="M45.5 38v6c0 9-6 14.5-13.5 14.5 5.5-2 9.5-7 9.5-14.5v-6z"/>' +
    '<path class="d-t2" d="M31.3 21.5h1.4v14h-1.4zM19 35.5h26v1.4h-26z"/><ellipse class="d-t3" cx="24.5" cy="28.5" rx="2" ry="4" transform="rotate(25 24.5 28.5)"/><rect class="d-dk" x="29.8" y="25" width="4.4" height="8" rx="2.2"/>' },
  printer: { also: ["printing", "a print job", "a printout", "a paper copy", "a print queue", "a photocopier"], tint: "#8e929c", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="25" ry="2"/><rect class="d-w" x="17" y="5" width="30" height="16" rx="1.5"/><rect class="d-w2" x="21" y="9" width="16" height="2.5" rx="1.2"/>' +
    '<rect class="d-t" x="5" y="17" width="54" height="28" rx="5"/><rect class="d-t3" x="5" y="17" width="54" height="5" rx="2.5"/><rect class="d-t2" x="5" y="38" width="54" height="7" rx="3"/>' +
    '<rect class="d-sky" x="40" y="25" width="12" height="6" rx="1.5"/><circle class="d-gr" cx="13" cy="28" r="2.2"/><rect class="d-dk" x="13" y="36" width="38" height="4.5" rx="2"/>' +
    '<path class="d-w" d="M16 38.5h32v16.5q0 2-2 2h-28q-2 0-2-2z"/><rect class="d-w2" x="20" y="44" width="24" height="2.5" rx="1.2"/><rect class="d-w2" x="20" y="49.5" width="16" height="2.5" rx="1.2"/>' },
  harddrive: { also: ["a hard disk", "a disk", "a hard drive", "disk storage", "saving to disk", "an ssd", "a drive"], tint: "#6fa3b8", svg:
    '<ellipse class="d-sh" cx="32" cy="60" rx="22" ry="2"/><rect class="d-t2" x="8" y="6" width="48" height="53" rx="4.5"/><rect class="d-t" x="8" y="4" width="48" height="53" rx="4.5"/>' +
    '<circle class="d-t2" cx="12.5" cy="8.5" r="1.6"/><circle class="d-t2" cx="51.5" cy="8.5" r="1.6"/><circle class="d-t2" cx="12.5" cy="52.5" r="1.6"/><circle class="d-t2" cx="51.5" cy="52.5" r="1.6"/>' +
    '<circle class="d-w2" cx="32" cy="27" r="19.5"/><circle class="d-w3" cx="32" cy="27" r="17.5"/><path class="d-line white" d="M19.5 22a13.5 13.5 0 0 1 8-8"/><circle class="d-w2" cx="32" cy="27" r="6"/><circle class="d-dk" cx="32" cy="27" r="2.8"/>' +
    '<path class="d-dk" d="M47.4 48.9l-13-17.2-2.8 2.1 13 17.2z"/><circle class="d-dk" cx="33" cy="32.8" r="2.4"/><circle class="d-dk2" cx="46" cy="50" r="5"/><circle class="d-w2" cx="46" cy="50" r="2"/>' },
  ram: { also: ["a memory module", "random access memory", "working memory", "short-term memory", "a dimm", "memory chips"], tint: "#4e9f63", svg:
    '<ellipse class="d-sh" cx="32" cy="56" rx="27" ry="2"/><path class="d-t" d="M3 16q0-2 2-2h54q2 0 2 2v34h-25v-4h-4.5v4h-28.5z"/><rect class="d-t3" x="3" y="14" width="58" height="3.5" rx="1.7"/>' +
    '<g class="d-dk">' + [6.5, 20, 33.5, 47].map((x) => `<rect x="${x}" y="20" width="10.5" height="15" rx="1.2"/>`).join("") + '</g>' +
    '<g class="d-dk2">' + [6.5, 20, 33.5, 47].map((x) => `<rect x="${x}" y="31.5" width="10.5" height="3.5"/>`).join("") + '</g>' +
    `<path class="d-y" d="${[5, 8.5, 12, 15.5, 19, 22.5, 26, 38, 41.5, 45, 48.5, 52, 55.5].map((x) => `M${x} 42h2.2v7h-2.2z`).join("")}"/>` },
  usb: { also: ["a usb stick", "a flash drive", "a thumb drive", "a memory stick", "a pen drive", "a dongle"], tint: "#f0a94b", svg:
    '<ellipse class="d-sh" cx="32" cy="59.5" rx="15" ry="2"/><rect class="d-w2" x="23" y="4" width="18" height="17" rx="1.5"/><rect class="d-dk" x="26.5" y="8" width="4" height="3.5"/><rect class="d-dk" x="33.5" y="8" width="4" height="3.5"/>' +
    '<rect class="d-t" x="17" y="18" width="30" height="40" rx="6"/><path class="d-t2" d="M39 18h2q6 0 6 6v28q0 6-6 6h-2z"/><rect class="d-t3" x="20.5" y="22" width="3" height="18" rx="1.5"/>' +
    '<path class="d-w" d="M32 23.5l4 6h-2.8v15.5h-2.4v-15.5h-2.8z"/><path class="d-line white" d="M32 41l-6-3.5v-4.5M32 38l6-3.5v-3"/><circle class="d-w" cx="26" cy="31.5" r="2.4"/><rect class="d-w" x="36.2" y="28" width="3.6" height="3.6"/><circle class="d-w" cx="32" cy="47" r="3"/>' },
  tablet: { also: ["a tablet computer", "a touchscreen", "an e-reader", "a touch screen device", "a slate", "swiping"], tint: "#4b4f58", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="27" ry="2"/><rect class="d-t2" x="3" y="12" width="58" height="42" rx="5.5"/><rect class="d-t" x="3" y="10" width="58" height="42" rx="5.5"/>' +
    '<rect class="d-sky" x="7.5" y="14.5" width="46" height="33" rx="1.5"/><circle class="d-y" cx="43" cy="24.5" r="4.5"/><path class="d-gr" d="M7.5 47.5v-6l12-12 9 9 7-6 18 15z"/><path class="d-gr2" d="M7.5 47.5v-6l12-12 4 4-10 14z"/>' +
    '<circle class="d-t3" cx="57.3" cy="31" r="1.8"/>' },
  watch: { also: ["a smartwatch", "a wristwatch", "a wearable", "a fitness tracker", "a smart watch", "on your wrist"], tint: "#63c2a2", svg:
    '<rect class="d-t2" x="21" y="3" width="22" height="16" rx="3"/><rect class="d-t2" x="21" y="45" width="22" height="16" rx="3"/><rect class="d-t" x="21" y="3" width="22" height="4" rx="2"/><rect class="d-t3" x="27" y="54" width="10" height="3" rx="1.5"/>' +
    '<rect class="d-t2" x="48" y="27" width="4.5" height="9" rx="1.8"/><rect class="d-dk" x="13" y="14" width="38" height="36" rx="10"/><rect class="d-ink" x="17" y="18" width="30" height="28" rx="7"/>' +
    '<path class="d-line thick yel" d="M32 23a9 9 0 1 1-9 9"/><path class="d-line thick tint" d="M32 27.5a4.5 4.5 0 1 1-4.5 4.5"/><circle class="d-w" cx="32" cy="32" r="1.6"/>' },
  camera: { also: ["a photo", "taking a picture", "a snapshot", "a webcam", "a picture", "a photograph"], tint: "#555a66", svg:
    '<ellipse class="d-sh" cx="32" cy="57.5" rx="27" ry="2"/><path class="d-t" d="M20 18l3-6q1-2 3-2h12q2 0 3 2l3 6z"/><rect class="d-w2" x="45" y="12" width="9" height="5" rx="1.5"/>' +
    '<rect class="d-t" x="4" y="16" width="56" height="38" rx="5"/><rect class="d-t3" x="4" y="16" width="56" height="5" rx="2.5"/><rect class="d-t2" x="4" y="46" width="56" height="8" rx="4"/><rect class="d-y" x="9.5" y="24" width="8" height="5" rx="1.2"/>' +
    '<circle class="d-w2" cx="32" cy="35" r="15"/><circle class="d-dk" cx="32" cy="35" r="12"/><circle class="d-bl2" cx="32" cy="35" r="7.5"/><circle class="d-dk2" cx="32" cy="35" r="3.5"/><circle class="d-w" cx="28.5" cy="31.5" r="2"/>' },
  microphone: { also: ["a mic", "recording", "a voice", "a podcast", "audio input", "a recording studio"], tint: "#5f86b3", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="16" ry="2"/><rect class="d-w2" x="30" y="38" width="4" height="15"/><rect class="d-w2" x="18" y="51" width="28" height="5.5" rx="2.7"/><path class="d-line thick grey" d="M16 24v4q0 11 16 11t16-11v-4"/>' +
    '<rect class="d-t" x="21" y="4" width="22" height="32" rx="11"/><path class="d-t2" d="M21 11h22v2.5h-22zM21 16.5h22v2.5h-22zM21 22h22v2.5h-22z"/><rect class="d-t2" x="21" y="28" width="22" height="4"/><rect class="d-t3" x="25" y="7.5" width="3" height="19" rx="1.5"/>' },
  speaker: { also: ["a loudspeaker", "sound", "audio", "loud noise", "a sound system", "a stereo"], tint: "#c9935b", svg:
    '<ellipse class="d-sh" cx="25" cy="59.5" rx="18" ry="2"/><rect class="d-t" x="6" y="5" width="36" height="53" rx="4"/><rect class="d-t3" x="6" y="5" width="36" height="4" rx="2"/><rect class="d-t2" x="6" y="54" width="36" height="4" rx="2"/>' +
    '<circle class="d-t2" cx="24" cy="18" r="6"/><circle class="d-dk2" cx="24" cy="18" r="4"/><circle class="d-t2" cx="24" cy="38" r="13"/><circle class="d-dk2" cx="24" cy="38" r="10.5"/><circle class="d-dk" cx="24" cy="38" r="4.5"/><circle class="d-w2" cx="22.5" cy="36.5" r="1.2"/>' +
    '<path class="d-line thick yel" d="M47 30a10 10 0 0 1 0 16M53 23.5a18 18 0 0 1 0 29"/>' },
  headphones: { also: ["earphones", "earbuds", "listening to music", "noise cancelling", "audio output", "a headphone set"], tint: "#e07f73", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="26" ry="2"/><path class="d-t2" d="M8 36a24 24 0 0 1 48 0h-6a18 18 0 0 0-36 0z"/><rect class="d-t3" x="25" y="11.5" width="14" height="3" rx="1.5"/>' +
    '<rect class="d-dk2" x="13" y="31" width="9" height="23" rx="3.5"/><rect class="d-dk2" x="42" y="31" width="9" height="23" rx="3.5"/><rect class="d-t" x="4" y="29" width="13" height="27" rx="5.5"/><rect class="d-t" x="47" y="29" width="13" height="27" rx="5.5"/>' +
    '<rect class="d-t3" x="7" y="33" width="2.8" height="14" rx="1.4"/><rect class="d-t2" x="54.2" y="33" width="2.8" height="19" rx="1.4"/>' },
  gamepad: { also: ["a video game controller", "a joystick", "a joypad", "gaming", "video games", "playing a video game"], tint: "#b79cf0", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="24" ry="2"/><path class="d-t" d="M18 17h28q9 0 12 9l3.5 15q1.5 8-4 10-4 1-8-4l-4-6h-27l-4 6q-4 5-8 4-5.5-2-4-10l3.5-15q3-9 12-9z"/>' +
    '<path class="d-t2" d="M46 41l3.5 6q4 5 8 4 5.5-2 4-10l-.6-2.8q-1 7-6.4 7.8-4 .5-8.5-5z"/><rect class="d-t3" x="18" y="19.5" width="28" height="3" rx="1.5"/>' +
    '<path class="d-dk" d="M14.8 23.5h4.4v4.6h4.6v4.4h-4.6v4.6h-4.4v-4.6h-4.6v-4.4h4.6z"/><circle class="d-y" cx="47" cy="25.3" r="2.5"/><circle class="d-rd" cx="52" cy="30.3" r="2.5"/><circle class="d-bl" cx="47" cy="35.3" r="2.5"/><circle class="d-gr" cx="42" cy="30.3" r="2.5"/>' +
    '<circle class="d-dk" cx="25" cy="38" r="4.3"/><circle class="d-dk" cx="39" cy="38" r="4.3"/><rect class="d-t2" x="28.5" y="27" width="7" height="2.6" rx="1.3"/>' },
  satellite: { also: ["gps", "sat nav", "a space probe", "a signal from space", "a weather satellite", "a communications satellite"], tint: "#f3c14b", svg:
    '<g transform="rotate(-30 32 32)"><rect class="d-w2" x="19" y="31" width="26" height="2.4"/>' +
    [3, 44].map((x) => `<rect class="d-bl2" x="${x}" y="24" width="17" height="16" rx="1.5"/><path class="d-line net" d="M${x + 5.7} 24v16M${x + 11.3} 24v16M${x} 32h17"/>`).join("") +
    '<rect class="d-w2" x="31" y="16" width="2" height="7"/><path class="d-w3" d="M24 15a8 8 0 0 0 16 0z"/><circle class="d-pk" cx="32" cy="11" r="2"/>' +
    '<rect class="d-t" x="24" y="21" width="16" height="22" rx="2.5"/><path class="d-t2" d="M32 21h5.5q2.5 0 2.5 2.5v17q0 2.5-2.5 2.5h-5.5z"/><rect class="d-t3" x="26.5" y="24" width="2.5" height="15" rx="1.2"/></g>' },
  sensor: { also: ["iot", "a smoke detector", "a smoke alarm", "a thermostat", "a smart device", "the internet of things"], tint: "#e9e4d8", svg:
    '<ellipse class="d-sh" cx="32" cy="57.5" rx="25" ry="2"/><path class="d-line thick yel" d="M24 26.5q8-6.5 16 0M17 19q15-12 30 0M10 11.5q22-17 44 0"/>' +
    '<path class="d-t2" d="M7 40v5.5a25 10 0 0 0 50 0v-5.5z"/><ellipse class="d-t" cx="32" cy="40" rx="25" ry="10"/><ellipse class="d-t2" cx="32" cy="40" rx="16" ry="6"/><ellipse class="d-t" cx="32" cy="39.5" rx="14" ry="5"/>' +
    '<path class="d-t2" d="M24 38.5h16v1.3h-16zM26 41h12v1.3h-12z"/><circle class="d-gr" cx="45" cy="47" r="1.8"/>' },
  qrcode: { also: ["a qr code", "a barcode", "scan me", "a scan code", "a scannable code", "scanning with a phone"], tint: "#4b4f58", svg:
    '<rect class="d-w2" x="6" y="8" width="52" height="52" rx="5"/><rect class="d-w" x="6" y="5" width="52" height="52" rx="5"/>' + finder(10, 9) + finder(39, 9) + finder(10, 38) +
    `<path class="d-t" d="${dots([[28.5, 9], [33, 13.5], [28.5, 18], [10, 28.5], [19, 28.5], [23.5, 33], [28.5, 28.5], [33, 33], [39, 28.5], [48, 28.5], [43.5, 33], [52.5, 33], [28.5, 38], [33, 42.5], [28.5, 47], [39, 38], [48, 42.5], [43.5, 47], [52.5, 47], [39, 51.5], [33, 51.5], [14.5, 33], [52.5, 38], [43.5, 42.5], [48, 51.5]], 4.5)}"/>` },
  fingerprint: { also: ["biometrics", "a thumbprint", "touch id", "proof of who you are", "a fingertip scan", "a biometric login"], tint: "#5f86b3", svg:
    '<path class="d-line thick tint" d="M28.5 44v-9a3.5 4 0 0 1 7 0v4M23 51v-16a9 10.4 0 0 1 18 0v6M41 46v6M17.5 47v-12a14.5 16.7 0 0 1 29 0v15M12 41v-6a20 23 0 0 1 40 0v10M6.5 39v-4a25.5 27 0 0 1 51 0v3M32 39v14"/>' },
  password: { also: ["a secret word", "a passcode", "a pin code", "a passphrase", "a login", "a secret code"], tint: "#7fbfe6", svg:
    '<rect class="d-t2" x="4" y="13" width="56" height="28" rx="6"/><rect class="d-t" x="4" y="11" width="56" height="28" rx="6"/><rect class="d-w" x="7.5" y="14.5" width="49" height="21" rx="3.5"/>' +
    '<circle class="d-dk" cx="15" cy="25" r="3.2"/><circle class="d-dk" cx="24" cy="25" r="3.2"/><circle class="d-dk" cx="33" cy="25" r="3.2"/><circle class="d-dk" cx="42" cy="25" r="3.2"/><rect class="d-t" x="49" y="19" width="2.2" height="12" rx="1"/>' +
    '<rect class="d-y2" x="26" y="48" width="25" height="4.5" rx="1.5"/><rect class="d-y2" x="41" y="51" width="3.5" height="6" rx="1"/><rect class="d-y2" x="46.5" y="51" width="3.5" height="5" rx="1"/><circle class="d-y" cx="21" cy="50.2" r="7"/><circle class="d-y2" cx="19" cy="50.2" r="2.4"/>' },
  card: { also: ["a bank card", "a credit card", "a debit card", "paying by card", "a contactless payment", "a payment card"], tint: "#d9534f", svg:
    '<ellipse class="d-sh" cx="32" cy="57.5" rx="27" ry="2"/><rect class="d-t2" x="4" y="15" width="56" height="38" rx="5"/><rect class="d-t" x="4" y="13" width="56" height="38" rx="5"/>' +
    '<path class="d-t3" d="M4 18q0-5 5-5h46q5 0 5 5v1h-56z" opacity=".55"/><rect class="d-y" x="10" y="22" width="12" height="9.5" rx="2"/><path class="d-y2" d="M10 25.5h4.5v-3.5h3v3.5h4.5v2.5h-4.5v3.5h-3v-3.5h-4.5z"/>' +
    '<path class="d-line white" d="M27 23.5q2 3.3 0 6.6M31.5 21.5q3.6 5.3 0 10.6"/><path class="d-w" d="M10 37h9v3.5h-9zM22 37h9v3.5h-9zM34 37h9v3.5h-9zM46 37h8v3.5h-8z"/><rect class="d-t3" x="10" y="44" width="20" height="2.5" rx="1.2"/>' },
  desktop: { also: ["a desktop computer", "a pc", "a workstation", "a home computer", "a pc tower", "a gaming pc"], tint: "#555a66", svg:
    '<ellipse class="d-sh" cx="32" cy="59.5" rx="19" ry="2"/><rect class="d-dk2" x="18" y="54" width="6" height="5" rx="1"/><rect class="d-dk2" x="40" y="54" width="6" height="5" rx="1"/>' +
    '<rect class="d-t" x="15" y="4" width="34" height="52" rx="4"/><path class="d-t2" d="M42 4h3q4 0 4 4v44q0 4-4 4h-3z"/><rect class="d-t3" x="15" y="4" width="34" height="4" rx="2"/>' +
    '<rect class="d-dk2" x="20" y="11" width="18" height="4" rx="1.5"/><rect class="d-dk2" x="20" y="18" width="18" height="4" rx="1.5"/><circle class="d-dk2" cx="29" cy="31" r="4.5"/><circle class="d-gr" cx="29" cy="31" r="2"/>' +
    '<path class="d-t2" d="M20 40h18v2h-18zM20 44.5h18v2h-18zM20 49h18v2h-18z"/>' },
  headset: { also: ["a vr headset", "virtual reality", "vr goggles", "the metaverse", "augmented reality", "vr"], tint: "#8e929c", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="24" ry="2"/><g transform="translate(0 4)"><path class="d-t2" d="M16 21c4-13 28-13 32 0h-5.5c-4-7.5-17-7.5-21 0z"/><rect class="d-t2" x="1" y="28" width="62" height="10" rx="4.5"/>' +
    '<path class="d-t" d="M12 18h40q6 0 6 6v16q0 6-6 6h-11q-3 0-4.5-3l-1-2q-1.5-3-3.5-3-2 0-3.5 3l-1 2q-1.5 3-4.5 3h-11q-6 0-6-6v-16q0-6 6-6z"/><rect class="d-t3" x="12" y="18" width="40" height="3.5" rx="1.7"/>' +
    '<rect class="d-dk2" x="11" y="24.5" width="42" height="12" rx="4"/><path class="d-w" d="M15 33l6-6h5l-6 6z" opacity=".35"/><circle class="d-bl" cx="48" cy="28.5" r="1.4"/></g>' },
  drone: { also: ["a quadcopter", "a flying camera", "a remote-controlled aircraft", "a delivery drone", "an unmanned aircraft", "a uav"], tint: "#8e929c", svg:
    '<rect class="d-t2" x="29" y="5" width="6" height="54" rx="3" transform="rotate(45 32 32)"/><rect class="d-t2" x="29" y="5" width="6" height="54" rx="3" transform="rotate(-45 32 32)"/>' +
    rotor(13, 13, 20) + rotor(51, 13, -25) + rotor(13, 51, -15) + rotor(51, 51, 30) +
    '<rect class="d-t" x="21" y="21" width="22" height="22" rx="7"/><rect class="d-t3" x="24" y="23" width="16" height="3" rx="1.5"/><circle class="d-gr" cx="27" cy="30" r="1.6"/><circle class="d-dk2" cx="32" cy="36" r="3.6"/><circle class="d-bl" cx="32" cy="36" r="1.5"/>' },
};
