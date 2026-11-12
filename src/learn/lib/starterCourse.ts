/**
 * The starter course Learn can write into a new folder ("Make a starter
 * course" on the Course from a folder screen; docs/COURSES.md is its guide).
 * Three lessons, one in each shape Learn reads, on a subject with no code
 * (how to study) and one with code, so an author of any discipline has
 * something real to copy and change. Paths are inside the course folder.
 */
const F = "```";

export const STARTER_COURSE: Record<string, string> = {
  "README.md": `# My course

One or two sentences on what this course teaches and who it is for. Learn shows this as the course's description.

## How this folder is read

- Each folder in here is a **unit**. Number them so they are taught in order: \`01_...\`, \`02_...\`.
- Each lesson is a numbered Markdown file (\`01_my-lesson.md\`) or a folder with a \`README.md\`.
- Delete these example lessons when you have written your own.
`,

  "01_getting-started/01_how-to-study.md": `# How to study so it sticks

Most people reread their notes and feel ready. This lesson shows two habits that work better: testing yourself, and spacing it out.

> 💡 **The big picture: a path through tall grass.** Walk a path once and the grass springs back. Walk it again tomorrow, and again next week, and it becomes a path anyone can follow. Remembering works the same way.

## Rereading feels good and does little

Reading a page again feels smooth, and that smoothness is mistaken for knowing. Knowing means being able to bring the idea back with the page closed.

> 💡 **Analogy: watching someone ride a bike.** You can watch a hundred times and still fall off. You learn by riding.

## Test yourself

Close the book and say or write what you remember. Every time you pull an idea out of your head, it gets easier to pull out next time.

| Habit | What it feels like | What it does |
|---|---|---|
| Rereading | Easy | Little |
| Testing yourself | Hard | A lot |

> 💡 **Analogy: lifting a weight.** The effort is the point. A weight that is easy to lift is not making you stronger.

## Space it out

Come back to an idea after a day, then three days, then a week. Forgetting a little before each return is what makes the memory strong.

## Checklist

- [ ] Why rereading misleads
- [ ] Testing yourself
- [ ] Spacing

## Exercises

1. In your own words, why does rereading feel more useful than it is?
2. You have a test in ten days and three hours to prepare. Describe how you would spread the three hours, and what you would do in each sitting.

## Answers

1. Rereading is smooth, and we mistake that ease for knowing. Real knowing is recall with the page closed, which rereading never practises.
2. Several short sittings spread over the ten days (for example six of thirty minutes), each one starting with the book closed: write down what you remember, check it, and study only what was missing. One sitting the day before is the weakest plan.
`,

  "01_getting-started/02_taking-notes/README.md": `# Taking notes you will use

A lesson can also be a folder with a \`README.md\`. Use a folder when the lesson has files of its own: exercises with model answers, code to run, or a small project.

> 💡 **The big picture: packing a bag for a trip.** You cannot carry the whole house. Good notes are the few things you will actually need when you get there.

## Write questions, not sentences

Turn each idea into a question you can answer later. "What are the two habits that make learning stick?" is a note you can test yourself with. A copied sentence is not.

> 💡 **Analogy: a shopping list.** A list tells you what to fetch. A photograph of the shop does not.

## One page, your own words

If you cannot say it in your own words, you have copied it, not learnt it.

## Checklist

- [ ] Notes as questions
- [ ] Your own words
`,

  "01_getting-started/02_taking-notes/exercises/ex01_rewrite.md": `# Turn a note into a question

Here is a copied note: "Spaced repetition improves long-term retention compared with massed practice."

Rewrite it as one or two questions you could test yourself with next week, in plain words.
`,

  "01_getting-started/02_taking-notes/solutions/sol01_rewrite.md": `A good answer asks for the idea rather than the wording, for example: "Why is studying a little on several days better than a lot on one day?" and "What should I do just before I look at my notes again?" Plain words, and each question has an answer the student can check.
`,

  "02_with-code/01_first-program/README.md": `# A first program

A lesson with code: examples to run, and exercises paired with solutions by number.

> 💡 **The big picture: a recipe.** A program is a recipe the computer follows one line at a time, exactly as written.

## Printing

\`print\` shows a value on the screen.

${F}python
print("Hello")
${F}

> 💡 **Analogy: saying it out loud.** The computer knows many things silently. \`print\` is how it says one of them aloud.

## Names for values

A variable is a name for a value, so you can use it again.

> 💡 **Analogy: a label on a jar.** The label is not the jam. It tells you which jar to open.

## Checklist

- [ ] print
- [ ] Variables
`,

  "02_with-code/01_first-program/examples/hello.py": `# One idea per example file. The student runs it from the board, then changes it.
name = "Emily"
print("Hello,", name)
`,

  "02_with-code/01_first-program/exercises/ex01_greet.py": `# Exercise 1: greet two people.
#
# Make this print "Hello, Emily" and then "Hello, Jack", using the variable each time.
# The comment at the top of an exercise file is the task the student sees.

first = "Emily"
second = "Jack"
print("Hello,")  # TODO: finish this line, then add one for the second name
`,

  "02_with-code/01_first-program/solutions/sol01_greet.py": `# Solution to exercise 1. Paired by number: ex01_... with sol01_...
# The student sees it only after three hints or a real attempt.

first = "Emily"
second = "Jack"
print("Hello,", first)
print("Hello,", second)
`,
};
