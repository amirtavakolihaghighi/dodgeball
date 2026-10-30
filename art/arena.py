"""Builds the game's sports hall (step 5 of docs/LOOK_AND_FEEL.md, decision 136) in Blender: the
round 2 hall the user picked, made light enough for a browser, with its sunlight and bounce light
baked into textures once, so laptops don't light it at all.

Writes into static/arena/:

- hall.glb: the hall (walls, windows, piers, ceiling, beams, banners, scoreboard, bunting, planters)
  and its leaves (the green walls, the plants), two meshes with flat colours, each with one UV map
  for its lightmap;
- floor_sun.jpg: where the sun itself reaches the floor (1 in its stripes, 0 in the shade), for the
  players' and balls' shadows, which only fall where the sun does;
- hall_light.jpg and leaves_light.jpg: those lightmaps (the leaves' is small: hundreds of tiny
  islands would crowd the walls out of one shared map); floor_light.jpg: the floor's (the game
  paints the court on the floor itself, so the court's paint gets the same sunlight);
- sky.jpg: the outside seen through the windows (sky, hills, trees, clouds), as a panorama;
- arena.json: the hall's size, the sun (to light the players to match), the lightmaps' scale and
  the window panes (the game draws the light shafts from them).

The court's paint and lines, its walls, the stands and the crowd are drawn by the game, because
they follow the court's size. A court too big for the hall makes the game scale the hall up.

Run from the repository's root (see CLAUDE.md for the form that works from Bash):

    blender --background --factory-startup --python art/arena.py -- [--quick] [--samples N]

--quick bakes small and noisy, to check the look fast. The .blend and the pictures go to art/out/arena/.
"""
import json
import math
import os
import sys
import time
from math import radians

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import style_samples as r1  # noqa: E402  (round 1's helpers: materials, boxes, terrain)
import style_samples_2 as r2  # noqa: E402  (round 2's hall: materials, window walls, outside, sky)
from style_samples import box, lin, material  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
QUICK = "--quick" in ARGS
SAMPLES = int(ARGS[ARGS.index("--samples") + 1]) if "--samples" in ARGS else (48 if QUICK else 768)
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "static", "arena")
WORK = os.path.join(HERE, "out", "arena")

HL, HW, HH = 32.0, 24.0, 17.0        # the hall inside: half length (x), half width (y), height
FLOOR_PX = (1024, 768) if QUICK else (2048, 1536)       # 3.1 cm a pixel
HALL_PX = 1024 if QUICK else 2048
LEAVES_PX = 256 if QUICK else 512
SKY_PX = (1024, 512) if QUICK else (2048, 1024)
SUN_EL, SUN_AZ = r2.SUN_EL, r2.SUN_AZ  # the same low sun as the style sample: from the left, a little behind
SUN_STRENGTH, SUN_COLOR = 12.0, "#ffd49a"
WIN_PITCH, WIN_WIDE, WIN_Z = 5.2, 3.0, (5.2, HH - 1.6, 10.6)   # the left wall's windows: spacing, width, bottom/top/transom
SKY_STRENGTH = 0.9
LIGHT_SCALE = 0.25                   # lightmaps hold light x this (8-bit), so the sun's stripes fit


def to_sun():
    el, az = radians(SUN_EL), radians(SUN_AZ)
    return Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))


def three(v):
    """Blender (Z up) to the game's axes (Y up): what the glTF export does."""
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


# ---------------------------------------------------------------- the hall

