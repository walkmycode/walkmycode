// A course kept as a folder on this computer, read for the Learn room
// (src/lib/learnCourse.ts): the outline of its lessons, or one lesson's README,
// examples, exercises and solutions. Loopback + same-origin only (guarded).
import { guarded } from "@/lib/providers/guard";
import { learnCourseHandler } from "@/lib/learnCourse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = guarded(learnCourseHandler());
