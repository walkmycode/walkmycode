// People and roles, and the everyday things they hold, give and share.
import type { DrawingSet } from "../types";
import { adult, cap, eyes, person } from "./parts";

const MOUTHS = '<path class="d-line smile" d="M27.5 32q4.5 4 9 0"/><path class="d-line frown" d="M27.5 35q4.5-4 9 0"/>';

/** One small head and shoulders of a crowd: the usual grown-up, moved and shrunk, its body running down to `end`. */
const mini = (x: number, y: number, s: string, cls: string, end: number) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path class="${cls}" d="M10 ${end}V55c0-10 9-17 22-17s22 7 22 17V${end}z"/>` +
  `<circle class="d-sk" cx="32" cy="25" r="14"/>${cap}${eyes(2)}${MOUTHS}</g>`;

export const PEOPLE: DrawingSet = {
  person: { person: true, also: ["a grown-up", "an adult", "a parent", "a neighbour", "someone", "a user"], tint: "#6aa5c9", svg:
    adult('<path class="d-t2" d="M23.5 41.5q8.5 9 17 0l-3-2q-5.5 5-11 0z"/>') },
  baby: { person: true, also: ["a toddler", "a newborn", "a little one", "a beginner", "an infant"], tint: "#a9d8ec", svg:
    person('<rect class="d-sk2" x="28" y="33" width="8" height="9" rx="3"/><path class="d-w" d="M21.5 42q10.5 17 21 0l-4-2.5h-13z"/><circle class="d-pk" cx="32" cy="48" r="2.2"/>') +
    '<circle class="d-sk" cx="32" cy="25" r="14"/><path class="d-hr" d="M27 12.5q0-6 6.5-8.5-1.5 3 0 4.5 2.5-3 6-2-3.5 2.5-3 6z"/>' + eyes(2) +
    '<circle class="d-blush" cx="22.5" cy="31" r="3"/><circle class="d-blush" cx="41.5" cy="31" r="3"/>' +
    '<path class="d-line smile" d="M28.5 32q3.5 3.5 7 0"/><path class="d-line frown" d="M28.5 35q3.5-3.5 7 0"/>' },
  doctor: { person: true, also: ["a nurse", "a medic", "a vet", "a dentist", "the hospital staff"], tint: "#f4f5f7", svg:
    adult('<path class="d-gr2" d="M25 40h14l-7 13z"/><path class="d-t2" d="M25.5 39.5l-5.5 3.5 10 14zM38.5 39.5l5.5 3.5-10 14z"/>' +
      '<path class="d-line thin" d="M25 43c-1 7 2 10 7 10s8-3 7-10M32 53v3"/><circle class="d-w2" cx="32" cy="58" r="3.2"/>' +
      '<path class="d-rd" d="M44.5 49.5h3v2.5h2.5v3h-2.5v2.5h-3v-2.5h-2.5v-3h2.5z"/>',
      '<rect class="d-w2" x="18.5" y="14.5" width="27" height="3" rx="1.5"/><circle class="d-w" cx="32" cy="14.5" r="5"/><circle class="d-w2" cx="32" cy="14.5" r="2.2"/>') },
  chef: { person: true, also: ["a cook", "a baker", "the kitchen staff", "a waiter", "a maker"], tint: "#f4f5f7", svg:
    adult('<path class="d-rd" d="M23.5 41q8.5 5 17 0l-2 5.5q-6.5 3-13 0z"/><rect class="d-t2" x="31.4" y="48" width="1.2" height="16"/>' +
      '<g class="d-w2"><circle cx="27" cy="52.5" r="1.6"/><circle cx="37" cy="52.5" r="1.6"/><circle cx="27" cy="59.5" r="1.6"/><circle cx="37" cy="59.5" r="1.6"/></g>',
      '<g class="d-w"><circle cx="23" cy="9" r="6.5"/><circle cx="41" cy="9" r="6.5"/><circle cx="32" cy="7.5" r="7"/><rect x="20" y="9" width="24" height="10" rx="1.5"/></g><rect class="d-w2" x="20" y="16" width="24" height="3" rx="1"/>') },
  guard: { person: true, also: ["a security guard", "a bouncer", "a gatekeeper", "a watchman", "a door keeper", "a doorman", "a keeper"], tint: "#4f76b0", svg:
    adult('<path class="d-t3" d="M25 40l7 6-5 4.5-4.5-8.5zM39 40l-7 6 5 4.5 4.5-8.5z"/><path class="d-dk2" d="M30.5 46h3l1.5 12-3 3-3-3z"/>' +
      '<path class="d-y" d="M44 47.5l1.5 3 3.3.4-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.4z"/>',
      '<path class="d-t" d="M15.5 15q0-8.5 16.5-8.5t16.5 8.5l-2.5 5h-28z"/><path class="d-dk2" d="M18 16.5h28v4h-28z"/>' +
      '<path class="d-dk" d="M17.5 20.5h29q1.5 4.5-2.5 4-12-3-24 0-4 .5-2.5-4z"/><circle class="d-y" cx="32" cy="12" r="2.8"/>') },
  farmer: { person: true, also: ["a gardener", "a grower", "a shepherd", "a planter", "a farm worker"], tint: "#7fb36b", svg:
    adult('<path class="d-bl2" d="M20.5 43.5l4.5-2.5 3.5 11h-6zM43.5 43.5l-4.5-2.5-3.5 11h6z"/><rect class="d-bl2" x="21" y="50" width="22" height="14" rx="2"/>' +
      '<circle class="d-y" cx="24.5" cy="53.5" r="1.6"/><circle class="d-y" cx="39.5" cy="53.5" r="1.6"/>',
      '<ellipse class="d-or" cx="32" cy="16.5" rx="22" ry="4.5"/><path class="d-y" d="M21 16q0-12 11-12t11 12q-11 2.5-22 0z"/><path class="d-rd" d="M21.2 12.5q10.8 2.5 21.6 0l.2 3.5q-11 2.5-22 0z"/>') },
  king: { person: true, also: ["a queen", "a ruler", "a monarch", "the boss", "a leader", "the owner"], tint: "#8d6bc7", svg:
    adult('<path class="d-w" d="M16.5 46.5q15.5-12.5 31 0l-2.5 6q-13-9.5-26 0z"/>' +
      '<g class="d-ink"><circle cx="21.5" cy="47.5" r="1"/><circle cx="28" cy="44.5" r="1"/><circle cx="36" cy="44.5" r="1"/><circle cx="42.5" cy="47.5" r="1"/></g><circle class="d-y" cx="32" cy="56" r="3.2"/>',
      '<path class="d-y" d="M19 19l-2.5-13 7.5 6 8-8.5 8 8.5 7.5-6-2.5 13z"/><rect class="d-or" x="18.5" y="15.5" width="27" height="4" rx="1"/>' +
      '<g class="d-y"><circle cx="16.5" cy="6" r="2"/><circle cx="32" cy="3.5" r="2"/><circle cx="47.5" cy="6" r="2"/></g>' +
      '<circle class="d-rd" cx="32" cy="12" r="2.2"/><circle class="d-bl" cx="24.5" cy="17.5" r="1.3"/><circle class="d-bl" cx="39.5" cy="17.5" r="1.3"/>') },
  scientist: { person: true, also: ["a researcher", "a chemist", "an inventor", "a lab worker", "an experimenter"], tint: "#f4f5f7", svg:
    adult('<path class="d-bl" d="M25 40h14l-7 13z"/><path class="d-t2" d="M25.5 39.5l-5.5 3.5 10 14zM38.5 39.5l5.5 3.5-10 14z"/>' +
      '<path class="d-sky" d="M46 42h4v7l5 10.5q1 2.5-2 2.5h-10q-3 0-2-2.5l5-10.5z"/><path class="d-gr" d="M43.8 54h8.4l2.8 5.5q1 2.5-2 2.5h-10q-3 0-2-2.5z"/>',
      '<rect class="d-dk" x="17.5" y="14.5" width="29" height="3.5" rx="1.5"/><rect class="d-dk" x="20" y="11" width="11.5" height="10" rx="4"/><rect class="d-dk" x="32.5" y="11" width="11.5" height="10" rx="4"/>' +
      '<rect class="d-sky" x="22" y="13" width="7.5" height="6" rx="2.5"/><rect class="d-sky" x="34.5" y="13" width="7.5" height="6" rx="2.5"/>') },
  builder: { person: true, also: ["a worker", "an engineer", "a plumber", "a repair person", "a carpenter", "a mechanic"], tint: "#f08a4b", svg:
    adult('<path class="d-dk" d="M25 40h14l-7 12z"/><path class="d-y" d="M18.5 45.5l4.5-3 2.5 21.5h-5.5zM45.5 45.5l-4.5-3-2.5 21.5h5.5z"/>',
      '<path class="d-y" d="M17 19.5q0-14 15-14t15 14z"/><rect class="d-or" x="29.5" y="4" width="5" height="12" rx="2"/><rect class="d-or" x="13.5" y="17.5" width="37" height="4.5" rx="2.2"/>') },
  customer: { person: true, also: ["a shopper", "a buyer", "a client", "a visitor", "a guest", "a passenger"], tint: "#e58f6e", svg:
    adult('<path class="d-w" d="M25 40h14l-7 10z"/><path class="d-t2" d="M25.5 39.5l-3.5 2.5 10 11 10-11-3.5-2.5-6.5 8z"/>' +
      '<path class="d-line thin" d="M41.5 51q4.5-10 9 0"/><path class="d-or" d="M36 50h20l1 14h-22z"/><path class="d-y" d="M36 50h20l.3 4h-20.6z"/>') },
  crowd: { person: true, also: ["a group", "a team", "a class", "an audience", "a family", "the public", "a queue"], tint: "#63b5a6", svg:
    mini(-4, 3, ".62", "d-t2", 99) + mini(28.3, 3, ".62", "d-t3", 99) + mini(8.6, 17, ".73", "d-t", 64.5) },

  ball: { also: ["a football", "a beach ball", "a sphere", "a circle", "a planet", "a bouncy ball"], tint: "#ee8f86", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="19" ry="2.5"/><circle class="d-t" cx="32" cy="31" r="24"/><path class="d-t2" d="M8 31a24 24 0 0 0 48 0a26 22 0 0 1-48 0z"/>' +
    '<path class="d-w" d="M9 26q23-12 46 0 1 3 1 6-24-13-48 0 0-3 1-6z"/><ellipse class="d-t3" cx="22" cy="15.5" rx="6" ry="3" transform="rotate(-35 22 15.5)"/>' },
  book: { also: ["a story", "a textbook", "a manual", "a diary", "a dictionary", "the instructions"], tint: "#5f9e8f", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="22" ry="2"/><rect class="d-t2" x="11" y="7" width="42" height="51" rx="3.5"/><rect class="d-w" x="16" y="50" width="35" height="5.5" rx="1"/><rect class="d-w2" x="16" y="52.2" width="35" height="1.2"/>' +
    '<path class="d-t" d="M17 7h32.5q3.5 0 3.5 3.5v39.5h-36z"/><rect class="d-t3" x="23" y="15" width="24" height="13" rx="1.5"/><rect class="d-w" x="26.5" y="19" width="17" height="2.2" rx="1.1"/><rect class="d-w" x="29.5" y="23" width="11" height="2.2" rx="1.1"/>' +
    '<path class="d-rd" d="M41 50h5v9l-2.5-2.5-2.5 2.5z"/>' },
  toycar: { also: ["a car", "a toy", "a vehicle", "a taxi", "a racer", "a moving object"], tint: "#e0605a", svg:
    '<ellipse class="d-sh" cx="32" cy="56" rx="26" ry="2.5"/><rect class="d-w2" x="30.5" y="9" width="3" height="9"/><circle class="d-y" cx="27.5" cy="9" r="4.2"/><circle class="d-y" cx="36.5" cy="9" r="4.2"/>' +
    '<path class="d-t" d="M15 33l6-12.5q1.5-3.5 5.5-3.5h11q4 0 5.5 3.5l6 12.5z"/><rect class="d-t" x="4" y="30" width="56" height="18" rx="7"/><path class="d-t2" d="M4 41h56q0 7-7 7h-42q-7 0-7-7z"/>' +
    '<path class="d-sky" d="M21 30l3.8-8q.7-1.5 2.7-1.5h3v9.5zM33.5 20.5h3q2 0 2.7 1.5l3.8 8h-9.5z"/><circle class="d-y" cx="56" cy="36" r="2.5"/>' +
    '<circle class="d-ink" cx="17" cy="48" r="7.5"/><circle class="d-ink" cx="47" cy="48" r="7.5"/><circle class="d-w2" cx="17" cy="48" r="3"/><circle class="d-w2" cx="47" cy="48" r="3"/>' },
  key: { also: ["a password", "a secret", "permission", "a door key", "an answer key", "access"], tint: "#f0c24a", svg:
    '<g transform="rotate(-40 32 32)"><rect class="d-t" x="24" y="28.5" width="36" height="7" rx="2.5"/><rect class="d-t2" x="24" y="32.5" width="36" height="3" rx="1.5"/>' +
    '<path class="d-t2" d="M43 35h5.5v7.5h-5.5zM51.5 35h5.5v10.5h-5.5z"/><path class="d-t" d="M2 32a13 13 0 1 1 26 0a13 13 0 1 1-26 0zM9.5 32a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0z"/>' +
    '<path class="d-t3" d="M4.5 30a10.5 10.5 0 0 1 16-7.5a12 12 0 0 0-16 7.5z"/></g>' },
  padlock: { also: ["a lock", "locked", "private", "a safe", "security", "a borrow"], tint: "#f0b54a", svg:
    '<path class="d-w2" d="M18 31v-10a14 14 0 0 1 28 0v10h-6.5v-10a7.5 7.5 0 0 0-15 0v10z"/><path class="d-w" d="M18 21a14 14 0 0 1 14-14v3a11 11 0 0 0-11 11v10h-3z"/>' +
    '<rect class="d-t" x="11" y="28" width="42" height="31" rx="5.5"/><path class="d-t2" d="M11 49h42v4.5q0 5.5-5.5 5.5h-31q-5.5 0-5.5-5.5z"/><rect class="d-t3" x="15" y="31" width="34" height="3.5" rx="1.7"/>' +
    '<circle class="d-ink" cx="32" cy="41" r="4"/><path class="d-ink" d="M30.3 42h3.4l1.3 8.5h-6z"/>' },
  cup: { also: ["a mug", "a drink", "a glass", "a container", "a measure of liquid", "a cup of tea"], tint: "#6fb0d6", svg:
    '<ellipse class="d-sh" cx="29" cy="58.5" rx="20" ry="2.3"/><path class="d-line grey" d="M20 14q-3-3.5 0-7M30 14q-3-3.5 0-7"/>' +
    '<path class="d-t2" d="M42 25h5a10.5 10.5 0 0 1 0 21h-5v-5.5h5a5 5 0 0 0 0-10h-5z"/><path class="d-t" d="M9 21h36v24q0 12-12 12h-12q-12 0-12-12z"/><path class="d-t2" d="M37 21h8v24q0 12-12 12h-4q8-2 8-12z"/>' +
    '<ellipse class="d-t3" cx="27" cy="21" rx="18" ry="4.5"/><ellipse class="d-wood" cx="27" cy="21.5" rx="14.5" ry="2.8"/>' },
  plate: { also: ["a dish", "a dinner", "a meal", "a serving", "a place at the table"], tint: "#eef0f4", svg:
    '<circle class="d-t2" cx="32" cy="33.5" r="20"/><circle class="d-t" cx="32" cy="32" r="20"/><circle class="d-t2" cx="32" cy="32" r="12.5" opacity=".5"/><circle class="d-t" cx="32" cy="32.8" r="11.5"/>' +
    '<path class="d-w2" d="M4.5 9h1.8v9h1.3v-9h1.8v9h1.3v-9h1.8v11q0 3-2.7 3.5v30.5q0 1.5-1.5 1.5t-1.5-1.5v-30.5q-2.3-.5-2.3-3.5z"/>' +
    '<path class="d-w2" d="M55 9q6 5 5 20h-2v24.5q0 1.5-1.5 1.5t-1.5-1.5z"/>' },
  cake: { also: ["a birthday cake", "a whole cut in parts", "a fraction", "a share", "a dessert", "a treat"], tint: "#f29fb5", svg:
    '<ellipse class="d-w2" cx="32" cy="52.5" rx="29" ry="7"/><ellipse class="d-w" cx="32" cy="51" rx="29" ry="7"/>' +
    '<path class="d-t" d="M9 27v19a23 7.5 0 0 0 46 0v-19z"/><path class="d-t2" d="M9 41a23 7.5 0 0 0 46 0v5a23 7.5 0 0 1-46 0z"/><ellipse class="d-t3" cx="32" cy="27" rx="23" ry="7.5"/>' +
    '<path class="d-w" d="M32 46l-9 7h18z"/><path class="d-cream" d="M32 27l-9 7v19l9-7z"/><path class="d-y" d="M32 27l9 7v19l-9-7z"/>' +
    '<path class="d-rd" d="M32 35l-9 7v3.5l9-7zM32 35l9 7v3.5l-9-7z"/>' +
    '<g class="d-rd"><circle cx="17" cy="25" r="2.6"/><circle cx="32" cy="22" r="2.6"/><circle cx="47" cy="25" r="2.6"/></g><rect class="d-y" x="31" y="9" width="2" height="11" rx="1"/><path class="d-or" d="M32 3q3 3.5 0 6-3-2.5 0-6z"/>' },
  pizza: { also: ["a pie cut in slices", "equal parts", "a pie chart", "a takeaway", "something to share out"], tint: "#f3c95a", svg:
    '<circle class="d-t2" cx="32" cy="32" r="27"/><circle class="d-t" cx="32" cy="32" r="22.5"/>' +
    '<g class="d-rd"><circle cx="45.5" cy="32" r="3.8"/><circle cx="38.8" cy="43.7" r="3.8"/><circle cx="25.2" cy="43.7" r="3.8"/><circle cx="18.5" cy="32" r="3.8"/><circle cx="25.2" cy="20.3" r="3.8"/><circle cx="38.8" cy="20.3" r="3.8"/></g>' +
    '<g class="d-gr2"><circle cx="33" cy="15" r="1.6"/><circle cx="47" cy="23.5" r="1.6"/><circle cx="46" cy="41" r="1.6"/><circle cx="31" cy="49" r="1.6"/><circle cx="17" cy="40.5" r="1.6"/><circle cx="18" cy="23" r="1.6"/></g>' +
    '<path class="d-line white" d="M32 5v54M8.6 18.5l46.8 27M8.6 45.5l46.8-27"/>' },
  apple: { also: ["a fruit", "a snack", "something to count", "a healthy choice", "a harvest"], tint: "#e2574f", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="16" ry="2"/><path class="d-wood" d="M30.5 21q0-8 4-13l3 1.5q-3.5 5-3.5 11.5z"/><path class="d-gr" d="M36 14q3-9 14-7.5-2.5 10-14 7.5z"/>' +
    '<path class="d-t" d="M32 20c-6-5-23-4-23 13 0 13 9.5 25 16.5 25 3 0 4.5-1.5 6.5-1.5s3.5 1.5 6.5 1.5c7 0 16.5-12 16.5-25 0-17-17-18-23-13z"/>' +
    '<path class="d-t2" d="M47 20.5c5 2.5 8 7 8 12.5 0 13-9.5 25-16.5 25-3 0-4.5-1.5-6.5-1.5 12-2 20-17 15-36z"/><ellipse class="d-t3" cx="19" cy="29" rx="3.5" ry="6.5" transform="rotate(20 19 29)"/>' },
  backpack: { also: ["a school bag", "a rucksack", "a bag", "luggage", "what you carry"], tint: "#5f8fd0", svg:
    '<ellipse class="d-sh" cx="32" cy="59.5" rx="21" ry="2"/><path class="d-t2" d="M23 15v-3a9 9 0 0 1 18 0v3h-4v-3a5 5 0 0 0-10 0v3z"/><rect class="d-t2" x="6" y="27" width="8" height="24" rx="4"/><rect class="d-t2" x="50" y="27" width="8" height="24" rx="4"/>' +
    '<rect class="d-t" x="11" y="12" width="42" height="47" rx="12"/><path class="d-t3" d="M11 30v-6q0-12 12-12h18q12 0 12 12v6q-21 6-42 0z"/><rect class="d-y" x="29" y="27" width="6" height="8" rx="1.5"/>' +
    '<rect class="d-t2" x="17" y="39" width="30" height="16" rx="4"/><rect class="d-w2" x="20" y="43" width="24" height="2" rx="1"/><rect class="d-y" x="39" y="42" width="3" height="5" rx="1"/>' },
  coat: { also: ["a jacket", "a raincoat", "a uniform", "clothes", "a layer", "a covering"], tint: "#c98d4f", svg:
    '<path class="d-t2" d="M22 9l-13 8-6 27 9 2.5 5-16zM42 9l13 8 6 27-9 2.5-5-16z"/><path class="d-t" d="M22 9l-6 8v41h32v-41l-6-8z"/><path class="d-dk" d="M24 9l8 13 8-13q-8 4-16 0z"/>' +
    '<path class="d-t3" d="M22 9l-5 9 15 7-8-16zM42 9l5 9-15 7 8-16z"/><rect class="d-t2" x="31.3" y="25" width="1.4" height="33"/>' +
    '<g class="d-y"><circle cx="36" cy="31" r="1.8"/><circle cx="36" cy="40" r="1.8"/><circle cx="36" cy="49" r="1.8"/></g><rect class="d-t2" x="19" y="44" width="8" height="2.5" rx="1"/><rect class="d-t2" x="38.5" y="44" width="6.5" height="2.5" rx="1"/>' },
  ticket: { also: ["a pass", "a token", "a voucher", "a receipt", "an entry pass", "a boarding pass"], tint: "#f0b95a", svg:
    '<g transform="rotate(-12 32 32)"><path class="d-t2" d="M5 20h54v9a4.5 4.5 0 0 0 0 9v9h-54v-9a4.5 4.5 0 0 0 0-9z"/><path class="d-t" d="M5 18h54v9a4.5 4.5 0 0 0 0 9v9h-54v-9a4.5 4.5 0 0 0 0-9z"/>' +
    '<g class="d-t2"><circle cx="43" cy="22" r="1.2"/><circle cx="43" cy="27" r="1.2"/><circle cx="43" cy="32" r="1.2"/><circle cx="43" cy="37" r="1.2"/><circle cx="43" cy="42" r="1.2"/></g>' +
    '<path class="d-w" d="M24 22l2.8 6 6.5.8-4.8 4.5 1.2 6.5-5.7-3.2-5.7 3.2 1.2-6.5-4.8-4.5 6.5-.8z"/><rect class="d-t2" x="47" y="26" width="6.5" height="2.5" rx="1.2"/><rect class="d-t2" x="47" y="31" width="6.5" height="2.5" rx="1.2"/><rect class="d-t2" x="47" y="36" width="4" height="2.5" rx="1.2"/></g>' },
  gift: { also: ["a birthday present", "a surprise", "a reward", "a prize", "something given"], tint: "#e0697d", svg:
    '<ellipse class="d-sh" cx="32" cy="59.5" rx="23" ry="2"/><rect class="d-t" x="10" y="29" width="44" height="30" rx="2.5"/><rect class="d-t2" x="10" y="29" width="44" height="5"/><rect class="d-t3" x="6" y="20" width="52" height="11" rx="2.5"/>' +
    '<rect class="d-y" x="27.5" y="20" width="9" height="39"/><path class="d-or" d="M27.5 31h9v3h-9z"/>' +
    '<path class="d-y" d="M32 20c-3-10-13-15-17-10s4 10 17 10zM32 20c3-10 13-15 17-10s-4 10-17 10z"/><path class="d-or" d="M32 20c-2-5-7-8-10-7 2 3 5 6 10 7zM32 20c2-5 7-8 10-7-2 3-5 6-10 7z"/><circle class="d-or" cx="32" cy="19" r="3.5"/>' },
  bed: { also: ["a place to sleep", "rest", "a bedroom", "night time", "a hospital bed"], tint: "#7c9fdc", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="28" ry="2"/><rect class="d-wood" x="3" y="14" width="7" height="43" rx="2.5"/><rect class="d-wood" x="54" y="27" width="7" height="30" rx="2.5"/><rect class="d-wood" x="6" y="44" width="52" height="7" rx="1"/>' +
    '<rect class="d-w3" x="9" y="33" width="46" height="12" rx="3"/><rect class="d-w" x="11" y="25" width="17" height="11" rx="5"/>' +
    '<path class="d-t" d="M25 31h29v15h-29q-3 0-3-3v-9q0-3 3-3z"/><path class="d-t3" d="M25 31h7v15h-7q-3 0-3-3v-9q0-3 3-3z"/><path class="d-t2" d="M32 41h22v5h-22z"/>' },
  chair: { also: ["a seat", "a place", "a stool", "a spot at the table", "a desk"], tint: "#c58d57", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="24" ry="2"/><path class="d-t2" d="M15 8h5v29h-5zM44 8h5v29h-5zM17 46h4.5v11h-4.5zM42.5 46h4.5v11h-4.5z"/>' +
    '<rect class="d-t" x="14" y="5" width="36" height="8" rx="3"/><rect class="d-t" x="19" y="18" width="26" height="5" rx="1.5"/><rect class="d-t" x="19" y="27" width="26" height="5" rx="1.5"/>' +
    '<path class="d-t3" d="M14 35h36l6 9h-48z"/><rect class="d-t" x="8" y="43.5" width="48" height="5" rx="1.5"/><rect class="d-t" x="9" y="48" width="5.5" height="12" rx="1.5"/><rect class="d-t" x="49.5" y="48" width="5.5" height="12" rx="1.5"/>' },
  umbrella: { also: ["shelter", "protection", "a cover", "a rainy day", "insurance", "a shield"], tint: "#e2605c", svg:
    '<rect class="d-w2" x="30.7" y="28" width="2.6" height="24"/><path class="d-wood" d="M30.2 50h3.6v5a6 6 0 0 1-12 0h3.6a2.4 2.4 0 0 0 4.8 0z"/><rect class="d-dk" x="30.8" y="3" width="2.4" height="6" rx="1.2"/>' +
    '<path class="d-t" d="M5 33a27 26 0 0 1 54 0q-6.75-5.5-13.5 0-6.75-5.5-13.5 0-6.75-5.5-13.5 0-6.75-5.5-13.5 0z"/>' +
    '<path class="d-t2" d="M18.5 33q.5-18 13.5-26-2 13 0 26-6.75-5.5-13.5 0zM45.5 33q-.5-18-13.5-26a27 26 0 0 1 27 26q-6.75-5.5-13.5 0z"/>' },
};
