# The athletes' animations: the full list

Every animation the athletes have, every change from one move into another, and what you should see in each. This is step 8's working list (decision 142): the user tries one move, writes what they saw and what they expected, Claude fixes that move only, and once the user approves it, it's **locked**.

> **On hold since 2026-11-03, and not finished** (decision 143). The user approved the three fixes from 11-01 (perfect dodges, strafing, getting up: now Locked) and is happy with the moves for now. Other work came first: the office logs, then names, players' identities, renaming, the lobby's search and bots with flags. **When the moves are picked up again, the first job is the animation tool** (option c at the end of this list: a viewer, then an editor), then the rest of this list, one move at a time. Since the merge into `main` (v2.3.0, 2026-11-03), this is the first item on `main`'s task list (section 15 of `docs/PROJECT.md`).

Times are with the default rules: the host can change the dash's time, each action's window and recovery, and the charge time, and the moves stretch to fit.

## How we work through it

1. The user picks a move from the list (or takes the next one).
2. The user tries it (where, in the next section), then writes what they saw and what they expected under **What the tester experienced**. A still picture of the pose they want helps more than words: a screenshot from a video, or a photo.
3. Claude fixes that move only, shows pictures of it, and runs the tests.
4. The user tries it again. When it's right, its status becomes **Locked** (with the date). A locked move isn't changed again without the user's say, and Claude adds a check of it to the moves test (`LOCKS` in `tests/browser/moves.js`, checked by `__lock` in `moves.json`): its key numbers at the held moment, with a tolerance. A later change that alters it prints `FAIL locked move ...` and the run exits with 1.

**Status:** **Open** = not judged yet. **Faulty** = the tester found a problem. **Waiting for test** = changed, and the tester hasn't tried the change yet. **Locked** = approved: don't change it without the user's say.

## Where to see them

