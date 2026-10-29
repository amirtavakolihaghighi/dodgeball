# The look and feel: the working plan

This is the working plan for the branch `look-and-feel`. Why the branch exists, the analysis behind it and every decision are in phase 15 and decisions 112–123 of [PROJECT.md](PROJECT.md). This file holds:

- the goal;
- the plan and where each step stands;
- how the art is made;
- the budgets that keep laptops smooth;
- the style samples;
- a log of what happened.

Keep it current: update the plan's status and the log after each step.

## The goal

The game should look and feel professionally made: juice and good art, both. We start from the highest expectations and scale down to what's realistic (decision 112).

## The constraints

- **No money and no other people** (decision 113): the user, Claude and free tools.
  - **Claude:** writes the code (effects, animation, sound processing, settings) and the Blender scripts (models, lighting, export).
  - **The user:** picks the direction from options, plays on real screens, listens to every sound, and runs the office sessions.
- **Only art that may be published here** (decision 119): this repository is public and MIT-licensed.
  - **Allowed:** art made here, and CC0 sources (Poly Haven, Quaternius's Universal Animation Library, Mesh2Motion).
  - **Not allowed:** Mixamo (its terms forbid sharing the raw files), paid packs, and the AI model generators.
- **Smooth and fair on office laptops** (decision 116):
  - Here a frame rate is part of fairness.
  - The host's PC also runs the server.
- **The stack stays** (decision 118): the Python server, and three.js in the browser.

## The style

- **The user's taste** (decision 115):
  - vibrant, smooth, clean 3D;
  - liked: Slow Roads, Venge.io, Rocket League, Knockout City;
  - not wanted: pixel art or a retro look, blocky (Minecraft- or Roblox-shaped) humanoids, dull colours.
- **What Claude makes well:** hard-surface shapes, lighting, materials and effects.
- **What Claude makes badly:** faces, hands, hair and cloth. So the proposal is characters in sleek suits, armour and helmets with visors.
- **How it's chosen:** from rendered style samples (decision 123; [the samples](#the-style-samples) below).

## The plan

| # | Step | Status |
| --- | --- | --- |
| 1 | **Style samples:** two or three directions, rendered; the user picks | Round 1 rendered, waiting for the user's pick |
| 2 | **Smooth and fair:** a graphics setting that scales itself down when the frame rate drops (D1); a warning when Chrome draws without the graphics card (D2); presses timed from the key event (B4); every effect prepared in the lobby; the host's tab on a lower setting by default | To do |
| 3 | **Juice:** an impact freeze on the player who's hit (never on the balls you react to); a camera punch; screen shake with a slider that never moves the aim; particles; balls that stretch and spin; a zoom while charging | To do |
| 4 | **Sound:** CC0 recordings, layered and varied; the hall's echo; music; a volume for each kind | To do |
| 5 | **The arena:** floor, walls, stands and a crowd; lighting baked in Blender | To do |
| 6 | **The ball and effects art** | To do |
| 7 | **The characters:** the model, team colours, a lighter version for low settings | To do |
| 8 | **Animation:** running from CC0 motion capture; throws, catches, deflects and dodges in code, fitted to the host's timings; knockouts by physics (ragdolls) | To do |
| 9 | **The HUD and menus** | To do |
| 10 | **An office session:** the logs measure frame rates, freezes and the first download on real laptops | To do |
| 11 | **The merge into `main`**, when the user says so. In the merge's conflicts, keep this branch's phase 15 and decision rows. Rewrite CLAUDE.md's opening section (about this branch) as plain notes for `main` | Not yet |

Step 2 comes before anything heavy, and steps 3 and 4 can follow right after step 1.

## How the art is made

- **Scripts in `art/`** build the art from nothing in Blender, so every piece can be rebuilt and changed (decision 120).
  - Their output (renders and `.blend` files) goes to `art/out/`, which isn't in git.
  - What the game loads is exported as glTF into `static/`.
- **Running a script, in the background** (from a Windows prompt; in a Claude Code worktree session, see `CLAUDE.md` for the Bash form):

  ```text
  "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python art\<script>.py -- <options>
  ```

- **The user's open Blender** (through the MCP, decision 121) is for looking: results are loaded there so the user can turn them around.
  - Scripts sent through the MCP run in safe mode: `bpy`, `bmesh`, `mathutils`, `math`, `random`, and no files, programs or network.
- **Conventions:**
  - Metres, with Z up in Blender (glTF export turns it into the game's Y up).
  - The game's real sizes:
    - the court: 28 × 21 m for 4 a side (`config.py`);
    - the ball: 0.2 m radius;
    - a player: about 1.75 m tall, with the throwing hand at 1.45 m.
  - Materials use the Principled BSDF, which exports as glTF PBR.
  - The game's colours:
    - teams: `#ff4d5e` red and `#3fa9ff` blue;
    - team balls: orange `#ff8a2a` and royal blue `#4f6dff`;
    - rally: yellow, cyan, magenta, red, white.

## The budgets

These are starting targets, to be checked on an office laptop and adjusted:

- 60 fps on the default setting on recent built-in graphics (Intel Iris Xe class), and the lowest setting for older laptops;
- under about 30 MB for the whole first download (about 1 MB today);
- a character: about 5,000–10,000 triangles, one or two materials, textures no bigger than 1024 px;
- the arena: lighting baked into textures, with real-time shadows only for players and balls.

## The style samples

### Round 1 (2026-10-29)

**How they were made:**

- `art/style_samples.py` builds three scenes from nothing, with no downloaded assets, at the game's real sizes and colours. It renders each twice in Blender's EEVEE:
  - **the gameplay view:** the game's own camera, over the right shoulder (`main.js shoulderCamera`: 0.75 m right, 4.4 m back, 2.3 m up, 62° tall);
  - **a close-up** of the near player.
- It also saves them to `art/out/style-samples.blend`, so they can be looked at in Blender.
- The pictures below are copies of `art/out/`.
- The same character kit dresses all three: a smooth body made of lofted tubes, gloves, shoes and a helmet with a visor. Two body types:
  - **sleek**, with armour plates for night and day;
  - **chunky**, with a jersey for the hall.

**The three directions:**

- **Night arena:** a dark stadium; a glossy floor that mirrors the lights; glowing court lines; LED end walls in the team colours; a light rig and haze; a dark crowd with phone lights. The athletes wear glossy team-coloured armour over a dark suit, with glowing rings and a glowing visor. Closest to Venge.io and Rocket League's arenas, and the most readable at night: the glow outlines every player.

  ![Night arena, gameplay view](images/look-and-feel/sample-night-play.jpg)
  ![Night arena, close-up](images/look-and-feel/sample-night-hero.jpg)

- **Daylight court:** an open-air court on a green plateau, glass side walls, hills fading into haze, round trees, soft sun. The athletes are white with team-coloured armour and dark visors. Calm and soft, close to Slow Roads' mood; the least saturated of the three.

  ![Daylight court, gameplay view](images/look-and-feel/sample-day-play.jpg)
  ![Daylight court, close-up](images/look-and-feel/sample-day-hero.jpg)

- **Sports hall:** a bright indoor hall. Each team's half is painted in its colour, with padded boards in five colours, a colourful crowd, bunting and big colour blocks on the walls. The athletes are chunkier: team jerseys over dark sleeves, a white belt, big gloves, and white helmets with dark visors. The most playful, nearest to a toy look.

  ![Sports hall, gameplay view](images/look-and-feel/sample-hall-play.jpg)
  ![Sports hall, close-up](images/look-and-feel/sample-hall-hero.jpg)

**What carries over to the game, and what doesn't:** these are offline renders. In the browser, on office laptops:

- **Carries over:**
  - the shapes, colours and materials;
  - baked lighting;
  - the glow (bloom, a screen effect);
  - the trails.
- **Expensive:** the haze and the mirror-like floor.
  - The haze would be faked with cheap light beams.
  - The floor reflection costs a second render of the scene, so it would be a setting, or faked.
- So the night arena loses the most in the move to a browser, but its darkness also hides simple geometry, and that helps.

**Waiting for:** the user's pick, or a mix of the three, and their notes on the characters.

## The log

- **2026-10-29:**
  - The question and the analysis (phase 15).
  - Blender 5.2 and the "MCP for Blender" add-on were installed by the user, then checked, pinned and tested by Claude.
  - The branch `look-and-feel` was created in its own folder, with this plan.
  - Style samples, round 1: three directions, each in a gameplay view and a close-up, also loaded into the user's Blender.
    - Five rounds of fixes along the way: a black daylight scene (world haze blocks the sun), a lamp mirrored as a blob in the floor, a crowd that took 100 s to build, an overexposed hall, and frilly shorts.
    - The lessons are in section 14 of `PROJECT.md`.
