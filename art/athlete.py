"""Builds the game's athlete (step 7 of docs/LOOK_AND_FEEL.md) in Blender: round 2's athlete
(art/style_samples_2.py), made light enough for a browser and given a skeleton that the game's
animation moves.

Writes into static/characters/:

- athlete.glb: one skeleton with bones named after the game's joints (hips, chest, head,
  upper/fore/hand_L/R, thigh/shin/foot_L/R) and, skinned to it, three meshes in two sizes:
  body_hi / body_lo (the body in its kit, hands and shoes), helmet_hi / helmet_lo and
  face_hi / face_lo (the two heads; the game shows one, picked for each player, decision 128).
  The _lo ones are for Low graphics, about a third of the triangles.
- athlete_<mesh>.png: for each mesh, which colour goes where: each pixel holds a colour slot
  (slot x 16 + 8), not a colour, so the game paints each player's own copy in their team's kit and
  their skin and hair. Borders are as sharp as the pixels, not the triangles, and the details that
  are only paint (eyes, lashes, lips, the kit's trims and stripes) cost no triangles.
- athlete.json: the slots (their names, roughness and metalness) and the maps.

Round 2's athlete is many layers (a body, a shirt over it, trims over the shirt). Here the body and
the kit are one surface: nothing is hidden under the clothes, and nothing pokes through them when
the body bends. Hands, shoes, the heads and the eyes are pieces that follow one bone each.

The skin weights come from round 2's body parts: each point follows the part whose surface it lies
on (the torso, an upper arm, a forearm, a thigh, a shin), blending where two meet, so the shirt and
the skin under a hem bend alike.

The athlete stands with arms a little out and faces +Z in the file (Blender -Y), left +X: the way the
game's figure faces. Run from the repository's root (see CLAUDE.md for the form that works from Bash):

    blender --background --factory-startup --python art/athlete.py -- [--quick]

--quick meshes coarser. A .blend (with the maps painted in the red team's colours) and check
pictures (rest, a throw's wind-up, a run, close-ups, Low) go to art/out/athlete/.
"""
import json
import math
import os
import struct
import sys
import time
import zlib
from math import radians

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import arena  # noqa: E402  (the graphics card for Cycles)
import style_samples_2 as r2  # noqa: E402  (round 2's athlete: shapes, skeleton, kit)
from style_samples import lin  # noqa: E402

F = np.float32
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
QUICK = "--quick" in ARGS
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "static", "characters")
WORK = os.path.join(HERE, "out", "athlete")
TAU = 0.013             # how far (m) the skin weights blend where two body parts meet
BALL_R = 0.15           # the game's held ball at the default size (world.js heldGeo)
ROT = Matrix.Rotation(radians(-90), 4, "Z")    # round 2 faces +X; the game's figure faces Blender -Y (glTF +Z)

# The rest pose: upright, arms a little out from the body (so arm and side are apart), relaxed
# hands, feet under the hips.
REST = dict(
    root=(0, 0, 0), pelvis=(0, 0, 0), chest=(0, 0, 0), head=(0, 0, 0),
    L=dict(hand=(0.0, 0.33, 0.9), elbow=(-1, 0.25, 0), point=(0.0, 0.08, -1), palm=(0, -1, 0), grip="relax"),
    R=dict(hand=(0.0, -0.33, 0.9), elbow=(-1, -0.25, 0), point=(0.0, -0.08, -1), palm=(0, 1, 0), grip="relax"),
    Lfoot=dict(at=(0.0, 0.11), yaw=6), Rfoot=dict(at=(0.0, -0.11), yaw=-6),
)

# The colour slots: name, colour on the red team with the first look (the game paints each
# player's own), roughness, metalness.
SLOTS = [
    ("skin", "#e3ab82", 0.5, 0), ("lips", "#c47a68", 0.45, 0), ("hair", "#3a2418", 0.6, 0),
    ("eye_white", "#f4f1ec", 0.25, 0), ("iris", "#7a5230", 0.25, 0), ("pupil", "#141012", 0.2, 0),
    ("cloth", "#e0213a", 0.65, 0), ("bright", "#ff4d5e", 0.45, 0), ("helmet", "#ff4d5e", 0.22, 0),
    ("white", "#f6f7fa", 0.6, 0), ("navy", "#1e2338", 0.65, 0), ("sole", "#e9ebef", 0.6, 0),
    ("laces", "#2b2f3c", 0.7, 0), ("visor", "#0a1020", 0.1, 0.4), ("gloss_white", "#f6f7f9", 0.3, 0),
]
SLOT = {name: i for i, (name, *_rest) in enumerate(SLOTS)}

