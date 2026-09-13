from dotenv import load_dotenv
load_dotenv()
import os
import json
import random
import string
from pathlib import Path
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

API_BASE_URL = os.getenv("API_BASE_URL", os.getenv("WEB_APP_URL", "")).rstrip("/")
BOT_API_KEY = os.getenv("BOT_API_KEY", "")
WEB_APP_URL = os.getenv("WEB_APP_URL", "")

def api_user(tg_user, ref_code=None):
    if not API_BASE_URL or not BOT_API_KEY:
        raise RuntimeError("API_BASE_URL and BOT_API_KEY are required")
    import urllib.request
    import json as _json
    payload={
        "telegram_id":str(tg_user.id),
        "username":tg_user.username or "",
        "first_name":tg_user.first_name or "",
        "last_name":tg_user.last_name or "",
        "referrer_code":ref_code or ""
    }
    req=urllib.request.Request(API_BASE_URL+"/bot/user",data=_json.dumps(payload).encode(),headers={"Content-Type":"application/json","X-Bot-Api-Key":BOT_API_KEY},method="POST")
    with urllib.request.urlopen(req,timeout=15) as r:
        data=_json.loads(r.read().decode())
    if not data.get("ok"):
        raise RuntimeError(data.get("error","API error"))
    u=data["user"]
    return {
        "telegram_id":u.get("id",tg_user.id), "name":u.get("firstName",tg_user.first_name or ""),
        "username":u.get("username",tg_user.username or ""), "referral_code":u.get("referralCode",""),
        "referred_by":u.get("referrerCode") or "", "referral_count":u.get("referrals",0),
        "referral_earned":u.get("referralReward",0), "balance":u.get("balance",0), "tap_count":u.get("taps",0)
    }

def get_or_create_user(tg_user, ref_code=None):
    return api_user(tg_user, ref_code), False

def main_keyboard():
    buttons = []

    if WEB_APP_URL:
        buttons.append([
            InlineKeyboardButton(
                "🚀 Open NayaDost Mining",
                web_app=WebAppInfo(url=WEB_APP_URL)
            )
        ])

    buttons += [
        [
            InlineKeyboardButton("💰 Balance", callback_data="balance"),
            InlineKeyboardButton("👥 Referral", callback_data="referral")
        ]
    ]

    return InlineKeyboardMarkup(buttons)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tg_user = update.effective_user
    ref_code = context.args[0] if context.args else None

    user, created = get_or_create_user(tg_user, ref_code)

    text = (
        f"👋 Welcome, {tg_user.first_name}!\n\n"
        "⛏️ *NayaDost Mining*\n\n"
        f"💰 Demo NYD Balance: `{user['balance']:.2f}`\n"
        f"👥 Referrals: `{user['referral_count']}`\n\n"
        "Tap, complete tasks and invite friends.\n"
        "This is an educational/demo app — no guaranteed profit."
    )

    await update.message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=main_keyboard()
    )

async def balance(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user, _ = get_or_create_user(update.effective_user)

    await update.message.reply_text(
        f"💰 *Your Balance*\n\n"
        f"🪙 NYD Demo Credits: `{user['balance']:.2f}`\n\n"
        "Demo credits only.",
        parse_mode="Markdown",
        reply_markup=main_keyboard()
    )

async def referral(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user, _ = get_or_create_user(update.effective_user)

    me = await context.bot.get_me()
    link = f"https://t.me/{me.username}?start={user['referral_code']}"

    await update.message.reply_text(
        f"👥 *Referral Program*\n\n"
        f"Your code: `{user['referral_code']}`\n"
        f"Successful referrals: `{user['referral_count']}`\n"
        f"Referral demo credits: `{user['referral_earned']}`\n\n"
        f"🔗 Your referral link:\n{link}\n\n"
        "Referral rewards are demo credits only.",
        parse_mode="Markdown"
    )

async def rewards(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🎁 *Daily Rewards*\n\n"
        "⛏️ Daily tap reward: 0.01 NYD demo credits\n"
        "👥 Referral reward: 50 NYD demo credits\n\n"
        "No real-money withdrawals or guaranteed profit.",
        parse_mode="Markdown"
    )

async def tasks(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "📋 *Tasks*\n\n"
        "1️⃣ Daily Tap Mining\n"
        "2️⃣ Check Rewards\n"
        "3️⃣ Invite Friends\n\n"
        "More demo tasks can be added later.",
        parse_mode="Markdown"
    )

async def profile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user, _ = get_or_create_user(update.effective_user)

    username = f"@{user['username']}" if user["username"] else "No username"

    await update.message.reply_text(
        f"👤 *Profile*\n\n"
        f"Name: {user['name']}\n"
        f"Username: {username}\n"
        f"Telegram ID: `{user['telegram_id']}`\n"
        f"NYD Balance: `{user['balance']:.2f}`\n"
        f"Referrals: `{user['referral_count']}`",
        parse_mode="Markdown"
    )

async def home(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await start(update, context)

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "ℹ️ *NayaDost Mining Help*\n\n"
        "/start — Start the bot\n"
        "/home — Open dashboard\n"
        "/balance — Check balance\n"
        "/referral — Referral link\n"
        "/rewards — Daily rewards\n"
        "/tasks — Tasks\n"
        "/profile — Telegram profile\n"
        "/help — Help\n\n"
        "NYD shown here is demo/educational credit.",
        parse_mode="Markdown",
        reply_markup=main_keyboard()
    )

def run():
    token = os.getenv("BOT_TOKEN")

    if not token:
        print("BOT_TOKEN not found.")
        print("Make sure .env is configured or set BOT_TOKEN.")
        return

    app = Application.builder().token(token).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("home", home))
    app.add_handler(CommandHandler("balance", balance))
    app.add_handler(CommandHandler("referral", referral))
    app.add_handler(CommandHandler("rewards", rewards))
    app.add_handler(CommandHandler("tasks", tasks))
    app.add_handler(CommandHandler("profile", profile))
    app.add_handler(CommandHandler("help", help_cmd))

    print("===================================")
    print(" NayaDost Mining Bot")
    print(" Bot is starting...")
    print("===================================")

    app.run_polling()

if __name__ == "__main__":
    run()
