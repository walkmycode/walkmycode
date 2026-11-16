// More people and the work they do: everyone a lesson in any subject might need to stand for someone. Same hand as base.ts.
import type { DrawingSet } from "../types";
import { adult, cap } from "./parts";

/** The shoulders again in a fixed colour (a uniform that keeps its colour whatever shirt a scene gives), with the neck over them. */
const suit = (c: string) => `<path class="${c}" d="M10 64v-7c0-10 9-17 22-17s22 7 22 17v7z"/><rect class="d-sk2" x="28" y="33" width="8" height="9" rx="3"/>`;
/** A shape and its mirror image across the middle of the drawing. */
const both = (s: string) => `${s}<g transform="matrix(-1 0 0 1 64 0)">${s}</g>`;

export const ROLES: DrawingSet = {
  police: { person: true, also: ["a policeman", "a policewoman", "a cop", "an officer", "a constable", "a bobby", "a detective"], tint: "#4a6fa5", svg:
    adult(suit("d-bl2") + '<path class="d-w" d="M26 40h12l-6 9z"/>' + both('<path class="d-dk" d="M26 40l-4.5 2.5 9.5 11.5z"/>') +
      '<path class="d-dk2" d="M30.8 42h2.4l.8 6-2 2.5-2-2.5z"/><path class="d-y" d="M40.5 47h5v4q0 2.5-2.5 3.5-2.5-1-2.5-3.5z"/>',
      '<path class="d-bl2" d="M17.5 21q-1-12 6-17.5 4-3 8.5-3t8.5 3q7 5.5 6 17.5z"/><path class="d-bl" d="M21.5 17q0-8 5.5-12.5-2.5 5-2.5 12.5z"/>' +
      '<rect class="d-dk" x="15" y="18.5" width="34" height="3.5" rx="1.7"/><circle class="d-w2" cx="32" cy="2.2" r="2"/>' +
      '<path class="d-w2" d="M32 6l1.6 3.4 3.7.4-2.7 2.5.7 3.7-3.3-1.8-3.3 1.8.7-3.7-2.7-2.5 3.7-.4z"/><circle class="d-y" cx="32" cy="11.4" r="1.5"/>') },
  firefighter: { person: true, also: ["a fireman", "a firewoman", "a rescuer", "the fire brigade", "a first responder", "an incident responder"], tint: "#e0605a", svg:
    adult(suit("d-y2") + '<path class="d-dk" d="M26 40h12l-6 6z"/><rect class="d-wood" x="31.3" y="45" width="1.4" height="19"/>' +
      '<rect class="d-y" x="10.3" y="52.5" width="43.4" height="5.5"/><rect class="d-w" x="10.3" y="54" width="43.4" height="2.5"/>',
      '<ellipse class="d-dk" cx="32" cy="20.5" rx="19" ry="3"/><ellipse class="d-rd" cx="32" cy="19" rx="20" ry="3.5"/>' +
      '<path class="d-rd" d="M19 19.5q0-15.5 13-15.5t13 15.5z"/><path class="d-pk" d="M22.5 15q.5-6 5-8.5-2 4-2 8.5z"/>' +
      '<path class="d-y" d="M27.5 7.5h9v6.5q0 4-4.5 5.5-4.5-1.5-4.5-5.5z"/><circle class="d-rd" cx="32" cy="12" r="1.8"/>') },
  nurse: { person: true, also: ["a carer", "a caregiver", "a midwife", "a health worker", "a paramedic", "a matron"], tint: "#6fb0d6", svg:
    adult(suit("d-bl") + '<path class="d-bl2" d="M25.5 39.5h3l3.5 5.5 3.5-5.5h3l-6.5 10z"/>' +
      '<rect class="d-bl2" x="19.5" y="51" width="8" height="7" rx="1"/><rect class="d-rd" x="22" y="47.5" width="1.8" height="5" rx=".9"/>' +
      '<rect class="d-w2" x="40.2" y="43.5" width="1.6" height="4"/><circle class="d-w" cx="41" cy="50" r="3.4"/><circle class="d-w2" cx="41" cy="50" r="2.2"/>' +
      '<path class="d-line thin" d="M41 48.5V50h1.2"/>',
      '<path class="d-w" d="M20 15.5l2.5-8.5h19l2.5 8.5q-12 3-24 0z"/><path class="d-w2" d="M20 15.5q12 3 24 0l-.5 2q-11.5 3-23 0z"/>' +
      '<path class="d-rd" d="M31 8h2v2h2v2h-2v2h-2v-2h-2v-2h2z"/>') },
  pilot: { person: true, also: ["an aviator", "a captain", "the flight crew", "a co-pilot", "the autopilot", "an airline pilot"], tint: "#5f86b3", svg:
    adult(suit("d-w3") + '<path class="d-dk2" d="M30.6 40.5h2.8l.9 3-1 13-2.3 2.5-2.3-2.5-1-13z"/>' +
      both('<g transform="rotate(-38 17.2 46.1)"><rect class="d-dk" x="11.7" y="43.9" width="11" height="4.5" rx="1"/><path class="d-y" d="M13.3 43.9h1.2v4.5h-1.2zM15.6 43.9h1.2v4.5h-1.2z"/></g>'),
      '<path class="d-w" d="M14.5 13.5q0-8.5 17.5-8.5t17.5 8.5l-3.5 3h-28z"/><path class="d-w2" d="M14.5 13.5h35l-3.5 3h-28z"/>' +
      '<rect class="d-dk2" x="18" y="15.5" width="28" height="5"/><path class="d-dk" d="M17 20.5h30q1.5 4.5-2.5 4-12.5-2.5-25 0-4 .5-2.5-4z"/>' +
      '<path class="d-line yel" d="M20.5 21.8q11.5-2 23 0"/><path class="d-y" d="M32 18q-6-.5-10-2.5 3 3.5 10 4.5 7-1 10-4.5-4 2-10 2.5z"/>') },
  judge: { person: true, also: ["a magistrate", "the bench", "an arbiter", "a barrister", "a lawyer", "the decider", "an umpire"], tint: "#8e929c", svg:
    adult(suit("d-dk") + both('<path class="d-dk2" d="M26 40l-4.5 2.5 8 21.5h2.5z"/>') +
      '<path class="d-w" d="M24.5 40.5q7.5 4.5 15 0l-1.5-2q-6 3-12 0zM28.5 41.5h7l.5 9h-3l-1-5.5-1 5.5h-3z"/>',
      '<path class="d-w2" d="M16 25.5q-2-18 16-18t16 18q-4-5.5-16-5.5t-16 5.5z"/><path class="d-w" d="M17 25q-2-16 15-16t15 16q-4-5-15-5t-15 5z"/>' +
      '<path class="d-line thin2" d="M20.5 16.5q11.5-5 23 0"/>' +
      both('<rect class="d-w2" x="12.3" y="18" width="10.4" height="24.5" rx="5.2"/><g class="d-w"><circle cx="17.5" cy="23" r="4.2"/><circle cx="17" cy="30.5" r="4.2"/><circle cx="17.5" cy="38" r="4.2"/></g>')) },
  student: { person: true, also: ["a graduate", "a learner", "a scholar", "a trainee", "an apprentice", "a college student"], tint: "#5f8fd0", svg:
    adult('<path class="d-t2" d="M27.5 40h9l-4.5 6z"/>' + both('<path class="d-bl2" d="M24 40l4-.5 3 24.5h-6z"/>') +
      '<g transform="rotate(-30 46 54)"><rect class="d-cream" x="38" y="51" width="16" height="6" rx="3"/><rect class="d-w2" x="50" y="51" width="4" height="6" rx="2"/><rect class="d-rd" x="43.5" y="51" width="2.5" height="6"/></g>',
      '<path class="d-dk" d="M19.5 13v6.5q12.5 4 25 0V13z"/><path class="d-dk" d="M11 10.5l21 7.5 21-7.5v2l-21 7.5-21-7.5z"/>' +
      '<path class="d-bl2" d="M32 3l21 7.5-21 7.5-21-7.5z"/><path class="d-bl" d="M32 3l21 7.5-3 1.1-18-6.5-18 6.5-3-1.1z"/>' +
      '<path class="d-line yel" d="M32 10.5l15 3.5v7"/><circle class="d-y" cx="32" cy="10.5" r="1.6"/><rect class="d-y" x="45.5" y="20" width="3" height="6" rx="1"/>') },
  developer: { person: true, also: ["a programmer", "a coder", "a software engineer", "a hacker", "a dev", "the maintainer", "a contributor"], tint: "#7c9fdc", svg:
    adult('<path class="d-t2" d="M19.5 44q12.5 11 25 0l-2.5-4q-10 8-20 0z"/><path class="d-line white" d="M28.5 47v4M35.5 47v4"/>' +
      '<rect class="d-w2" x="16" y="52" width="32" height="12" rx="2"/><rect class="d-w3" x="16" y="52" width="32" height="2" rx="1"/>' +
      '<path class="d-line thin" d="M27.5 55.5l-3 3 3 3M36.5 55.5l3 3-3 3M33.5 55l-3 7"/>',
      '<path class="d-w2" d="M15.5 26q0-18.5 16.5-18.5t16.5 18.5h-3.5q0-15-13-15t-13 15z"/>' +
      both('<rect class="d-dk" x="13" y="20.5" width="7" height="12" rx="3.5"/><rect class="d-gr" x="13" y="24.5" width="2" height="4" rx="1"/>')) },
  artist: { person: true, also: ["a painter", "a designer", "a creator", "an illustrator", "a sculptor", "the art teacher"], tint: "#e0697d", svg:
    adult(suit("d-cream") + '<path class="d-w3" d="M23 41.5q9 8 18 0l-2.5-2q-6.5 5-13 0z"/>' +
      '<ellipse class="d-wood" cx="24" cy="56" rx="13" ry="7" transform="rotate(-10 24 56)"/><circle class="d-cream" cx="31" cy="57.5" r="2"/>' +
      '<circle class="d-rd" cx="16" cy="56.5" r="2.2"/><circle class="d-y" cx="19.5" cy="52.5" r="2.2"/><circle class="d-bl" cx="25" cy="51.5" r="2.2"/><circle class="d-gr" cx="21.5" cy="59" r="2.2"/>' +
      '<g transform="rotate(25 44 52)"><rect class="d-wood" x="42.8" y="45" width="2.4" height="16" rx="1.2"/><path class="d-rd" d="M42.8 42.5q1.2-6 2.4 0z"/></g>',
      '<ellipse class="d-rd" cx="34" cy="12.5" rx="16" ry="6.5" transform="rotate(-12 34 12.5)"/><ellipse class="d-pk" cx="27" cy="11" rx="5" ry="2" transform="rotate(-12 27 11)"/>' +
      '<rect class="d-rd" x="34" y="3" width="2.4" height="5" rx="1.2" transform="rotate(-12 35 5.5)"/>') },
  musician: { person: true, also: ["a guitarist", "a singer", "a band member", "a rock star", "a performer", "a composer"], tint: "#b79cf0", svg:
    adult('<path class="d-t2" d="M24.5 41.5l7.5 7 7.5-7-3.5-1.5h-8z"/>' +
      '<g transform="translate(27 51) rotate(-28)"><circle class="d-or" cx="-6" cy="0" r="9"/><circle class="d-or" cx="5" cy="0" r="7"/><circle class="d-ink" cx="3" cy="0" r="2.8"/>' +
      '<rect class="d-wood" x="-10" y="-3.5" width="2.2" height="7" rx=".8"/><rect class="d-wood" x="10" y="-1.8" width="23" height="3.6"/><rect class="d-dk" x="32" y="-2.8" width="7" height="5.6" rx="1"/></g>',
      '<g class="d-y"><ellipse cx="51.5" cy="13" rx="3.2" ry="2.4" transform="rotate(-20 51.5 13)"/><rect x="53.3" y="3" width="1.5" height="10"/><path d="M54.8 3q4.5 1 4.5 6-1.5-2.5-4.5-2.5z"/></g>') },
  driver: { person: true, also: ["a chauffeur", "a taxi driver", "a cabbie", "a motorist", "a delivery driver", "a device driver"], tint: "#c9935b", svg:
    adult('<path class="d-t2" d="M24.5 41.5l7.5 7 7.5-7-3.5-1.5h-8z"/>' +
      '<path class="d-dk2" d="M20.5 52.5a11.5 11.5 0 1 1 23 0a11.5 11.5 0 1 1-23 0zM24 52.5a8 8 0 1 0 16 0a8 8 0 1 0-16 0z"/>' +
      '<path class="d-dk2" d="M24 51h16v3h-16zM30.5 52.5h3v8.5h-3z"/><circle class="d-dk" cx="32" cy="52.5" r="3.5"/><path class="d-line thin2" d="M23.5 47a10 10 0 0 1 17 0"/>' +
      '<circle class="d-sk" cx="23.5" cy="46" r="3.2"/><circle class="d-sk" cx="40.5" cy="46" r="3.2"/>',
      '<path class="d-wood" d="M17 19.5q-1-11 15-11.5 15 .5 15 11.5z"/><path class="d-dk" d="M17.5 18.5q14.5-4 29 0l1 3.5q-15.5-4.5-31 0z"/>' +
      '<circle class="d-dk" cx="32" cy="8.5" r="1.6"/>') },
  athlete: { person: true, also: ["a runner", "a sprinter", "a sportsperson", "an Olympian", "a competitor", "a jogger"], tint: "#e2574f", svg:
    adult(suit("d-sk") + '<path class="d-t" d="M20 64V47q0-4.5 3.5-6.5l2.5-1.2q6 8 12 0l2.5 1.2q3.5 2 3.5 6.5v17z"/>' +
      '<rect class="d-w" x="24.5" y="50" width="15" height="11" rx="1"/><path class="d-ink" d="M30.5 53l3-1.5h1.5v8h-2.2v-5.3l-2.3 1z"/>',
      '<rect class="d-rd" x="18.3" y="15.5" width="27.4" height="4.5" rx="2"/><rect class="d-w" x="18.3" y="17.2" width="27.4" height="1.1"/>') },
  grandparent: { person: true, also: ["a grandma", "a grandpa", "a granny", "an elder", "an old person", "a pensioner", "the ancestor"], tint: "#c98d4f", hair: "#cfd1d6", svg:
    adult('<path class="d-w" d="M25 40h14l-7 13z"/>' + both('<path class="d-t2" d="M25 40l-2 1.5 7.5 15V64H32V53z"/><rect class="d-t2" x="17" y="54" width="8" height="6" rx="1"/>') +
      '<g class="d-w3"><circle cx="32" cy="56.5" r="1.3"/><circle cx="32" cy="61" r="1.3"/></g>' +
      '<path class="d-wood" d="M48.5 64V46q0-6 5.5-6t5.5 6v2h-3v-2q0-3-2.5-3t-2.5 3v18z"/><circle class="d-sk" cx="50" cy="49" r="3.3"/>',
      cap.replace("d-hr", "d-w2") + '<g class="d-glass"><circle cx="26.5" cy="26" r="4.6"/><circle cx="37.5" cy="26" r="4.6"/><path d="M31.1 26h1.8"/></g>' +
      '<circle class="d-blush" cx="22" cy="32" r="2.6"/><circle class="d-blush" cx="42" cy="32" r="2.6"/>') },
  engineer: { person: true, also: ["a site engineer", "a civil engineer", "a surveyor", "a technician", "a site manager", "a safety officer"], tint: "#f0a94b", svg:
    adult('<path class="d-or" d="M19 64V46.5q0-4 4-5.5l2.5-1 6.5 9 6.5-9 2.5 1q4 1.5 4 5.5V64z"/><path class="d-w3" d="M19 52.5h26v2.6H19zM19 58.5h26v2.6H19z"/>' +
      '<rect class="d-wood" x="38" y="46" width="14" height="17" rx="1.5"/><rect class="d-w" x="40" y="49" width="10" height="12"/><rect class="d-w2" x="42" y="44.5" width="6" height="3" rx="1"/>' +
      '<path class="d-line thin" d="M42 52.5h6M42 55.5h6M42 58.5h4"/>',
      '<path class="d-w" d="M17.5 19.5q0-14.5 14.5-14.5t14.5 14.5z"/><path class="d-w3" d="M36 6q10.5 3 10.5 13.5h-6q0-9-4.5-13.5z"/>' +
      '<rect class="d-w2" x="29.5" y="4" width="5" height="12" rx="2"/><rect class="d-w2" x="14" y="17.5" width="36" height="4.5" rx="2.2"/>') },
  waiter: { person: true, also: ["a waitress", "a butler", "a steward", "a bartender", "the room service", "a caterer"], tint: "#8e929c", svg:
    adult(suit("d-w") + '<path class="d-dk" d="M19 64V46.5q0-4 4-5.5l2.5-1 6.5 13 6.5-13 2.5 1q4 1.5 4 5.5V64z"/>' +
      '<g class="d-w2"><circle cx="32" cy="56" r="1.2"/><circle cx="32" cy="60.5" r="1.2"/></g><path class="d-ink" d="M32 42.5l-5.5-3v6zM32 42.5l5.5-3v6z"/><circle class="d-ink" cx="32" cy="42.5" r="1.8"/>' +
      '<rect class="d-w3" x="49" y="42" width="6" height="18" rx="3"/><circle class="d-sk" cx="52" cy="41.5" r="3"/>' +
      '<path class="d-w3" d="M44 37a8.5 8 0 0 1 17 0z"/><path class="d-w" d="M47 35q0-4 4-5.5-2 2.5-2 5.5z"/><circle class="d-w2" cx="52.5" cy="28.5" r="1.5"/><rect class="d-w2" x="42" y="37" width="21" height="2.5" rx="1.2"/>') },
  soldier: { person: true, also: ["a trooper", "a warrior", "a defender", "a marine", "the army", "the troops", "a fighter"], tint: "#7fb36b", svg:
    adult(suit("d-gr2") + '<g class="d-wood"><path d="M13 55q2-5 7-4 3 2 0 4-3 0-4 3-3 1-3-3z"/><path d="M38 45q4-3 8 0 2 3-2 3-3-1-6-3z"/><path d="M27 58q4-2 7 1 1 3-3 3-4-1-4-4z"/></g>' +
      '<g class="d-dk"><path d="M21 46q3-3 6 0 0 3-3 3t-3-3z"/><path d="M44 55q4-1 6 2 1 3-3 2-3-1-3-4z"/><path d="M33 50q2-2 4 0t-1 3q-3 0-3-3z"/></g>',
      '<path class="d-gr2" d="M15.5 22q0-17.5 16.5-17.5t16.5 17.5z"/><path class="d-wood" d="M21 13q3-4 7-2 1 3-3 4-3 0-4-2z"/><path class="d-dk" d="M35 9q4-1 6 2t-2 3q-4-1-4-5z"/>' +
      '<rect class="d-dk" x="14" y="20" width="36" height="3.5" rx="1.7"/>') },
  astronaut: { person: true, also: ["a spaceman", "a spacewoman", "a cosmonaut", "a space explorer", "a space traveller", "a pioneer"], tint: "#eef0f4", svg:
    adult(suit("d-w") + '<rect class="d-w2" x="24" y="50" width="16" height="10" rx="2"/><circle class="d-rd" cx="28" cy="55" r="1.6"/><circle class="d-bl" cx="32" cy="55" r="1.6"/><circle class="d-y" cx="36" cy="55" r="1.6"/>' +
      '<circle class="d-bl2" cx="46" cy="51" r="2.6"/><circle class="d-w2" cx="32" cy="25" r="20"/><circle class="d-w" cx="32" cy="25" r="18.8"/><circle class="d-dk2" cx="32" cy="25" r="16.5"/>' +
      '<rect class="d-w2" x="19" y="42" width="26" height="4.5" rx="2.2"/>',
      '<circle class="d-glass" cx="32" cy="25" r="16.5"/><path class="d-line white" d="M19.5 20q2.5-7 9-9.5"/>') },
};