# Triangles for each piece, High and Low. Pixels across each mesh's map: twice the colour
# texture's, so the game can average each 2 x 2 into one smooth-edged pixel.
BUDGET = dict(hi=dict(body=5200, hand=420, shoe=300, face=1500, helmet=1600),
              lo=dict(body=1750, hand=140, shoe=150, face=500, helmet=540))
EYE_SEGMENTS = dict(hi=(10, 8), lo=(8, 6))
MAP_SIZE = dict(body_hi=1024, body_lo=512, face_hi=512, face_lo=256, helmet_hi=512, helmet_lo=256)


def slots(names, n):
    return np.array([SLOT[x] for x in names], np.int32)[n]


# ---------------------------------------------------------------- the pieces' shapes and paint
# Each piece: its shape (a distance function in its own frame), how it's painted there, and where
# it goes on the athlete (round 2's frame, facing +X).

class Piece:
    def __init__(self, pid, name, f, paint, M, lo=None, hi=None, h=None, bone=None):
        self.pid, self.name, self.f, self.paint, self.M = pid, name, f, paint, M
        self.lo, self.hi, self.h, self.bone = lo, hi, h, bone


def closure(fn, name):
    """A value a round 2 function closed over (the region a kit trim covers)."""
    return fn.__closure__[fn.__code__.co_freevars.index(name)].cell_contents


def body_shape(J, parts):
    """The body in its kit, as one surface: round 2's shirt, shorts, socks and wristbands joined to
    the skin where it shows, and the paint: each point painted by the piece it lies on."""
    jf, jt = r2.jersey_parts(J, parts)
    jtrim = closure(jt, "region")
    hem_z = float(J["pc"][2]) - 0.04                     # where the shirt ends (round 2's hem)

    def shirt(p):                                       # flares a little at the hem, over the shorts
        return jf(p) - F(0.012) * r2.smoothstep(hem_z + 0.15, hem_z + 0.02, p[:, 2])
    sf, sc_, sw = r2.shorts_parts(J, parts)
    scol, swhite = closure(sc_, "region"), closure(sw, "region")

    def shorts(p):                                      # nothing above the shirt's hem: the shirt hangs over them
        return r2.smax(sf(p), p[:, 2] - F(hem_z + 0.03), 0.004)
    socks = {s: r2.sock_parts(J, parts, s) for s in ("L", "R")}
    bands = {s: r2.wristband_sdf(J, parts, s) for s in ("L", "R")}
    pieces = [parts["body"], shirt, shorts, socks["L"][0], socks["R"][0], bands["L"], bands["R"]]

    def f(p):
        d = pieces[0](p)
        for g in pieces[1:]:
            d = np.minimum(d, g(p))
        return d

    def paint(p, n):
        k = np.stack([g(p) for g in pieces], 1).argmin(1)
        out = np.full(len(p), SLOT["skin"], np.int32)
        m = k == 1                                     # the shirt: team cloth, white collar, cuffs and hem
        out[m] = np.where(jtrim(p[m]) < 0, SLOT["white"], SLOT["cloth"])
        m = k == 2                                     # the shorts: navy, team stripes, white hems
        out[m] = np.where(swhite(p[m]) < 0, SLOT["white"], np.where(scol(p[m]) < 0, SLOT["cloth"], SLOT["navy"]))
        for i, side in ((3, "L"), (4, "R")):           # socks: white with two team stripes
            m = k == i
            out[m] = np.where(socks[side][1](p[m], n[m]) == 1, SLOT["bright"], SLOT["white"])
        out[(k == 5) | (k == 6)] = SLOT["bright"]      # wristbands
        return out
    return f, paint