def left_windows():
    n = int((2 * HL - 2) // WIN_PITCH)
    return n, -(n * WIN_PITCH) / 2


def low_blobs(name, coll, centres, radii, mats, seed):
    """Leaves as low round shapes (one subdivision): a browser draws thousands of these cheaply."""
    return r2.blobs(name, coll, centres, radii, mats, seed=seed, sub=1)


def build_hall(coll, M):
    """The round 2 hall without the court, its walls and the stands (the game draws those).
    Returns the window panes the sun shines through: (x0, x1, z0, z1) on the wall at y = HW."""
    L, W, H = HL, HW, HH
    z0, z1, zt = WIN_Z
    # the left wall: a teal band, tall windows between piers, a cream band at the top
    box("wall_left_low", coll, (2 * L, 0.5, z0), (0, W + 0.25, z0 / 2), M["wall_low"])
    box("wall_left_top", coll, (2 * L, 0.5, 1.6), (0, W + 0.25, H - 0.8), M["wall"])
    n, x0 = left_windows()
    mid = (z0 + (H - 1.6)) / 2
    tall = (H - 1.6) - z0
    for xa, xb in ((-L, x0), (x0 + n * WIN_PITCH, L)):
        box("pier", coll, (xb - xa, 0.5, tall), ((xa + xb) / 2, W + 0.25, mid), M["wall"])
    panes = []
    for i in range(n):
        xc = x0 + (i + 0.5) * WIN_PITCH
        if i < n - 1:
            box("pier", coll, (WIN_PITCH - WIN_WIDE, 0.5, tall), (xc + WIN_PITCH / 2, W + 0.25, mid), M["wall"])
        r2.window_wall(coll, M, "y", W + 0.25, (xc - WIN_WIDE / 2, xc + WIN_WIDE / 2), z0, z1, WIN_WIDE / 2, zt, "win_left")
        for xa, xb in ((xc - WIN_WIDE / 2 + 0.12, xc - 0.12), (xc + 0.12, xc + WIN_WIDE / 2 - 0.12)):
            for za, zb in ((z0 + 0.24, zt - 0.12), (zt + 0.12, z1 - 0.24)):
                panes.append((xa, xb, za, zb))
    # the right wall: cream, a teal band low down, tall banners in the palette
    box("wall_right", coll, (2 * L, 0.5, H), (0, -W - 0.25, H / 2), M["wall"])
    box("wall_right_band", coll, (2 * L, 0.2, 5.2), (0, -W + 0.05, 2.6), M["wall_low"])
    for i in range(7):
        x = -24 + i * 8
        box("banner", coll, (3.2, 0.12, 6.5), (x, -W + 0.2, 10.5), M["pal"][i % len(r2.PALETTE)])
        box("banner_tip", coll, (3.2, 0.13, 0.5), (x, -W + 0.21, 7.1), M["line"])
    # the near end (behind the red team) and the far end: a big window over a scoreboard and green walls
    box("wall_near", coll, (0.5, 2 * W, H), (-L - 0.25, 0, H / 2), M["wall"])
    box("wall_far_low", coll, (0.5, 2 * W, 6.5), (L + 0.25, 0, 3.25), M["wall"])
    box("wall_far_top", coll, (0.5, 2 * W, 1.6), (L + 0.25, 0, H - 0.8), M["wall"])
    for s in (-1, 1):
        box("wall_far_side", coll, (0.5, 1.6, H - 8.1), (L + 0.25, s * (W - 0.8), 6.5 + (H - 8.1) / 2), M["wall"])
    r2.window_wall(coll, M, "x", L + 0.25, (-W + 1.6, W - 1.6), 6.5, H - 1.6, 3.0, 11.2, "win_far")
    box("score_frame", coll, (0.4, 8.4, 3.2), (L - 0.3, 0, 4.2), M["dark"])
    for y, team in ((1.9, "red"), (-1.9, "blue")):
        box("score_" + team, coll, (0.05, 3.4, 2.2), (L - 0.52, y, 4.25), M["emit_" + team])
    box("score_mid", coll, (0.05, 0.25, 2.2), (L - 0.52, 0, 4.25), M["emit_white"])
    rnd = np.random.default_rng(4)
    cs, rs = [], []
    for ya, yb in ((-W + 2.5, -5.2), (5.2, W - 2.5)):
        for _ in range(170):
            cs.append((L - 0.25 + rnd.uniform(-0.1, 0.1), rnd.uniform(ya, yb), rnd.uniform(0.7, 6.0)))
            rs.append(rnd.uniform(0.32, 0.55))
    low_blobs("green_wall", coll, cs, rs, M["leaf"], seed=5)
    # the ceiling: warm wooden boards on glued-laminated beams
    box("ceiling", coll, (2 * L + 1, 2 * W + 1, 0.4), (0, 0, H + 0.2), M["ceiling"])
    for i in range(13):
        box("beam", coll, (0.5, 2 * W, 1.1), (-L + 2.5 + i * (2 * L - 5) / 12, 0, H - 0.55), M["beam"])
    # planters along the far wall and in the corners: round shrubs and small trees
    rnd = np.random.default_rng(11)
    cs, rs = [], []
    spots = [(L - 2.2, y) for y in np.linspace(-W + 3, W - 3, 9)] + \
            [(sx * (L - 3.0), sy * (W - 3.0)) for sx in (-1, 1) for sy in (-1, 1)]
    for k, (x, y) in enumerate(spots):
        tall = k % 3 == 1 or k >= 9
        box("planter", coll, (1.4, 1.4, 0.8), (x, y, 0.4), M["pot"] if k % 2 else M["terracotta"])
        if tall:
            box("trunk", coll, (0.16, 0.16, 2.6), (x, y, 2.0), M["trunk"])
            for _ in range(18):
                d = rnd.normal(0, 1, 3)
                d = d / np.linalg.norm(d) * rnd.uniform(0.2, 1.0)
                cs.append((x + d[0] * 1.2, y + d[1] * 1.2, 3.6 + d[2] * 1.0))
                rs.append(rnd.uniform(0.45, 0.7))
        else:
            for _ in range(10):
                d = rnd.normal(0, 1, 3)
                d = d / np.linalg.norm(d) * rnd.uniform(0.1, 0.8)
                cs.append((x + d[0] * 0.75, y + d[1] * 0.75, 1.25 + abs(d[2]) * 0.6))
                rs.append(rnd.uniform(0.35, 0.5))
    low_blobs("plants", coll, cs, rs, M["leaf"], seed=12)
    # bunting across the hall, under the beams
    for k, y in enumerate((-9, 0, 9)):
        n_flags = 44
        bm = bmesh.new()
        for i in range(n_flags):
            x = -L + 2 + i * (2 * L - 4) / (n_flags - 1)
            z = H - 2.3 - 1.6 * math.sin(math.pi * i / (n_flags - 1))
            v = [bm.verts.new(q) for q in ((x - 0.38, y, z), (x + 0.38, y, z), (x, y, z - 0.8))]
            f = bm.faces.new(v)
            f.material_index = (i + k) % len(r2.PALETTE)
        r1.new_obj("bunting", bm, coll, M["pal"], smooth=False)
    return panes


def hall_materials():
    M = r2.hall2_materials()
    # the scoreboard glows in the team colours; the game draws these unlit
    M["emit_red"] = material("emit_red", (0, 0, 0, 1), emit=lin(r1.TEAM["red"]), strength=3.0)
    M["emit_blue"] = material("emit_blue", (0, 0, 0, 1), emit=lin(r1.TEAM["blue"]), strength=3.0)
    M["emit_white"] = material("emit_white", (0, 0, 0, 1), emit=lin("#ffffff"), strength=4.0)
    for m in bpy.data.materials:          # flat colours: the game has no textures for these
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.use_nodes else None
        if b and b.inputs["Base Color"].is_linked:
            b.inputs["Base Color"].default_value = m.diffuse_color
            for link in list(b.inputs["Base Color"].links):
                m.node_tree.links.remove(link)
    return M


def floor_object(coll):
    """The floor: one plane over the whole hall, UV 0..1 across it (the game's floor is the same)."""
    me = bpy.data.meshes.new("floor")
    me.from_pydata([(-HL, -HW, 0), (HL, -HW, 0), (HL, HW, 0), (-HL, HW, 0)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="light")
    for loop, (u, v) in zip(me.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[loop.index].uv = (u, v)
    me.update()
    me.materials.append(material("floor_wood", lin("#efb46c"), rough=0.3))   # its warmth bounces onto the walls
    o = bpy.data.objects.new("floor", me)
    coll.objects.link(o)
    return o


def join_hall(coll, name, pick):
    """The hall pieces pick() chooses as one mesh, with a lightmap UV map packed by area."""
    objs = [o for o in coll.objects if o.type == "MESH" and o.name != "floor" and pick(o)]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target="MESH")           # applies modifiers
    bpy.ops.object.join()
    hall = bpy.context.view_layer.objects.active
    hall.name = hall.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = hall.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name="light")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=radians(66), island_margin=0.002, area_weight=1.0, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    return hall


# ---------------------------------------------------------------- light, baking, the panorama

def enable_gpu(sc):
    sc.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
            try:
                prefs.compute_device_type = kind
            except TypeError:
                continue
            prefs.get_devices()
            devices = [d for d in prefs.devices if d.type == kind]
            if devices:
                for d in prefs.devices:
                    d.use = d.type == kind
                sc.cycles.device = "GPU"
                return kind
    except Exception as e:  # noqa: BLE001  (any trouble: bake on the CPU)
        print("no GPU for Cycles:", e)
    sc.cycles.device = "CPU"
    return "CPU"


def lights(coll, sc):
    w = r2.world_sky(sc)
    next(n for n in w.node_tree.nodes if n.type == "BACKGROUND").inputs["Strength"].default_value = SKY_STRENGTH
    sun = r1.add_light(coll, "sun", "SUN", (0, 0, 60), None, SUN_STRENGTH, SUN_COLOR)
    sun.data.angle = radians(1.0)
    sun.rotation_euler = (-to_sun()).to_track_quat("-Z", "Y").to_euler()
    return sun


def image(name, w, h):
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    return img


def bake(obj, img, part):
    """Diffuse light (no colour) reaching obj, into img: part is DIRECT (sun) or INDIRECT (sky and bounce)."""
    for slot in obj.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes.get("bake_target") or nt.nodes.new("ShaderNodeTexImage")
        node.name = "bake_target"
        node.image = img
        nt.nodes.active = node
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    started = time.time()
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={part}, margin=8, margin_type="EXTEND", use_clear=True)
    print(f"  baked {obj.name} {part} {img.size[0]}x{img.size[1]} in {time.time() - started:.0f} s")
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)[..., :3].copy()


