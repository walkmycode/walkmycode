from fastapi import FastAPI

app = FastAPI()


@app.get("/items")
def list_items():
    return []


@app.get("/items/{item_id}")
def get_item(item_id: str):
    return {"id": item_id}


@app.post("/orders")
def create_order():
    return {"ok": True}
