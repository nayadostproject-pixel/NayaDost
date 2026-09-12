from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3, time

app = Flask(__name__)
CORS(app)
DB = "nayadost.db"

def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c

def speed(level):
    level = max(1, min(1000, int(level)))
    return round(0.20 * (level ** 0.65), 6)

def get_user(uid):
    c = db()
    u = c.execute("SELECT * FROM users WHERE telegram_id=?", (uid,)).fetchone()
    if not u:
        c.execute(
            "INSERT INTO users (telegram_id, username) VALUES (?,?)",
            (uid, request.args.get("username", "Tester"))
        )
        c.commit()
        u = c.execute("SELECT * FROM users WHERE telegram_id=?", (uid,)).fetchone()
    c.close()
    return u

@app.get("/api/me")
def me():
    uid = request.args.get("telegram_id")
    if not uid:
        return jsonify({"error": "telegram_id required"}), 400

    u = get_user(int(uid))
    now = int(time.time())
    level = u["miner_level"]
    return jsonify({
        "telegram_id": u["telegram_id"],
        "balance": u["balance"],
        "level": level,
        "speed": speed(level),
        "mining_started": bool(u["mining_started"]),
        "last_claim": u["last_claim"],
        "server_time": now
    })

@app.post("/api/start")
def start():
    data = request.get_json(force=True)
    uid = int(data["telegram_id"])
    get_user(uid)

    c = db()
    now = int(time.time())
    c.execute(
        "UPDATE users SET mining_started=1, last_claim=? WHERE telegram_id=? AND mining_started=0",
        (now, uid)
    )
    c.commit()
    c.close()
    return jsonify({"ok": True, "mining_started": True})

@app.post("/api/claim")
def claim():
    data = request.get_json(force=True)
    uid = int(data["telegram_id"])
    u = get_user(uid)

    if not u["mining_started"]:
        return jsonify({"error": "Mining not started"}), 400

    now = int(time.time())
    elapsed = max(0, now - int(u["last_claim"] or now))

    # TEST ECONOMY:
    # Level 1 earns 0.0002 NYD per minute.
    # Speed multiplier increases automatically with miner level.
    earned = (elapsed / 60.0) * 0.0002 * (speed(u["miner_level"]) / 0.20)

    c = db()
    c.execute(
        "UPDATE users SET balance=balance+?, last_claim=? WHERE telegram_id=?",
        (earned, now, uid)
    )
    c.commit()

    new_balance = c.execute(
        "SELECT balance FROM users WHERE telegram_id=?", (uid,)
    ).fetchone()["balance"]
    c.close()

    return jsonify({
        "ok": True,
        "earned": round(earned, 8),
        "balance": round(new_balance, 8),
        "elapsed_seconds": elapsed
    })

if __name__ == "__main__":
    print("NYD TEST API running on http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=False)
