import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes
BOT_TOKEN = "8810496478:AAFCVGhkR259n1QvSVfxngTaT7spda1lcaE"
WEBAPP_URL = "https://cute-fairy-7f9f09.netlify.app/"
logging.basicConfig(level=logging.INFO)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [[InlineKeyboardButton("⛏️ Start Mining", web_app=WebAppInfo(url=WEB_APP_URL))]]
    await update.message.reply_text(
        f"Welcome to NayaDost Mining! 🪙\n\nBalance: 0.00 NYD\n\nNeeche button dabao aur mining start karo:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

app = Application.builder().token(BOT_TOKEN).build()
app.add_handler(CommandHandler("start", start))
print("Bot started... @NayaDostMining_NYD_bot")
app.run_polling()