def face_paint(p, n):
    """The face version's head: skin, lips, brows, a dark line of lashes, and the hair."""
    out = np.full(len(p), SLOT["skin"], np.int32)
    out[r2.head_colors(p)[:, 1] > 0.45] = SLOT["lips"]
    for s in (1, -1):                                  # the lash line along each upper lid, thicker outside
        q = p - r2.v3((r2.EYE[0], s * r2.EYE[1], r2.EYE[2]))
        edge = (q[:, 2] - F(r2.LID[0]) + F(0.55) * (q[:, 0] - F(r2.EYE_R))) / F(math.hypot(1, 0.55))
        outer = np.clip(s * q[:, 1] / F(r2.EYE_R), -1, 1)
        lash = (np.abs(edge - F(0.0012)) < F(0.0011) + F(0.0006) * (outer + 1)) & (r2.norm(q) < F(r2.EYE_R + 0.005)) & (q[:, 0] > 0.002)
        out[lash] = SLOT["pupil"]
    out[r2.brows_sdf(p) < 0.0004] = SLOT["hair"]
    out[r2.hair_sdf(p) <= r2.head_sdf(p) + F(1e-4)] = SLOT["hair"]
    return out


def face_shape(p):
    return np.minimum(r2.head_sdf(p), r2.hair_sdf(p))


HELMET_PARTS = [r2.head_sdf, r2.helmet_sdf, r2.visor_sdf, r2.trim_sdf]


def helmet_shape(p):
    d = HELMET_PARTS[0](p)
    for g in HELMET_PARTS[1:]:
        d = np.minimum(d, g(p))
    return d


def helmet_paint(p, n):
    """The helmet version's head: a glossy team shell with a white stripe over the top, the dark
    visor in its white frame, white ear pods, and the face below the visor."""
    k = np.stack([g(p) for g in HELMET_PARTS], 1).argmin(1)
    out = np.full(len(p), SLOT["skin"], np.int32)
    out[(k == 0) & (r2.head_colors(p)[:, 1] > 0.45)] = SLOT["lips"]
    stripe = (np.abs(p[:, 1]) < 0.017) & (p[:, 2] > 0.03) & (r2.visor_region(p) > 0.008)
    out[k == 1] = np.where(stripe[k == 1], SLOT["gloss_white"], SLOT["helmet"])
    out[k == 2] = SLOT["visor"]
    out[k == 3] = SLOT["gloss_white"]
    return out


def eye_shape(p):
    return r2.norm(p) - F(1)


def eye_paint(p, n):
    """A unit eyeball looking along +X: pupil, iris, a dark ring, the white."""
    r = np.where(p[:, 0] > 0, np.hypot(p[:, 1], p[:, 2]), 2)
    return np.select([r < 0.24, r < 0.55, r < 0.61], [SLOT["pupil"], SLOT["iris"], SLOT["pupil"]], SLOT["eye_white"]).astype(np.int32)


def skin_paint(p, n):
    return np.full(len(p), SLOT["skin"], np.int32)


def shoe_paint(p, n):
    return slots(["white", "sole", "bright", "laces"], r2.shoe_regions(p, n))


def pieces_for(J, parts):
    H = Matrix.Translation(J["head"]) @ J["Rh"].to_4x4() @ Matrix.Scale(r2.HEAD_SCALE, 4)
    bf, bpaint = body_shape(J, parts)
    lo, hi = r2.skeleton_box(J)
    P = [Piece(0, "body", bf, bpaint, Matrix.Identity(4), lo, hi, 0.0068)]
    for k, side in enumerate(("L", "R")):
        S = J[side]
        hf, hlo, hhi = r2.hand_sdf(S["grip"])
        P.append(Piece(1 + k, "hand_" + side, hf, skin_paint, Matrix.Translation(S["wr"]) @ S["Rhand"].to_4x4(),
                       hlo, hhi, 0.0024, "hand_" + side))
        Mf = Matrix.Translation(S["an"]) @ S["Rfoot"].to_4x4()
        P.append(Piece(3 + k, "shoe_" + side, r2.shoe_sdf, shoe_paint, Mf @ r2.MIRROR_Y if side == "L" else Mf,
                       (-0.11, -0.07, -0.09), (0.23, 0.07, 0.03), 0.0034, "foot_" + side))
    P.append(Piece(5, "face", face_shape, face_paint, H, (-0.15, -0.12, -0.17), (0.15, 0.12, 0.25), 0.0026, "head"))
    for k, s in ((0, 1), (1, -1)):
        gaze = Matrix.Rotation(-s * math.atan2(r2.EYE[1], 1.4), 4, "Z")
        R = r2.EYE_R
        Me = H @ Matrix.Translation((r2.EYE[0], s * r2.EYE[1], r2.EYE[2])) @ gaze @ Matrix.Diagonal((R, R, R, 1))
        P.append(Piece(6 + k, "eye_" + "LR"[k], eye_shape, eye_paint, Me, bone="head"))
    P.append(Piece(8, "helmet", helmet_shape, helmet_paint, H, (-0.16, -0.14, -0.17), (0.17, 0.14, 0.235), 0.0028, "head"))
    return {p.name: p for p in P}


