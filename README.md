# SPIKE Blocks → Python

Live: https://blocktopythonspike.vercel.app/

Upload a LEGO SPIKE Prime word-block project (`.llsp3`, SPIKE App 3) and get **SPIKE 3** Python back
(`from hub import port`, `motor`, `motor_pair`, `runloop` …). Everything runs in the browser.

## Features
- **Blocks ⇄ Python side by side**: hover a block to highlight the Python it became; click a line to find its block.
- **LEGO-style output**: matches LEGO's own SPIKE 3 examples (`velocity=300` for 30%, `206` degrees for 10 cm, reverse = negative degrees, `motor_pair.pair(...)` at the top).
- **Explain mode**: puts each original block above its Python as a comment.
- **SPIKE project download**: get a Python `.llsp3` that opens in the SPIKE App, or a plain `.py`, or copy.
- **Example robot** button, TODO list for blocks with no Python version, works on phones and in dark mode.

## Files
| File | What it does |
| --- | --- |
| `index.html` | the page |
| `style.css` | styles |
| `app.js` | upload, block view, linking, buttons |
| `converter.js` | the block → Python engine (also runs in Node) |
| `example.js` | the built-in example project |

## How it works
A `.llsp3` file is a zip: `manifest.json` + `scratch.sb3` (another zip) → `project.json`,
which stores every block as an opcode such as `flippermove_setMovementPair`.
`converter.js` walks each "when …" stack and turns blocks into Python. Settings blocks
(movement motors, movement speed, motor speed, wheel size) are written straight into the
moves when they never change, the same way LEGO's examples are written.

Checked against real SPIKE App files, including LEGO's Training Camp programs, which ship in
both block and Python versions.

## Adding a block
Find its opcode (unzip a project, look in `project.json`), then add:
1. a `case` in `stmtLines()` (command blocks) or `reporter()` (round/hexagon blocks), and
2. its wording in the `TPL` table so it shows nicely in the block view.

## Deploy
Static site, no build step. Vercel: framework preset **Other**, no build command.
Pushing to `main` redeploys.
