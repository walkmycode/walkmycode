// The users service: four doors, three of them handled by named functions.
const express = require("express");
const { Pool } = require("pg");

const app = express();
const db = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.get("/users/:id", getUser);
app.get("/users", listUsers);
app.post("/users", createUser);
app.get("/health", (req, res) => res.json({ ok: true }));

async function getUser(req, res) {
  const r = await db.query("SELECT * FROM users WHERE id=$1", [req.params.id]);
  res.json(r.rows[0] ?? null);
}

async function listUsers(req, res) {
  const r = await db.query("SELECT id, name FROM users ORDER BY id");
  res.json(r.rows);
}

async function createUser(req, res) {
  const r = await db.query("INSERT INTO users (name) VALUES ($1) RETURNING *", [req.body.name]);
  res.status(201).json(r.rows[0]);
}

app.listen(8080);