# ---------------------------------------------------------------- meshing

def surface(coll, name, f, lo, hi, h):
    """The shape f meshed (round 2's surface nets, without custom normals: they don't survive
    the trimming)."""
    t0 = time.time()
    h = h * r2.DETAIL
    lo = [lo[i] - 2 * h for i in range(3)]
    hi = [hi[i] + 2 * h for i in range(3)]
    D = r2.sample(f, lo, hi, h)
    verts, quads = r2.surface_nets(D, lo, h)
    del D
    for _ in range(2):                          # onto the true surface
        g = r2.gradient(f, verts)
        gl = np.maximum(r2.norm(g), F(1e-6))
        step = np.clip(f(verts) / gl, -h, h)
        verts = verts - g / gl[:, None] * step[:, None]
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    me.loops.add(quads.size)
    me.loops.foreach_set("vertex_index", quads.ravel().astype(np.int32))
    me.polygons.add(len(quads))
    me.polygons.foreach_set("loop_start", np.arange(0, quads.size, 4, dtype=np.int32))
    me.update()
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    print(f"  mesh {name}: {len(verts)} verts, {len(quads)} quads, {time.time() - t0:.1f}s")
    return o


def sphere(coll, name, u, v):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    bm.transform(Matrix.Rotation(radians(90), 4, "Y"))          # its pole (the iris) forwards, +X
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return o


def trimmed(o, triangles, name, symmetric=False):
    """A copy of o cut down to about this many triangles (collapse decimation), smooth-shaded."""
    c = o.copy()
    c.data = o.data.copy()
    o.users_collection[0].objects.link(c)
    tris = sum(len(p.vertices) - 2 for p in c.data.polygons)
    if tris > triangles:
        m = c.modifiers.new("trim", "DECIMATE")
        m.ratio = triangles / tris
        m.use_collapse_triangulate = True
        if symmetric:
            m.use_symmetry = True
            m.symmetry_axis = "Y"
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(c.evaluated_get(dg))
        c.modifiers.remove(m)
        old = c.data
        c.data = me
        bpy.data.meshes.remove(old)
    bm = bmesh.new()                                  # slivers the trimming leaves (and the exporter warns of)
    bm.from_mesh(c.data)
    bmesh.ops.dissolve_degenerate(bm, dist=0.0004, edges=bm.edges)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(c.data)
    bm.free()
    c.data.validate()
    c.name = c.data.name = name
    c.data.shade_smooth()
    return c


def place(o, M):
    """Moves o's mesh by M; a mirroring M turns its faces back the right way round."""
    o.data.transform(M)
    if M.to_3x3().determinant() < 0:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(o.data)
        bm.free()
    o.data.update()


def verts_of(o):
    v = np.zeros(len(o.data.vertices) * 3, F)
    o.data.vertices.foreach_get("co", v)
    return v.reshape(-1, 3)


def tag(o, pid):
    o.data.attributes.new("piece", "INT", "POINT").data.foreach_set("value", np.full(len(o.data.vertices), pid, np.int32))


def rigid(o, bone):
    """Every vertex of o follows this bone, fully."""
    o.vertex_groups.new(name=bone).add(range(len(o.data.vertices)), 1.0, "REPLACE")


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def true_normals(o, pieces):
    """Shades the trimmed mesh with its true surface's normals (each piece's distance function's
    gradient, at each vertex): the light mesh shades like the smooth sculpt, not in facets. Not
    where the trimming left a vertex off the true surface (bridging the gap between fingers, say):
    there the gradient can face sideways, and the mesh's own normal stays."""
    me = o.data
    v = verts_of(o)
    pid = np.zeros(len(me.vertices), np.int32)
    me.attributes["piece"].data.foreach_get("value", pid)
    normals = np.zeros_like(v)
    me.vertex_normals.foreach_get("vector", normals.ravel())
    off = 0
    for piece in pieces.values():
        m = pid == piece.pid
        if not m.any():
            continue
        T = ROT @ piece.M                              # rotations, mirrors and even scales: normals turn like directions
        inv = np.array(T.inverted())
        p = (v[m] @ inv[:3, :3].T + inv[:3, 3]).astype(F)
        g = r2.gradient(piece.f, p)
        n = g @ np.array(T.to_3x3()).T.astype(F)
        n /= np.maximum(r2.norm(n), F(1e-6))[:, None]
        near = np.abs(piece.f(p)) * np.abs(np.linalg.det(np.array(T.to_3x3()))) ** (1 / 3) < 0.004
        idx = np.nonzero(m)[0]
        normals[idx[near]] = n[near]
        off += int((~near).sum())
    me.normals_split_custom_set_from_vertices(normals)
    print(f"  normals {o.name}: {len(v) - off} from the true surface, {off} the mesh's own")


