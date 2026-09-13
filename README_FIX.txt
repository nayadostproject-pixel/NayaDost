NayaDost Mining FINAL FIX

1. Daily mining limit: 5000 taps/day.
2. Mining reward remains 0.0100 NYD per tap at Level 1.
3. Two Telegram channel tasks: 200 NYD each.
4. Existing channel-task rows are force-updated to 200 NYD on server startup.
5. SQLite database uses /var/data on Render when RENDER is set, so data survives restarts/redeploys when the attached persistent disk is active.
6. render.yaml attaches a 1 GB persistent disk and uses Render Starter (paid) because Render Free web services do not provide persistent disks.
7. Wallet disconnect does not clear the user's balance.
8. Withdrawal history remains in the same SQLite database.

IMPORTANT: Deploy this patch to the live Render service. The ZIP itself does not deploy to GitHub/Render automatically.
