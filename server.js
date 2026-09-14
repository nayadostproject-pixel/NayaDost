// NayaDost Mining backend
// Node 18+ / Express / SQLite
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { Address, Cell, beginCell, contractAddress, loadStateInit, WalletContractV1R1, WalletContractV1R2, WalletContractV1R3, WalletContractV2R1, WalletContractV2R2, WalletContractV3R1, WalletContractV3R2, WalletContractV4, WalletContractV5R1 } = require('@ton/ton');
const { sha256, getSecureRandomBytes } = require('@ton/crypto');
const nacl = require('tweetnacl');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({limit:'256kb'}));
app.use(express.urlencoded({extended:true}));
// Cross-origin support: the Mini App may be hosted on Netlify while this Node API
// runs on Railway/VPS. Telegram init-data headers must be explicitly allowed.
app.use((req,res,next)=>{
 res.setHeader('Access-Control-Allow-Origin','*');
 res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
 res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Telegram-Init-Data, X-Telegram-User, X-Admin-Key, Accept');
 res.setHeader('Access-Control-Max-Age','86400');
 if(req.method==='OPTIONS') return res.status(204).end();
 next();
});
app.get('/api/health',async(req,res)=>{try{const row=await get('SELECT COUNT(*) AS users FROM users');res.json({ok:true,service:'NayaDost Mining API',time:new Date().toISOString(),database:'sqlite',databaseFile:dbPath,users:Number(row?.users||0)});}catch(e){res.status(500).json({ok:false,error:'Database health check failed'});}});
app.get('/tonconnect-manifest.json',(req,res)=>{
 const base=(APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
 res.set({
   'Cache-Control':'no-store',
   'Access-Control-Allow-Origin':'*'
 });
 res.type('application/json').send(JSON.stringify({
   url:base+'/',
   name:'NayaDost Mining',
   iconUrl:base+'/icon-180.png'
 }));
});
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_NOW';
const BOT_API_KEY = process.env.BOT_API_KEY || '';
const OFFICIAL_CHANNEL = process.env.OFFICIAL_CHANNEL || '@NYDEarn_Official';
const EARN_CHANNEL = process.env.EARN_CHANNEL || 'https://t.me/+9-jDg9aDMOphNzdl';
const DEPOSIT_ADDRESS = process.env.DEPOSIT_ADDRESS || 'UQCx6kQYSADRJEjejFFttCNo12pjdquaOMhrXn8zYuF1wTvX';
const PRICE_API_URL = ''; // NYD price is fixed by product rules
const TON_DEPOSIT_API_URL = process.env.TON_DEPOSIT_API_URL || '';
const PRICE_FALLBACK = 0.0005; // 1000 NYD = 0.50 USD
const APP_URL = String(process.env.APP_URL || '').replace(/\/$/, '');
const APP_DOMAIN = String(process.env.APP_DOMAIN || '');
const TON_NETWORK = String(process.env.TON_NETWORK || '-239');
const TON_PROOF_TTL = Math.max(60, Number(process.env.TON_PROOF_TTL || 900));
const PAYMENT_TON_ADDRESS = process.env.PAYMENT_TON_ADDRESS || DEPOSIT_ADDRESS;
const PAYMENT_USDT_ADDRESS = String(process.env.PAYMENT_USDT_ADDRESS || DEPOSIT_ADDRESS).trim() || DEPOSIT_ADDRESS;
const USDT_MASTER = process.env.USDT_MASTER || 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const TONAPI_BASE_URL = String(process.env.TONAPI_BASE_URL || 'https://tonapi.io').replace(/\/$/,'');
const TONAPI_API_KEY = process.env.TONAPI_API_KEY || '';
const TONCENTER_BASE_URL = String(process.env.TONCENTER_BASE_URL || 'https://toncenter.com/api/v3').replace(/\/$/,'');
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || '';
const PAYMENT_TTL_MINUTES = Math.max(5, Number(process.env.PAYMENT_TTL_MINUTES || 30));
const VIP_PRICE_USDT = 25;
const VIP_RATE_PER_SECOND = 0.100;
const VIP_QR_ADDRESS = PAYMENT_USDT_ADDRESS;
const LEVEL_PRICE_MULTIPLIER = Math.max(0.000001, Number(process.env.LEVEL_PRICE_MULTIPLIER || 1));
const TON_PRICE_USD = Math.max(0.000001, Number(process.env.TON_PRICE_USD || 1));
const TON_PRICE_API_URL = String(process.env.TON_PRICE_API_URL || 'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd');
// Multi-level referral commissions. The final rate continues for deeper levels.
const REFERRAL_RATES = String(process.env.REFERRAL_RATES || '5,3,2,1,0.5').split(',').map(Number).filter(x=>Number.isFinite(x)&&x>0);
const REFERRAL_MAX_TOTAL = Math.max(0, Number(process.env.REFERRAL_MAX_TOTAL || 15));

// Persistent SQLite storage.
// Railway persistent volume is mounted at /data in production; DB_DIR/DB_PATH can override it.
// DB_DIR/DB_PATH can be set explicitly on other hosts.
const localDataDir = path.join(__dirname, 'data');
const persistentDataDir = process.env.DB_DIR || (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID ? '/data' : localDataDir);
fs.mkdirSync(persistentDataDir, {recursive:true});
const dbPath = process.env.DB_PATH || path.join(persistentDataDir,'naya_dost.sqlite');
const db = new sqlite3.Database(dbPath);
console.log('[DB] SQLite database:', dbPath);
db.configure('busyTimeout', 10000);
try { db.run('PRAGMA journal_mode=WAL'); db.run('PRAGMA synchronous=NORMAL'); } catch(e) { console.warn('[DB] PRAGMA setup:', e.message); }
db.run('PRAGMA journal_mode=WAL');
db.run('PRAGMA synchronous=NORMAL');
db.run('PRAGMA wal_autocheckpoint=1000');

db.serialize(()=>{
 db.run(`CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT UNIQUE, username TEXT, first_name TEXT, last_name TEXT,
  referral_code TEXT UNIQUE, referrer_code TEXT, wallet_address TEXT, wallet_type TEXT, verified INTEGER DEFAULT 0,
  balance REAL DEFAULT 0, pending_mining REAL DEFAULT 0, total_taps INTEGER DEFAULT 0, referrals INTEGER DEFAULT 0, successful_referrals INTEGER DEFAULT 0, referral_reward INTEGER DEFAULT 0, team_wallet REAL DEFAULT 0,
  miner_level INTEGER DEFAULT 1, sound INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
 )`);
 db.run(`CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, title TEXT, reward REAL, type TEXT, channel TEXT, active INTEGER DEFAULT 1)`);
 db.run(`CREATE TABLE IF NOT EXISTS task_claims(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, task_id TEXT, claimed_at TEXT, UNIQUE(user_id,task_id))`);
 db.run(`CREATE TABLE IF NOT EXISTS referral_earnings(id INTEGER PRIMARY KEY AUTOINCREMENT, beneficiary_id INTEGER NOT NULL, source_user_id INTEGER NOT NULL, source_claim_id TEXT NOT NULL, level INTEGER NOT NULL, rate REAL NOT NULL, amount REAL NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(beneficiary_id,source_claim_id,level))`);
 db.run(`CREATE TABLE IF NOT EXISTS withdrawals(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount REAL, burn REAL, net REAL, address TEXT, status TEXT DEFAULT 'Pending', admin_note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
 db.run(`CREATE TABLE IF NOT EXISTS deposits(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, tx_hash TEXT UNIQUE, amount REAL, asset TEXT, network TEXT, status TEXT DEFAULT 'Pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
 db.run(`CREATE TABLE IF NOT EXISTS mine_daily(user_id INTEGER NOT NULL, day TEXT NOT NULL, taps INTEGER DEFAULT 0, PRIMARY KEY(user_id,day))`);
 db.run(`CREATE TABLE IF NOT EXISTS price_history(id INTEGER PRIMARY KEY AUTOINCREMENT, price REAL, source TEXT, fetched_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
 db.run(`CREATE TABLE IF NOT EXISTS ton_proof_nonces(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, payload TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL, used INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
 db.run(`CREATE TABLE IF NOT EXISTS level_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL, level INTEGER NOT NULL, asset TEXT NOT NULL, amount REAL NOT NULL, amount_units TEXT NOT NULL, recipient TEXT NOT NULL, sender TEXT, status TEXT DEFAULT 'Pending', tx_hash TEXT, admin_note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
 db.run(`INSERT OR IGNORE INTO tasks(id,title,reward,type,channel) VALUES
  ('youtube','YouTube Like & Comment (Videos + Shorts)',1,'external',''),
  ('earn_channel','NYD EARN PAYMENT CHANNEL — Join & Verify',100,'telegram',?),
  ('official_channel','Official Channel — Join & Verify',100,'telegram',?),
  ('website','Visit Website (nydtoken.com)',1,'external',''),
  ('react','React to latest post (English)',1,'external',''),
  ('x','Follow X @OfficialNayaDost',100,'external',''),
  ('daily','Daily Check-in',5,'daily','')`,[EARN_CHANNEL,OFFICIAL_CHANNEL]);
  // Migration: existing installations may already have the two Telegram tasks
  // with the old reward. Always force these two task rewards to 100 NYD.
  db.run("UPDATE tasks SET reward=100 WHERE id IN ('earn_channel','official_channel')");
  db.run("UPDATE tasks SET reward=100 WHERE id='x'");
});

db.run('ALTER TABLE users ADD COLUMN referral_reward INTEGER DEFAULT 0',()=>{});
db.run('ALTER TABLE users ADD COLUMN pending_mining REAL DEFAULT 0',()=>{});
db.run('ALTER TABLE users ADD COLUMN team_wallet REAL DEFAULT 0',()=>{});
db.run('ALTER TABLE users ADD COLUMN vip_active INTEGER DEFAULT 0',()=>{});
db.run('ALTER TABLE users ADD COLUMN vip_paid_at TEXT',()=>{});
db.run('ALTER TABLE users ADD COLUMN vip_last_mined_at INTEGER DEFAULT 0',()=>{});
db.run(`CREATE TABLE IF NOT EXISTS vip_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL, asset TEXT NOT NULL DEFAULT 'USDT', amount_units TEXT NOT NULL, recipient TEXT NOT NULL, sender TEXT, status TEXT DEFAULT 'Pending', tx_hash TEXT UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

function run(sql, params=[]){return new Promise((resolve,reject)=>db.run(sql,params,function(e){if(e)reject(e);else resolve(this);}))}
function get(sql, params=[]){return new Promise((resolve,reject)=>db.get(sql,params,(e,row)=>e?reject(e):resolve(row)))}
function all(sql, params=[]){return new Promise((resolve,reject)=>db.all(sql,params,(e,rows)=>e?reject(e):resolve(rows)))}
function makeCode(){return crypto.randomBytes(5).toString('hex').toUpperCase()}
async function awardDirectReferral(referrerId, referredUserId){
 const already=await get('SELECT id FROM referral_earnings WHERE beneficiary_id=? AND source_user_id=? AND source_claim_id=?',[referrerId,referredUserId,'SIGNUP']);
 if(already)return false;
 const r=await run('UPDATE users SET successful_referrals=COALESCE(successful_referrals,0)+1, balance=COALESCE(balance,0)+100, referral_reward=COALESCE(referral_reward,0)+1, updated_at=CURRENT_TIMESTAMP WHERE id=?',[referrerId]);
 if(!r.changes)return false;
 await run('INSERT INTO referral_earnings(beneficiary_id,source_user_id,source_claim_id,level,rate,amount) VALUES(?,?,?,?,?,?)',[referrerId,referredUserId,'SIGNUP',1,0,100]);
 return true;
}

async function attachReferral(user, referrerCode){
 const code=String(referrerCode||'').trim().toUpperCase();
 if(!code || code===String(user.referral_code||'').toUpperCase() || user.referrer_code) return false;
 const ref=await get('SELECT id FROM users WHERE referral_code=?',[code]);
 if(!ref || ref.id===user.id) return false;
 // Only the first valid referrer can ever be attached.
 const changed=await run("UPDATE users SET referrer_code=? WHERE id=? AND (referrer_code IS NULL OR TRIM(referrer_code)='')",[code,user.id]);
 if(!changed.changes)return false;
 await run('UPDATE users SET referrals=COALESCE(referrals,0)+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',[ref.id]);
 const fresh=await get('SELECT * FROM users WHERE id=?',[user.id]);
 // If the referred user is already wallet-verified, don't wait for another verification.
 if(fresh?.verified) await awardDirectReferral(ref.id,user.id);
 return true;
}

async function reconcileReferralStats(){
 // Repair counters from the actual referral relationships, so old users are not lost
 // because an earlier build failed to increment the referrer counter.
 await run(`UPDATE users SET referrals=(
   SELECT COUNT(*) FROM users child WHERE child.referrer_code=users.referral_code
 )`);
 // Backfill the one-time 100 NYD direct reward for any referred user who is already verified
 // but whose reward record was missed by an older build.
 const verifiedRefs=await all(`SELECT child.id AS child_id, parent.id AS parent_id
   FROM users child JOIN users parent ON parent.referral_code=child.referrer_code
   WHERE child.verified=1 AND child.referrer_code IS NOT NULL AND TRIM(child.referrer_code)<>''`);
 for(const row of verifiedRefs) await awardDirectReferral(row.parent_id,row.child_id);
 await run(`UPDATE users SET successful_referrals=(
   SELECT COUNT(*) FROM referral_earnings e WHERE e.beneficiary_id=users.id AND e.source_claim_id='SIGNUP'
 ), referral_reward=(
   SELECT COUNT(*) FROM referral_earnings e2 WHERE e2.beneficiary_id=users.id AND e2.source_claim_id='SIGNUP'
 )`);
}

async function getUser(body){
 const telegramId = String(body.telegram_id || body.telegramId || '');
 if(!telegramId) throw new Error('telegram_id required');
 let u = await get('SELECT * FROM users WHERE telegram_id=?',[telegramId]);
 const incomingRef=String(body.referrer_code||'').trim().toUpperCase();
 if(!u){
  let code; do{code=makeCode()}while(await get('SELECT id FROM users WHERE referral_code=?',[code]));
  await run('INSERT INTO users(telegram_id,username,first_name,last_name,referral_code,referrer_code) VALUES(?,?,?,?,?,?)',[telegramId,body.username||'',body.first_name||'',body.last_name||'',code,null]);
  u=await get('SELECT * FROM users WHERE telegram_id=?',[telegramId]);
  if(incomingRef) await attachReferral(u,incomingRef);
 } else {
  await run('UPDATE users SET username=?,first_name=?,last_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[body.username||u.username,body.first_name||u.first_name,body.last_name||u.last_name,u.id]);
  if(incomingRef && !u.referrer_code) await attachReferral(u,incomingRef);
  u=await get('SELECT * FROM users WHERE id=?',[u.id]);
 }
 return u;
}
function publicUser(u){return {id:u.telegram_id,username:u.username,firstName:u.first_name,lastName:u.last_name,referralCode:u.referral_code,referrerCode:u.referrer_code,wallet:u.wallet_address||'',walletType:u.wallet_type||'',verified:!!u.verified,balance:u.balance,taps:u.total_taps,referrals:u.referrals,successfulReferrals:u.successful_referrals,referralReward:u.referral_reward||0,teamWallet:Number(u.team_wallet||0),pendingMining:Number(u.pending_mining||0),level:u.miner_level,sound:!!u.sound,vipActive:!!u.vip_active,vipPaidAt:u.vip_paid_at||'',vipRatePerSecond:VIP_RATE_PER_SECOND}}

async function distributeReferralRewards(sourceUserId, sourceClaimId, claimedAmount){
 const amount=Number(claimedAmount);
 if(!Number.isFinite(amount)||amount<=0)return 0;
 let current=await get('SELECT id,referrer_code FROM users WHERE id=?',[sourceUserId]);
 let level=1, distributed=0, visited=new Set([sourceUserId]);
 while(current?.referrer_code && level<=100){
   const ref=await get('SELECT id,referrer_code FROM users WHERE referral_code=?',[current.referrer_code]);
   if(!ref || visited.has(ref.id))break;
   visited.add(ref.id);
   const configured=REFERRAL_RATES[Math.min(level-1,REFERRAL_RATES.length-1)];
   const remaining=Math.max(0,REFERRAL_MAX_TOTAL-distributed);
   const rate=Math.min(configured, remaining);
   if(rate<=0)break;
   const reward=Math.round(amount*rate/100*1e8)/1e8;
   if(reward>0){
     const inserted=await run('INSERT OR IGNORE INTO referral_earnings(beneficiary_id,source_user_id,source_claim_id,level,rate,amount) VALUES(?,?,?,?,?,?)',[ref.id,sourceUserId,String(sourceClaimId),level,rate,reward]);
     if(inserted.changes){await run('UPDATE users SET team_wallet=COALESCE(team_wallet,0)+?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[reward,ref.id]);distributed+=rate;}
   }
   current=ref; level++;
 }
 return distributed;
}


function verifyTelegramInitData(initData){
 if(!BOT_TOKEN)return null; // development mode; production must set TELEGRAM_BOT_TOKEN
 const params=new URLSearchParams(initData||'');
 const hash=params.get('hash');
 if(!hash)throw new Error('Missing Telegram initData');
 const authDate=Number(params.get('auth_date')||0);
 if(!authDate || Math.abs(Math.floor(Date.now()/1000)-authDate)>86400)throw new Error('Telegram initData expired');
 const check=[...params.entries()].filter(([k])=>k!=='hash').sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>`${k}=${v}`).join('\\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
 const expected=crypto.createHmac('sha256',secret).update(check).digest('hex');
 if(hash.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(expected)))throw new Error('Invalid Telegram initData');
 let user=null;try{user=JSON.parse(params.get('user')||'null')}catch(e){}
 if(!user?.id)throw new Error('Telegram user missing');
 return user;
}

app.use('/api',(req,res,next)=>{
 if(req.method==='GET' || !BOT_TOKEN)return next();
 try{
  const u=verifyTelegramInitData(req.get('X-Telegram-Init-Data'));
  req.body=req.body||{};
  // Never trust client-supplied identity when Telegram authentication is enabled.
  req.body.telegram_id=String(u.id);
  req.body.username=u.username||'';
  req.body.first_name=u.first_name||'';
  req.body.last_name=u.last_name||'';
  next();
 }catch(e){res.status(401).json({ok:false,error:e.message})}
});


function walletKeyLoader(stateInit){
 const loadV1=cs=>{cs.loadUint(32);return cs.loadBuffer(32)};
 const loadV2=cs=>{cs.loadUint(32);return cs.loadBuffer(32)};
 const loadV3=cs=>{cs.loadUint(32);cs.loadUint(32);return cs.loadBuffer(32)};
 const loadV4=cs=>{cs.loadUint(32);cs.loadUint(32);return cs.loadBuffer(32)};
 const loadV5=cs=>{cs.loadBoolean();cs.loadUint(32);cs.loadUint(32);return cs.loadBuffer(32)};
 const known=[
  {contract:WalletContractV1R1,load:loadV1},{contract:WalletContractV1R2,load:loadV1},{contract:WalletContractV1R3,load:loadV1},
  {contract:WalletContractV2R1,load:loadV2},{contract:WalletContractV2R2,load:loadV2},
  {contract:WalletContractV3R1,load:loadV3},{contract:WalletContractV3R2,load:loadV3},
  {contract:WalletContractV4,load:loadV4},{contract:WalletContractV5R1,load:loadV5}
 ].map(({contract,load})=>({code:contract.create({workchain:0,publicKey:Buffer.alloc(32)}).init.code,load}));
 if(!stateInit.code||!stateInit.data)return null;
 for(const x of known){try{if(x.code.equals(stateInit.code))return x.load(stateInit.data.beginParse())}catch(e){}}
 return null;
}

function buildTonProofDigest(address, proof){
 const wc=Buffer.alloc(4);wc.writeInt32BE(address.workChain,0);
 const domainBytes=Buffer.from(proof.domain.value,'utf8');
 if(Number(proof.domain.lengthBytes)!==domainBytes.length)throw new Error('Invalid TON proof domain length');
 const domainLen=Buffer.alloc(4);domainLen.writeUInt32LE(domainBytes.length,0);
 const ts=Buffer.alloc(8);ts.writeBigUInt64LE(BigInt(proof.timestamp));
 const message=Buffer.concat([Buffer.from('ton-proof-item-v2/','utf8'),wc,Buffer.from(address.hash),domainLen,domainBytes,ts,Buffer.from(proof.payload,'utf8')]);
 const inner=crypto.createHash('sha256').update(message).digest();
 return crypto.createHash('sha256').update(Buffer.concat([Buffer.from([0xff,0xff]),Buffer.from('ton-connect','utf8'),inner])).digest();
}

async function verifyTonProof({address:addressText,network,public_key,walletStateInit,proof,payload,expectedDomain}){
 if(String(network)!==TON_NETWORK)throw new Error('Wrong TON network');
 if(!proof||!walletStateInit)throw new Error('TON wallet proof is missing');
 if(proof.payload!==payload)throw new Error('TON proof nonce mismatch');
 const domain=expectedDomain || APP_DOMAIN || (APP_URL ? new URL(APP_URL).host : '');
 if(!domain || proof.domain.value!==domain)throw new Error('TON proof domain mismatch');
 const now=Math.floor(Date.now()/1000), ts=Number(proof.timestamp);
 if(!Number.isFinite(ts)||Math.abs(now-ts)>TON_PROOF_TTL)throw new Error('TON proof expired');
 const wanted=Address.parse(addressText);
 const stateInit=loadStateInit(Cell.fromBase64(walletStateInit).beginParse());
 const derived=contractAddress(wanted.workChain,stateInit);
 if(!derived.equals(wanted))throw new Error('Wallet state does not match wallet address');
 const extracted=walletKeyLoader(stateInit);
 if(!extracted)throw new Error('Unsupported TON wallet version for proof verification');
 const reported=Buffer.from(String(public_key||''),'hex');
 if(reported.length!==32 || !extracted.equals(reported))throw new Error('TON wallet public key mismatch');
 const digest=buildTonProofDigest(wanted,proof);
 const signature=Buffer.from(String(proof.signature||''),'base64');
 if(signature.length!==64 || !nacl.sign.detached.verify(new Uint8Array(digest),new Uint8Array(signature),new Uint8Array(extracted)))throw new Error('Invalid TON wallet signature');
 return true;
}

app.post('/api/bot/user',async(req,res)=>{try{
 if(!BOT_API_KEY || req.get('X-Bot-Api-Key')!==BOT_API_KEY)return res.status(401).json({ok:false,error:'Unauthorized'});
 const u=await getUser(req.body);
 res.json({ok:true,user:publicUser(u)});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/bot/referral',async(req,res)=>{try{
 if(!BOT_API_KEY || req.get('X-Bot-Api-Key')!==BOT_API_KEY)return res.status(401).json({ok:false,error:'Unauthorized'});
 const telegram_id=String(req.body.telegram_id||''); const referrer_code=String(req.body.referrer_code||'').trim();
 if(!telegram_id||!referrer_code)throw new Error('telegram_id and referrer_code required');
 const u=await getUser({telegram_id,username:req.body.username||'',first_name:req.body.first_name||'',last_name:req.body.last_name||'',referrer_code});
 await reconcileReferralStats();
 const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);
 res.json({ok:true,user:publicUser(fresh)});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/bootstrap',async(req,res)=>{try{const u=await getUser(req.body); await settleVipUser(u.id); await reconcileReferralStats(); const freshUser=await get('SELECT * FROM users WHERE id=?',[u.id]); const tasks=await all('SELECT * FROM tasks WHERE active=1'); const claims=await all('SELECT task_id FROM task_claims WHERE user_id=?',[u.id]); const telegramStatuses={}; for(const tid of ['earn_channel','official_channel']) telegramStatuses[tid]=await telegramStatusForUser(u.id,tid); const today=new Date().toISOString().slice(0,10); const dailyClaim=await get('SELECT id FROM task_claims WHERE user_id=? AND task_id=?',[u.id,'daily:'+today]); const mineMeta=await get('SELECT taps FROM mine_daily WHERE user_id=? AND day=?',[u.id,today]); res.json({ok:true,user:publicUser(freshUser),tasks,claims:claims.map(x=>x.task_id),dailyClaimed:!!dailyClaim,mineDay:today,mineTaps:Number(mineMeta?.taps||0),dailyTaps:Number(mineMeta?.taps||0),serverTime:new Date().toISOString(),deposit:{address:DEPOSIT_ADDRESS,network:'TON',asset:'USDT'},payments:{tonAddress:PAYMENT_TON_ADDRESS,usdtAddress:PAYMENT_USDT_ADDRESS,usdtMaster:USDT_MASTER,vipUsdtAddress:VIP_QR_ADDRESS,vipPriceUsdt:VIP_PRICE_USDT,vipRatePerSecond:VIP_RATE_PER_SECOND},channels:{earn:EARN_CHANNEL,official:OFFICIAL_CHANNEL},telegramTaskStatuses:telegramStatuses})}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/mine',async(req,res)=>{try{
 const u=await getUser(req.body);
 const today=new Date().toISOString().slice(0,10);
 const meta=await get('SELECT taps FROM mine_daily WHERE user_id=? AND day=?',[u.id,today]);
 const used=Number(meta?.taps||0);
 const LIMIT=5000;
 if(used>=LIMIT)return res.status(400).json({ok:false,error:'Daily 5000 tap limit reached',mineTaps:used,remaining:0,mineDay:today});
 const reward=.01*(1+Math.max(0,Number(u.miner_level||1)-1)*.02);
 await run('BEGIN IMMEDIATE');
 try{
  const locked=await get('SELECT taps FROM mine_daily WHERE user_id=? AND day=?',[u.id,today]);
  const lockedUsed=Number(locked?.taps||0);
  if(lockedUsed>=LIMIT){await run('ROLLBACK');return res.status(400).json({ok:false,error:'Daily 5000 tap limit reached',mineTaps:lockedUsed,remaining:0,mineDay:today});}
  if(locked) await run('UPDATE mine_daily SET taps=taps+1 WHERE user_id=? AND day=?',[u.id,today]);
  else await run('INSERT INTO mine_daily(user_id,day,taps) VALUES(?,?,1)',[u.id,today]);
  await run('UPDATE users SET pending_mining=COALESCE(pending_mining,0)+?,total_taps=total_taps+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',[reward,u.id]);
  await run('COMMIT');
 }catch(e){try{await run('ROLLBACK')}catch(_){ } throw e;}
 const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);
 const finalMeta=await get('SELECT taps FROM mine_daily WHERE user_id=? AND day=?',[u.id,today]);
 const count=Number(finalMeta?.taps||0);
 res.json({ok:true,reward,balance:fresh.balance,pendingMining:Number(fresh.pending_mining||0),taps:fresh.total_taps,mineDay:today,mineTaps:count,dailyTaps:count,remaining:Math.max(0,LIMIT-count)});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/claim',async(req,res)=>{try{
 const u=await getUser(req.body);
 const row=await get('SELECT pending_mining FROM users WHERE id=?',[u.id]);
 const amount=Number(row?.pending_mining||0);
 if(!Number.isFinite(amount)||amount<=0)throw new Error('No mined NYD available to claim');
 const r=await run('UPDATE users SET balance=balance+pending_mining,pending_mining=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND COALESCE(pending_mining,0)>0',[u.id]);
 if(!r.changes)throw new Error('Claim failed. Please try again.');
 await distributeReferralRewards(u.id,'MINE:'+Date.now()+':'+u.id,amount);
 const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);
 res.json({ok:true,claimed:amount,user:publicUser(fresh)});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/ton-proof/nonce',async(req,res)=>{try{
 const u=await getUser(req.body);
 await run('UPDATE ton_proof_nonces SET used=1 WHERE user_id=? AND used=0',[u.id]);
 const raw=await getSecureRandomBytes(32);
 const payload=Buffer.from(raw).toString('base64url');
 const expires=Math.floor(Date.now()/1000)+TON_PROOF_TTL;
 await run('INSERT INTO ton_proof_nonces(user_id,payload,expires_at) VALUES(?,?,?)',[u.id,payload,expires]);
 res.json({ok:true,payload,expiresAt:expires});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/ton-proof/verify',async(req,res)=>{try{
 const u=await getUser(req.body);
 const p=req.body.proof||{};
 const nonce=await get('SELECT * FROM ton_proof_nonces WHERE user_id=? AND payload=? AND used=0',[u.id,p.payload||'']);
 if(!nonce)throw new Error('TON Connect session expired. Tap Connect Wallet again.');
 if(Number(nonce.expires_at)<Math.floor(Date.now()/1000))throw new Error('TON Connect session expired.');
 await verifyTonProof({address:req.body.address,network:req.body.chain,public_key:req.body.public_key,walletStateInit:req.body.walletStateInit,proof:p,payload:nonce.payload,expectedDomain:APP_DOMAIN || (APP_URL ? new URL(APP_URL).host : req.get('host'))});
 // Consume only after successful verification so a failed signature can be retried.
 await run('UPDATE ton_proof_nonces SET used=1 WHERE id=? AND used=0',[nonce.id]);
 await run('UPDATE users SET wallet_address=?,wallet_type=?,verified=1,updated_at=CURRENT_TIMESTAMP WHERE id=?',[req.body.address,'TON',u.id]);
  if(!u.verified && u.referrer_code){ const ref=await get('SELECT id FROM users WHERE referral_code=?',[u.referrer_code]); if(ref) await awardDirectReferral(ref.id,u.id); }
 const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);
 res.json({ok:true,user:publicUser(fresh)});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

// Deliberately reject manual address binding. Wallet addresses must come from TON Connect + ton_proof.
app.post('/api/wallet/connect',async(req,res)=>res.status(400).json({ok:false,error:'Manual wallet addresses are disabled. Use Connect Wallet through Telegram/TON Connect.'}));
app.post('/api/verify-wallet',async(req,res)=>res.status(400).json({ok:false,error:'Wallet verification is performed automatically by TON Connect proof.'}));
app.post('/api/wallet/disconnect',async(req,res)=>{try{const u=await getUser(req.body);await run('UPDATE users SET wallet_address=NULL,wallet_type=NULL,verified=0,updated_at=CURRENT_TIMESTAMP WHERE id=?',[u.id]);const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);res.json({ok:true,user:publicUser(fresh)})}catch(e){res.status(400).json({ok:false,error:e.message})}});

// Telegram channel tasks are verified server-side with Bot API membership checks.

async function telegramApi(method, params={}){
 const token=BOT_TOKEN;
 if(!token) throw new Error('Telegram bot verification is not configured');
 const qs=new URLSearchParams();
 for(const [k,v] of Object.entries(params)){
   if(v!==undefined && v!==null && v!=='') qs.set(k,String(v));
 }
 const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:qs});
 const j=await r.json().catch(()=>({}));
 if(!r.ok || !j.ok) throw new Error(j.description||`Telegram API ${r.status}`);
 return j.result;
}
function channelChatId(task){
 const envKey=task.id==='earn_channel'?'EARN_CHANNEL_CHAT_ID':'OFFICIAL_CHANNEL_CHAT_ID';
 const configured=String(process.env[envKey]||'').trim();
 if(configured) return configured;
 const ch=String(task.channel||'').trim();
 if(/^@[A-Za-z0-9_]{5,}$/.test(ch)) return ch;
 const m=ch.match(/^https:\/\/t\.me\/([A-Za-z0-9_]{5,})\/?$/i);
 return m ? '@'+m[1] : '';
}
function telegramCycleKey(){
 const now=Date.now();
 return Math.floor(now/(2*60*60*1000));
}
function telegramClaimId(taskId){ return `${taskId}:2h:${telegramCycleKey()}`; }
function telegramNextAvailable(){ return (telegramCycleKey()+1)*2*60*60*1000; }
async function telegramStatusForUser(userId, taskId){
 const row=await get(`SELECT claimed_at FROM task_claims WHERE user_id=? AND task_id LIKE ? ORDER BY id DESC LIMIT 1`,[userId,`${taskId}:2h:%`]);
 if(!row) return {claimed:false,nextAvailable:0,cycle:telegramCycleKey()};
 const claimedMs=Date.parse(String(row.claimed_at||'').replace(' ','T')+'Z');
 const next=Number.isFinite(claimedMs)?claimedMs+(2*60*60*1000):0;
 const available=next<=Date.now();
 return {claimed:!available,nextAvailable:available?0:next,cycle:telegramCycleKey()};
}

async function verifyTelegramMembership(task, telegramId){
 const chatId=channelChatId(task);
 if(!chatId){
   throw new Error(`Channel verification is not configured for ${task.id}. Set ${task.id==='earn_channel'?'EARN_CHANNEL_CHAT_ID':'OFFICIAL_CHANNEL_CHAT_ID'} in the deployment environment.`);
 }
 const member=await telegramApi('getChatMember',{chat_id:chatId,user_id:telegramId});
 const status=String(member?.status||'');
 if(['creator','administrator','member'].includes(status)) return true;
 if(status==='restricted' && member?.is_member) return true;
 throw new Error('Join the Telegram channel first, then tap Verify & Claim.');
}

app.post('/api/tasks/telegram-verify',async(req,res)=>{try{
 const u=await getUser(req.body);
 const task=await get('SELECT * FROM tasks WHERE id=? AND active=1',[req.body.task_id]);
 if(!task||task.type!=='telegram')throw new Error('Telegram task not found');
 const claimId=telegramClaimId(task.id);
 const status=await telegramStatusForUser(u.id,task.id);
 if(status.claimed)return res.json({ok:true,already:true,user:publicUser(u),reward:0,nextAvailable:status.nextAvailable});
 await verifyTelegramMembership(task,u.telegram_id);
 await run('BEGIN IMMEDIATE');
 try{
   const latest=await get(`SELECT claimed_at FROM task_claims WHERE user_id=? AND task_id LIKE ? ORDER BY id DESC LIMIT 1`,[u.id,`${task.id}:2h:%`]);
   if(latest){
     const claimedMs=Date.parse(String(latest.claimed_at||'').replace(' ','T')+'Z');
     const next=Number.isFinite(claimedMs)?claimedMs+(2*60*60*1000):0;
     if(next>Date.now()){await run('ROLLBACK');return res.json({ok:true,already:true,user:publicUser(u),reward:0,nextAvailable:next});}
   }
   const claimRow=await run('INSERT INTO task_claims(user_id,task_id,claimed_at) VALUES(?,?,CURRENT_TIMESTAMP)',[u.id,claimId]);
   await run('UPDATE users SET balance=COALESCE(balance,0)+?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[task.reward,u.id]);
   await run('COMMIT');
   await distributeReferralRewards(u.id,'TASK:'+claimRow.lastID,task.reward);
 }catch(e){try{await run('ROLLBACK')}catch(_){} throw e;}
 const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);
 res.json({ok:true,claimed:true,reward:task.reward,user:publicUser(fresh),nextAvailable:Date.now()+(2*60*60*1000)});
}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post('/api/tasks/claim',async(req,res)=>{try{const u=await getUser(req.body);const task=await get('SELECT * FROM tasks WHERE id=? AND active=1',[req.body.task_id]);
if(!task)throw new Error('Task not found');
if(task.id==='daily'){
 const today=new Date().toISOString().slice(0,10), dailyId='daily:'+today;
 const existing=await get('SELECT id FROM task_claims WHERE user_id=? AND task_id=?',[u.id,dailyId]);
 if(existing)throw new Error('Daily claim already collected');
 const claimRow=await run('INSERT INTO task_claims(user_id,task_id,claimed_at) VALUES(?,?,CURRENT_TIMESTAMP)',[u.id,dailyId]);
 await run('UPDATE users SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[task.reward,u.id]);
 await distributeReferralRewards(u.id,'DAILY:'+claimRow.lastID,task.reward);
 const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);
 return res.json({ok:true,claimed:true,reward:task.reward,dailyKey:today,user:publicUser(fresh)});
}if(!task)throw new Error('Task not found');if(task.type==='telegram')return res.status(400).json({ok:false,error:'Use Telegram Verify for this task'});if(task.id==='profile'&&!u.verified)return res.status(400).json({ok:false,error:'Wallet verification required'});const c=await get('SELECT id FROM task_claims WHERE user_id=? AND task_id=?',[u.id,task.id]);if(c)return res.status(400).json({ok:false,error:'Already claimed'});const claimRow=await run('INSERT INTO task_claims(user_id,task_id,claimed_at) VALUES(?,?,CURRENT_TIMESTAMP)',[u.id,task.id]);await run('UPDATE users SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[task.reward,u.id]);await distributeReferralRewards(u.id,'TASK:'+claimRow.lastID,task.reward);const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);res.json({ok:true,reward:task.reward,user:publicUser(fresh)})}catch(e){res.status(400).json({ok:false,error:e.message})}});


function levelDef(level){
 const n=Number(level);
 if(!Number.isInteger(n)||n<2||n>1000)throw new Error('Invalid miner level');
 const cost=Math.ceil(100*Math.pow(n-1,1.35));
 const speed=.20+(n-1)*.05;
 const tapReward=.01*(1+(n-1)*.02);
 return {level:n,cost,speed,tapReward};
}
function rawAddress(a){try{return Address.parse(String(a||'')).toRawString().toLowerCase()}catch{return String(a||'').trim().toLowerCase()}}
function paymentAgeOk(p){return (Date.now()-new Date(p.created_at+'Z').getTime()) <= PAYMENT_TTL_MINUTES*60*1000}
async function getTonPriceUsd(){try{const r=await fetch(TON_PRICE_API_URL);const j=await r.json();const x=Number(j?.['the-open-network']?.usd ?? j?.price ?? j?.usd);if(Number.isFinite(x)&&x>0)return x}catch{}return TON_PRICE_USD}
async function fetchTonCenter(url){
 const headers={'accept':'application/json'};
 if(TONCENTER_API_KEY)headers['X-API-Key']=TONCENTER_API_KEY;
 const r=await fetch(url,{headers});
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(j.error||j.message||`TON Center ${r.status}`);
 return j;
}
async function verifyLevelPayment(p){
 if(!paymentAgeOk(p))return {confirmed:false,expired:true};
 const expected=BigInt(p.amount_units);
 const sender=rawAddress(p.sender), recipient=rawAddress(p.recipient);
 const start=Math.floor(new Date(p.created_at+'Z').getTime()/1000)-60;
 if(p.asset==='USDT'){
   const qs=new URLSearchParams({jetton_master:USDT_MASTER,owner_address:recipient,direction:'in',start_utime:String(start),limit:'100',sort:'desc'});
   const data=await fetchTonCenter(`${TONCENTER_BASE_URL}/jetton/transfers?${qs}`);
   for(const t of (data.jetton_transfers||[])){
     if(t.transaction_aborted)continue;
     if(rawAddress(t.destination)!==recipient)continue;
     if(sender){
       const sourceOwner=t.source_wallet||t.source||'';
       let ownerOk=rawAddress(sourceOwner)===sender;
       if(!ownerOk && t.source){
         try{
           const ownerQs=new URLSearchParams({owner_address:sender,jetton_address:USDT_MASTER,limit:'100'});
           const jw=await fetchTonCenter(`${TONCENTER_BASE_URL}/jetton/wallets?${ownerQs}`);
           ownerOk=(jw.jetton_wallets||[]).some(w=>rawAddress(w.address)===rawAddress(t.source));
         }catch{}
       }
       if(!ownerOk)continue;
     }
     if(BigInt(String(t.amount||0))<expected)continue;
     return {confirmed:true,txHash:t.transaction_hash||t.trace_id||''};
   }
   return {confirmed:false};
 }
 const qs=new URLSearchParams({account:p.recipient,start_utime:String(start),limit:'100',sort:'desc'});
 const data=await fetchTonCenter(`${TONCENTER_BASE_URL}/transactions?${qs}`);
 for(const t of (data.transactions||[])){
   if(t.description?.aborted || t.description?.action?.success===false)continue;
   const m=t.in_msg||{};
   if(rawAddress(m.destination)!==recipient)continue;
   if(sender && rawAddress(m.source)!==sender)continue;
   if(BigInt(String(m.value||0))<expected)continue;
   return {confirmed:true,txHash:t.hash||m.hash||''};
 }
 return {confirmed:false};
}
app.post('/api/level-payment/create',async(req,res)=>{try{
 const u=await getUser(req.body);
 if(!u.wallet_address||!u.verified)throw new Error('Connect and verify your TON wallet first');
 const target=levelDef(req.body.level);
 if(target.level<=Number(u.miner_level||1))throw new Error('This level is already unlocked');
 const price=PRICE_FALLBACK;
 const amountUsdt=target.cost*price*LEVEL_PRICE_MULTIPLIER;
 if(!Number.isFinite(amountUsdt)||amountUsdt<=0)throw new Error('Invalid level payment amount');
 const asset=String(req.body.asset||'USDT').toUpperCase();
 if(!['TON','USDT'].includes(asset))throw new Error('Unsupported payment asset');
 const existing=await get('SELECT * FROM level_payments WHERE user_id=? AND level=? AND asset=? AND status=\'Pending\' ORDER BY id DESC LIMIT 1',[u.id,target.level,asset]);
 if(existing && paymentAgeOk(existing)){const payAmount=asset==='TON'?Number(existing.amount_units)/1e9:Number(existing.amount_units)/1e6;return res.json({ok:true,id:existing.id,invoice:existing.invoice,level:existing.level,costNyd:target.cost,speed:target.speed,tapReward:target.tapReward,amount:existing.amount,amountUnits:existing.amount_units,asset,recipient:existing.recipient,usdtMaster:USDT_MASTER,nydPrice:price,tonPriceUsd:await getTonPriceUsd(),payAmount,status:'Pending',reused:true});}
 const recipient=asset==='TON'?PAYMENT_TON_ADDRESS:PAYMENT_USDT_ADDRESS;
 if(!recipient)throw new Error(asset==='USDT'?'USDT receiving address is not configured on the server':'TON receiving address is not configured on the server');
 const tonPrice=await getTonPriceUsd();
 const units=asset==='TON'?String(Math.ceil((amountUsdt/tonPrice)*1e9)):String(Math.ceil(amountUsdt*1e6));
 const invoice=`NYD-L${target.level}-${u.telegram_id}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
 const r=await run('INSERT INTO level_payments(invoice,user_id,level,asset,amount,amount_units,recipient,sender) VALUES(?,?,?,?,?,?,?,?)',[invoice,u.id,target.level,asset,amountUsdt,units,recipient,u.wallet_address]);
 res.json({ok:true,id:r.lastID,invoice,level:target.level,costNyd:target.cost,speed:target.speed,tapReward:target.tapReward,amount:amountUsdt,amountUnits:units,asset,recipient,usdtMaster:USDT_MASTER,nydPrice:price,tonPriceUsd:tonPrice,payAmount:asset==='TON'?Number(units)/1e9:Number(units)/1e6,status:'Pending'});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/level-payment/details',async(req,res)=>{try{
 const u=await getUser(req.body);
 const p=await get('SELECT invoice,level,asset,amount,amount_units,recipient,sender,status,created_at FROM level_payments WHERE invoice=? AND user_id=?',[req.body.invoice,u.id]);
 if(!p)throw new Error('Payment invoice not found');
 if(p.status==='Confirmed'){const payAmount=p.asset==='TON'?Number(p.amount_units)/1e9:Number(p.amount_units)/1e6;return res.json({ok:true,payment:{...p,payAmount,usdtMaster:USDT_MASTER}})}
 const payAmount=p.asset==='TON'?Number(p.amount_units)/1e9:Number(p.amount_units)/1e6; res.json({ok:true,payment:{...p,payAmount,usdtMaster:USDT_MASTER}});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/level-payment/transaction',async(req,res)=>{try{
 const u=await getUser(req.body);
 const p=await get('SELECT * FROM level_payments WHERE invoice=? AND user_id=?',[req.body.invoice,u.id]);
 if(!p)throw new Error('Payment invoice not found');
 if(p.status!=='Pending')throw new Error('This payment invoice is no longer pending');
 if(!u.wallet_address||!u.verified)throw new Error('Connect and verify your TON wallet first');
 if(!paymentAgeOk(p))throw new Error('Payment invoice expired. Create a new payment.');
 if(p.asset==='TON') return res.json({ok:true,message:{address:p.recipient,amount:String(p.amount_units)}});
 const sender=rawAddress(u.wallet_address), master=rawAddress(USDT_MASTER);
 const qs=new URLSearchParams({owner_address:u.wallet_address,jetton_address:USDT_MASTER,limit:'100'});
 const data=await fetchTonCenter(`${TONCENTER_BASE_URL}/jetton/wallets?${qs}`);
 const wallets=data.jetton_wallets||[];
 const wallet=wallets.find(x=>rawAddress(x.jetton||x.jetton_address||x.master)===master) || wallets[0];
 if(!wallet?.address)throw new Error('USDT wallet was not found for your connected wallet. Receive some USDT on TON first.');
 const body=beginCell()
   .storeUint(0x0f8a7ea5,32)
   .storeUint(0,64)
   .storeCoins(BigInt(p.amount_units))
   .storeAddress(Address.parse(p.recipient))
   .storeAddress(Address.parse(u.wallet_address))
   .storeBit(0)
   .storeCoins(50000000n)
   .storeBit(0)
   .endCell().toBoc().toString('base64');
 res.json({ok:true,message:{address:wallet.address,amount:'50000000',payload:body},asset:'USDT'});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/level-payment/confirm',async(req,res)=>{try{
 const u=await getUser(req.body);
 const p=await get('SELECT * FROM level_payments WHERE invoice=? AND user_id=?',[req.body.invoice,u.id]);
 if(!p)throw new Error('Payment invoice not found');
 if(p.status==='Confirmed')return res.json({ok:true,confirmed:true,level:p.level,txHash:p.tx_hash,user:publicUser(u)});
 if(Number(u.miner_level||1)>=Number(p.level))return res.json({ok:true,confirmed:true,level:u.miner_level,txHash:p.tx_hash||'',user:publicUser(u)});
 if(lower(p.sender)!==lower(u.wallet_address))throw new Error('Connected wallet does not match the payment wallet');
 if(!paymentAgeOk(p)){await run('UPDATE level_payments SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?',['Expired',p.id,'Pending']);return res.json({ok:true,confirmed:false,status:'Expired',error:'Payment invoice expired. Create a new payment.'});}
 const check=await verifyLevelPayment(p);
 if(!check.confirmed)return res.json({ok:true,confirmed:false,status:'Pending'});
 await run('UPDATE level_payments SET status=?,tx_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?',['Confirmed',check.txHash||'',p.id,'Pending']);
 await run('UPDATE users SET miner_level=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND miner_level<?',[p.level,u.id,p.level]);
 const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);
 res.json({ok:true,confirmed:true,level:fresh.miner_level,txHash:check.txHash||'',user:publicUser(fresh)});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/level-payments',async(req,res)=>{try{const u=await getUser(req.body);const rows=await all('SELECT invoice,level,asset,amount,recipient,status,tx_hash,created_at,updated_at FROM level_payments WHERE user_id=? ORDER BY id DESC LIMIT 30',[u.id]);res.json({ok:true,rows})}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/referrals/claim',async(req,res)=>{try{const u=await getUser(req.body);const before=await get('SELECT team_wallet FROM users WHERE id=?',[u.id]);const amount=Number(before?.team_wallet||0);if(amount<=0)throw new Error('No network rewards available');const r=await run('UPDATE users SET balance=balance+?, team_wallet=0, updated_at=CURRENT_TIMESTAMP WHERE id=? AND COALESCE(team_wallet,0)>0',[amount,u.id]);if(!r.changes)throw new Error('Network reward claim failed. Try again.');const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);res.json({ok:true,reward:amount,user:publicUser(fresh)})}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/withdraw',async(req,res)=>{try{const u=await getUser(req.body);if(!u.wallet_address)throw new Error('Connect a wallet first');if(!u.verified)throw new Error('Verify your wallet first');const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<10)throw new Error('Minimum withdrawal is 10 NYD');if(amount>500)throw new Error('Maximum withdrawal is 500 NYD per request');if(amount>u.balance)throw new Error('Insufficient balance');const burn=amount*0.03,net=amount-burn;const debited=await run('UPDATE users SET balance=balance-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND balance>=?',[amount,u.id,amount]);if(!debited.changes)throw new Error('Insufficient balance');const r=await run('INSERT INTO withdrawals(user_id,amount,burn,net,address) VALUES(?,?,?,?,?)',[u.id,amount,burn,net,u.wallet_address]);res.json({ok:true,id:r.lastID,amount,burn,net,balance:u.balance-amount,status:'Pending'})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post('/api/history',async(req,res)=>{try{const u=await getUser(req.body);const rows=await all('SELECT id,amount,burn,net,address,status,admin_note,created_at,updated_at FROM withdrawals WHERE user_id=? ORDER BY id DESC',[u.id]);res.json({ok:true,rows})}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/deposit/status',async(req,res)=>{try{const u=await getUser(req.body);if(!TON_DEPOSIT_API_URL)return res.json({ok:true,configured:false,depositAddress:DEPOSIT_ADDRESS,credited:0,message:'Configure TON_DEPOSIT_API_URL for automatic blockchain deposit tracking'});const url=TON_DEPOSIT_API_URL.replace('{address}',encodeURIComponent(DEPOSIT_ADDRESS)).replace('{user}',encodeURIComponent(u.telegram_id));const r=await fetch(url);const j=await r.json();const amount=Number(j.amount||j.credited||0);if(Number.isFinite(amount)&&amount>0){await run('UPDATE users SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[amount,u.id]);await run('INSERT INTO deposits(user_id,tx_hash,amount,asset,network,status) VALUES(?,?,?,?,?,?)',[u.id,'api-'+Date.now(),amount,'USDT','TON','Confirmed']);}const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);res.json({ok:true,configured:true,credited:amount,balance:fresh.balance});}catch(e){res.status(400).json({ok:false,error:e.message})}});


async function settleVipUser(userId){
  const u=await get('SELECT id,vip_active,balance,vip_last_mined_at FROM users WHERE id=?',[userId]);
  if(!u || !u.vip_active)return u;
  const now=Date.now();
  let last=Number(u.vip_last_mined_at||0);
  if(!last || last>now) last=now;
  const seconds=Math.max(0,(now-last)/1000);
  if(seconds<=0)return u;
  const reward=seconds*VIP_RATE_PER_SECOND;
  await run('UPDATE users SET balance=COALESCE(balance,0)+?,vip_last_mined_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND vip_active=1',[reward,now,userId]);
  return await get('SELECT * FROM users WHERE id=?',[userId]);
}

async function verifyVipPayment(p){
  if(!p || p.status!=='Pending')return {confirmed:p?.status==='Confirmed',txHash:p?.tx_hash||''};
  const expected=BigInt(p.amount_units);
  const sender=rawAddress(p.sender), recipient=rawAddress(p.recipient);
  const start=Math.floor(new Date(p.created_at+'Z').getTime()/1000)-120;
  const qs=new URLSearchParams({jetton_master:USDT_MASTER,owner_address:recipient,direction:'in',start_utime:String(start),limit:'100',sort:'desc'});
  const data=await fetchTonCenter(`${TONCENTER_BASE_URL}/jetton/transfers?${qs}`);
  for(const t of (data.jetton_transfers||[])){
    if(t.transaction_aborted)continue;
    if(rawAddress(t.destination)!==recipient)continue;
    if(sender){
      const sourceOwner=t.source_wallet||t.source||'';
      let ownerOk=rawAddress(sourceOwner)===sender;
      if(!ownerOk && t.source){
        try{
          const ownerQs=new URLSearchParams({owner_address:sender,jetton_address:USDT_MASTER,limit:'100'});
          const jw=await fetchTonCenter(`${TONCENTER_BASE_URL}/jetton/wallets?${ownerQs}`);
          ownerOk=(jw.jetton_wallets||[]).some(w=>rawAddress(w.address)===rawAddress(t.source));
        }catch{}
      }
      if(!ownerOk)continue;
    }
    if(BigInt(String(t.amount||0))<expected)continue;
    const txHash=t.transaction_hash||t.trace_id||'';
    if(txHash){
      const used=await get('SELECT id FROM vip_payments WHERE tx_hash=? AND status=?',[txHash,'Confirmed']);
      if(used && used.id!==p.id)continue;
    }
    return {confirmed:true,txHash};
  }
  return {confirmed:false};
}

async function confirmVipInvoice(invoice,userId){
  const p=await get('SELECT * FROM vip_payments WHERE invoice=? AND user_id=?',[invoice,userId]);
  if(!p)throw new Error('VIP payment invoice not found');
  if(p.status==='Confirmed'){
    const fresh=await get('SELECT * FROM users WHERE id=?',[userId]);
    return {confirmed:true,txHash:p.tx_hash||'',user:fresh};
  }
  const check=await verifyVipPayment(p);
  if(!check.confirmed)return {confirmed:false,status:'Pending'};
  const used=check.txHash?await get('SELECT id FROM vip_payments WHERE tx_hash=? AND status=?',[check.txHash,'Confirmed']):null;
  if(used && used.id!==p.id)return {confirmed:false,status:'Pending'};
  await run('UPDATE vip_payments SET status=?,tx_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?',['Confirmed',check.txHash||'',p.id,'Pending']);
  await run(`UPDATE users SET vip_active=1,vip_paid_at=COALESCE(vip_paid_at,CURRENT_TIMESTAMP),
    vip_last_mined_at=CASE WHEN COALESCE(vip_last_mined_at,0)<=0 THEN ? ELSE vip_last_mined_at END,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`,[Date.now(),userId]);
  const fresh=await get('SELECT * FROM users WHERE id=?',[userId]);
  return {confirmed:true,txHash:check.txHash||'',user:fresh};
}

app.post('/api/vip/create',async(req,res)=>{try{
  const u=await getUser(req.body);
  await settleVipUser(u.id);
  const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);
  if(fresh.vip_active)return res.json({ok:true,active:true,user:publicUser(fresh),priceUsdt:VIP_PRICE_USDT,ratePerSecond:VIP_RATE_PER_SECOND,address:VIP_QR_ADDRESS});
  if(!fresh.wallet_address||!fresh.verified)throw new Error('Connect and verify your TON wallet first');
  const existing=await get("SELECT * FROM vip_payments WHERE user_id=? AND status='Pending' ORDER BY id DESC LIMIT 1",[fresh.id]);
  if(existing){
    const age=(Date.now()-new Date(existing.created_at+'Z').getTime())/60000;
    if(age<=PAYMENT_TTL_MINUTES)return res.json({ok:true,invoice:existing.invoice,asset:'USDT',amount:VIP_PRICE_USDT,amountUnits:existing.amount_units,recipient:existing.recipient,priceUsdt:VIP_PRICE_USDT,ratePerSecond:VIP_RATE_PER_SECOND,status:'Pending',qrAddress:VIP_QR_ADDRESS,reused:true});
    await run("UPDATE vip_payments SET status='Expired',updated_at=CURRENT_TIMESTAMP WHERE id=?",[existing.id]);
  }
  const invoice=`NYD-VIP-${fresh.telegram_id}-${crypto.randomBytes(7).toString('hex').toUpperCase()}`;
  const units=String(VIP_PRICE_USDT*1e6);
  const r=await run('INSERT INTO vip_payments(invoice,user_id,asset,amount_units,recipient,sender) VALUES(?,?,?,?,?,?)',[invoice,fresh.id,'USDT',units,VIP_QR_ADDRESS,fresh.wallet_address]);
  res.json({ok:true,id:r.lastID,invoice,asset:'USDT',amount:VIP_PRICE_USDT,amountUnits:units,recipient:VIP_QR_ADDRESS,priceUsdt:VIP_PRICE_USDT,ratePerSecond:VIP_RATE_PER_SECOND,status:'Pending',qrAddress:VIP_QR_ADDRESS});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/vip/details',async(req,res)=>{try{
  const u=await getUser(req.body); await settleVipUser(u.id);
  const p=await get('SELECT invoice,asset,amount_units,recipient,sender,status,created_at FROM vip_payments WHERE invoice=? AND user_id=?',[req.body.invoice,u.id]);
  if(!p)throw new Error('VIP payment invoice not found');
  res.json({ok:true,payment:{...p,amount:VIP_PRICE_USDT,payAmount:VIP_PRICE_USDT,priceUsdt:VIP_PRICE_USDT,ratePerSecond:VIP_RATE_PER_SECOND}});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/vip/transaction',async(req,res)=>{try{
  const u=await getUser(req.body); const p=await get('SELECT * FROM vip_payments WHERE invoice=? AND user_id=?',[req.body.invoice,u.id]);
  if(!p)throw new Error('VIP payment invoice not found');
  if(p.status!=='Pending')throw new Error('This VIP payment is no longer pending');
  if(!u.wallet_address||!u.verified)throw new Error('Connect and verify your TON wallet first');
  const sender=rawAddress(u.wallet_address), master=rawAddress(USDT_MASTER);
  const qs=new URLSearchParams({owner_address:u.wallet_address,jetton_address:USDT_MASTER,limit:'100'});
  const data=await fetchTonCenter(`${TONCENTER_BASE_URL}/jetton/wallets?${qs}`);
  const wallets=data.jetton_wallets||[];
  const wallet=wallets.find(x=>rawAddress(x.jetton||x.jetton_address||x.master)===master)||wallets.find(x=>x.address);
  if(!wallet?.address)throw new Error('USDT wallet was not found for your connected wallet. Receive USDT on TON first.');
  const body=beginCell()
    .storeUint(0x0f8a7ea5,32).storeUint(0,64).storeCoins(BigInt(p.amount_units))
    .storeAddress(Address.parse(p.recipient)).storeAddress(Address.parse(u.wallet_address))
    .storeBit(0).storeCoins(50000000n).storeBit(0).endCell().toBoc().toString('base64');
  res.json({ok:true,message:{address:wallet.address,amount:'50000000',payload:body},asset:'USDT',sender});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/vip/confirm',async(req,res)=>{try{
  const u=await getUser(req.body); const result=await confirmVipInvoice(String(req.body.invoice||''),u.id);
  if(!result.confirmed)return res.json({ok:true,confirmed:false,status:'Pending',priceUsdt:VIP_PRICE_USDT,ratePerSecond:VIP_RATE_PER_SECOND});
  res.json({ok:true,confirmed:true,priceUsdt:VIP_PRICE_USDT,ratePerSecond:VIP_RATE_PER_SECOND,txHash:result.txHash,user:publicUser(result.user)});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/vip/status',async(req,res)=>{try{
  const u=await getUser(req.body); const fresh=await settleVipUser(u.id);
  res.json({ok:true,active:!!fresh?.vip_active,priceUsdt:VIP_PRICE_USDT,ratePerSecond:VIP_RATE_PER_SECOND,user:publicUser(fresh)});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

async function autoCheckVipPayments(){
  try{
    const rows=await all("SELECT * FROM vip_payments WHERE status='Pending' ORDER BY id ASC LIMIT 100");
    for(const p of rows){
      try{
        const age=(Date.now()-new Date(p.created_at+'Z').getTime())/60000;
        if(age>PAYMENT_TTL_MINUTES){await run("UPDATE vip_payments SET status='Expired',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='Pending'",[p.id]);continue;}
        const result=await confirmVipInvoice(p.invoice,p.user_id);
        if(result.confirmed)console.log('[VIP] Payment confirmed',p.invoice);
      }catch(e){console.warn('[VIP] payment check:',e.message)}
    }
  }catch(e){console.warn('[VIP] watcher:',e.message)}
}

setInterval(async()=>{
  try{
    const rows=await all("SELECT id FROM users WHERE vip_active=1");
    for(const u of rows){try{await settleVipUser(u.id)}catch(e){console.warn('[VIP] mining:',e.message)}}
  }catch(e){}
},1000);
setInterval(autoCheckVipPayments,10000);

app.post('/api/miner-stats',async(req,res)=>{try{
 const u=await getUser(req.body); await settleVipUser(u.id); const freshVipUser=await get('SELECT * FROM users WHERE id=?',[u.id]);
 const day=new Date().toISOString().slice(0,10);
 const rate=.01*(1+Math.max(0,Number(freshVipUser.miner_level||1)-1)*.02);
 const dayStart=Date.parse(day+'T00:00:00Z'); const paidAt=freshVipUser.vip_paid_at?Date.parse(String(freshVipUser.vip_paid_at).replace(' ','T')+'Z'):NaN;
 const vipStart=Number.isFinite(paidAt)?Math.max(dayStart,paidAt):dayStart;
 const vipEarn=freshVipUser.vip_active?Math.max(0,(Date.now()-vipStart)/1000)*VIP_RATE_PER_SECOND:0;
 const md=await get('SELECT taps FROM mine_daily WHERE user_id=? AND day=?',[u.id,day]);
 const mineEarn=Number(md?.taps||0)*rate;
 const taskRows=await all(`SELECT tc.task_id,t.reward FROM task_claims tc LEFT JOIN tasks t ON (tc.task_id=t.id OR tc.task_id LIKE t.id||':2h:%') WHERE tc.user_id=? AND date(tc.claimed_at)=date('now')`,[u.id]);
 const taskEarn=taskRows.reduce((s,r)=>s+Number(r.reward||0),0);
 const ref=await get(`SELECT COALESCE(SUM(amount),0) AS amount FROM referral_earnings WHERE beneficiary_id=? AND date(created_at)=date('now')`,[u.id]);
 const dep=await get(`SELECT COALESCE(SUM(amount),0) AS amount FROM deposits WHERE user_id=? AND status='Confirmed' AND date(created_at)=date('now')`,[u.id]);
 const wd=await get(`SELECT COALESCE(SUM(amount),0) AS amount FROM withdrawals WHERE user_id=? AND date(created_at)=date('now')`,[u.id]);
 const totalWd=await get(`SELECT COALESCE(SUM(amount),0) AS amount FROM withdrawals WHERE user_id=?`,[u.id]);
 const todayEarned=mineEarn+taskEarn+Number(ref?.amount||0)+Number(dep?.amount||0)+vipEarn;
 const todayWithdrawn=Number(wd?.amount||0);
 const todayPnl=todayEarned-todayWithdrawn;
 res.json({ok:true,price:PRICE_FALLBACK,balance:Number(freshVipUser.balance||0),totalWithdrawn:Number(totalWd?.amount||0),todayEarned,todayWithdrawn,todayPnl,rate,updatedAt:new Date().toISOString()});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.get('/api/price',async(req,res)=>{const price=PRICE_FALLBACK;const source='fixed-product-price';await run('INSERT INTO price_history(price,source) VALUES(?,?)',[price,source]);res.json({ok:true,price,source,updatedAt:new Date().toISOString()})});

function admin(req,res,next){if(req.headers['x-admin-key']!==ADMIN_KEY)return res.status(401).json({ok:false,error:'Unauthorized'});next()}
app.get('/admin',admin,async(req,res)=>{const users=await all('SELECT id,telegram_id,username,referral_code,referrer_code,wallet_address,balance,verified,referrals,miner_level,created_at FROM users ORDER BY id DESC');const wd=await all('SELECT w.*,u.telegram_id,u.username FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC');res.json({ok:true,depositAddress:DEPOSIT_ADDRESS,users,withdrawals:wd})});
app.post('/admin/withdraw/:id',admin,async(req,res)=>{const status=req.body.status;if(!['Approved','Rejected'].includes(status))return res.status(400).json({ok:false,error:'Invalid status'});const w=await get('SELECT * FROM withdrawals WHERE id=?',[req.params.id]);if(!w)return res.status(404).json({ok:false,error:'Not found'});if(w.status!=='Pending')return res.status(400).json({ok:false,error:'Already processed'});if(status==='Rejected')await run('UPDATE users SET balance=balance+? WHERE id=?',[w.amount,w.user_id]);await run('UPDATE withdrawals SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[status,req.body.note||'',w.id]);res.json({ok:true})});
app.get('/admin/deposit-address',admin,(req,res)=>res.json({ok:true,address:DEPOSIT_ADDRESS,network:'TON',asset:'USDT'}));

const webDir = path.join(__dirname,'public');
if (!fs.existsSync(webDir)) throw new Error('Required public directory missing: '+webDir);
// Never let an unknown /api route fall through to the SPA HTML shell.
// The frontend expects JSON; this prevents the 'invalid JSON (200)' symptom.
app.use('/api',(req,res)=>res.status(404).json({ok:false,error:'API endpoint not found',path:req.path}));
app.use((req,res,next)=>{res.setHeader('X-NYD-Build','NYD-5000-WALLET-PERSISTENT-2H-REFERRAL-FIX'); if(req.path==='/'||req.path.endsWith('.html'))res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');next()});
app.use(express.static(webDir,{etag:false,maxAge:0}));
app.get('*',(req,res)=>res.sendFile(path.join(webDir,'index.html'),{headers:{'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate'}}));
app.listen(PORT,()=>console.log(`NayaDost Mining running on http://localhost:${PORT}`));