def body_weights(o, J, parts):
    """Skin weights for the body: each vertex follows the body part whose surface is nearest
    (softly, over TAU), the torso split into hips and chest around the waist."""
    v = verts_of(o)
    names = ["torso", "upper_L", "fore_L", "upper_R", "fore_R", "thigh_L", "shin_L", "thigh_R", "shin_R"]
    D = np.stack([parts["torso"](v),
                  parts["upper_arm"](v, "L"), parts["forearm"](v, "L"), parts["upper_arm"](v, "R"), parts["forearm"](v, "R"),
                  parts["thigh"](v, "L"), parts["shin"](v, "L"), parts["thigh"](v, "R"), parts["shin"](v, "R")], 1)
    W = np.exp(-(D - D.min(1, keepdims=True)) / F(TAU))
    up = r2.smoothstep(J["waist"][2] - 0.05, J["waist"][2] + 0.1, v[:, 2])
    W = np.concatenate([W[:, :1] * (1 - up)[:, None], W[:, :1] * up[:, None], W[:, 1:]], 1)
    names = ["hips", "chest"] + names[1:]
    top = np.argsort(-W, 1)[:, :3]                             # glTF takes four; three is plenty
    keep = np.zeros_like(W)
    rows = np.arange(len(W))[:, None]
    keep[rows, top] = W[rows, top]
    keep[keep < 0.02] = 0
    keep /= keep.sum(1, keepdims=True)
    groups = [o.vertex_groups.new(name=n) for n in names]
    for i, j in zip(*np.nonzero(keep)):
        groups[j].add([int(i)], float(keep[i, j]), "REPLACE")


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = name
    return o


def unwrap(o):
    """Texture coordinates: smart projection's islands, each flattened again with the least
    stretch (projection alone squashes the steps at hems and collars edge-on, and a squashed face
    shows one pixel's colour), at the same scale everywhere, packed with room to bleed."""
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    o.data.uv_layers.new(name="uv")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=radians(80), island_margin=0.004, area_weight=1.0, scale_to_bounds=False)
    bpy.ops.uv.seams_from_islands(mark_seams=True)
    bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", margin=0.004)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=0.006, rotate=True, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


# ---------------------------------------------------------------- the colour-slot maps

