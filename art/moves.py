"""The athlete's moves (step 8 of docs/LOOK_AND_FEEL.md): CC0 animation clips retargeted onto the
athlete's skeleton, for art/athlete.py to export with the athlete.

The clips are Mesh2Motion's human library (github.com/Mesh2Motion/mesh2motion-app, its art CC0;
much of it Quaternius's Universal Animation Library, also CC0). They're downloaded once into
art/out/anim-sources/mesh2motion/ and imported into Blender there (data only: no code from them
runs).

Retargeting: each of our bones follows one bone of theirs. Its turn away from its rest pose, in
the world, is applied to ours, after our rest is turned to point the way theirs does (their arms
are out in a T, ours hang a little out). The hips also follow their pelvis's movement, scaled by
the two skeletons' hip heights. Clips that travel (the "_RM" ones) are kept in place: the game
moves the player itself.

For the running cycles, the stride (metres per cycle) and when the left foot lands are measured,
so the game can match the legs to the player's speed and blend the cycles in step.
"""
import math
import os
import time
import urllib.request

import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, "out", "anim-sources", "mesh2motion")
URL = "https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-app/main/static/animations/{}.glb"
FILES = ["human-base-animations", "human-addon-animations", "human-mocap-animations"]
FPS = 30

# our bone: (their bone, the joint theirs points to, ours points to: a bone's head, or None for its own tail)
BONES = {
    "hips": ("pelvis", "spine_01", "chest"),
    "chest": ("spine_03", "neck_01", "head"),
    "head": ("head", "head_leaf", None),
}
for _s, _t in (("L", "l"), ("R", "r")):
    BONES.update({
        f"upper_{_s}": (f"upperarm_{_t}", f"lowerarm_{_t}", f"fore_{_s}"),
        f"fore_{_s}": (f"lowerarm_{_t}", f"hand_{_t}", f"hand_{_s}"),
        f"hand_{_s}": (f"hand_{_t}", f"middle_01_{_t}", None),
        f"thigh_{_s}": (f"thigh_{_t}", f"calf_{_t}", f"shin_{_s}"),
        f"shin_{_s}": (f"calf_{_t}", f"foot_{_t}", f"foot_{_s}"),
        f"foot_{_s}": (f"foot_{_t}", f"ball_{_t}", None),
    })
ORDER = ["hips", "chest", "head", "upper_L", "fore_L", "hand_L", "upper_R", "fore_R", "hand_R",
         "thigh_L", "shin_L", "foot_L", "thigh_R", "shin_R", "foot_R"]

# The game's clips: their source, and options. in_place: drop the travel of a root-motion clip.
# measure: a running cycle (stride and footfall measured).
CLIPS = {
    "idle": ("Idle_A", {}),
    "guard": ("Fighting Idle", {}),                 # the boxer's stance: ready to move
    "jog": ("Jog", {"measure": True}),
    "sprint": ("Sprint", {"measure": True}),
    "throw": ("Throw Object", {"throw": True}),     # the overhead throw: wound up to the cocked arm, released from there
    "flip": ("Backflip", {"air": True}),            # the corkscrew's and the backflip's body
    "air": ("NinjaJump_Idle", {}),                  # spread in the air: the side flip's and butterfly's body
    "flinch_chest": ("Hit_Chest", {}),
    "flinch_head": ("Hit_Head", {}),
    "ko_back": ("Death_D", {}),                     # knees give, falls back
    "ko_fly": ("Death_B", {}),                      # thrown back
    "ko_tumble": ("Death_C", {}),                   # thrown over backwards: the fastest balls
    "getup": ("LayToIdle", {}),
    "win_jump": ("Victory", {}),
    "win_pump": ("Victory Fist Pump", {}),
    "cheer": ("Cheering_Two_Hands", {}),
    "beaten": ("Kneeling Tired", {}),
}


def fetch():
    """Downloads the CC0 animation files once (into their own folder; only Blender's glTF importer
    reads them)."""
    os.makedirs(SOURCES, exist_ok=True)
    for name in FILES:
        path = os.path.join(SOURCES, name + ".glb")
        if not os.path.exists(path):
            print("  downloading", name)
            urllib.request.urlretrieve(URL.format(name), path)


