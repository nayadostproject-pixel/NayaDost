import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes
import os
import os
BOT_TOKEN = os.getenv("BOT_TOKEN") or open(".env").read().split("=",1)[1].strip()
WEBAPP_URL = "https://cute-fairy-7f9f09.netlify.app/"
logging.basicConfig(level=logging.INFO)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [[InlineKeyboardButton("⛏️ Start Mining", web_app=WebAppInfo(url=WEBAPP_URL))]]
    await update.message.reply_text(
        f"Welcome to NayaDost Mining! 🪙\n\nBalance: 0.00 NYD\n\nNeeche button dabao aur mining start karo:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

app = Application.builder().token(BOT_TOKEN).build()
app.add_handler(CommandHandler("start", start))
print("Bot started... @NayaDostMining_NYD_bot")
app.run_polling()
