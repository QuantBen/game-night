# Game Night

Party games for people in the same room. Everyone plays on their own phone; no app to install, no game master.

- `/` is the hub: pick a game, or type a room code to jump straight in.
- `/werewolf` is narrated Werewolf. One device (the "narrator") speaks every command out loud and runs the game; everyone else joins with a 4-letter room code or by scanning the QR code on the narrator's screen.

The site is plain HTML/JS with no build step. Live sync between phones goes through one free Firebase Realtime Database that every game shares.

---

## One-time setup (about 10 minutes)

### 1. Create the Firebase database (free)

1. Go to <https://console.firebase.google.com> and click **Create a project**. Any name works (for example `game-night`). You can turn off Google Analytics.
2. In the left menu, open **Build → Realtime Database** and click **Create Database**.
   - Location: pick the one closest to you (for Singapore, `asia-southeast1`).
   - Security rules: choose **Start in locked mode**.
3. Open the **Rules** tab, delete what's there, paste the contents of [`database.rules.json`](database.rules.json), and click **Publish**.
4. Open the **Data** tab and copy the URL shown at the top. It looks like
   `https://game-night-xxxxx-default-rtdb.asia-southeast1.firebasedatabase.app`
5. Paste that URL into [`shared/firebase-config.js`](shared/firebase-config.js) in place of `PASTE_YOUR_DATABASE_URL_HERE`, and commit.

The URL isn't a secret: it ends up in every visitor's browser anyway. The rules only allow reading and writing inside individual rooms.

### 2. Deploy on Vercel

1. Go to <https://vercel.com/new> and import this GitHub repository.
2. Framework preset: **Other**. Leave the build command and output directory empty.
3. Click **Deploy**. Your site is live at `https://<project>.vercel.app`.

From then on, every push to `main` redeploys automatically.

---

## Playing Werewolf

1. On the device that will narrate (a laptop or tablet that's plugged in works best), open the site → **Werewolf** → **Host a new game on this device**. Turn the volume up.
2. Everyone else scans the QR code or opens the link, then types their name. The narrator can play too: type a name on that device as well.
3. The narrator sets the roles (werewolves, Seer, Doctor) and taps **Deal**. Everyone picks a face-down card, memorises their role, and taps **Ready**.
4. Follow the voice. At night, close your eyes; open them only when your role is called, and act on your phone. In the morning, discuss, tap **Ready to vote**, then vote. The eliminated player's role is revealed.

Tips:
- Keep the narrator's screen on. If it drops out, any phone can tap **Narrate here** to take over.
- The narrator bar has **Repeat**, **Skip** (if someone stops responding), **Voice** (pick a voice or go silent), **Players** (remove someone who left), and **End game**.
- Trying it alone? In the lobby, tap **Add bots**.

## Test mode (no Firebase needed)

Add `?local=1` to any URL, e.g. `/werewolf?local=1`. Tabs in the same browser then talk to each other directly, which is handy for trying things on one computer.

## Adding another game

1. Create a folder with an `index.html`, e.g. `/spyfall/index.html`. Include `/shared/base.css` for the shared look.
2. Use `/shared/realtime.js` for rooms and live sync: `connect()`, `createRoom(B, 'spyfall')`, `roomInfo()`, and the backend's `get / set / on / presence` calls. `werewolf/index.html` shows the full pattern (a host device that owns the game state, and players that send their inputs).
3. Add an entry to the `GAMES` list at the bottom of `/index.html`.

Room codes are shared across games, so the hub's "Got a room code?" box sends people to the right game automatically.

## Files

```
index.html                 hub / game picker
werewolf/index.html        Werewolf
shared/base.css            shared styles
shared/realtime.js         rooms + live sync (Firebase, or ?local=1 test mode)
shared/firebase-config.js  your database URL goes here
shared/vendor/             bundled Firebase SDK and QR-code library
database.rules.json        paste into Firebase → Realtime Database → Rules
vercel.json                clean URLs and caching
```
