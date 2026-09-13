# Local playability gate

This is the repeatable gate for the first family-playable build. It uses the disposable QA world and two separate browser sessions.

## Start

```bash
npm run test:world
DATABASE_PATH=.data/family-test.sqlite npm start
```

Open `http://localhost:3000/play` in two private browser windows. Sign in as `family-alice` and `family-bob`.

## Required checks

1. Both players can enter `Family QA World` and see the same turn number.
2. Alice can move her scout toward the obstacle field. The server path avoids obstacles and the ship moves at most its per-turn speed.
3. Alice submits a destination that is temporarily blocked. The order shows “Blocked; retrying”; after the blocker is removed, the ship resumes without another click.
4. Alice plans a route to P3. Route cards show component ETAs and the total is labeled in turns. The selected route and the executed lane itinerary match.
5. Alice locks a turn. Bob sees the lock, then both players lock and the turn resolves exactly once.
6. Disconnect and reconnect one browser. The player returns to the same game with the current ship position, pending destination, and turn state intact.
7. Bob attempts Alice’s ship, queue, and turn actions. Each is rejected and no Alice state changes.
8. Stop and restart the server. Reopen both sessions and verify the game, objects, orders, and turn number persist.

The automated portion of this gate is available as `npm run test:playability`; it covers authenticated two-client commands, authoritative movement, lane confirmation, blocked retry, duplicate turns, and rollback. The browser steps remain necessary for rendering, reconnect, and restart behavior.