def load_sources():
    """Their skeleton, with every clip as an action; their meshes are thrown away."""
    sc = bpy.context.scene
    sc.render.fps = FPS
    coll = bpy.data.collections.new("moves sources")
    sc.collection.children.link(coll)
    layer = bpy.context.view_layer.layer_collection.children[coll.name]
    keep = bpy.context.view_layer.active_layer_collection
    bpy.context.view_layer.active_layer_collection = layer
    for name in FILES:
        bpy.ops.import_scene.gltf(filepath=os.path.join(SOURCES, name + ".glb"))
    bpy.context.view_layer.active_layer_collection = keep
    rigs = [o for o in coll.all_objects if o.type == "ARMATURE"]
    rig = rigs[0]
    for o in list(coll.all_objects):
        if o is not rig and o.type != "EMPTY":
            bpy.data.objects.remove(o)
    actions = {a.name: a for a in bpy.data.actions}
    return rig, actions, coll


def world_rot(m):
    return m.to_3x3().normalized().to_quaternion()


def setup(src, dst):
    """For each of our bones: their rest turn, ours turned to point like theirs, and the rest
    relations Blender's pose needs. Everything in each skeleton's own space: some clips move the
    armature object itself, and that must not leak into the next clip (both skeletons face -Y,
    feet at 0)."""
    info = {}
    for ours, (theirs, their_aim, our_aim) in BONES.items():
        sb, db = src.data.bones[theirs], dst.data.bones[ours]
        s_rest = world_rot(sb.matrix_local)
        d_rest = world_rot(db.matrix_local)
        s_dir = (src.data.bones[their_aim].head_local - sb.head_local).normalized()
        d_end = dst.data.bones[our_aim].head_local if our_aim else db.tail_local
        d_dir = (d_end - db.head_local).normalized()
        align = d_dir.rotation_difference(s_dir)         # our rest pointed their way
        info[ours] = dict(theirs=theirs, s_rest_inv=s_rest.inverted(), d_rest=align @ d_rest,
                          rest=world_rot(db.matrix_local), parent=db.parent.name if db.parent else None)
    s_pelvis = src.data.bones["pelvis"].head_local
    d_hips = dst.data.bones["hips"].head_local
    return info, s_pelvis, d_hips, d_hips.z / s_pelvis.z


def new_action(rig, name):
    a = bpy.data.actions.new(name)
    slot = a.slots.new(id_type="OBJECT", name=rig.name)
    bag = a.layers.new("moves").strips.new(type="KEYFRAME").channelbag(slot, ensure=True)
    return a, slot, bag


def write_curves(bag, data_path, frames, values):
    """One fcurve per component, every frame keyed (linear)."""
    n = len(frames)
    for i in range(len(values[0])):
        fc = bag.fcurves.new(data_path=data_path, index=i)
        fc.keyframe_points.add(n)
        co = [0.0] * (2 * n)
        co[0::2] = frames
        co[1::2] = [v[i] for v in values]
        fc.keyframe_points.foreach_set("co", co)
        fc.keyframe_points.foreach_set("interpolation", [2] * n)    # LINEAR
        fc.update()


def bake(src, actions, dst, name, source, opts, setup_info):
    """One clip onto our skeleton: their bones' world turns away from rest, ours from (aligned)
    rest; the hips follow their pelvis. Returns the action and its measurements."""
    info, s_pelvis, d_hips, scale = setup_info
    sc = bpy.context.scene
    act_src = actions[source]
    src.animation_data.action = act_src
    if act_src.slots:
        src.animation_data.action_slot = act_src.slots[0]
    f0, f1 = (int(round(v)) for v in act_src.frame_range)
    frames = list(range(f0, f1 + 1))
    rots = {b: [] for b in ORDER}
    hips = []
    feet = {"L": [], "R": []}
    hand = []
    travel = []
    prev = {}
    for f in frames:
        sc.frame_set(f)
        world = {}
        for ours in ORDER:
            i = info[ours]
            delta = world_rot(src.pose.bones[i["theirs"]].matrix) @ i["s_rest_inv"]
            world[ours] = delta @ i["d_rest"]
        for ours in ORDER:                              # Blender's pose: local turns from the rest relations
            i = info[ours]
            if i["parent"]:
                q = i["rest"].inverted() @ info[i["parent"]]["rest"] @ world[i["parent"]].inverted() @ world[ours]
            else:
                q = i["rest"].inverted() @ world[ours]
            q.normalize()
            if ours in prev and prev[ours].dot(q) < 0:
                q.negate()
            prev[ours] = q
            rots[ours].append(q)
        p = src.pose.bones["pelvis"].head - s_pelvis
        travel.append(p.xy.length)
        if opts.get("in_place"):
            p.x = p.y = 0.0
        hips.append(info["hips"]["rest"].inverted() @ (p * scale))
        for s, t in (("L", "l"), ("R", "r")):
            feet[s].append(src.pose.bones[f"foot_{t}"].head * scale)
        hand.append(src.pose.bones["hand_r"].head * scale)
    a, slot, bag = new_action(dst, name)
    keys = [float(f - f0) for f in frames]               # every clip starts at 0
    for ours in ORDER:
        write_curves(bag, f'pose.bones["{ours}"].rotation_quaternion', keys, [tuple(q) for q in rots[ours]])
    write_curves(bag, 'pose.bones["hips"].location', keys, [tuple(v) for v in hips])
    meta = {"duration": round((f1 - f0) / FPS, 4)}
    if opts.get("measure"):
        meta.update(measure(feet, FPS))
    if opts.get("air"):
        meta.update(airborne(feet, FPS))
    if opts.get("in_place"):                            # a dash: when its travel is 10% and 90% done
        total = max(travel) or 1.0
        meta["takeoff"] = round(next(k for k, d in enumerate(travel) if d >= 0.1 * total) / FPS, 4)
        meta["touchdown"] = round(next(k for k, d in enumerate(travel) if d >= 0.9 * total) / FPS, 4)
    if opts.get("throw"):
        meta.update(throw_marks(hand, FPS))
    return a, slot, meta


