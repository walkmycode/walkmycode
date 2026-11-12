# The orders service: takes an order, checks the user with the users service,
# and tells everyone on the orders.created topic.
import os

import requests
from confluent_kafka import Producer
from fastapi import FastAPI

from .db import conn

app = FastAPI()
producer = Producer({"bootstrap.servers": os.environ["KAFKA_BROKERS"]})


@app.post("/orders")
def create_order(uid: int):
    users = requests.get("http://users:8080/users").json()
    user = requests.get(f"{os.environ['USERS_URL']}/users/{uid}").json()
    cur = conn.cursor()
    cur.execute("INSERT INTO orders (user_id) VALUES (%s)", (uid,))
    cur.execute("INSERT INTO users (id, name) VALUES (%s, %s) ON CONFLICT DO NOTHING", (uid, user["name"]))
    conn.commit()
    producer.produce(topic="orders.created", value=str(uid))
    return {"ok": True, "known": len(users)}


@app.get("/health")
def health():
    return {"ok": True}