- **In the game:**
  - **The lobby's warm-up** (Esc › Warm up): run, throw, dodge, catch and deflect alone, at your own pace.
  - **A match with bots:** everything else (perfect dodges need a ball coming at you; knockouts, getting up and a round's end need a match).
- **The clips as files** (the 17 clips marked "clip" below). Note: the game doesn't play them as they are. It cuts, speeds up, blends and turns them; the throw's wind-up, for example, is the clip's first 0.43 s stretched over your charge.
  - `art/out/athlete/athlete_preview.glb`: the athlete in the red kit with all 17 clips. Drag it into a glTF viewer in the browser, such as <https://gltf-viewer.donmccurdy.com/>, which lists the clips and plays them. Or import it into Blender (File › Import › glTF 2.0).
  - `art/out/athlete/athlete.blend`: the Blender file `art/athlete.py` saves: the skeleton "athlete" (15 bones) with the 17 clips as tracks, both bodies (`_hi` and `_lo`) and both heads.
  - `static/characters/athlete.glb`: the game's own copy. It looks grey in other programs, because the game paints its colours.
  - `art/out/anim-sources/mesh2motion/*.glb`: the CC0 library the clips come from (178 clips on Mesh2Motion's own figure): other clips we could choose instead.
  - `art/out/` isn't in git: `art/athlete.py` builds it again (about a minute; it downloads the library once).
- **The moves marked "made here"** exist only as numbers in `static/js/athlete.js` (where the hands and feet go over the move; the arms and legs bend to reach them). No file shows them: only the game does. To edit them in Blender or another tool, Claude would first have to record them into clips.

## A. Standing and moving

| # | Animation | When it plays | What you should see | Made from | What the tester experienced | Status |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Idle | In the lobby, the warm-up and between rounds, standing still | Standing relaxed, breathing; it loops (3.1 s) | clip `idle` | | Open |
| A2 | Guard stance | During the countdown and play, standing still | A boxer's guard, fists up; it loops (1.7 s) | clip `guard` | | Open |
| A3 | Jog | Moving at up to 3 m/s | A jog whose steps keep pace with the floor (one cycle every 5.4 m) | clip `jog` | | Open |
| A4 | Sprint | Faster: blends in from 3 m/s, all sprint from 5.5 m/s (the top speed is 6) | A sprint. Its cycle is stretched to at least 4.2 m so the legs don't blur, so the feet slide a little | clip `sprint` | | Open |
| A5 | Starting and stopping | Speeding up from a stop, or slowing to one | The run fades in between 0.25 and 1.4 m/s, and out the same way | game | | Open |
| A6 | Strafing right | Only D (or →) held | The legs turn up to 75° to the right and run forwards that way, whatever you did before (backing up too); the chest keeps a quarter of the turn; the head faces the aim | clips `jog` and `sprint`, turned | Second test (11-01): "legs are still wrong when you just hold left and right without forward". First test (10-31): "i press to go right and the legs walk left". (Changed 11-01: see Claude's notes below.) Third test (11-03): good. | Locked (2026-11-03) |
| A7 | Strafing left | Only A (or ←) held | The mirror of A6 | clips `jog` and `sprint`, turned | Second test (11-01): as A6. (Changed 11-01: see Claude's notes below.) Third test (11-03): good. | Locked (2026-11-03) |
| A8 | Forward diagonals | W+A or W+D | The legs turn 45° towards the movement and run | clips `jog` and `sprint`, turned | | Open |
| A9 | Backpedal | S held | The jog played backwards, the legs square to the aim | clip `jog`, reversed | First test (10-31): "backpedal look natural" | Open |
| A10 | Backward diagonals | S+A or S+D | Backpedalling with the legs turned 45° (for S+D the hips turn front-left), so the feet step back the way you move | clip `jog`, reversed and turned | | Open |
| A11 | Forward run ↔ backpedal | Changing direction across your side | The run turns into a backpedal when the movement passes 103° from the aim, and back when it comes under 97°, so pure sideways (90°) always runs forwards | game | Changed 11-01 (with A6) Third test (11-03): good. | Locked (2026-11-03) |
| A12 | Changing direction while running | e.g., right, then left | The legs swing round to the new direction in about a quarter of a second | game | | Open |
| A13 | Turning on the spot | Aiming with the mouse, standing | The whole body turns with the aim; no steps | game | | Open |
| A14 | Running one way, aiming another | e.g., running right while aiming ahead | The legs point where you run (up to 75° from the aim), the upper body where you aim | game | | Open |

## B. Carrying the ball

| # | Animation | When it plays | What you should see | Made from | What the tester experienced | Status |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Holding the ball | Whenever you have a ball and aren't throwing | The right hand in front of the right hip, palm up, the ball resting in it; steady while standing and running | made here | | Open |
| B2 | A ball arrives | When the throw's cooldown ends, or after a catch (D7) | The right hand moves to B1 over 0.15 s, the ball in it | made here | | Open |
| B3 | The ball in whole-body moves | Dashes, acrobatics, flinches, knockouts, getting up, celebrating | The arms follow that move, and the ball stays in the right hand wherever it goes (in a dash, the guard's raised fist) | the move's own | | Open |

## C. Throwing (the right arm)

| # | Animation | When it plays | What you should see | Made from | What the tester experienced | Status |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | Which throw | Each time you start charging | One of three styles at random: overhead, side-arm or underarm | game | First test (10-31) asked for these three | Open |
| C2 | Overhead wind-up | Holding throw (a full charge takes 0.9 s) | The arm draws back over the shoulder, the ball behind the head, as far as the charge has gone (the clip's first 0.43 s); standing still, the legs take the clip's step too | clip `throw` | | Open |
| C3 | Overhead release | Letting go | Through the release and on into the follow-through, in 0.42 s. The ball flies the moment you let go, while the arm is still back; the arm comes through about 0.18 s later | clip `throw` | | Open |
| C4 | Side-arm wind-up | Holding throw | The right hand at the stomach's height, moving out to the right and a little back as the charge grows (from 0.3 to 0.62 m out); the chest turns up to 23° away | made here | | Open |
| C5 | Side-arm release | Letting go | The arm sweeps across the front at stomach height, the chest swinging 26° the other way, then settles (the ball has already flown, as in C3) | made here | | Open |
| C6 | Underarm wind-up | Holding throw | Like bowling: the right hand down and back below the waist (0.3 m behind, 0.88 m up), the upper body bending up to 17° forward | made here | | Open |
| C7 | Underarm release | Letting go | A low swing forward and up (0.76 m up as it passes, ending 0.62 m ahead at 1.08 m), the body straightening (the ball has already flown, as in C3) | made here | | Open |
| C8 | Throwing while running | Charging and throwing on the move | The legs keep running; the throw moves the upper body only | game | | Open |
| C9 | A quick throw | Letting go before a full charge | The wind-up only goes as far as the charge did; the release starts from the fully wound-up arm, so it may jump | made here, clip `throw` | | Open |
| C10 | A charge cancelled by a defence | Dodge, catch or deflect while charging (the game cancels the charge) | Catch or deflect: the right arm stays up a moment (fading over 0.4 s) while the left arm acts. Dodge: the dash takes over the whole body | game | | Open |
| C11 | The ball glows | While charging | The ball in hand glows brighter as the charge grows | effect | | Open |

## D. The left arm: guard, parry, catch

| # | Animation | When it plays | What you should see | Made from | What the tester experienced | Status |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Guard while charging | Any wind-up | The left forearm level in front of the face, hiding it, the palm towards the face; it follows the head when the body bends (underarm); in and out over 0.1 s | made here | First test (10-31) asked for it: "the left hand always comes horizontally infront of the face like hiding the face behind the arm" | Open |
| D2 | Deflect: the backhand parry | Pressing deflect (E); 0.48 s (the deflect's window 0.18 s and recovery 0.3 s) | The left forearm across the chest, the back of the hand towards the ball; then it swings out to the left like a door opening, the back of the hand leading, at shoulder height: 0.42 m out 0.15 s in, furthest (0.52 m) at 0.24 s; the chest unwinds from 14° right to 17° left; then the hand drops to the side | made here | First test (10-31), of the first version: "looks like the character is punching the ball back"; wanted a left-hand parry like Dark Souls' (the user offered a precise description) | Open |
| D3 | Deflect mid-charge | Deflecting while charging | The charge is cancelled; the right arm stays up a moment while the left hand parries (D2) | made here | First test (10-31) asked for the backhand parry here too | Open |
| D4 | A deflect that meets the ball | The deflect succeeds | The parry plays on to its end (the game ends the deflect at once); a ring and a swipe in the deflect's colour | made here, effects | | Open |
| D5 | Catch: the palm blast | Pressing catch (right mouse or F); 0.55 s (window 0.3 s, recovery 0.25 s) | The left arm straight out in front at shoulder height (0.6 m), palm forward, fingers up, the left shoulder turned forward (the chest 31° to the right); in over 0.05 s, out over the recovery | made here | First test (10-31) asked for it: "left hand extended forward and left shoulder turned forward like iron man doing a blast with his palm plasma blaster with one hand" | Open |
| D6 | Catch mid-charge | Catching while charging | From the guard (D1), the left hand turns over, palm from the face to forward, as it shoots out | made here | First test (10-31): "the left hand rotates 180 degree so that the inside of the hand is facing outward and forward" | Open |
| D7 | The caught ball | A catch meets the ball | The ball sits in the left palm for 0.35 s while the hand pulls it in to the stomach, the palm turning towards the right hand, which comes across to take it; then it's in the right hand (B1). Starting a wind-up meanwhile moves it to the right hand at once | made here | | Open |
| D8 | A defence that misses | The ball hits you anyway | The hit (G1 to G6) takes over | game | | Open |
| D9 | Pressing again | A new press of the same defence | The move starts again from the beginning | game | | Open |

## E. Dodges (the dash)

| # | Animation | When it plays | What you should see | Made from | What the tester experienced | Status |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | Which dodge | Pressing dodge (Space or Shift) | By the dash's direction from the aim: within 52° forward, beyond 132° back, otherwise left or right. With no direction held, the game dashes you sideways (to the right, or away from an incoming ball's line) | game | | Open |
| E2 | Dash right | A dash to the right: 0.22 s, then 0.25 s of landing | The right foot lifts (10 cm) and steps out (0.33 m); the left foot pushes the body across (out to 0.4 m, its heel rising); the hips shift 5 cm left (the push), then 8 cm right, dipping 6–9 cm; the upper body tilts 14–16° forward; at the end the right foot lands (0.28 m out) and takes the weight, and the left foot follows in. The arms keep the guard | made here | First test (10-31) asked for exactly this | Open |
| E3 | Dash left | A dash to the left | The mirror of E2 | made here | | Open |
| E4 | Dash forward | A dash forwards | A half crouch (the hips 13 cm down, 10 cm forward) and one big step: the left foot lifts 15 cm and lands 0.55 m ahead, the right foot pushes 0.46 m behind; the upper body leans 18° forward | made here | First test (10-31), of the first version: "dashing forward makes the right hand do a backhand flick"; asked for "half crouch and one big step forward" | Open |
| E5 | Dash back | A dash backwards | A jump back still facing forward: a crouch (the hips 9 cm down), the jump (the hips 12 cm up, both feet tucked 24 cm up), a soft landing (the hips 10 cm down), then standing | made here | First test (10-31) asked for "a jump back but facing forward" | Open |
| E6 | The dash's trail | During the dash | Faint glowing copies of the body every 0.045 s (your own very faint), each fading over 0.4 s; not on Low graphics | effect | | Open |
| E7 | Dashing with the ball or while charging | | The charge is cancelled; during the dash the arms follow the guard, the ball in the right fist | game | | Open |
| E8 | The end of a dash | | The dash hands the body back to running or standing over its last 0.08 s | game | | Open |

## F. Perfect dodges

| # | Animation | When it plays | What you should see | Made from | What the tester experienced | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Which acrobatic | A dodge the game counts as perfect | A corkscrew, an aerial side flip or a butterfly twist, the same on every screen; moving backwards (faster than 1.5 m/s), a backflip. Each lasts 0.5 s, with glowing afterimages every 0.065 s and a glow in the team's colour | game | Second test (11-01): "the perfect dodge animations are ruined. i dont know what did you do but it seems like nothing is happening with the character until last frame of animation and then only some movement from the after image is visible". (Changed 11-01: see Claude's notes below.) Third test (11-03): good. | Locked (2026-11-03) |
| F2 | Corkscrew | | The backflip from just before its takeoff to its landing, kept low (28% of its height), with a full twist round the body | clip `flip`, with a twist | Second test (11-01): as F1. (Changed 11-01: see Claude's notes below.) Third test (11-03): good. | Locked (2026-11-03) |
| F3 | Aerial side flip | | The mid-air pose turning a full circle sideways, towards the side you were moving, rising 0.55 m | clip `air`, turned | Second test (11-01): as F1. (Changed 11-01: see Claude's notes below.) Third test (11-03): good. | Locked (2026-11-03) |
| F4 | Butterfly twist | | The mid-air pose leaning flat (up to 72°) and spinning a full circle round the vertical, rising 0.55 m | clip `air`, turned | Second test (11-01): as F1. (Changed 11-01: see Claude's notes below.) Third test (11-03): good. | Locked (2026-11-03) |
| F5 | Backflip | A perfect dodge while moving backwards | The backflip, kept low, without the twist | clip `flip` | First test (10-31) asked for it. Second test (11-01): as F1. (Changed 11-01: see Claude's notes below.) Third test (11-03): good. | Locked (2026-11-03) |

## G. Getting hit and knocked out

| # | Animation | When it plays | What you should see | Made from | What the tester experienced | Status |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Impact freeze | Being hit | The pose freezes and shudders for 0.085 s (0.15 s if it knocks you out), with a flash in the team's colour fading over 0.18 s; everything else keeps moving | effect | | Open |
| G2 | Flinch | Hit, not knocked out | A recoil of the chest or the head (at random), at 85% strength, for up to 0.5 s after the freeze | clips `flinch_chest`, `flinch_head` | | Open |
| G3 | Knockout: falling back | Knocked out by a ball slower than 16 m/s | The body turns to face the thrower, then falls back, away from the ball | clip `ko_back` | | Open |
| G4 | Knockout: thrown off the feet | 16–24 m/s | A harder fall, thrown back off the feet | clip `ko_fly` | | Open |
| G5 | Knockout: tumbling | Faster than 24 m/s | Thrown back, tumbling | clip `ko_tumble` | | Open |
| G6 | Lying down | After the fall | The fall's last pose holds; from 2.2 s the body fades out over 0.6 s | clip, effect | | Open |
| G7 | Knocked out by team health | The team's bar empties and everyone on it goes down together | Those the ball didn't hit fall back (G3) the way they face | clip `ko_back` | | Open |
| G8 | Hit during another move | | A flinch lies over whatever plays; a knockout replaces everything | game | | Open |

## H. Getting up

| # | Animation | When it plays | What you should see | Made from | What the tester experienced | Status |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | Revived | A teammate revives you | Getting up from the floor in 1.1 s (the clip sped up), easing into the stance over the last 0.3 s. If you move while getting up, the get-up gives way to running within 0.15 s: no sliding along the floor | clip `getup` | Second test (11-01): "when the character is knocked out... if they are revived, the player can move left and right when the character is lying on the ground flat and is not good". (Changed 11-01: see Claude's notes below.) Third test (11-03): good. | Locked (2026-11-03) |
| H2 | Back up at a round's start | A new round starts while you're down | The same as H1 | clip `getup` | Second test (11-01): "if the round starts and the characater is getting up from the ground... the player can move left and right when the character is lying on the ground flat". (Changed 11-01: see Claude's notes below.) Third test (11-03): good. | Locked (2026-11-03) |
| H3 | Flickering while protected | Right after a revive, while the game protects you | The body flickers between solid and see-through | effect | | Open |

## I. A round's end

| # | Animation | When it plays | What you should see | Made from | What the tester experienced | Status |
| --- | --- | --- | --- | --- | --- | --- |
| I1 | Winners celebrate | Your team won the round, and you're up, standing still and doing nothing | A jump, a fist pump or cheering (one per player and round), looping; it fades in over 0.3 s | clips `win_jump`, `win_pump`, `cheer` | | Open |
| I2 | Losers kneel | Your team lost, standing still | Kneeling, tired, looping | clip `beaten` | | Open |
| I3 | A draw | | Nobody celebrates | game | | Open |
| I4 | Moving during the end | | The celebration fades out over 0.3 s, back to normal moves | game | | Open |

## J. One move into another

Most moves above say how they start and end. These are the changes worth testing on their own:

| # | Change | What you should see | What the tester experienced | Status |
| --- | --- | --- | --- | --- |
| J1 | Idle ↔ guard | When a countdown starts or a round ends: an instant switch, with no blend | | Open |
| J2 | Holding the ball → wind-up | The right hand leaves the hip for the wind-up over 0.08 s; the left forearm rises to the face (D1) over 0.1 s | | Open |
| J3 | Release → empty hand → a new ball | After the release the arm settles (0.18 s); when the cooldown ends, the ball appears in the right hand (B2) | | Open |
| J4 | Guard → parry | The left hand goes from in front of the face down across the chest, then out (D2) | | Open |
| J5 | Guard → catch | The left hand turns over and shoots out (D6) | | Open |
| J6 | Catch → caught ball → holding it | D5, then D7, then B1 | | Open |
| J7 | Anything → dash → back | The dash takes the whole body in 0.03 s and gives it back over 0.08 s (E8) | | Open |
| J8 | Dash → perfect dodge | The acrobatic takes over right away and plays its whole 0.5 s | Second test (11-01): broken (F1). (Changed 11-01: see Claude's notes below.) Third test (11-03): good. | Locked (2026-11-03) |
| J9 | Anything → flinch | The flinch lies over the move (G2) | | Open |
| J10 | Anything → knockout → lying → fading | G1, then G3 to G5, then G6 | | Open |
| J11 | Lying → getting up → stance | H1; the player shouldn't slide along the floor while lying | Second test (11-01): the player moves while lying flat (H1, H2). (Changed 11-01: see Claude's notes below.) Third test (11-03): good. | Locked (2026-11-03) |
| J12 | Play → round's end → next round | I1 or I2 while standing still; at the next round, back to the stance | | Open |
| J13 | Strafing right → left | The legs swing round through forward (A12) | | Open |
| J14 | Running forward → backpedalling | A11 | | Open |

## K. Other

| # | Animation | What you should see | What the tester experienced | Status |
| --- | --- | --- | --- | --- |
| K1 | Players near the camera | Another player closer than 2.6 m to the camera turns 80% see-through, so they don't block your view | | Open |
| K2 | Low graphics | The same moves on lighter bodies; no afterimages (no dash trail, no perfect-dodge copies) | | Open |
| K3 | The stick figures | Until the athlete has loaded, or with `?noathlete` in the address: the old simple figures with their own poses (not part of this list's work) | | |
| K4 | Other things | The tester has seen other problems, still to be reported move by move | Second test (11-01): "there are other things too" | Open |

## Claude's notes on the reported problems

Changed on 2026-11-01. The tester approved all three on 2026-11-03 ("good"), so they're Locked, and the moves test checks their numbers (`tests/browser/moves.json`).

- **Perfect dodges (F1 to F5, J8):** in the redo, the dash's footwork (E2 to E5) was put after the acrobatics in the layers, so it covered them for the whole dodge (0.47 s of the acrobatic's 0.5 s). Only the last moment showed, and the afterimages copied the footwork. A regression from the redo.
  - **Changed:** the footwork now comes first and the acrobatics over it. The test holds a corkscrew in the middle of a dash: the body is in the air (the hips 1.48 m up), the same as a corkscrew alone.
- **The legs with only left or right held (A6, A7, A11):** the switch between running forward and backpedalling had a dead band from 77° to 103°, and a pure sideways move (90°) sat inside it. So a strafe kept whatever came before: after backing up, it backpedalled with the legs turned the other way. Claude's strafe test had started from standing still, so it passed.
  - **Changed:** the band is now 97° to 103°, so pure sideways always runs forwards. The test strafes right right after a backpedal: the hips turn right (+1.28 rad) and run forwards.
  - If it still looks wrong, the next step is giving pure sideways its own move (a side shuffle).
- **Throws (C3, C5, C7):** not reported, but worth checking: the ball flies the moment you let go, and the arm swings through after it (the overhead arm reaches its release point 0.18 s later).
- **Moving while lying (H1, H2, J11):** the game lets a revived player move at once, and getting up takes 1.1 s, so the body slid along the floor.
  - **Changed:** moving while getting up cuts the get-up short: it gives way to running over 0.15 s. Standing still, the whole get-up still plays. The test walks during a get-up: the body is up and running (the hips 0.89 m up, against 0.29 m standing still at the same moment).
  - Also: when the server places a player (at a round's start), the figure no longer takes the jump for running.
  - The other way, if this looks wrong: a rule that keeps the player still for about a second after a revive or a round's start (a rule change: the user's call).

## If prompting doesn't work: making or fixing moves yourself

The user's options (decision 142), with Claude's view:

- **a) Blender:** free, the most capable, and the athlete already lives in it (`art/out/athlete/athlete.blend`, all 17 clips). It's hard for a beginner. Fixing a move means learning pose mode, turning bones, keyframes, the timeline and saving; expect a day or two of practice before simple fixes go smoothly. Claude can teach it step by step and watch your Blender through the add-on (it sees your screen there) to check each step. The moves made here aren't in Blender: Claude would first record them into clips, and `art/athlete.py` would then take your clips instead of its own.
- **b) A free online tool:** none found (2026-11-01) that is completely free, keeps our skeleton and is easy for a beginner:
  - Cascadeur, the easiest real animation tool (it poses the body for you), exports only to its own format in its free version, for non-commercial use, so nothing comes out of it for free.
  - Rokoko Video makes motion from a video of you acting the move (30 seconds a month free, exported as FBX). But it's AI-made motion: decision 119 excludes AI generators, so it's the user's call whether motion acted by the user counts. Its licence for your own recordings needs checking.
  - Mesh2Motion's web app (free, open source, CC0, where our clips come from) only applies its library's clips; it can't edit them. It's useful for browsing other clips to choose from.
  - The browser posing toys found are early, unlicensed, and rebuild the skeleton.
- **The user's choice (2026-11-03, decision 143):** c), built before the moves are worked on again.
- **c) A small web tool made here (Claude's recommendation):** a page in the game, like the "Hear every sound" page.
  - **First, a viewer:** pick any move or change from this list, loop it, slow it down, step frame by frame, turn the camera round, and see the time of each moment.
  - **Then an editor** for the moves made here: drag the hands and feet with handles at each key moment while the body follows, change the timing, save. The game then plays exactly what you made.
  - **For the clips:** pick another clip from the CC0 library, or which part of it plays and how fast.
  - It uses the game's own character, code and timings: nothing to export or convert, and nothing to learn but dragging handles.
