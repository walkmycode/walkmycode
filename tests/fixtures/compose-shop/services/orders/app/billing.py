# Charges go to the payments service, whose code is not in this repo.
import os

import requests


def charge(order_id: int, amount: int):
    r = requests.post(os.getenv("PAYMENTS_URL") + "/charge", json={"order": order_id, "amount": amount})
    return r.json()
