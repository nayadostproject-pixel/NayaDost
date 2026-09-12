from pathlib import Path
p=Path("api.py")
s=p.read_text()

old='''    cur = c.execute("""
        INSERT INTO withdrawals
        (telegram_id, amount, wallet_address, network, status, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?)
    """, (
        uid,
        amount,
        wallet["wallet_address"],
        wallet["network"],
        now
    ))'''

new='''    cur = c.execute("""
        INSERT INTO withdrawals
        (telegram_id, amount, wallet_address, network, status, created_at,
         usdt_price, usdt_amount)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    """, (
        uid,
        amount,
        wallet["wallet_address"],
        wallet["network"],
        now,
        usdt_price,
        usdt_amount
    ))'''

if old in s:
    s=s.replace(old,new)

start=s.find('@app.get("/api/withdrawals")')
if start!=-1:
    end=s.find('\\n\\n@app.', start+10)
    if end==-1:
        end=len(s)

    block='''@app.get("/api/withdrawals")
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
'''
    s=s[:start]+block+s[end:]

p.write_text(s)
print("Withdraw system setup complete")
