CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 telegram_id TEXT UNIQUE NOT NULL,
 username TEXT DEFAULT '', first_name TEXT DEFAULT '', last_name TEXT DEFAULT '',
 referral_code TEXT UNIQUE NOT NULL, referrer_code TEXT,
 wallet_address TEXT DEFAULT '', wallet_type TEXT DEFAULT '', verified INTEGER DEFAULT 0,
 balance REAL DEFAULT 0, pending_mining REAL DEFAULT 0, total_taps INTEGER DEFAULT 0,
 referrals INTEGER DEFAULT 0, successful_referrals INTEGER DEFAULT 0, referral_reward INTEGER DEFAULT 0,
 team_wallet REAL DEFAULT 0, miner_level INTEGER DEFAULT 1, sound INTEGER DEFAULT 1,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT,reward REAL,type TEXT,channel TEXT DEFAULT '',active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS task_claims(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,task_id TEXT,claimed_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,task_id));
CREATE TABLE IF NOT EXISTS referral_earnings(id INTEGER PRIMARY KEY AUTOINCREMENT,beneficiary_id INTEGER NOT NULL,source_user_id INTEGER NOT NULL,source_claim_id TEXT NOT NULL,level INTEGER NOT NULL,rate REAL NOT NULL,amount REAL NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(beneficiary_id,source_claim_id,level));
CREATE TABLE IF NOT EXISTS withdrawals(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,amount REAL,burn REAL,net REAL,address TEXT,status TEXT DEFAULT 'Pending',admin_note TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS deposits(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,tx_hash TEXT UNIQUE,amount REAL,asset TEXT,network TEXT,status TEXT DEFAULT 'Pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ton_proof_nonces(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,payload TEXT UNIQUE,expires_at INTEGER,used INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS level_payments(id INTEGER PRIMARY KEY AUTOINCREMENT,invoice TEXT UNIQUE,user_id INTEGER,level INTEGER,asset TEXT,amount REAL,amount_units TEXT,recipient TEXT,sender TEXT,status TEXT DEFAULT 'Pending',tx_hash TEXT,admin_note TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO tasks(id,title,reward,type,channel) VALUES
('youtube','YouTube Like & Comment (Videos + Shorts)',1,'external',''),
('earn_channel','NYD EARN PAYMENT CHANNEL — Join & Verify',1,'telegram','https://t.me/+9-jDg9aDMOphNzdl'),
('official_channel','Official Channel — Join & Verify',1,'telegram','@NYDEarn_Official'),
('website','Visit Website (nydtoken.com)',1,'external',''),
('react','React to latest post (English)',1,'external',''),
('daily','Daily Check-in',5,'daily','');