def airborne(feet, fps):
    """When both feet leave the ground and when the first comes back (seconds)."""
    low = min(min(p.z for p in feet[s]) for s in feet)
    up = [min(feet["L"][k].z, feet["R"][k].z) > low + 0.12 for k in range(len(feet["L"]))]
    k0 = next((k for k, u in enumerate(up) if u), 0)
    k1 = next((k for k in range(k0, len(up)) if not up[k]), len(up) - 1)
    return {"takeoff": round(k0 / fps, 4), "touchdown": round(k1 / fps, 4)}


def throw_marks(hand, fps):
    """The throw's cocked arm (the right hand furthest back and up, in the first part) and the end
    of its release (the hand furthest forward after it). Forwards is -Y."""
    n = len(hand)
    cock = max(range(int(n * 0.6)), key=lambda k: hand[k].y + 0.5 * hand[k].z)
    release = min(range(cock, n), key=lambda k: hand[k].y)
    return {"cock": round(cock / fps, 4), "release": round(release / fps, 4)}


def measure(feet, fps):
    """A running cycle's stride (metres per cycle) and where in the cycle the left foot lands (0..1).
    A planted foot slides back as fast as the runner goes: each foot's travel over its whole time on
    the ground (some clips hold a foot still for a few frames, then catch up)."""
    n = len(feet["L"]) - 1                              # the last frame repeats the first
    travel = frames = 0
    land = 0
    for s in ("L", "R"):
        P = feet[s][:n]
        low = min(p.z for p in P)
        down = [p.z < low + 0.06 for p in P]
        start = next((k for k in range(n) if down[k] and not down[k - 1]), None)
        if start is None:
            continue
        end = start
        while down[(end + 1) % n] and (end + 1) % n != start:
            end += 1
        travel += abs(P[end % n].y - P[start].y)
        frames += end - start
        if s == "L":
            land = start
    speed = travel / frames * fps if frames else 4.0
    return {"stride": round(speed * n / fps, 3), "speed": round(speed, 3), "footfall": round(land / n, 4)}


def bake_all(dst):
    """Every clip of CLIPS onto our skeleton (dst, at rest), stacked on its NLA tracks for the
    exporter. Returns the clips' measurements."""
    t0 = time.time()
    fetch()
    src, actions, coll = load_sources()
    src.animation_data_create()
    dst.animation_data_create()
    for pb in dst.pose.bones:
        pb.rotation_mode = "QUATERNION"
    info = setup(src, dst)
    moves = {}
    for name, (source, opts) in CLIPS.items():
        a, slot, meta = bake(src, actions, dst, name, source, opts, info)
        track = dst.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, a)
        strip.action_slot = slot
        track.mute = True                               # stacked, not mixed: each is its own clip
        moves[name] = meta
        print(f"  move {name} <- {source}: {meta}")
    for o in list(coll.all_objects):
        bpy.data.objects.remove(o)
    bpy.data.collections.remove(coll)
    for a in list(bpy.data.actions):                    # their clips go; ours stay
        if a.name not in CLIPS:
            bpy.data.actions.remove(a)
    print(f"  moves baked in {time.time() - t0:.0f} s")
    return moves


def play(rig, name, frame):
    """Shows one of our clips at a frame (for the check pictures)."""
    a = bpy.data.actions[name]
    rig.animation_data.action = a
    rig.animation_data.action_slot = a.slots[0]
    bpy.context.scene.frame_set(int(frame))


def rest(rig):
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
