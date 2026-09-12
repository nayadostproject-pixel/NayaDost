import sqlite3

db = sqlite3.connect("nayadost.db")

db.executescript("""
CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    balance REAL DEFAULT 0,
    mining_started INTEGER DEFAULT 0,
    last_claim INTEGER DEFAULT 0,
    miner_level INTEGER DEFAULT 1,
    referred_by INTEGER,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    reward REAL NOT NULL,
    active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS task_completions (
    telegram_id INTEGER,
    task_id INTEGER,
    completed_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (telegram_id, task_id)
);

CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER,
    amount REAL,
    wallet TEXT,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (strftime('%s','now'))
);
""")

db.commit()
db.close()
print("TABLES READY")