def slot_map(o, pieces, size):
    """Which slot each pixel of o's map shows: every triangle drawn into the map, each pixel's
    point on the athlete taken back into its piece's frame, onto the piece's true surface, and
    painted there. Pixels outside the islands take their nearest neighbour's slot."""
    me = o.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    tl = np.zeros(nt * 3, np.int32)
    tv = np.zeros(nt * 3, np.int32)
    me.loop_triangles.foreach_get("loops", tl)
    me.loop_triangles.foreach_get("vertices", tv)
    tl, tv = tl.reshape(-1, 3), tv.reshape(-1, 3)
    uv = np.zeros(len(me.loops) * 2, F)
    me.uv_layers["uv"].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2) * F(size)
    uv[:, 1] = F(size) - uv[:, 1]                      # image rows run top-down (glTF's texture coordinates)
    co = verts_of(o).astype(np.float64)
    pid = np.zeros(len(me.vertices), np.int32)
    me.attributes["piece"].data.foreach_get("value", pid)
    xs, ys, pts, owner = [], [], [], []
    empty = 0
    for t in range(nt):
        a, b, c = uv[tl[t]].astype(np.float64)
        x0, y0 = np.floor(np.minimum(np.minimum(a, b), c)).astype(int)
        x1, y1 = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int)
        gx, gy = np.meshgrid(np.arange(max(x0, 0), min(x1, size)), np.arange(max(y0, 0), min(y1, size)))
        q = np.stack([gx.ravel() + 0.5, gy.ravel() + 0.5], 1)
        v0, v1, v2 = b - a, c - a, q - a
        d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
        den = d00 * d11 - d01 * d01
        if abs(den) < 1e-12:
            empty += 1
            continue
        d20, d21 = v2 @ v0, v2 @ v1
        w1 = (d11 * d20 - d01 * d21) / den
        w2 = (d00 * d21 - d01 * d20) / den
        w0 = 1 - w1 - w2
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            empty += 1
            continue
        p3 = co[tv[t]]
        pts.append(w0[inside, None] * p3[0] + w1[inside, None] * p3[1] + w2[inside, None] * p3[2])
        xs.append(gx.ravel()[inside])
        ys.append(gy.ravel()[inside])
        owner.append(np.full(inside.sum(), pid[tv[t, 0]]))
    xs, ys, pts, owner = map(np.concatenate, (xs, ys, pts, owner))
    print(f"  map {o.name}: {size} px, {len(xs) / size / size:.0%} covered, {empty} of {nt} triangles too thin to hold a pixel")
    img = np.full((size, size), 255, np.uint8)        # 255: no island here
    by_id = {p.pid: p for p in pieces.values()}
    for k in np.unique(owner):
        piece = by_id[int(k)]
        m = owner == k
        inv = np.array((ROT @ piece.M).inverted())
        # painted where the trimmed surface is (within millimetres of the true one): snapping onto
        # the true surface jumps between close sheets, like the shirt's collar and the neck under it
        p = (pts[m] @ inv[:3, :3].T + inv[:3, 3]).astype(F)
        n = r2.gradient(piece.f, p)
        n /= np.maximum(r2.norm(n), F(1e-6))[:, None]
        img[ys[m], xs[m]] = piece.paint(p, n)
    for _ in range(16):                                # bleed past the islands' edges
        empty = img == 255
        if not empty.any():
            break
        grown = img.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nb = np.roll(np.roll(img, dy, 0), dx, 1)
            fill = empty & (grown == 255) & (nb != 255)
            grown[fill] = nb[fill]
        img = grown
    img[img == 255] = SLOT["skin"]
    return img


def write_png(path, img):
    """An 8-bit grey PNG of the slots (slot x 16 + 8, so a slightly changed value still reads)."""
    h, w = img.shape
    data = (img.astype(np.uint16) * 16 + 8).clip(0, 255).astype(np.uint8)
    raw = b"".join(b"\x00" + data[y].tobytes() for y in range(h))

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
                 + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def preview_material(name, img):
    """The map painted in the red team's colours as the game paints it (each 2 x 2 averaged), for
    the pictures and the .blend."""
    pal = np.array([[int(c[k:k + 2], 16) / 255 for k in (1, 3, 5)] + [1.0] for _, c, *_r in SLOTS], F)
    px = pal[np.minimum(img, len(SLOTS) - 1)]
    px = (px[0::2, 0::2] + px[1::2, 0::2] + px[0::2, 1::2] + px[1::2, 1::2]) / 4
    px = px[::-1]                                      # Blender's rows run bottom-up
    size = px.shape[0]
    im = bpy.data.images.new(name, size, size, alpha=False)
    im.pixels.foreach_set(px.ravel())
    im.pack()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    rough = np.array([s[2] for s in SLOTS], F)
    bsdf.inputs["Roughness"].default_value = float(np.median(rough[np.unique(img)]))
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = im
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "uv"
    nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m


# ---------------------------------------------------------------- the skeleton

def joint(p):
    return ROT @ Vector(p)


def armature(coll, J):
    """Bones at the athlete's joints, named after the game's; each runs from its joint to the next."""
    arm = bpy.data.armatures.new("athlete")
    rig = bpy.data.objects.new("athlete", arm)
    coll.objects.link(rig)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones

    def bone(name, head, tail, parent=None):
        b = eb.new(name)
        b.head, b.tail = joint(head), joint(tail)
        if parent:
            b.parent = eb[parent]

    up = Vector((0, 0, 1))
    bone("hips", J["pc"], J["waist"])
    bone("chest", J["waist"], J["neck"], "hips")
    bone("head", J["neck"], J["head"] + up * 0.12, "chest")
    for side in ("L", "R"):
        S = J[side]
        bone("upper_" + side, S["sh"], S["el"], "chest")
        bone("fore_" + side, S["el"], S["wr"], "upper_" + side)
        bone("hand_" + side, S["wr"], S["wr"] + S["Rhand"] @ Vector((0.09, 0, 0)), "fore_" + side)
        bone("thigh_" + side, S["hip"], S["kn"], "hips")
        bone("shin_" + side, S["kn"], S["an"], "thigh_" + side)
        bone("foot_" + side, S["an"], S["an"] + S["Rfoot"] @ Vector((0.15, 0, -0.04)), "shin_" + side)
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def attach(rig, o):
    o.parent = rig
    o.modifiers.new("armature", "ARMATURE").object = rig


