# Chatroom

End-to-end encrypted chat (DMs + group chats), spam rate limiters, notifications, and a GamesPlace
that plays games from [ugs-files-sorted](https://github.com/brickyosu/ugs-files-sorted) and shows play activity.

- `server.js` + `lib/` : express, ws, postgres backend (only ever stores ciphertext)
- `public/index.html` : the whole client app (vanilla js, webcrypto, no dependencies)
- `public/loader.html` : host this anywhere; it loads the app into the page with no iframe

## Env vars
- `DATABASE_URL` (required) postgres connection string
- `GITHUB_TOKEN` (optional) raises the github api rate limit used to index the game list
- `VAPID_SUBJECT` (optional) `mailto:you@example.com` for web push

## Run locally
    DATABASE_URL=postgres://... npm start
