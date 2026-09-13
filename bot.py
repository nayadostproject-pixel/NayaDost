import os
import requests
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes, CallbackQueryHandler

WEB_APP_URL = os.getenv('WEB_APP_URL', 'https://nayadost-3.onrender.com/')
API_BASE_URL = os.getenv('API_BASE_URL', 'https://nayadost-3.onrender.com').rstrip('/')
BOT_API_KEY = os.getenv('BOT_API_KEY', '')
BOT_TOKEN = os.getenv('BOT_TOKEN', '')


def backend(path, payload):
    r = requests.post(
        API_BASE_URL + path,
        json=payload,
        headers={'X-Bot-Api-Key': BOT_API_KEY, 'Content-Type': 'application/json'},
        timeout=15,
    )
    data = r.json()
    if not r.ok or not data.get('ok'):
        raise RuntimeError(data.get('error', f'Backend error {r.status_code}'))
    return data


def keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton('🚀 Open NayaDost Mining', web_app=WebAppInfo(url=WEB_APP_URL))],
        [InlineKeyboardButton('💰 Balance', callback_data='balance')],
    ])


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    ref = context.args[0].strip() if context.args else ''
    try:
        data = backend('/api/bot/referral' if ref else '/api/bot/user', {
            'telegram_id': str(u.id),
            'username': u.username or '',
            'first_name': u.first_name or '',
            'last_name': u.last_name or '',
            'referrer_code': ref,
        })
        user = data['user']
    except Exception as e:
        await update.message.reply_text(f'Backend temporarily unavailable: {e}')
        return
    await update.message.reply_text(
        f'👋 Welcome, {u.first_name}!\n\n'
        f'⛏️ *NayaDost Mining*\n\n'
        f'💰 Balance: `{float(user.get("balance", 0)):.4f} NYD`\n'
        f'👥 Referrals: `{int(user.get("referrals", 0))}`\n\n'
        'Open the Mini App to mine, complete tasks, manage your wallet and withdrawals.',
        parse_mode='Markdown',
        reply_markup=keyboard(),
    )


async def callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    if q.data == 'balance':
        u = q.from_user
        try:
            data = backend('/api/bot/user', {'telegram_id': str(u.id), 'username': u.username or '', 'first_name': u.first_name or '', 'last_name': u.last_name or ''})
            user = data['user']
            await q.message.reply_text(f'💰 Balance: `{float(user.get("balance", 0)):.4f} NYD`', parse_mode='Markdown', reply_markup=keyboard())
        except Exception as e:
            await q.message.reply_text(f'Unable to read balance: {e}')


async def balance(update: Update, context: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    try:
        data = backend('/api/bot/user', {'telegram_id': str(u.id), 'username': u.username or '', 'first_name': u.first_name or '', 'last_name': u.last_name or ''})
        user = data['user']
        await update.message.reply_text(
            f'💰 *NYD Balance*\n\n`{float(user.get("balance", 0)):.4f} NYD`\n\n'
            f'👥 Referrals: `{int(user.get("referrals", 0))}`\n'
            f'⛏️ Total taps: `{int(user.get("taps", 0))}`',
            parse_mode='Markdown', reply_markup=keyboard()
        )
    except Exception as e:
        await update.message.reply_text(f'Unable to read balance: {e}')


async def referral(update: Update, context: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    try:
        data = backend('/api/bot/user', {'telegram_id': str(u.id), 'username': u.username or '', 'first_name': u.first_name or '', 'last_name': u.last_name or ''})
        user = data['user']
        me = await context.bot.get_me()
        link = f'https://t.me/{me.username}?start={user["referralCode"]}'
        await update.message.reply_text(
            f'👥 *Referral Program*\n\n'
            f'Your code: `{user["referralCode"]}`\n'
            f'Total referrals: `{int(user.get("referrals", 0))}`\n'
            f'Successful referrals: `{int(user.get("successfulReferrals", 0))}`\n'
            f'Rewards: `{int(user.get("referralReward", 0))}`\n\n'
            f'🔗 {link}', parse_mode='Markdown'
        )
    except Exception as e:
        await update.message.reply_text(f'Unable to create referral link: {e}')


async def home(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await start(update, context)


async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text('/start — Open NayaDost\n/balance — Balance\n/referral — Referral link\n/help — Help', reply_markup=keyboard())


def main():
    if not BOT_TOKEN:
        raise SystemExit('BOT_TOKEN is missing')
    if not BOT_API_KEY:
        raise SystemExit('BOT_API_KEY is missing')
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler('start', start))
    app.add_handler(CommandHandler('home', home))
    app.add_handler(CommandHandler('balance', balance))
    app.add_handler(CommandHandler('referral', referral))
    app.add_handler(CommandHandler('help', help_cmd))
    app.add_handler(CallbackQueryHandler(callback))
    print('NayaDost Mining bot started — backend is the single source of truth.')
    app.run_polling()


if __name__ == '__main__':
    main()