def socket(coll, rig, name, bone, at):
    """An empty on a bone (exported as a child of its joint): where the game hangs things."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    coll.objects.link(e)
    e.parent = rig
    e.parent_type = "BONE"
    e.parent_bone = bone
    bpy.context.view_layer.update()
    e.matrix_world = Matrix.Translation(joint(at))
    return e


# ---------------------------------------------------------------- check pictures

def turn(rig, name, axis, deg):
    """Turns a bone (and what hangs on it) about its own joint, round an axis of the file's frame."""
    pb = rig.pose.bones[name]
    head = pb.matrix.translation.copy()
    pb.matrix = Matrix.Translation(head) @ Matrix.Rotation(radians(deg), 4, axis) @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


POSES = {    # facing -Y: about X, + swings a limb backwards; about Y, + leans to the athlete's left
    "rest": [],
    "windup": [("chest", "Z", 30), ("upper_R", "X", 150), ("upper_R", "Y", 15), ("fore_R", "X", -100),
               ("upper_L", "X", -80), ("upper_L", "Y", -10), ("thigh_L", "X", -20), ("shin_L", "X", 25),
               ("thigh_R", "X", 15), ("shin_R", "X", 20)],
    "run": [("chest", "Z", -12), ("thigh_L", "X", -45), ("shin_L", "X", 75), ("thigh_R", "X", 30), ("shin_R", "X", 40),
            ("upper_L", "X", 35), ("fore_L", "X", -60), ("upper_R", "X", -40), ("fore_R", "X", -75)],
}


def pose(rig, name):
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    for bone, axis, deg in POSES[name]:
        turn(rig, bone, axis, deg)


