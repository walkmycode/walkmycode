// The notes API.
const express = require("express");

const app = express();

app.get("/notes", (req, res) => res.json([]));
app.post("/notes", (req, res) => res.status(201).json({}));
app.get("/notes/:id", (req, res) => res.json({}));
app.get("/health", (req, res) => res.send("ok"));

app.listen(8000);