def blur(a, sigma):
    """A Gaussian blur, for the noisy indirect light (it varies slowly anyway)."""
    r = max(1, int(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    p = np.pad(a, ((0, 0), (r, r), (0, 0)), mode="edge")
    a = sum(k[i] * p[:, i:i + a.shape[1]] for i in range(2 * r + 1))
    p = np.pad(a, ((r, r), (0, 0), (0, 0)), mode="edge")
    return sum(k[i] * p[i:i + a.shape[0]] for i in range(2 * r + 1))


def save_jpg(a, path, encode=True):
    """Light x LIGHT_SCALE, sRGB-encoded, as an 8-bit JPEG (encode=False: a picture, already display values)."""
    v = np.clip(a * (LIGHT_SCALE if encode else 1.0), 0.0, 1.0)
    if encode:
        v = np.where(v <= 0.0031308, 12.92 * v, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    h, w = v.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"          # written as is
    img.pixels.foreach_set(np.concatenate([v, np.ones((h, w, 1))], axis=2).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "JPEG"
    try:
        img.save(quality=92)
    except TypeError:
        img.save()
    print("  wrote", path, os.path.getsize(path) // 1024, "KB")


def panorama(sc, hall_coll, path):
    """The outside from the middle of the hall, all the way round: the game's background."""
    for lc in sc.view_layers[0].layer_collection.children:
        lc.exclude = lc.collection == hall_coll
    cam = bpy.data.objects.new("pano", bpy.data.cameras.new("pano"))
    sc.collection.objects.link(cam)
    cam.data.type = "PANO"
    try:
        cam.data.panorama_type = "EQUIRECTANGULAR"
    except (AttributeError, TypeError):
        cam.data.cycles.panorama_type = "EQUIRECTANGULAR"
    cam.location = (0, 0, 3.0)
    cam.rotation_euler = (radians(90), 0, radians(-90))    # looking along +X, Z up: the game's +x in the middle
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = SKY_PX
    sc.render.resolution_percentage = 100
    sc.cycles.samples = 32 if QUICK else 128
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 90
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for lc in sc.view_layers[0].layer_collection.children:
        lc.exclude = False
    print("  wrote", path, os.path.getsize(path) // 1024, "KB")


# ---------------------------------------------------------------- the whole thing

def main():
    started = time.time()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    device = enable_gpu(sc)
    print("Cycles on", device, "with", SAMPLES, "samples")
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 4
    hall_coll = bpy.data.collections.new("Hall")
    out_coll = bpy.data.collections.new("Outside")
    sc.collection.children.link(hall_coll)
    sc.collection.children.link(out_coll)
    M = hall_materials()
    panes = build_hall(hall_coll, M)
    floor = floor_object(hall_coll)
    r2.outside(out_coll)
    lights(sc.collection, sc)
    leafy = ("green_wall", "plants")
    leaves = join_hall(hall_coll, "leaves", lambda o: o.name.startswith(leafy))
    hall = join_hall(hall_coll, "hall", lambda o: not o.name.startswith(leafy) and o.name != "leaves")
    for o in (hall, leaves):
        print(f"{o.name}: {len(o.data.polygons)} faces, {len(o.material_slots)} materials")

    sun_light = bake(floor, image("floor_direct", *FLOOR_PX), "DIRECT")
    fl = blur(bake(floor, image("floor_indirect", *FLOOR_PX), "INDIRECT"), 3.0) + sun_light
    save_jpg(fl, os.path.join(OUT, "floor_light.jpg"))
    sun = sun_light.mean(axis=2)
    sun = np.clip(sun / max(1e-6, float(np.percentile(sun, 99.5))), 0.0, 1.0)[::2, ::2]   # half size: shadows are soft
    save_jpg(np.repeat(sun[..., None], 3, axis=2), os.path.join(OUT, "floor_sun.jpg"), encode=False)
    hl = blur(bake(hall, image("hall_indirect", HALL_PX, HALL_PX), "INDIRECT"), 1.2)
    hl += bake(hall, image("hall_direct", HALL_PX, HALL_PX), "DIRECT")
    save_jpg(hl, os.path.join(OUT, "hall_light.jpg"))
    ll = blur(bake(leaves, image("leaves_indirect", LEAVES_PX, LEAVES_PX), "INDIRECT"), 1.0)
    ll += bake(leaves, image("leaves_direct", LEAVES_PX, LEAVES_PX), "DIRECT")
    save_jpg(ll, os.path.join(OUT, "leaves_light.jpg"))
    panorama(sc, hall_coll, os.path.join(OUT, "sky.jpg"))

    for m in bpy.data.materials:            # the bake targets mustn't travel into the glTF
        if m.use_nodes and "bake_target" in m.node_tree.nodes:
            m.node_tree.nodes.remove(m.node_tree.nodes["bake_target"])
    bpy.ops.object.select_all(action="DESELECT")
    hall.select_set(True)
    leaves.select_set(True)
    bpy.context.view_layer.objects.active = hall
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "hall.glb"), export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT")
    print("  wrote hall.glb", os.path.getsize(os.path.join(OUT, "hall.glb")) // 1024, "KB")

    sun = to_sun()
    info = {
        "hall": {"half": [HL, HW], "height": HH},
        "floor": {"size": [2 * HL, 2 * HW], "light": "floor_light.jpg", "sun": "floor_sun.jpg"},
        "walls": {"model": "hall.glb", "light": {"hall": "hall_light.jpg", "leaves": "leaves_light.jpg"}},
        "lightScale": LIGHT_SCALE,
        "sky": "sky.jpg",
        "sun": {"toward": three(sun), "color": SUN_COLOR, "strength": SUN_STRENGTH},
        # the window panes the sun shines through, as quads on the wall, in the game's axes
        "panes": [[three((xa, HW, za)), three((xb, HW, za)), three((xb, HW, zb)), three((xa, HW, zb))]
                  for xa, xb, za, zb in panes],
        "quick": QUICK,
    }
    with open(os.path.join(OUT, "arena.json"), "w", newline="\n") as f:
        json.dump(info, f, indent=1)
        f.write("\n")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "arena.blend"))
    print(f"done in {time.time() - started:.0f} s")


if __name__ == "__main__":
    main()