def studio(sc):
    arena.enable_gpu(sc)
    sc.cycles.samples = 32 if QUICK else 64
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 720, 900
    sc.view_settings.view_transform = "AgX"
    w = bpy.data.worlds.new("studio")
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = lin("#a9c8f0")
    bg.inputs["Strength"].default_value = 0.7
    sc.world = w
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.5
    sun.data.color = lin("#ffd49a")[:3]
    sun.data.angle = radians(3)
    sun.rotation_euler = (radians(55), 0, radians(40))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    floor = bpy.data.objects.new("floor", bpy.data.meshes.new("floor"))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=4)
    bm.to_mesh(floor.data)
    bm.free()
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    next(n for n in fm.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = lin("#c98a52")
    floor.data.materials.append(fm)
    sc.collection.objects.link(floor)
    return cam


def shoot(sc, cam, loc, target, lens, path):
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    sc.render.filepath = path
    sc.render.image_settings.file_format = "JPEG"
    bpy.ops.render.render(write_still=True)


def check_pictures(sc, rig, meshes):
    """Both heads at rest from the front, the wind-up and a run from the side, close-ups, Low."""
    cam = studio(sc)
    shots = []

    def show(*names):
        for o in meshes:
            o.hide_render = o.name not in names

    def shot(name, *args):
        path = os.path.join(WORK, f"check-{name}.jpg")
        shoot(sc, cam, *args, path)
        shots.append(path)

    front = ((1.2, -4.2, 1.35), (0, 0, 0.95), 50)
    for head, move in (("helmet", "windup"), ("face", "run")):
        show("body_hi", f"{head}_hi")
        pose(rig, "rest")
        shot(f"{head}-rest", *front)
        shot(f"{head}-back", (-1.0, 4.2, 1.6), (0, 0, 0.95), 50)
        pose(rig, move)
        shot(f"{head}-{move}", (4.0, -2.4, 1.5), (0, 0, 1.0), 50)
    pose(rig, "rest")
    for head in ("helmet", "face"):
        show("body_hi", f"{head}_hi")
        shot(f"{head}-close", (0.55, -1.2, 1.72), (0, 0, 1.62), 60)
        show("body_lo", f"{head}_lo")
        shot(f"{head}-low", *front)
    for o in meshes:
        o.hide_render = False
    return shots


# ---------------------------------------------------------------- build

def main():
    started = time.time()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    sc = bpy.context.scene
    coll = bpy.data.collections.new("Athlete")
    sc.collection.children.link(coll)
    J = r2.pose_skeleton(REST)
    parts = r2.body_parts(J)
    pieces = pieces_for(J, parts)
    fine = {p.name: surface(coll, p.name, p.f, p.lo, p.hi, p.h) for p in pieces.values() if p.h}
    made, maps = [], {}
    for lod in ("hi", "lo"):
        def cut(name, key, symmetric=False):
            o = trimmed(fine[name], BUDGET[lod][key], f"{name}_{lod}", symmetric)
            tag(o, pieces[name].pid)
            return o
        body = cut("body", "body", True)
        body_weights(body, J, parts)
        group = {"body": [body], "face": [cut("face", "face", True)], "helmet": [cut("helmet", "helmet", True)]}
        for s in ("L", "R"):
            group["body"] += [cut("hand_" + s, "hand"), cut("shoe_" + s, "shoe")]
            eye = sphere(coll, f"eye_{s}_{lod}", *EYE_SEGMENTS[lod])
            eye.data.shade_smooth()
            tag(eye, pieces["eye_" + s].pid)
            group["face"].append(eye)
        for objs in group.values():
            for o in objs:
                piece = pieces[o.name.rsplit("_", 1)[0]]
                if piece.bone:
                    rigid(o, piece.bone)
                place(o, ROT @ piece.M)
        for name, objs in group.items():
            o = join(objs, f"{name}_{lod}")
            unwrap(o)
            true_normals(o, pieces)
            img = slot_map(o, pieces, MAP_SIZE[o.name])
            write_png(os.path.join(OUT, f"athlete_{o.name}.png"), img)
            maps[o.name] = f"athlete_{o.name}.png"
            o.data.materials.append(preview_material(o.name, img))
            made.append(o)
    for o in fine.values():
        bpy.data.objects.remove(o)
    rig = armature(coll, J)
    for o in made:
        attach(rig, o)
    S = J["R"]                                       # a held ball: where it touches the palm, its centre at 0.15 m
    touch = Vector(r2.BALL_HELD) * r2.HAND
    sockets = [socket(coll, rig, "palm_R", "hand_R", S["wr"] + S["Rhand"] @ touch),
               socket(coll, rig, "ball_R", "hand_R", S["wr"] + S["Rhand"] @ (touch - Vector((0, 0, BALL_R))))]
    counts = {o.name: tri_count(o) for o in made}
    for o in made:
        print(f"  {o.name}: {counts[o.name]} triangles, {len(o.data.vertices)} vertices")

    shots = check_pictures(sc, rig, made)
    # The file carries shapes, bones and texture coordinates only: the game paints from the maps.
    plain = bpy.data.materials.new("athlete")
    previews = {o.name: o.data.materials[0] for o in made}
    for o in made:
        o.data.materials[0] = plain
    bpy.ops.object.select_all(action="DESELECT")
    for o in [rig, *sockets, *made]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(OUT, "athlete.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=False,
                              export_yup=True, export_texcoords=True, export_normals=True, export_materials="EXPORT",
                              export_skins=True, export_animations=False, export_morph=False)
    print("  wrote athlete.glb", os.path.getsize(path) // 1024, "KB")
    for o in made:
        o.data.materials[0] = previews[o.name]
    # a copy painted in the red team's colours, for looking at in Blender (the MCP's safe mode imports
    # glTF, not other .blend files)
    bpy.ops.export_scene.gltf(filepath=os.path.join(WORK, "athlete_preview.glb"), export_format="GLB", use_selection=True,
                              export_apply=False, export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_skins=True, export_animations=False, export_morph=False)
    info = dict(slots=[s[0] for s in SLOTS], color=[s[1] for s in SLOTS], rough=[s[2] for s in SLOTS],
                metal=[s[3] for s in SLOTS], maps=maps, supersample=2, triangles=counts, heads=["helmet", "face"],
                held=dict(palm="palm_R", centre="ball_R", radius=BALL_R))
    with open(os.path.join(OUT, "athlete.json"), "w", newline="\n") as fh:
        json.dump(info, fh, indent=1)
        fh.write("\n")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "athlete.blend"))
    print("  pictures:", *shots, sep="\n    ")
    print(f"done in {time.time() - started:.0f} s")


if __name__ == "__main__":
    main()
