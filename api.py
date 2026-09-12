from flask import Flask, request, jsonify
from pathlib import Path
from flask_cors import CORS
from price_config import NYD_USDT_PRICE
import sqlite3, time

app = Flask(__name__)
CORS(app)
DB = str(Path(__file__).resolve().parent / "nayadost.db")

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

@app.post("/api/wallet/connect")
def connect_wallet():
    data = request.get_json(force=True)
    uid = int(data["telegram_id"])
    address = str(data.get("wallet_address", "")).strip()
    network = str(data.get("network", "TESTNET")).strip()

    if not address:
        return jsonify({"error": "Wallet address required"}), 400

    c = db()
    now = int(time.time())
    usdt_price = NYD_USDT_PRICE
    usdt_amount = amount * usdt_price

    c.execute("""
        INSERT INTO wallets (telegram_id, wallet_address, network, connected_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
            wallet_address=excluded.wallet_address,
            network=excluded.network,
            connected_at=excluded.connected_at
    """, (uid, address, network, now))

    c.commit()
    c.close()

    return jsonify({
        "ok": True,
        "wallet_address": address,
        "network": network
    })


@app.get("/api/wallet")
def get_wallet():
    uid = request.args.get("telegram_id")

    if not uid:
        return jsonify({"error": "telegram_id required"}), 400

    c = db()
    w = c.execute(
        "SELECT wallet_address, network, connected_at FROM wallets WHERE telegram_id=?",
        (int(uid),)
    ).fetchone()
    c.close()

    if not w:
        return jsonify({"connected": False})

    return jsonify({
        "connected": True,
        "wallet_address": w["wallet_address"],
        "network": w["network"],
        "connected_at": w["connected_at"]
    })


@app.post("/api/wallet/disconnect")
def disconnect_wallet():
    data = request.get_json(force=True)
    uid = int(data["telegram_id"])

    c = db()
    c.execute("DELETE FROM wallets WHERE telegram_id=?", (uid,))
    c.commit()
    c.close()

    return jsonify({"ok": True})


@app.post("/api/withdraw")
def withdraw():
    data = request.get_json(force=True)
    uid = int(data["telegram_id"])

    try:
        amount = float(data.get("amount", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid amount"}), 400

    if amount < 500:
        return jsonify({"error": "Minimum withdrawal is 500 NYD"}), 400

    if amount > 10000:
        return jsonify({"error": "Maximum withdrawal is 10000 NYD"}), 400

    burn = 15.0
    payout_nyd = round(amount - burn, 8)

    c = db()

    user = c.execute(
        "SELECT balance FROM users WHERE telegram_id=?",
        (uid,)
    ).fetchone()

    wallet = c.execute(
        "SELECT wallet_address, network FROM wallets WHERE telegram_id=?",
        (uid,)
    ).fetchone()

    if not user:
        c.close()
        return jsonify({"error": "User not found"}), 404

    if not wallet:
        c.close()
        return jsonify({"error": "Connect wallet first"}), 400

    if amount > user["balance"]:
        c.close()
        return jsonify({"error": "Insufficient balance"}), 400

    now = int(time.time())

    c.execute(
        "UPDATE users SET balance = balance - ? WHERE telegram_id=?",
        (amount, uid)
    )

    cur = c.execute("""
        INSERT INTO withdrawals
        (telegram_id, amount, wallet_address, network, status, created_at,
         usdt_price, usdt_amount, burn_nyd)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    """, (
        uid,
        payout_nyd,
        wallet["wallet_address"],
        wallet["network"],
        now,
        usdt_price,
        payout_nyd * usdt_price,
        burn
    ))

    withdrawal_id = cur.lastrowid

    c.commit()
    c.close()

    return jsonify({
        "ok": True,
        "withdrawal_id": withdrawal_id,
        "amount": round(amount, 8),
        "wallet_address": wallet["wallet_address"],
        "network": wallet["network"],
        "status": "pending",
        "usdt_price": usdt_price,
        "usdt_amount": round(payout_nyd * usdt_price, 8),
        "burn_nyd": burn,
        "payout_nyd": payout_nyd
    })


@app.get("/api/withdrawals")
def withdrawal_history():
    uid = request.args.get("telegram_id")
    if not uid:
        return jsonify({"error": "telegram_id required"}), 400

    c = db()
    rows = c.execute("""
        SELECT id, amount, wallet_address, network, status,
               created_at, usdt_price, usdt_amount, processed_at
        FROM withdrawals
        WHERE telegram_id=?
        ORDER BY id DESC
    """, (int(uid),)).fetchall()
    c.close()

    return jsonify({"withdrawals": [dict(row) for row in rows]})


@app.get("/api/admin/withdrawals")
def admin_withdrawals():
    c = db()
    rows = c.execute("""
        SELECT id, telegram_id, amount, burn_nyd,
               (amount - burn_nyd) AS payout_nyd,
               usdt_price, usdt_amount,
               wallet_address, network, status, created_at, processed_at
        FROM withdrawals
        ORDER BY id DESC
    """).fetchall()
    c.close()
    return jsonify({"withdrawals": [dict(row) for row in rows]})

@app.post("/api/admin/withdrawal/status")
def admin_withdrawal_status():
    data = request.get_json(force=True)
    withdrawal_id = int(data["withdrawal_id"])
    status = str(data.get("status", "")).lower().strip()

    if status not in ("paid", "rejected"):
        return jsonify({"error": "Status must be paid or rejected"}), 400

    c = db()
    row = c.execute(
        "SELECT id, status FROM withdrawals WHERE id=?",
        (withdrawal_id,)
    ).fetchone()

    if not row:
        c.close()
        return jsonify({"error": "Withdrawal not found"}), 404

    if row["status"] != "pending":
        c.close()
        return jsonify({"error": "Withdrawal already processed"}), 400

    now = int(time.time())

    if status == "rejected":
        w = c.execute(
            "SELECT telegram_id, amount FROM withdrawals WHERE id=?",
            (withdrawal_id,)
        ).fetchone()
        c.execute(
            "UPDATE users SET balance=balance+? WHERE telegram_id=?",
            (w["amount"], w["telegram_id"])
        )

    c.execute(
        "UPDATE withdrawals SET status=?, processed_at=? WHERE id=?",
        (status, now, withdrawal_id)
    )
    c.commit()
    c.close()

    return jsonify({
        "ok": True,
        "withdrawal_id": withdrawal_id,
        "status": status
    })

@app.get("/api/price")
def nyd_price():
    price = NYD_USDT_PRICE
    return jsonify({
        "symbol": "NYD/USDT",
        "price": price,
        "example_500_nyd": round(500 * price, 8)
    })
