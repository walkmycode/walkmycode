/**
 * One scene of every kind, written as a professor would write it (kinds.ts), across subjects: the tests clean
 * them, and the player's preview (Learn, ?scenes) plays them. The mockup docs/design/analogy-scene.html has the
 * same ones drawn with stand-ins; here every drawing is a name from the set (src/lib/drawings).
 */
export const SCENE_EXAMPLES: Record<string, { language: string | null; raw: unknown }> = {
  lifetimes: {
    language: "rust",
    raw: {
      kind: "timeline", title: "Olivia's bike", place: "A street where Olivia lives, for now",
      code: 'let r;\n{\n    let s = String::from("hi");\n    r = &s;\n}                 // s dropped here\nprintln!("{r}");  // r would dangle',
      rows: [{ id: "s", a: "Olivia's bike", r: "s: String", ia: "bicycle", ir: "memory", tone: "yellow" }, { id: "r", a: "Harry riding it", r: "r = &s", ia: "child", ir: "cursor", tone: "blue", borrows: "s" }],
      marks: [1, 2, 3, 4, 5, 6].map((n) => ({ a: `line ${n}`, r: `line ${n}` })),
      band: { from: 1, to: 4, a: "while Olivia lives on this street", r: "the inner { } block" },
      words: [{ a: "the bike", r: "the value s owns" }, { a: "riding it", r: "a borrow, &s" }, { a: "moving away", r: "drop at }" }, { a: "nothing to ride", r: "a dangling reference" }],
      steps: [
        { head: "Harry *waits*", a: "Harry is ready to borrow a bike, but there is none yet.", r: "r is declared, but points at nothing yet.", line: 1, at: 0, bars: {}, word: 1 },
        { head: "Olivia *gets* a bike", a: "Olivia gets a shiny new bike.", r: 's is created and owns the text "hi".', line: 3, at: 2, bars: { s: [2, null] }, word: 0 },
        { head: "Harry *borrows* it", a: "Olivia lets Harry ride it while she is around.", r: "r borrows s: it points at s without owning it.", line: 4, at: 3, bars: { s: [2, null], r: [3, null] }, tags: { r: { a: "riding", r: "valid", tone: "blue" } } },
        { head: "Olivia *moves away*", a: "Olivia moves house, and her bike goes with her.", r: "The block ends, so s is dropped.", line: 5, at: 4, bars: { s: [2, 4], r: [3, null] }, tags: { s: { a: "gone", r: "dropped", tone: "pink" } }, word: 2 },
        { head: "No bike to *ride*", a: "Harry reaches for the bike, but there is nothing there.", r: "Using r here would read freed memory, so the compiler stops it.", line: 6, at: 5, bars: { s: [2, 4], r: [3, null] }, tags: { r: { a: "stopped", r: "E0597", tone: "pink" } }, stop: true, word: 3,
          ask: { q: "Olivia and her bike have gone. Can Harry still ride it?", opts: ["Yes, he has it on loan", "No, there is nothing to ride"], right: 1, why: "A borrow points at the owner's value; when the owner is gone, so is the value." } },
      ],
      rule: "A borrow can never outlive the thing it borrows.",
      breaks: "In real life Harry could visit Olivia's new house; in Rust, once s is dropped its value is gone for good.",
    },
  },

  blood: {
    language: null,
    raw: {
      kind: "flow", title: "The delivery round", place: "A town with one depot and many houses",
      facts: ["In the lungs, blood picks up oxygen.", "The heart pumps it out to the body.", "Cells take the oxygen and give back carbon dioxide.", "The heart pumps the blood back to the lungs.", "The lungs breathe out the carbon dioxide."],
      source: "GCSE biology",
      stops: [{ id: "lungs", a: "the depot", r: "the lungs", ia: "factory", ir: "lungs" }, { id: "out", a: "the pump, going out", r: "the heart", ia: "heart", ir: "heart" }, { id: "cells", a: "the houses", r: "body cells", ia: "house", ir: "cell" }, { id: "back", a: "the pump, coming back", r: "the heart", ia: "heart", ir: "heart" }],
      mover: { a: "the van", r: "the blood", ia: "van", ir: "drop" },
      items: [{ id: "o2", a: "parcels", r: "oxygen", ia: "parcel", tint: "green" }, { id: "co2", a: "rubbish", r: "carbon dioxide", ia: "bin", tint: "pink" }],
      words: [{ a: "the van", r: "the blood" }, { a: "parcels", r: "oxygen" }, { a: "rubbish", r: "carbon dioxide" }, { a: "the pump", r: "the heart" }],
      steps: [
        { head: "The van *loads*", a: "At the depot, the van loads up with parcels.", r: "In the lungs, blood picks up oxygen.", facts: [0], at: "lungs", carry: ["o2"], word: 1 },
        { head: "The pump *pushes*", a: "The pump pushes the van out into town.", r: "The heart pumps the blood out to the body.", facts: [1], at: "out", carry: ["o2"], word: 3 },
        { head: "Parcels in, rubbish *out*", a: "At the houses it drops the parcels and picks up the rubbish.", r: "Cells take the oxygen and give back carbon dioxide.", facts: [2], at: "cells", carry: ["co2"], word: 2,
          ask: { q: "The van reaches the houses full of parcels. What does it carry away?", opts: ["More parcels", "The rubbish"], right: 1, why: "Cells use the oxygen and hand back carbon dioxide, their waste." } },
        { head: "Back to the *depot*", a: "The pump sends the van back, and the rubbish goes out.", r: "The heart pumps the blood to the lungs, which breathe the carbon dioxide out.", facts: [3, 4], at: "back", carry: ["co2"] },
      ],
      rule: "Blood is a delivery round: oxygen out to the cells, carbon dioxide back to the lungs, pumped round by the heart.",
      breaks: "Your blood is billions of tiny vans that never stop, and the heart is really two pumps side by side.",
    },
  },

  callstack: {
    language: "python",
    raw: {
      kind: "containers", title: "The pile of plates", place: "The kitchen sink after Sunday lunch", order: "stack",
      code: 'def shout(word):\n    return word.upper() + "!"\n\ndef greet(name):\n    return shout("hi " + name)\n\nprint(greet("Jack"))',
      holder: { a: "the sink", r: "the call stack" },
      items: [{ id: "main", a: "the bottom plate", r: "<module>", ia: "plate", ir: "stack", note: { a: "the main job", r: "the file itself" } }, { id: "greet", a: "greet's plate", r: "greet()", ia: "plate", ir: "function", note: { a: 'says "Jack"', r: 'name = "Jack"' } }, { id: "shout", a: "shout's plate", r: "shout()", ia: "plate", ir: "function", note: { a: 'says "hi Jack"', r: 'word = "hi Jack"' } }],
      words: [{ a: "a plate", r: "a frame" }, { a: "putting one on top", r: "a call" }, { a: "washing the top", r: "a return" }, { a: "the pile", r: "the call stack" }],
      steps: [
        { head: "The pile *starts*", a: "There is always one plate at the bottom: the main job.", r: "Python starts running the file.", line: 7, items: ["main"], word: 3 },
        { head: "greet goes *on top*", a: 'Calling greet puts a new plate on top, with "Jack" written on it.', r: 'greet("Jack") pushes a frame with name = "Jack".', line: 4, items: ["main", "greet"], word: 1 },
        { head: "shout goes *on top*", a: "greet needs shout, so another plate goes on top.", r: "greet calls shout, which pushes its own frame.", line: 1, items: ["main", "greet", "shout"], word: 0 },
        { head: "Top plate *washed*", a: 'Only the top plate can be washed: shout finishes and hands down "HI JACK!".', r: 'shout returns "HI JACK!" and its frame is popped.', line: 2, items: ["main", "greet"], out: { a: '"HI JACK!"', r: '"HI JACK!"' }, word: 2,
          ask: { q: "Two plates are on the pile. Which one gets washed first?", opts: ["greet's, it came first", "shout's, it is on top"], right: 1, why: "Only the top plate can come off: the last call made is the first to finish." } },
        { head: "Back to the *bottom*", a: "greet finishes too, and the answer reaches the bottom plate.", r: "greet returns and print shows HI JACK!.", line: 7, items: ["main"], out: { a: '"HI JACK!"', r: '"HI JACK!"' } },
      ],
      rule: "The last function called is the first to finish.",
      breaks: "You could pull a plate from the middle of a real pile; Python never can, and a pile with no end topples over as a RecursionError.",
    },
  },

  interest: {
    language: null,
    raw: {
      kind: "compare", title: "The brick wall and the snowball", place: "£100 saved at 10% a year", unit: "£",
      facts: ["£100 is saved two ways, at 10% a year.", "Simple interest: 10% of the first £100, £10 every year.", "Compound interest: 10% of what you have now.", "After 5 years: £150 against £161.05."],
      series: [{ id: "s", a: "Jack's brick wall", r: "simple interest", ia: "brick", tint: "yellow", values: [100, 110, 120, 130, 140, 150] }, { id: "c", a: "Olivia's snowball", r: "compound interest", ia: "trend", tint: "green", values: [100, 110, 121, 133.1, 146.41, 161.05] }],
      points: ["start", "year 1", "year 2", "year 3", "year 4", "year 5"].map((p) => ({ a: p, r: p })),
      words: [{ a: "a brick a year", r: "simple interest" }, { a: "the snowball", r: "compound interest" }, { a: "picking up snow", r: "interest on interest" }],
      steps: [
        { head: "Both start at *£100*", a: "Jack starts a wall and Olivia a snowball, both the same size.", r: "£100 saved two ways, at 10% a year.", facts: [0], upto: 0 },
        { head: "A brick a *year*", a: "Jack adds one brick a year; after a year both are 110.", r: "Simple interest adds £10 a year.", facts: [1], upto: 1, word: 0 },
        { head: "The snowball *pulls ahead*", a: "The snowball picks up a tenth of its own size, so it grows faster and faster.", r: "Compound interest pays 10% of what you have now.", facts: [2], upto: 2, word: 2 },
        { head: "The gap *keeps growing*", a: "By year five the snowball is £11.05 ahead.", r: "After 5 years: £150 against £161.05.", facts: [3], upto: 5, gap: true, word: 1 },
      ],
      rule: "Compound interest earns interest on its interest, so it grows faster every year.",
      breaks: "Money only snowballs while the rate holds and you leave it alone, and debt snowballs in just the same way.",
    },
  },

  law: {
    language: null,
    raw: {
      kind: "graph", type: "flowchart", title: "The school council", place: "A new rule for the school, from idea to signed",
      facts: ["A bill is drafted and read for the first time.", "MPs debate it, then vote.", "If the vote fails, the bill falls.", "Committees go through it line by line.", "The House of Lords checks it and can propose changes.", "The Houses send changes back and forth until they agree.", "Royal Assent makes it an Act."],
      source: "UK Parliament",
      nodes: [
        { id: "idea", shape: "oval", a: "An idea for the school", r: "A bill is drafted", ia: "bulb", ir: "scroll" }, { id: "read", shape: "box", a: "Read it out at assembly", r: "First reading" },
        { id: "debate", shape: "box", a: "Everyone argues about it", r: "Second reading" }, { id: "vote", shape: "diamond", a: "Most hands up?", r: "Commons vote" },
        { id: "fall", shape: "oval", a: "Idea dropped", r: "The bill falls", ia: "bin", lane: 0.86 }, { id: "fix", shape: "box", a: "Fix the details", r: "Committee and report" },
        { id: "lords", shape: "box", a: "The governors check it", r: "House of Lords" }, { id: "agree", shape: "diamond", a: "Both agree?", r: "Both Houses agree?" },
        { id: "law", shape: "oval", a: "The head signs it", r: "Royal Assent", ia: "contract", ir: "crown" },
      ],
      edges: [{ from: "idea", to: "read" }, { from: "read", to: "debate" }, { from: "debate", to: "vote" }, { from: "vote", to: "fall", a: "no", r: "no" }, { from: "vote", to: "fix", a: "yes", r: "yes" },
        { from: "fix", to: "lords" }, { from: "lords", to: "agree" }, { from: "agree", to: "fix", back: true, a: "no: back it goes", r: "no: ping-pong", carry: "scroll" }, { from: "agree", to: "law", a: "yes", r: "yes" }],
      words: [{ a: "an idea for the school", r: "a bill" }, { a: "hands up", r: "a vote" }, { a: "the governors", r: "the House of Lords" }, { a: "back and forth", r: "ping-pong" }],
      steps: [
        { head: "An idea becomes a *bill*", a: "Someone writes down an idea for a new rule and reads it out.", r: "A bill is drafted and given its first reading.", facts: [0], show: ["idea", "read"], word: 0 },
        { head: "MPs *debate* it", a: "Everyone argues about it, then hands go up.", r: "Second reading: a debate, then a vote.", facts: [1], show: ["debate", "vote"], word: 1 },
        { head: "No? It *falls*", a: "If most say no, the idea is dropped.", r: "If the vote fails, the bill falls.", facts: [2], show: ["fall"] },
        { head: "Yes? Fix the *details*", a: "If most say yes, a small group fixes every detail.", r: "Committee and report stages.", facts: [3], show: ["fix"] },
        { head: "The Lords *check* it", a: "The governors read it too, and may ask for changes.", r: "The House of Lords can propose amendments.", facts: [4], show: ["lords", "agree"], word: 2 },
        { head: "Disagree? *Ping-pong*", a: "If they disagree, it goes back and forth.", r: "Amendments go back and forth between the Houses.", facts: [5], show: ["agree-fix"], word: 3,
          ask: { q: "The Lords want a change the Commons won't accept. What happens?", opts: ["The bill is dropped", "It goes back and forth until they agree"], right: 1, why: "That back and forth is called ping-pong; most bills come out of it agreed." } },
        { head: "Signed: it's *law*", a: "When both agree, the head signs it.", r: "Royal Assent: the bill becomes an Act.", facts: [6], show: ["law"] },
      ],
      rule: "A bill becomes law only when both Houses agree the same words and the monarch gives Royal Assent.",
      breaks: "A school council can scrap anything; the Lords can delay most bills but, in the end, not block them.",
    },
  },

  order: {
    language: "typescript",
    raw: {
      kind: "graph", type: "state", title: "The order slip", place: "A shop's order slip, from written to delivered",
      code: 'const next = {\n  placed: ["paid", "cancelled"],\n  paid: ["packed"],\n  packed: ["shipped"],\n  shipped: ["delivered"],\n  delivered: ["returned"],\n  returned: ["refunded"],\n};',
      nodes: [
        { id: "s0", shape: "start", rank: 0, lane: 0.36 }, { id: "placed", a: "A slip is written", r: "placed", ia: "receipt", rank: 1, lane: 0.36 }, { id: "paid", a: "Money in the till", r: "paid", ia: "till", rank: 2, lane: 0.36 },
        { id: "packed", a: "In a box", r: "packed", ia: "parcel", rank: 3, lane: 0.36 }, { id: "shipped", a: "On the van", r: "shipped", ia: "van", rank: 4, lane: 0.36 }, { id: "delivered", a: "On the doorstep", r: "delivered", ia: "door", rank: 5, lane: 0.36 },
        { id: "end", shape: "end", rank: 6, lane: 0.36 }, { id: "cancelled", a: "Torn up", r: "cancelled", ia: "scissors", rank: 1, lane: 0.8 }, { id: "end2", shape: "end", rank: 2, lane: 0.8 },
        { id: "returned", a: "Sent back", r: "returned", ia: "parcel", rank: 5, lane: 0.8 }, { id: "refunded", a: "Money back", r: "refunded", ia: "coin", rank: 6, lane: 0.8 },
      ],
      edges: [{ from: "s0", to: "placed" }, { from: "placed", to: "paid", a: "pay", r: "pay()" }, { from: "placed", to: "cancelled", a: "change your mind", r: "cancel()" }, { from: "cancelled", to: "end2" },
        { from: "paid", to: "packed", a: "pick", r: "pack()" }, { from: "packed", to: "shipped", a: "load", r: "dispatch()", carry: "parcel" }, { from: "shipped", to: "delivered", a: "knock knock", r: "deliver()", carry: "van" },
        { from: "delivered", to: "end" }, { from: "delivered", to: "returned", a: "not right?", r: "return()" }, { from: "returned", to: "refunded", a: "money back", r: "refund()" }, { from: "refunded", to: "end" }],
      words: [{ a: "a slip's status", r: "a state" }, { a: "an arrow", r: "a transition" }, { a: "the end of the road", r: "a final state" }],
      steps: [
        { head: "An order is *placed*", a: "A slip is written for what you want.", r: "Every order starts in the placed state.", line: 2, show: ["s0", "placed"], word: 0 },
        { head: "Then it's *paid*", a: "You pay, and the money goes in the till.", r: "pay() is the only way from placed to paid.", line: 2, show: ["paid"], word: 1 },
        { head: "Or *cancelled*", a: "Or you change your mind before paying.", r: "cancel() leaves only from placed.", line: 2, show: ["cancelled", "end2"],
          ask: { q: "Once an order is paid, can it still be cancelled?", opts: ["Yes, any time", "No: only a placed order can"], right: 1, why: "Only placed has a cancel arrow; the arrows are the only ways to move." } },
        { head: "Packed and *shipped*", a: "It's boxed up and put on the van.", r: "pack() then dispatch().", line: 4, show: ["packed", "shipped"] },
        { head: "*Delivered*", a: "It reaches your doorstep.", r: "deliver() reaches a final state.", line: 5, show: ["delivered", "end"], word: 2 },
        { head: "Sent back, *money back*", a: "If it isn't right, you send it back and get your money back.", r: "return() then refund().", line: 7, show: ["returned", "refunded"] },
      ],
      rule: "An order can only move along the arrows: each state lists the few states that may come next.",
      breaks: "A parcel can be lost on the way; in software an order is always in exactly one state.",
    },
  },

  zoo: {
    language: "python",
    raw: {
      kind: "graph", type: "class", title: "The zoo's family tree", place: "A zoo, its animals, and who is what",
      code: "class Animal:\n    def speak(self): ...\n    def eat(self): ...\n\nclass Dog(Animal):\n    def speak(self): return \"Woof\"\n\nclass Bird(Animal):\n    def fly(self): ...\n\nclass Zoo:\n    animals: list[Animal]",
      nodes: [
        { id: "animal", a: "Every animal", r: "Animal", ia: "dog", rank: 0, lane: 0.62, rows: ["name: str", "speak()", "eat()"] }, { id: "zoo", a: "The zoo's list", r: "Zoo", ia: "checklist", rank: 0, lane: 0.16, rows: ["animals: list[Animal]", "add(animal)"] },
        { id: "dog", a: "A dog", r: "Dog", ia: "dog", rank: 1, lane: 0.45, rows: ['speak() → "Woof"'] }, { id: "bird", a: "A bird", r: "Bird", ia: "bird", rank: 1, lane: 0.8, rows: ["speak()", "fly()"] },
      ],
      edges: [{ from: "dog", to: "animal", kind: "inherit", a: "is an", r: "inherits" }, { from: "bird", to: "animal", kind: "inherit", a: "is an", r: "inherits" }, { from: "zoo", to: "animal", kind: "has", a: "keeps many", r: "has 0..*" }],
      words: [{ a: "every animal", r: "the base class" }, { a: "is an", r: "inherits" }, { a: "keeps many", r: "aggregation" }],
      steps: [
        { head: "Every animal can *speak*", a: "Every animal has a name, eats and makes a sound.", r: "Animal is the base class.", line: 1, show: ["animal"], word: 0 },
        { head: "A dog *is an* animal", a: "A dog is an animal, so it can already eat; it just says Woof.", r: "Dog inherits from Animal and overrides speak().", line: 5, show: ["dog"], word: 1 },
        { head: "A bird adds *fly*", a: "A bird is an animal that can also fly.", r: "Bird inherits from Animal and adds fly().", line: 8, show: ["bird"],
          ask: { q: "A bird can fly. Does the dog get fly() too?", opts: ["Yes, they're both animals", "No, fly() is only Bird's"], right: 1, why: "A class inherits from its parent, never from its siblings." } },
        { head: "The zoo *has* animals", a: "The zoo keeps a list of animals of any kind.", r: "Zoo holds Animals: has-a, not is-a.", line: 11, show: ["zoo"], word: 2 },
      ],
      rule: "Inheritance is “is a” (a Dog is an Animal); holding is “has a” (a Zoo has Animals).",
      breaks: "A class gets exactly what its parent defines, and nothing from its brothers and sisters.",
    },
  },

  school: {
    language: "sql",
    raw: {
      kind: "graph", type: "er", title: "The school office", place: "Cards, lists and a sign-up sheet",
      code: "CREATE TABLE student (id INT PRIMARY KEY, name TEXT);\nCREATE TABLE teacher (id INT PRIMARY KEY, name TEXT);\nCREATE TABLE course (id INT PRIMARY KEY, teacher_id INT REFERENCES teacher(id));\nCREATE TABLE enrolment (student_id INT REFERENCES student(id), course_id INT REFERENCES course(id), grade TEXT);",
      nodes: [
        { id: "student", a: "Pupil cards", r: "student", ia: "student", rank: 0, rows: ["PK id", "name"] }, { id: "enrol", a: "The sign-up sheet", r: "enrolment", ia: "checklist", rank: 1, rows: ["FK student_id", "FK course_id", "grade"] },
        { id: "course", a: "Class lists", r: "course", ia: "book", rank: 2, rows: ["PK id", "title", "FK teacher_id"] }, { id: "teacher", a: "Staff list", r: "teacher", ia: "teacher", rank: 3, rows: ["PK id", "name"] },
      ],
      edges: [{ from: "student", to: "enrol", kind: "onemany", a: "signs up", r: "1 : many" }, { from: "course", to: "enrol", kind: "onemany", a: "has pupils", r: "1 : many" }, { from: "teacher", to: "course", kind: "onemany", a: "teaches", r: "1 : many" }],
      words: [{ a: "a card number", r: "primary key" }, { a: "pointing at a card", r: "foreign key" }, { a: "the sign-up sheet", r: "a join table" }],
      steps: [
        { head: "One card per *pupil*", a: "Every pupil has a card with a number nobody else has.", r: "student: each row has a unique id.", line: 1, show: ["student"], word: 0 },
        { head: "One teacher, many *classes*", a: "One teacher can take many classes.", r: "course.teacher_id points at teacher.id.", line: 3, show: ["teacher", "course"], word: 1 },
        { head: "The *sign-up sheet*", a: "A sheet has a line for each pupil in each class.", r: "enrolment links student and course.", line: 4, show: ["enrol"], word: 2,
          ask: { q: "A pupil takes many classes and a class has many pupils. Where do we write who takes what?", opts: ["On each pupil's card", "On a separate sign-up sheet"], right: 1, why: "Many-to-many needs a table of its own." } },
      ],
      rule: "Give every row its own key, point at other tables by their keys, and give a many-to-many link a table of its own.",
      breaks: "On paper you might copy a name onto every sheet; a database stores it once and points at it.",
    },
  },

  photosynthesis: {
    language: null,
    raw: {
      kind: "graph", type: "mindmap", title: "A leaf's kitchen", place: "Inside a leaf on a sunny day",
      facts: ["6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂", "Plants need light, water and carbon dioxide.", "It happens in chloroplasts.", "It makes glucose and oxygen.", "It starts almost every food chain."],
      nodes: [
        { id: "root", shape: "root", a: "A leaf's kitchen", r: "Photosynthesis", ia: "leaf" },
        { id: "needs", shape: "topic", a: "Ingredients", r: "Needs", tint: "yellow" }, { id: "sun", shape: "leaf", a: "sunshine", r: "light energy", ia: "sun", of: "needs" }, { id: "water", shape: "leaf", a: "a drink", r: "water", ia: "drop", of: "needs" }, { id: "air", shape: "leaf", a: "air", r: "carbon dioxide", ia: "cloud", of: "needs" },
        { id: "where", shape: "topic", a: "The kitchen", r: "Where", tint: "blue" }, { id: "chloro", shape: "leaf", a: "tiny green stoves", r: "chloroplasts", ia: "cell", of: "where" },
        { id: "makes", shape: "topic", a: "What it cooks", r: "Makes", tint: "green" }, { id: "sugar", shape: "leaf", a: "sugar food", r: "glucose", ia: "cake", of: "makes" }, { id: "oxygen", shape: "leaf", a: "fresh air out", r: "oxygen", ia: "lungs", of: "makes" },
        { id: "why", shape: "topic", a: "Why it matters", r: "Why it matters", tint: "pink" }, { id: "food", shape: "leaf", a: "food for everyone", r: "food chains", ia: "apple", of: "why" },
      ],
      edges: [],
      words: [{ a: "ingredients", r: "reactants" }, { a: "tiny green stoves", r: "chloroplasts" }, { a: "sugar food", r: "glucose" }],
      steps: [
        { head: "A leaf's *kitchen*", a: "Every green leaf is a little kitchen that cooks with sunlight.", r: "Photosynthesis: plants make food from light.", facts: [0], show: ["root"] },
        { head: "The *ingredients*", a: "It needs sunshine, a drink of water, and air.", r: "Light, water and carbon dioxide.", facts: [1], show: ["needs", "sun", "water", "air"], word: 0 },
        { head: "The *kitchen*", a: "The cooking happens on tiny green stoves.", r: "In chloroplasts.", facts: [2], show: ["where", "chloro"], word: 1 },
        { head: "What it *makes*", a: "It cooks sugar for food and breathes out fresh air.", r: "Glucose and oxygen.", facts: [3], show: ["makes", "sugar", "oxygen"], word: 2,
          ask: { q: "Light, water and air go in. What comes out, besides sugar?", opts: ["Carbon dioxide", "Oxygen"], right: 1, why: "The plant gives off oxygen, the gas we breathe in." } },
        { head: "Why it *matters*", a: "Almost every animal's food starts here.", r: "It starts food chains.", facts: [4], show: ["why", "food"] },
      ],
      rule: "Photosynthesis uses light to turn water and carbon dioxide into sugar and oxygen.",
      breaks: "A kitchen cooks with heat; a leaf cooks with light, in millions of chloroplasts at once.",
    },
  },

  https: {
    language: null,
    raw: {
      kind: "sequence", title: "The padlocked box", place: "Emily and her bank, talking across a busy street",
      facts: ["The TCP handshake opens a connection.", "Client Hello and Server Hello agree the cipher.", "The server sends its certificate with its public key.", "The browser encrypts a session key with the public key.", "Only the private key can decrypt it.", "Both switch to the session key.", "Everything after is encrypted with the session key."],
      source: "TLS 1.2 with RSA key exchange",
      parts: [{ id: "c", a: "Emily", r: "your browser", ia: "person", ir: "browser" }, { id: "s", a: "the bank", r: "the server", ia: "bank", ir: "server" }],
      chips: [{ id: "pub", a: "the open padlock", r: "public key", ia: "key", tint: "blue" }, { id: "priv", a: "the bank's own key", r: "private key", ia: "key", tint: "pink" }, { id: "sess", a: "the secret word", r: "session key", ia: "key", tint: "yellow" }, { id: "box", a: "the locked box", r: "encrypted session key", ia: "padlock", tint: "pink" }],
      rows: [
        { id: "m1", from: "c", to: "s", a: "Hello, are you there?", r: "TCP SYN" }, { id: "m2", from: "s", to: "c", a: "Yes, I'm here!", r: "TCP SYN + ACK" }, { id: "m3", from: "c", to: "s", a: "Great, let's talk", r: "TCP ACK" },
        { id: "d1", divider: true, a: "the line is open", r: "connection established" },
        { id: "m4", from: "c", to: "s", a: "The locks I know", r: "Client Hello" }, { id: "m5", from: "s", to: "c", a: "Let's use this one", r: "Server Hello" }, { id: "m6", from: "s", to: "c", a: "My ID, and an open padlock", r: "Certificate", carry: "pub" },
        { id: "m8", from: "c", to: "s", a: "The secret word, locked in a box", r: "Client Key Exchange", carry: "box" }, { id: "m9", from: "c", to: "s", a: "I'll whisper from now on", r: "Change Cipher Spec" }, { id: "m10", from: "s", to: "c", a: "Me too", r: "Change Cipher Spec" },
        { id: "m13", from: "c", to: "s", a: "A whispered message", r: "Encrypted data", carry: "sess" }, { id: "m14", from: "s", to: "c", a: "A whispered reply", r: "Encrypted data", carry: "sess" },
      ],
      phases: [{ a: "Say hello", r: "TCP handshake", from: "m1", to: "d1", tone: "blue" }, { a: "Check the ID", r: "Certificate check", from: "m4", to: "m6", tone: "green" }, { a: "Share a secret", r: "Key exchange", from: "m8", to: "m10", tone: "purple" }, { a: "Talk in secret", r: "Data", from: "m13", to: "m14", tone: "yellow" }],
      insets: [{ id: "enc", side: "c", row: "m8", ins: ["sess", "pub"], out: "box", a: "Emily snaps the padlock shut on the secret word", r: "encrypt the session key with the public key" }, { id: "dec", side: "s", row: "m9", ins: ["box", "priv"], out: "sess", a: "Only the bank's own key opens it", r: "decrypt with the private key" }],
      words: [{ a: "the open padlock", r: "public key" }, { a: "the bank's own key", r: "private key" }, { a: "the secret word", r: "session key" }],
      steps: [
        { head: "Say *hello*", a: "Emily knocks, the bank answers, and the line is open.", r: "The TCP handshake opens a connection.", facts: [0], show: ["m1", "m2", "m3", "d1"] },
        { head: "Agree on a *lock*", a: "They agree which kind of lock to use.", r: "Client Hello and Server Hello.", facts: [1], show: ["m4", "m5"] },
        { head: "An *open padlock*", a: "The bank sends its ID with an open padlock anyone can snap shut.", r: "The certificate carries the public key.", facts: [2], show: ["m6"], word: 0 },
        { head: "Lock the *secret*", a: "Emily locks a secret word in a box with that padlock and sends it.", r: "The browser encrypts a session key with the public key.", facts: [3], show: ["enc", "m8"],
          ask: { q: "Emily locks the box with the bank's open padlock. Who can open it?", opts: ["Anyone with the padlock", "Only the bank, with its own key"], right: 1, why: "Anyone can snap the padlock shut; only one key opens it." } },
        { head: "Only the bank can *open* it", a: "The bank opens the box with the key it never shares.", r: "The private key decrypts the session key.", facts: [4], show: ["dec"], word: 1 },
        { head: "Talk in *secret*", a: "Both whisper with the secret word from now on.", r: "Everything is encrypted with the session key.", facts: [5, 6], show: ["m9", "m10", "m13", "m14"], word: 2 },
      ],
      rule: "Anyone can lock a box with the server's open padlock, but only the server can open it: that is how both sides agree a secret.",
      breaks: "A real padlock can be cut; this one is maths nobody can undo in time.",
    },
  },
};
