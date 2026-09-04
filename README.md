# Survivor Arena Multiplayer

A multiplayer version of the supplied Survivor Arena game.

## Features
- Real-time multiplayer over Socket.IO
- Shared enemy swarm
- No bosses anywhere in the game
- Player username + aura color
- WASD movement
- Space dash
- Auto-targeting weapon
- Level-up upgrades
- Force field, spark drone, orbital saws, Holo-Knight
- XP gems, healing drops, XP vacuum
- Minimap and health bars
- Render-ready Node/Express web service

## Local run

Requires Node.js 18+.

```bash
npm install
npm start
```

Open http://localhost:3000 in two browser tabs/windows.

## Render

Push this folder to GitHub, then create a Render Web Service from the repo, or deploy it as a Blueprint using `render.yaml`.

The server listens on `process.env.PORT` and `0.0.0.0`, which is required for Render.

Free Render services can spin down after inactivity, so the first connection after idle time can take a little longer.
