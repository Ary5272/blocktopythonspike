# SPIKE Blocks → Python

Upload a LEGO SPIKE Prime word-block project (`.llsp3`) and get **SPIKE 3** Python back
(`from hub import port`, `motor`, `motor_pair`, `runloop` …). Everything runs in the browser;
no server, no build step.

## Files
- `index.html` – the page (upload, Copy, Download .py)
- `converter.js` – the block → Python engine

## Deploy to Vercel

**Option A – drag and drop (easiest)**
1. Go to https://vercel.com/new and sign in.
2. Put this folder in a GitHub repo, then pick "Import Git Repository" and choose it.
3. Framework preset: **Other**. Leave build command and output directory empty. Click **Deploy**.

**Option B – command line**
```
npm i -g vercel
cd spike-converter
vercel          # first time: answer the setup questions, framework = Other
vercel --prod
```

## How it works
A `.llsp3` file is a zip: `manifest.json` + `scratch.sb3` (another zip) → `project.json`,
which stores every block as an opcode such as `flippermove_setMovementPair`.
`converter.js` walks each "when …" stack and turns blocks into Python:

| Block | Python |
| --- | --- |
| set movement motors to A+E | `motor_pair.pair(motor_pair.PAIR_1, port.A, port.E)` |
| move forward 20 cm | `await motor_pair.move_for_degrees(motor_pair.PAIR_1, int(20 / cm_per_rotation * 360), 0, velocity=move_speed)` |
| A run clockwise 1 rotation | `await motor.run_for_degrees(port.A, 360, motor_speeds[port.A])` |
| wait 1 seconds | `await runloop.sleep_ms(1000)` |
| when program starts (×2) | two `async def` functions run together with `runloop.run(...)` |

Speeds: block % → degrees/second using ×10 (`SPEED_FACTOR` in `converter.js`).
Blocks without a Python version become `# TODO` comments and are listed under the code.

## Adding a block
Find its opcode (unzip a project, look in `project.json`), then add a `case` for it in
`stmtLines()` (command blocks) or `reporter()` (round/hexagon blocks) in `converter.js`.
