/**
 * The names of the drawings (src/lib/drawings), on their own: a model that
 * answers is told them so it can pick one, and a prompt should not have to
 * carry the drawings to do it. tests/drawings.test.ts keeps this list the
 * same as the set.
 */
export const DRAWING_NAMES = [
  "child", "teacher", "teddy", "box", "drawer", "memory", "checker", "van", "shop", "letter", "parcel", "laptop", "cloud", "server", "page", "tray",
  "gone", "person", "baby", "doctor", "chef", "guard", "farmer", "king", "scientist", "builder", "customer", "crowd", "ball", "book", "toycar",
  "key", "padlock", "cup", "plate", "cake", "pizza", "apple", "backpack", "coat", "ticket", "gift", "bed", "chair", "umbrella", "house", "school",
  "bank", "hospital", "factory", "library", "castle", "bridge", "road", "tower", "tent", "island", "car", "bus", "train", "ship", "plane", "bicycle",
  "rocket", "coin", "banknote", "wallet", "piggybank", "scales", "basket", "receipt", "stall", "flag", "globe", "sun", "moon", "star", "planet",
  "drop", "fire", "mountain", "river", "wave", "tree", "leaf", "flower", "sprout", "dog", "cat", "bird", "fish", "bee", "egg", "magnet", "battery",
  "bulb", "atom", "molecule", "flask", "thermometer", "heart", "brain", "lungs", "cell", "dna", "blocks", "ruler", "piechart", "barchart", "dice",
  "clock", "phone", "database", "folder", "gear", "robot", "shield", "bug", "plug", "cable", "antenna", "chip", "screen", "cursor", "token", "queue",
  "stack", "pipe", "funnel", "trafficlight", "gate", "signpost", "mailbox", "bell", "hourglass", "calendar", "switch", "magnifier", "toolbox",
  "wrench", "puzzle", "brick", "recipe", "trophy", "bin", "police", "firefighter", "nurse", "pilot", "judge", "student", "developer", "artist",
  "musician", "driver", "athlete", "grandparent", "engineer", "waiter", "soldier", "astronaut", "loadbalancer", "gateway", "api", "cache", "cdn",
  "broker", "container", "cluster", "service", "serverless", "webhook", "ratelimiter", "replica", "shard", "browser", "dns", "router", "internet",
  "firewall", "vpn", "certificate", "bucket", "datacenter", "rack", "backup", "logs", "dashboard", "siren", "code", "terminal", "function",
  "variable", "array", "linkedlist", "binarytree", "graph", "hashmap", "binary", "json", "blueprint", "loop", "branch", "commit", "merge",
  "pullrequest", "conveyor", "checklist", "package", "chain", "tag", "fork", "thread", "dolls", "flowchart", "keyboard", "mouse", "printer",
  "harddrive", "ram", "usb", "tablet", "watch", "camera", "microphone", "speaker", "headphones", "gamepad", "satellite", "sensor", "qrcode",
  "fingerprint", "password", "card", "desktop", "headset", "drone", "microscope", "telescope", "testtube", "pendulum", "spring", "pulley", "seesaw",
  "prism", "rainbow", "volcano", "lightning", "snowflake", "raincloud", "calculator", "shapes", "protractor", "abacus", "linechart", "virus", "germ",
  "tooth", "bone", "eye", "ear", "hand", "stomach", "kidney", "muscle", "syringe", "pill", "stethoscope", "bandage", "scroll", "sword", "crown",
  "ballot", "parliament", "gavel", "map", "compass", "anchor", "pyramid", "newspaper", "megaphone", "medal", "passport", "pin", "cactus", "turbine",
  "solar", "recycle", "handshake", "contract", "briefcase", "office", "trolley", "trend", "suitcase", "stamp", "target", "easel", "moneybag", "till",
  "shelves", "door", "window", "ladder", "stairs", "tap", "kettle", "saucepan", "fridge", "washer", "lamp", "candle", "scissors", "paperclip",
  "pencil", "mirror", "glasses", "palette", "music", "guitar", "piano", "drum", "masks", "speech", "whistle", "stopwatch", "shoe", "chess", "kite",
  "balloon", "goal",
] as const;

/** What a model is told, once, wherever it may write a scene or a picture diagram. */
export const DRAWING_LIST = `In a scene or a picture diagram, give each actor, thing and node "ia": its drawing, a name from this list when one fits (leave it out when none does): ${DRAWING_NAMES.join(", ")}.`;
