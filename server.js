// NayaDost Mining backend
// Node 18+ / Express / SQLite
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { Address, Cell, contractAddress, loadStateInit, WalletContractV1R1, WalletContractV1R2, WalletContractV1R3, WalletContractV2R1, WalletContractV2R2, WalletContractV3R1, WalletContractV3R2, WalletContractV4, WalletContractV5R1 } = require('@ton/ton');
const { sha256, getSecureRandomBytes } = require('@ton/crypto');
const nacl = require('tweetnacl');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({limit:'256kb'}));
app.use(express.urlencoded({extended:true}));
// Cross-origin support: the Mini App may be hosted on Netlify while this Node API
// runs on Render/Railway/VPS. Telegram init-data headers must be explicitly allowed.
app.use((req,res,next)=>{
 res.setHeader('Access-Control-Allow-Origin','*');
 res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
 res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Telegram-Init-Data, X-Telegram-User, X-Admin-Key, Accept');
 res.setHeader('Access-Control-Max-Age','86400');
 if(req.method==='OPTIONS') return res.status(204).end();
 next();
});
app.get('/api/health',(req,res)=>res.json({ok:true,service:'NayaDost Mining API',time:new Date().toISOString()}));
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
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGE_ME_NOW';
const OFFICIAL_CHANNEL = process.env.OFFICIAL_CHANNEL || '@NYDEarn_Official';
const EARN_CHANNEL = process.env.EARN_CHANNEL || 'https://t.me/+9-jDg9aDMOphNzdl';
const DEPOSIT_ADDRESS = process.env.DEPOSIT_ADDRESS || 'UQCx6kQYSADRJEjejFFttCNo12pjdquaOMhrXn8zYuF1wTvX';
const PRICE_API_URL = process.env.NYD_PRICE_API_URL || '';
const TON_DEPOSIT_API_URL = process.env.TON_DEPOSIT_API_URL || '';
const PRICE_FALLBACK = Number(process.env.NYD_PRICE_FALLBACK || 0.0010);
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
const LEVEL_PRICE_MULTIPLIER = Math.max(0.000001, Number(process.env.LEVEL_PRICE_MULTIPLIER || 1));
const TON_PRICE_USD = Math.max(0.000001, Number(process.env.TON_PRICE_USD || 1));
const TON_PRICE_API_URL = String(process.env.TON_PRICE_API_URL || 'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd');
// Multi-level referral commissions. The final rate continues for deeper levels.
const REFERRAL_RATES = String(process.env.REFERRAL_RATES || '5,3,2,1,0.5').split(',').map(Number).filter(x=>Number.isFinite(x)&&x>0);
const REFERRAL_MAX_TOTAL = Math.max(0, Number(process.env.REFERRAL_MAX_TOTAL || 15));

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, {recursive:true});
const db = new sqlite3.Database(path.join(dataDir,'naya_dost.sqlite'));

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
  ('earn_channel','NYD EARN PAYMENT CHANNEL — Join & Verify',1,'telegram',?),
  ('official_channel','Official Channel — Join & Verify',1,'telegram',?),
  ('website','Visit Website (nydtoken.com)',1,'external',''),
  ('react','React to latest post (English)',1,'external',''),
  ('daily','Daily Check-in',5,'daily','')`,[EARN_CHANNEL,OFFICIAL_CHANNEL]);
});

db.run('ALTER TABLE users ADD COLUMN referral_reward INTEGER DEFAULT 0',()=>{});
db.run('ALTER TABLE users ADD COLUMN pending_mining REAL DEFAULT 0',()=>{});
db.run('ALTER TABLE users ADD COLUMN team_wallet REAL DEFAULT 0',()=>{});

function run(sql, params=[]){return new Promise((resolve,reject)=>db.run(sql,params,function(e){if(e)reject(e);else resolve(this);}))}
function get(sql, params=[]){return new Promise((resolve,reject)=>db.get(sql,params,(e,row)=>e?reject(e):resolve(row)))}
function all(sql, params=[]){return new Promise((resolve,reject)=>db.all(sql,params,(e,rows)=>e?reject(e):resolve(rows)))}
function makeCode(){return crypto.randomBytes(5).toString('hex').toUpperCase()}
async function getUser(body){
 const telegramId = String(body.telegram_id || body.telegramId || '');
 if(!telegramId) throw new Error('telegram_id required');
 let u = await get('SELECT * FROM users WHERE telegram_id=?',[telegramId]);
 if(!u){
  let code; do{code=makeCode()}while(await get('SELECT id FROM users WHERE referral_code=?',[code]));
  await run('INSERT INTO users(telegram_id,username,first_name,last_name,referral_code,referrer_code) VALUES(?,?,?,?,?,?)',[telegramId,body.username||'',body.first_name||'',body.last_name||'',code,body.referrer_code||null]);
  u=await get('SELECT * FROM users WHERE telegram_id=?',[telegramId]);
  if(body.referrer_code && body.referrer_code!==u.referral_code){
   const ref=await get('SELECT id FROM users WHERE referral_code=?',[body.referrer_code]);
   if(ref){await run('UPDATE users SET referrals=referrals+1 WHERE id=?',[ref.id]);}
  }
 } else {
  await run('UPDATE users SET username=?,first_name=?,last_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[body.username||u.username,body.first_name||u.first_name,body.last_name||u.last_name,u.id]);
  u=await get('SELECT * FROM users WHERE id=?',[u.id]);
 }
 return u;
}
function publicUser(u){return {id:u.telegram_id,username:u.username,firstName:u.first_name,lastName:u.last_name,referralCode:u.referral_code,referrerCode:u.referrer_code,wallet:u.wallet_address||'',walletType:u.wallet_type||'',verified:!!u.verified,balance:u.balance,taps:u.total_taps,referrals:u.referrals,successfulReferrals:u.successful_referrals,referralReward:u.referral_reward||0,teamWallet:Number(u.team_wallet||0),pendingMining:Number(u.pending_mining||0),level:u.miner_level,sound:!!u.sound}}

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

app.post('/api/bootstrap',async(req,res)=>{try{const u=await getUser(req.body); const tasks=await all('SELECT * FROM tasks WHERE active=1'); const claims=await all('SELECT task_id FROM task_claims WHERE user_id=?',[u.id]); const today=new Date().toISOString().slice(0,10); const dailyClaim=await get('SELECT id FROM task_claims WHERE user_id=? AND task_id=?',[u.id,'daily:'+today]); const mineMeta=await get('SELECT taps FROM mine_daily WHERE user_id=? AND day=?',[u.id,today]); res.json({ok:true,user:publicUser(u),tasks,claims:claims.map(x=>x.task_id),dailyClaimed:!!dailyClaim,mineDay:today,mineTaps:Number(mineMeta?.taps||0),deposit:{address:DEPOSIT_ADDRESS,network:'TON',asset:'USDT'},payments:{tonAddress:PAYMENT_TON_ADDRESS,usdtAddress:PAYMENT_USDT_ADDRESS,usdtMaster:USDT_MASTER},channels:{earn:EARN_CHANNEL,official:OFFICIAL_CHANNEL}})}catch(e){res.status(400).json({ok:false,error:e.message})}});

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
 const count=used+1;
 res.json({ok:true,reward,balance:fresh.balance,pendingMining:Number(fresh.pending_mining||0),taps:fresh.total_taps,mineDay:today,mineTaps:count,remaining:LIMIT-count});
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
  if(!u.verified && u.referrer_code){ const ref=await get('SELECT id FROM users WHERE referral_code=?',[u.referrer_code]); if(ref){ const already=await get('SELECT id FROM referral_earnings WHERE beneficiary_id=? AND source_user_id=? AND source_claim_id=?',[ref.id,u.id,'SIGNUP']); if(!already){ await run('UPDATE users SET successful_referrals=successful_referrals+1, balance=balance+100, referral_reward=referral_reward+1, updated_at=CURRENT_TIMESTAMP WHERE id=?',[ref.id]); await run('INSERT INTO referral_earnings(beneficiary_id,source_user_id,source_claim_id,level,rate,amount) VALUES(?,?,?,?,?,?)',[ref.id,u.id,'SIGNUP',1,0,100]); } } }
 const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);
 res.json({ok:true,user:publicUser(fresh)});
}catch(e){res.status(400).json({ok:false,error:e.message})}});

// Deliberately reject manual address binding. Wallet addresses must come from TON Connect + ton_proof.
app.post('/api/wallet/connect',async(req,res)=>res.status(400).json({ok:false,error:'Manual wallet addresses are disabled. Use Connect Wallet through Telegram/TON Connect.'}));
app.post('/api/verify-wallet',async(req,res)=>res.status(400).json({ok:false,error:'Wallet verification is performed automatically by TON Connect proof.'}));
app.post('/api/wallet/disconnect',async(req,res)=>{try{const u=await getUser(req.body);await run('UPDATE users SET wallet_address=NULL,wallet_type=NULL,verified=0,updated_at=CURRENT_TIMESTAMP WHERE id=?',[u.id]);const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);res.json({ok:true,user:publicUser(fresh)})}catch(e){res.status(400).json({ok:false,error:e.message})}});

// Channel tasks intentionally use a lightweight one-time claim flow.
// We open the channel for the user, then credit the reward once per task.
// No Telegram Bot API membership check is required, so rewards are not blocked by
// missing BOT_TOKEN/private-channel permissions.
app.post('/api/tasks/telegram-verify',async(req,res)=>{try{
 const u=await getUser(req.body);
 const task=await get('SELECT * FROM tasks WHERE id=? AND active=1',[req.body.task_id]);
 if(!task||task.type!=='telegram')throw new Error('Telegram task not found');
 const claim=await get('SELECT id FROM task_claims WHERE user_id=? AND task_id=?',[u.id,task.id]);
 if(claim)return res.json({ok:true,already:true,user:publicUser(u),reward:0});
 const claimRow=await run('INSERT INTO task_claims(user_id,task_id,claimed_at) VALUES(?,?,CURRENT_TIMESTAMP)',[u.id,task.id]);
 await run('UPDATE users SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[task.reward,u.id]);
 await distributeReferralRewards(u.id,'TASK:'+claimRow.lastID,task.reward);
 const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);
 res.json({ok:true,claimed:true,reward:task.reward,user:publicUser(fresh)});
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
 let price=PRICE_FALLBACK;
 if(PRICE_API_URL){try{const r=await fetch(PRICE_API_URL);const j=await r.json();const x=Number(j.price??j.usd??j.data?.price);if(Number.isFinite(x)&&x>0)price=x}catch{}}
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

app.post('/api/withdraw',async(req,res)=>{try{const u=await getUser(req.body);if(!u.wallet_address)throw new Error('Connect a wallet first');if(!u.verified)throw new Error('Verify your wallet first');const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<10)throw new Error('Minimum withdrawal is 10 NYD');if(amount>500)throw new Error('Maximum withdrawal is 500 NYD per request');if(amount>u.balance)throw new Error('Insufficient balance');const burn=amount*0.03,net=amount-burn;await run('UPDATE users SET balance=balance-?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[amount,u.id]);const r=await run('INSERT INTO withdrawals(user_id,amount,burn,net,address) VALUES(?,?,?,?,?)',[u.id,amount,burn,net,u.wallet_address]);res.json({ok:true,id:r.lastID,amount,burn,net,balance:u.balance-amount,status:'Pending'})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post('/api/history',async(req,res)=>{try{const u=await getUser(req.body);const rows=await all('SELECT id,amount,burn,net,address,status,admin_note,created_at,updated_at FROM withdrawals WHERE user_id=? ORDER BY id DESC',[u.id]);res.json({ok:true,rows})}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.post('/api/deposit/status',async(req,res)=>{try{const u=await getUser(req.body);if(!TON_DEPOSIT_API_URL)return res.json({ok:true,configured:false,depositAddress:DEPOSIT_ADDRESS,credited:0,message:'Configure TON_DEPOSIT_API_URL for automatic blockchain deposit tracking'});const url=TON_DEPOSIT_API_URL.replace('{address}',encodeURIComponent(DEPOSIT_ADDRESS)).replace('{user}',encodeURIComponent(u.telegram_id));const r=await fetch(url);const j=await r.json();const amount=Number(j.amount||j.credited||0);if(Number.isFinite(amount)&&amount>0){await run('UPDATE users SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[amount,u.id]);await run('INSERT INTO deposits(user_id,tx_hash,amount,asset,network,status) VALUES(?,?,?,?,?,?)',[u.id,'api-'+Date.now(),amount,'USDT','TON','Confirmed']);}const fresh=await get('SELECT * FROM users WHERE id=?',[u.id]);res.json({ok:true,configured:true,credited:amount,balance:fresh.balance});}catch(e){res.status(400).json({ok:false,error:e.message})}});

app.get('/api/price',async(req,res)=>{let price=PRICE_FALLBACK,source='fallback';try{if(PRICE_API_URL){const r=await fetch(PRICE_API_URL);const j=await r.json(); const p=Number(j.price ?? j.usd ?? j.data?.price);if(Number.isFinite(p)&&p>0){price=p;source='configured-api'}}}catch{} await run('INSERT INTO price_history(price,source) VALUES(?,?)',[price,source]);res.json({ok:true,price,source,updatedAt:new Date().toISOString()})});

function admin(req,res,next){if(req.headers['x-admin-key']!==ADMIN_KEY)return res.status(401).json({ok:false,error:'Unauthorized'});next()}
app.get('/admin',admin,async(req,res)=>{const users=await all('SELECT id,telegram_id,username,referral_code,referrer_code,wallet_address,balance,verified,referrals,miner_level,created_at FROM users ORDER BY id DESC');const wd=await all('SELECT w.*,u.telegram_id,u.username FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC');res.json({ok:true,depositAddress:DEPOSIT_ADDRESS,users,withdrawals:wd})});
app.post('/admin/withdraw/:id',admin,async(req,res)=>{const status=req.body.status;if(!['Approved','Rejected'].includes(status))return res.status(400).json({ok:false,error:'Invalid status'});const w=await get('SELECT * FROM withdrawals WHERE id=?',[req.params.id]);if(!w)return res.status(404).json({ok:false,error:'Not found'});if(w.status!=='Pending')return res.status(400).json({ok:false,error:'Already processed'});if(status==='Rejected')await run('UPDATE users SET balance=balance+? WHERE id=?',[w.amount,w.user_id]);await run('UPDATE withdrawals SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[status,req.body.note||'',w.id]);res.json({ok:true})});
app.get('/admin/deposit-address',admin,(req,res)=>res.json({ok:true,address:DEPOSIT_ADDRESS,network:'TON',asset:'USDT'}));

const webDir = fs.existsSync(path.join(__dirname,'public')) ? path.join(__dirname,'public') : __dirname;
app.use((req,res,next)=>{if(req.path==='/'||req.path.endsWith('.html'))res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');next()});
app.use(express.static(webDir,{etag:false,maxAge:0}));
app.get('*',(req,res)=>res.sendFile(path.join(webDir,'index.html'),{headers:{'Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate'}}));
app.listen(PORT,()=>console.log(`NayaDost Mining running on http://localhost:${PORT}`));
