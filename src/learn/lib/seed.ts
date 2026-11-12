import type { Lesson } from "./types";

/** The first lesson of the machine learning course, written by hand. Every
 *  later lesson, in any subject, is written by the professor on request. */
export const ML_LESSON_1: Omit<Lesson, "id" | "createdAt" | "updatedAt" | "at" | "seen"> = {
  course: "Machine learning, from zero",
  number: 1,
  title: "What does it mean for a machine to learn?",
  subject: "Machine learning",
  summary:
    "A model is a rule the computer learns from examples. Learning means turning the model's knobs to make the loss smaller, and a score only counts on data the model has never seen.",
  boards: [
    { title: "Good evening. Let's begin.", kind: "talk", lines: [
      { w: "Today, one question:", s: "Good evening, and welcome to your first lesson. Today we answer one question." },
      { w: "[[What does it mean for a machine to learn?]]", s: "What does it mean for a machine to learn?" },
      { w: "No code today. Just ideas, in plain words.", s: "There is no code today. Just ideas, in plain words. If you understand today, everything later will make sense." },
      { w: "Keep a notebook open. At the end, you explain it back to me.", s: "Keep a notebook open. At the end of the lesson, you will explain it back to me, in your own words." },
    ]},
    { title: "The old way: people write the rules", kind: "talk", lines: [
      { w: "For decades, programmers wrote **rules** by hand.", s: "For decades, programmers told computers exactly what to do, by writing rules by hand." },
      { w: "`if temperature > 30 → say \"hot\"`", s: "For example: if the temperature is above thirty degrees, say hot. Simple, and it works." },
      { w: "But try writing the rule for: {pink:\"Is this person stuttering?\"}", s: "But now try to write the rule for this: is this person stuttering right now?" },
      { w: "Pauses? Repeats? Tense lips? Every person is different.", s: "Is it the pauses? The repeated sounds? Tension in the lips? Every person is different, and every moment is different." },
      { w: "Some rules are **too hard for people to write down**.", s: "Some rules are simply too hard for people to write down. This is where machine learning comes in." },
    ]},
    { title: "The new way: show examples, let it find the rule", kind: "talk", lines: [
      { w: "Instead of rules, we give the computer **examples**.", s: "In machine learning, we do not write the rule. We give the computer examples." },
      { w: "Each example: the {blue:inputs} and the {green:right answer}.", s: "Each example has two parts. The inputs, and the right answer." },
      { w: "The computer searches for a rule that turns inputs into answers.", s: "The computer then searches for a rule that turns the inputs into the answers, as well as it can." },
      { w: "That found rule is called a **model**.", s: "The rule it finds is called a model. Remember that word. A model is just a rule that the computer learned from examples." },
      { w: "Like a child learning \"dog\": nobody gives a definition, just many dogs.", s: "It is like a child learning the word dog. Nobody gives the child a definition. They just see many dogs, and they learn." },
    ]},
    { title: "A tiny example: taxi fares in London", kind: "talk", lines: [
      { w: "We record six trips:", s: "Let us use a tiny example. Imagine we record six taxi trips in London.",
        table: { head: ["distance (km)", "fare (£)"], rows: [["1", "8"], ["2", "11"], ["3", "14"], ["5", "19"], ["7", "25"], ["9", "31"]] } },
      { w: "{blue:Distance} is the input. We call it a **feature**, {blue:x}.", s: "The distance is the input. In machine learning we call an input a feature, and we often write it as x." },
      { w: "{green:Fare} is the answer. We call it the **label**, {green:y}.", s: "The fare is the answer we want to predict. We call it the label, and we write it as y." },
      { w: "Question: a new trip is 6 km. What fare?", s: "Now the question. A new trip is six kilometres. What will the fare be? That is prediction." },
    ]},
    { title: "The model: a guess with knobs", kind: "talk", lines: [
      { w: "Our guess: fare grows with distance, in a straight line.", s: "Our guess is simple: the fare grows with the distance, in a straight line." },
      { w: "`fare = a × distance + b`", s: "We write it like this. Fare equals a, times distance, plus b." },
      { w: "**a** = pounds per kilometre.  **b** = the starting charge.", s: "a is how many pounds each kilometre costs. b is the starting charge, the money you pay just for getting in." },
      { w: "a and b are the model's **knobs**. The proper name: **parameters**.", s: "a and b are like knobs on a radio. We can turn them. Their proper name is parameters." },
      { w: "**Learning = finding the best knob settings.**", s: "And here is the big idea of today. Learning means finding the best settings for the knobs." },
    ]},
    { title: "How wrong is our guess?", kind: "talk", lines: [
      { w: "For each trip: `error = guess − true fare`", s: "To find the best knobs, we must measure how wrong a guess is. For each trip, the error is our guess minus the true fare." },
      { w: "We square each error, so big mistakes count more, and minus never cancels plus.", s: "We square each error. Squaring makes every error positive, so they cannot cancel out, and it makes big mistakes count much more than small ones." },
      { w: "Average them: the **loss**. {pink:Small loss = good model.}", s: "Then we take the average. That number is called the loss. A small loss means a good model. A big loss means a bad one." },
      { w: "Learning, in one line: **turn the knobs to make the loss smaller.**", s: "So now we can say what learning really is. Turn the knobs, a little at a time, in the direction that makes the loss smaller." },
      { w: "Try it yourself on the next board →", s: "Enough talking. On the next board, you will turn the knobs yourself." },
    ]},
    { title: "Your turn: be the learning machine", kind: "lab-taxi", lines: [
      { w: "Move the knobs. Watch the line, and watch the loss.", s: "Move the two knobs. Watch the line move, and watch the loss. Try to make the loss as small as you can." },
      { w: "Then press **Let the machine learn** and watch it do the same thing.", s: "Then press the button: let the machine learn. It will do exactly what you did: small turns of the knobs, always downhill, towards a smaller loss. That method has a name. Gradient descent. We will study it properly later." },
    ]},
    { title: "The exam rule: never test on what you studied", kind: "talk", lines: [
      { w: "A student who **memorises** the past paper scores 100%… on that paper.", s: "Now a very important rule. Imagine a student who memorises last year's exam paper. On that paper, they score one hundred percent." },
      { w: "On a new paper? They fail. They never understood.", s: "But give them a new paper, and they fail. They memorised. They never understood." },
      { w: "Models do this too. It is called {pink:**overfitting**}.", s: "Models can do exactly the same thing. We call it overfitting." },
      { w: "So we split the data: {blue:training set} to learn, {green:test set} to check.", s: "So we always split our data. The training set is for learning. The test set is kept hidden, and used only at the end, to check." },
      { w: "**A score only counts on data the model has never seen.**", s: "Write this down: a score only counts on data the model has never seen. In your project, that will mean speakers the model has never heard." },
    ]},
    { title: "Two kinds of questions", kind: "talk", lines: [
      { w: "**Regression**: the answer is a {blue:number}.", s: "Machine learning mostly answers two kinds of questions. The first is regression, where the answer is a number." },
      { w: "\"What will the fare be?\" → £22.", s: "What will the fare be? Twenty two pounds. That is regression." },
      { w: "**Classification**: the answer is a {green:category}.", s: "The second is classification, where the answer is a category, a choice between groups." },
      { w: "\"Is this moment fluent or a block?\" → block.", s: "Is this moment of speech fluent, or a block? That is classification." },
      { w: "Both learn from examples with answers: **supervised learning**.", s: "Both of these learn from examples that come with the right answers. Together we call them supervised learning. There is also unsupervised learning, which finds groups without any answers, but that is for another day." },
    ]},
    { title: "Where this goes: your project", kind: "talk", lines: [
      { w: "FlowSignals, part 2, in today's words:", s: "Let me show you where this is going. Here is part two of your project, FlowSignals, described in today's words." },
      { w: "{blue:Features}: lip speed, pauses, loudness, pitch…", s: "The features will be numbers from your lips and your voice. Lip speed, pauses, loudness, pitch." },
      { w: "{green:Label}: fluent or disfluent.", s: "The label will be: fluent, or disfluent." },
      { w: "**Model**: a classifier. **Learning**: making its loss smaller.", s: "The model will be a classifier, and learning will mean making its loss smaller, exactly like the taxi line." },
      { w: "**Honest test**: on speakers it has never heard.", s: "And the honest test will be on speakers it has never heard. You now know why." },
    ]},
    { title: "Summary: three ideas, over and over", kind: "talk", lines: [
      { w: "1. Turn the world into **numbers**.", s: "Let us summarise. Machine learning is three ideas, repeated over and over. One. Turn the world into numbers." },
      { w: "2. Make a **guess** with knobs: a model.", s: "Two. Make a guess with knobs. That is a model." },
      { w: "3. **Measure how wrong** it is, and turn the knobs to be less wrong.", s: "Three. Measure how wrong it is, the loss, and turn the knobs to be less wrong. That is learning." },
      { w: "And test it only on data it has never seen.", s: "And always test it on data it has never seen." },
      { w: "Well done. Now: explain it back →", s: "Well done. That is lesson one. Now, the most important part. Explain it back to me." },
    ]},
    { title: "Explain it back", kind: "explain", lines: [
      { w: "Answer in your own words, 3–5 sentences in total:", s: "Answer these four questions in your own words. Three to five sentences in total is enough. Do not look back at the boards." },
    ], questions: [
      "What is a **model**?",
      "What does it mean for a model to **learn**?",
      "Why do we test on data the model has **never seen**?",
      "Give one example of **regression** and one of **classification**.",
    ]},
  ],
};
