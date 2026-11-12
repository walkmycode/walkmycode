// A second API with a notes list of its own, so a path alone can't say which one is meant.
const express = require("express");

const app = express();

app.get("/notes", (req, res) => res.json([]));
app.delete("/notes/:id", (req, res) => res.status(204).end());

app.listen(8100);
