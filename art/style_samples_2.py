"""Style samples, round 2: the sports hall in vibrant colour and light, and new athletes.

Round 1 (style_samples.py) gave three directions; the user picked the sports hall (decision 124),
with colour and light like Genshin Impact's landscapes (125) and characters towards Fortnite-like
humanoids (126). This round builds:

- the hall lit by a warm, low sun through big windows, in visible beams, with cool sky light in
  the shadows, warm wood, greenery, a bright sky with clouds outside, bloom and a colour grade;
- athletes with heroic proportions, real hands with fingers, a sports kit in the team colours and
  livelier poses, each in two versions: a sports helmet with a visor, and a stylised face with hair.

The bodies are modelled as smooth shapes (signed distance functions, numpy) and turned into
meshes here, so nothing is downloaded. Run with Blender 5.2 in the background (docs/LOOK_AND_FEEL.md):

    blender --background --factory-startup --python art/style_samples_2.py -- [options]

Options: --out art/out   --shots play,hero,pair,face   --heads helmet,face   --samples 64
         --size 1920x1080   --quick (coarser meshes and faster light, for tests)
"""
import math
import os
import sys
import time
from math import radians

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import style_samples as r1  # noqa: E402  (round 1's helpers: materials, boxes, crowd, lights, cameras)
from style_samples import HALF_L, HALF_W, TEAM, BALL, lin, mixc, material, box, look_at, add_light  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


OUT = os.path.abspath(opt("--out", os.path.join(HERE, "out")))
SHOTS = opt("--shots", "play,hero,pair,face").split(",")
HEADS = opt("--heads", "helmet,face").split(",")
SAMPLES = int(opt("--samples", "64"))
RES_X, RES_Y = (int(v) for v in opt("--size", "1920x1080").split("x"))
QUICK = "--quick" in ARGS
BENCH = "--bench" in ARGS
DETAIL = 1.6 if QUICK else 1.0        # mesh cell sizes are multiplied by this

F = np.float32


# ---------------------------------------------------------------- shapes as distance functions
# A shape is a function from points (N, 3) to signed distances (N,), negative inside. Smooth
# unions blend parts like a sculptor's clay, which is what gives the bodies their organic look.

def v3(x):
    return np.asarray(x, dtype=F)


def norm(q):
    return np.sqrt(np.einsum("ij,ij->i", q, q))


def sd_sphere(p, c, r):
    return norm(p - v3(c)) - F(r)


def sd_ellipsoid(p, c, radii, R=None):
    """Close to the true distance near the surface (Inigo Quilez's bound). R: columns = local axes."""
    q = p - v3(c)
    if R is not None:
        q = q @ v3(R)
    r = v3(radii)
    k0 = norm(q / r)
    k1 = norm(q / (r * r))
    return np.where(k1 > 1e-9, k0 * (k0 - 1) / np.maximum(k1, F(1e-9)), -F(min(radii)))


def sd_cone(p, a, b, ra, rb):
    """A capsule from a to b whose radius goes from ra to rb (Quilez's exact round cone)."""
    a, b = v3(a), v3(b)
    ba = b - a
    l2 = float(ba @ ba)
    rr = ra - rb
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = p - a
    y = pa @ ba
    z = y - l2
    xv = pa * F(l2) - y[:, None] * ba
    x2 = np.einsum("ij,ij->i", xv, xv)
    y2 = y * y * F(l2)
    z2 = z * z * F(l2)
    k = math.copysign(1.0, rr) * rr * rr * x2 if rr != 0 else np.zeros_like(x2)
    d = (np.sqrt(np.maximum(x2 * F(a2 * il2), 0)) + y * F(rr)) * F(il2) - F(ra)
    end_b = np.sign(z) * F(a2) * z2 > k
    end_a = (np.sign(y) * F(a2) * y2 < k) & ~end_b
    d[end_b] = np.sqrt(x2[end_b] + z2[end_b]) * F(il2) - F(rb)
    d[end_a] = np.sqrt(x2[end_a] + y2[end_a]) * F(il2) - F(ra)
    return d


def sd_box(p, c, half, R=None, r=0.0):
    q = p - v3(c)
    if R is not None:
        q = q @ v3(R)
    q = np.abs(q) - (v3(half) - F(r))
    return norm(np.maximum(q, 0)) + np.minimum(q.max(axis=1), 0) - F(r)


def sd_plane(p, point, normal):
    """Positive on the side the normal points to."""
    n = v3(normal) / F(np.linalg.norm(normal))
    return (p - v3(point)) @ n


def smin(a, b, k):
    """Smooth union: blends within distance k (k may be an array, for blends local to a joint)."""
    k = np.maximum(k, F(1e-6))
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.minimum(a, b) - h * h * k * F(0.25)


def smax(a, b, k):
    return -smin(-a, -b, k)


def near(p, c, radius):
    """1 at c, fading to 0 at radius: makes a blend local to a joint (no webbing elsewhere)."""
    t = np.clip(1 - norm(p - v3(c)) / F(radius), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- turning shapes into meshes

CORNERS = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
EDGES = [(a, b) for a in range(8) for b in range(a + 1, 8)
         if sum(abs(CORNERS[a][t] - CORNERS[b][t]) for t in range(3)) == 1]


def grid_points(lo, shape, h, idx=None):
    if idx is None:
        ax = [lo[i] + h * np.arange(shape[i], dtype=F) for i in range(3)]
        g = np.meshgrid(*ax, indexing="ij")
        return np.stack([x.ravel() for x in g], 1).astype(F)
    return (np.stack(idx, 1).astype(F) * F(h) + v3(lo)).astype(F)


def sample(f, lo, hi, h, factor=4):
    """f on a fine grid, evaluated exactly only near the surface (a narrow band found on a grid
    `factor` times coarser); elsewhere the coarse value's sign is enough."""
    hc = h * factor
    nc = [int(math.ceil((hi[i] - lo[i]) / hc)) + 1 for i in range(3)]
    Dc = f(grid_points(lo, nc, hc)).reshape(nc)
    band = np.abs(Dc) < F(2.0 * hc * math.sqrt(3))
    cell = np.zeros([n - 1 for n in nc], bool)
    for (i, j, k) in CORNERS:
        cell |= band[i:nc[0] - 1 + i, j:nc[1] - 1 + j, k:nc[2] - 1 + k]
    nf = [(n - 1) * factor + 1 for n in nc]
    D = np.repeat(np.repeat(np.repeat(Dc, factor, 0), factor, 1), factor, 2)[:nf[0], :nf[1], :nf[2]]
    fine_cell = np.repeat(np.repeat(np.repeat(cell, factor, 0), factor, 1), factor, 2)
    mask = np.zeros(nf, bool)
    for (i, j, k) in CORNERS:
        mask[i:nf[0] - 1 + i, j:nf[1] - 1 + j, k:nf[2] - 1 + k] |= fine_cell
    idx = np.nonzero(mask)
    D[idx] = f(grid_points(lo, nf, h, idx))
    return D


def surface_nets(D, lo, h):
    """Quads on the zero level of D: one vertex per cell the surface crosses, one quad per crossed edge."""
    inside = D < 0
    n = D.shape
    anyc = inside[:-1, :-1, :-1].copy()
    allc = anyc.copy()
    for (i, j, k) in CORNERS[1:]:
        c = inside[i:n[0] - 1 + i, j:n[1] - 1 + j, k:n[2] - 1 + k]
        anyc |= c
        allc &= c
    active = anyc & ~allc
    del anyc, allc
    cells = np.argwhere(active)
    vals = np.stack([D[cells[:, 0] + i, cells[:, 1] + j, cells[:, 2] + k] for (i, j, k) in CORNERS], 1)
    acc = np.zeros((len(cells), 3), F)
    cnt = np.zeros(len(cells), F)
    corner = np.array(CORNERS, F)
    for a, b in EDGES:
        da, db = vals[:, a], vals[:, b]
        m = (da < 0) != (db < 0)
        t = (da[m] / (da[m] - db[m]))[:, None]
        acc[m] += corner[a] + t * (corner[b] - corner[a])
        cnt[m] += 1
    verts = (cells + acc / cnt[:, None]) * F(h) + v3(lo)
    lin_ids = np.ravel_multi_index(cells.T, active.shape)
    quads = []
    for axis in range(3):
        lo_s, hi_s = [slice(1, -1)] * 3, [slice(1, -1)] * 3
        lo_s[axis], hi_s[axis] = slice(0, -1), slice(1, None)
        a_in, b_in = inside[tuple(lo_s)], inside[tuple(hi_s)]
        ch = a_in != b_in
        e = np.argwhere(ch)
        u, v = (axis + 1) % 3, (axis + 2) % 3
        e[:, u] += 1
        e[:, v] += 1

        def cell_of(du, dv):
            c = e.copy()
            c[:, u] -= du
            c[:, v] -= dv
            return np.searchsorted(lin_ids, np.ravel_multi_index(c.T, active.shape))

        q = np.stack([cell_of(1, 1), cell_of(0, 1), cell_of(0, 0), cell_of(1, 0)], 1)
        flip = ~a_in[ch]
        q[flip] = q[flip][:, ::-1]
        quads.append(q)
    return verts, np.concatenate(quads)


def gradient(f, p, eps=4e-4):
    g = np.zeros_like(p)
    for i in range(3):
        d = np.zeros(3, F)
        d[i] = eps
        g[:, i] = (f(p + d) - f(p - d)) / F(2 * eps)
    return g


def mesh_from_sdf(name, f, lo, hi, h, coll=None, mats=(), regions=None, colors=None, parent=None):
    """Mesh the shape f inside the box lo..hi with cells of size h (metres), smooth normals from f.
    regions(face_centres, face_normals) -> material index per face; colors(verts) -> RGBA per vertex."""
    t0 = time.time()
    h = h * DETAIL
    lo = [lo[i] - 2 * h for i in range(3)]
    hi = [hi[i] + 2 * h for i in range(3)]
    D = sample(f, lo, hi, h)
    verts, quads = surface_nets(D, lo, h)
    del D
    for _ in range(2):                         # pull the vertices onto the true surface
        g = gradient(f, verts)
        gl = np.maximum(norm(g), F(1e-6))
        step = np.clip(f(verts) / gl, -h, h)           # flat spots in the field must not fling vertices
        verts = verts - g / gl[:, None] * step[:, None]
    nrm = gradient(f, verts)
    nrm /= np.maximum(norm(nrm), F(1e-6))[:, None]
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    me.loops.add(quads.size)
    me.loops.foreach_set("vertex_index", quads.ravel().astype(np.int32))
    me.polygons.add(len(quads))
    me.polygons.foreach_set("loop_start", np.arange(0, quads.size, 4, dtype=np.int32))
    me.update()
    for m in mats:
        me.materials.append(m)
    if regions is not None and len(mats) > 1:
        fc = verts[quads].mean(axis=1)
        fn = nrm[quads].mean(axis=1)
        me.polygons.foreach_set("material_index", np.asarray(regions(fc, fn), np.int32))
    if colors is not None:
        ca = me.color_attributes.new("mask", "FLOAT_COLOR", "POINT")
        ca.data.foreach_set("color", np.asarray(colors(verts), F).ravel())
    me.shade_smooth()
    me.normals_split_custom_set_from_vertices(nrm.astype(F))
    o = bpy.data.objects.new(name, me)
    if coll is not None:
        coll.objects.link(o)
    if parent is not None:
        o.parent = parent
    print(f"  mesh {name}: {len(verts)} verts, {len(quads)} quads, {time.time() - t0:.1f}s")
    return o


# ---------------------------------------------------------------- the athlete: hands
# A right hand in its own frame: X from the wrist to the fingers, Y to the thumb, Z the back of
# the hand (the palm faces -Z). The left hand is its mirror image.

HAND = 1.1                         # heroic proportions: hands 10% larger than life

# knuckle position, bone lengths, radii at the knuckle / middle joints / tip: chunkier than life
FINGERS = {
    "index": ((0.100, 0.0295, 0.001), (0.042, 0.025, 0.021), (0.0112, 0.0104, 0.0094, 0.0085)),
    "middle": ((0.104, 0.009, 0.002), (0.046, 0.0285, 0.022), (0.0116, 0.0107, 0.0096, 0.0087)),
    "ring": ((0.1, -0.0115, 0.001), (0.043, 0.0265, 0.021), (0.011, 0.0101, 0.0091, 0.0083)),
    "little": ((0.091, -0.0305, -0.002), (0.033, 0.02, 0.018), (0.0098, 0.0089, 0.0081, 0.0074)),
}
THUMB = ((0.020, 0.024, -0.014), (0.040, 0.031, 0.026), (0.016, 0.0132, 0.012, 0.0108))

# Per grip: each finger's spread and bend at its three joints (degrees); the thumb's direction
# (yaw towards the thumb side, pitch towards the palm), the way it bends, and its two bends.
GRIPS = {
    "relax": dict(spread=(4, 0, -4, -9), curl=((18, 34, 18), (22, 40, 20), (27, 44, 22), (32, 46, 24)),
                  thumb=(40, 32, (0.3, -0.35, -0.9), (14, 22))),
    "open": dict(spread=(10, 1, -8, -17), curl=((6, 10, 5), (7, 11, 6), (9, 13, 7), (11, 15, 8)),
                 thumb=(58, 16, (0.2, -0.2, -1.0), (4, 10))),
    "ball": dict(spread=(13, 1, -11, -23), wrap=0.15, thumb=(62, 40, (0.25, -0.25, -1.0), None)),
    "fist": dict(spread=(2, 0, -2, -5), curl=((80, 100, 62), (84, 102, 62), (88, 102, 60), (90, 100, 58)),
                 thumb=(28, 40, (0.15, -1.0, -0.15), (42, 34))),
}
BALL_HELD = (0.074, 0.0, -0.012)    # where a held ball touches the palm


def wrap_angle(j, d, axis, length, c, R):
    """The bend (radians) that puts the end of a bone from j, starting along d, on a sphere (c, R)."""
    lo, hi = 0.0, math.radians(95)
    for _ in range(30):
        mid = (lo + hi) / 2
        e = j + (Matrix.Rotation(mid, 3, axis) @ d) * length
        if (e - c).length > R:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def hand_bones(grip):
    """Joint positions (hand frame) for each finger and the thumb, with their radii."""
    G = GRIPS[grip]
    s = HAND
    chains = []
    ball_c = R_ball = None
    if G.get("wrap"):
        ball_c = Vector(BALL_HELD) * s - Vector((0, 0, G["wrap"]))
    for (name, (base, lengths, radii)), spread in zip(FINGERS.items(), G["spread"]):
        rz = Matrix.Rotation(radians(spread), 3, "Z")
        axis = rz @ Vector((0, 1, 0))
        d = rz @ Vector((1, 0, 0))
        pts = [Vector(base) * s]
        bend = 0.0
        for i, L in enumerate(lengths):
            L *= s
            if ball_c is not None:
                R_ball = G["wrap"] + radii[i + 1] * s * 0.9
                b = wrap_angle(pts[-1], Matrix.Rotation(bend, 3, axis) @ d, axis, L, ball_c, R_ball)
                bend += max(b, 0.0)
            else:
                bend += radians(G["curl"][list(FINGERS).index(name)][i])
            pts.append(pts[-1] + (Matrix.Rotation(bend, 3, axis) @ d) * L)
        chains.append((pts, [r * s for r in radii]))
    yaw, pitch, toward, bends = G["thumb"]
    base, lengths, radii = THUMB
    d = Matrix.Rotation(radians(yaw), 3, "Z") @ Matrix.Rotation(radians(pitch), 3, "Y") @ Vector((1, 0, 0))
    axis = d.cross(Vector(toward)).normalized()      # positive bends turn the thumb towards `toward`
    pts = [Vector(base) * s]
    bend = 0.0
    for i, L in enumerate(lengths):
        L *= s
        if i > 0:
            if bends is None:
                R_t = G["wrap"] + radii[i + 1] * s * 0.9
                bend += max(wrap_angle(pts[-1], Matrix.Rotation(bend, 3, axis) @ d, axis, L, ball_c, R_t), 0.0)
            else:
                bend += radians(bends[i - 1])
        pts.append(pts[-1] + (Matrix.Rotation(bend, 3, axis) @ d) * L)
    thumb = (pts, [r * s for r in radii], d)
    return chains, thumb


def hand_sdf(grip):
    chains, (tpts, trad, tdir) = hand_bones(grip)
    s = HAND

    def f(p):
        palm = sd_box(p, (0.058 * s, -0.001 * s, -0.001 * s), (0.043 * s, 0.0425 * s, 0.0145 * s), r=0.012 * s)
        palm = smin(palm, sd_ellipsoid(p, (0.03 * s, 0.0, -0.004 * s), (0.034 * s, 0.037 * s, 0.02 * s)), 0.012)
        tR = r1.frame(tdir, Vector((0, 0, 1)))
        palm = smin(palm, sd_ellipsoid(p, tpts[0] + tdir * 0.018 * s + Vector((0, -0.004, -0.002)), (0.034 * s, 0.02 * s, 0.017 * s), tR), 0.012)
        palm = smin(palm, sd_ellipsoid(p, (0.05 * s, -0.031 * s, -0.008 * s), (0.038 * s, 0.013 * s, 0.013 * s)), 0.01)
        palm = smin(palm, sd_ellipsoid(p, (0.0, 0.0, -0.002 * s), (0.03 * s, 0.03 * s, 0.021 * s)), 0.014)
        palm = smin(palm, sd_cone(p, (0.0, 0.0, -0.002 * s), (-0.07, 0.0, 0.0), 0.024 * s, 0.026), 0.012)
        d = palm
        for pts, rad in chains:
            fd = None
            for i in range(3):
                seg = sd_cone(p, pts[i], pts[i + 1], rad[i], rad[i + 1])
                fd = seg if fd is None else np.minimum(fd, seg)
            d = smin(d, fd, 0.01 * near(p, pts[0], 0.03))
        td = None
        for i in range(3):
            seg = sd_cone(p, tpts[i], tpts[i + 1], trad[i], trad[i + 1])
            td = seg if td is None else smin(td, seg, 0.004)
        return smin(d, td, 0.012 * near(p, tpts[1], 0.05))

    pts = [q for c, _ in chains for q in c] + list(tpts)
    lo = [min(q[i] for q in pts) - 0.03 for i in range(3)]
    hi = [max(q[i] for q in pts) + 0.03 for i in range(3)]
    lo[0] = min(lo[0], -0.07)
    return f, lo, hi



# ---------------------------------------------------------------- the athlete: skeleton and poses
# The athlete's frame: facing +X, left is +Y, Z up, feet on the ground. 1.75 m tall like the game's
# player, with heroic proportions: the head 1/7 of the height, broad shoulders, a narrow waist.

SK = dict(pelvis=0.99, hip=(0.0, 0.092, -0.075), waist=0.10, chest=0.13,
          shoulder=(-0.014, 0.206, 0.205), neck=(-0.012, 0.0, 0.215), head=(0.012, 0.0, 0.125),
          upper=0.295, fore=0.27, thigh=0.43, shin=0.415, ankle=0.072)
SOLE = [(-0.065, -0.072), (0.185, -0.072)]       # heel and toe under the ankle, in the foot's frame


def two_bone(root, target, a, b, pole):
    """The middle joint of a two-bone limb reaching from root towards target, bending towards pole."""
    root, target, pole = Vector(root), Vector(target), Vector(pole)
    d = target - root
    dist = min(d.length, (a + b) * 0.9995)
    if d.length > (a + b) * 1.02:
        print(f"    (a limb is {d.length - a - b:.3f} m short of its target)")
    u = d.normalized()
    cos_a = (a * a + dist * dist - b * b) / (2 * a * dist)
    sin_a = math.sqrt(max(0.0, 1 - cos_a * cos_a))
    v = (pole - pole.dot(u) * u).normalized()
    return root + (u * cos_a + v * sin_a) * a, root + u * dist


def hand_frame(point, palm, mirror):
    """Columns: towards the fingers, towards the thumb, the back of the hand (a left hand is mirrored)."""
    h = Vector(point).normalized()
    n = Vector(palm)
    n = (n - n.dot(h) * h).normalized()
    back = -n
    thumb = back.cross(h)
    if mirror:
        thumb = -thumb
    return Matrix((h, thumb, back)).transposed()


def foot_frame(yaw, pitch):
    return r1.rot(yaw) @ r1.rot(y=pitch)


def ankle_height(pitch):
    s, c = math.sin(radians(pitch)), math.cos(radians(pitch))
    return max(x * s - z * c for x, z in SOLE)


def pose_skeleton(P):
    """Joint positions and frames for a pose: P gives the pelvis offset and turns, where the hands
    (or a held ball) and feet go, and which way elbows and knees point."""
    J = dict(P=P)
    Rp = r1.rot(*P.get("pelvis", (0, 0, 0)))
    cy, cp, cr = P.get("chest", (0, 0, 0))
    Rm = Rp @ r1.rot(cy * 0.5, cp * 0.5, cr * 0.5)
    Rc = Rp @ r1.rot(cy, cp, cr)
    hy, hp, hr = P.get("head", (0, 0, 0))
    Rn = Rc @ r1.rot(hy * 0.4, hp * 0.4, hr * 0.4)
    Rh = Rc @ r1.rot(hy, hp, hr)
    pc = Vector((0, 0, SK["pelvis"])) + Vector(P.get("root", (0, 0, 0)))
    w = pc + Rp @ Vector((0, 0, SK["waist"]))
    c = w + Rm @ Vector((0, 0, SK["chest"]))
    nk = c + Rc @ Vector(SK["neck"])
    hd = nk + Rn @ Vector(SK["head"])
    J.update(Rp=Rp, Rm=Rm, Rc=Rc, Rn=Rn, Rh=Rh, pc=pc, waist=w, chest=c, neck=nk, head=hd)
    for side, s in (("L", 1), ("R", -1)):
        A = P[side]
        sh = c + Rc @ Vector((SK["shoulder"][0], s * SK["shoulder"][1], SK["shoulder"][2]))
        Rhand = hand_frame(A["point"], A["palm"], mirror=(side == "L"))
        if "ball" in A:
            ball = Vector(A["ball"])
            wr = ball - Rhand @ (Vector(BALL_HELD) * HAND - Vector((0, 0, GRIPS[A["grip"]]["wrap"])))
        else:
            ball = None
            wr = Vector(A["hand"])
        el, wr = two_bone(sh, wr, SK["upper"], SK["fore"], A["elbow"])
        L = P[side + "foot"]
        fR = foot_frame(L.get("yaw", 0), L.get("pitch", 0))
        an_t = Vector((L["at"][0], L["at"][1], ankle_height(L.get("pitch", 0)) + L.get("lift", 0)))
        hip = pc + Rp @ Vector((SK["hip"][0], s * SK["hip"][1], SK["hip"][2]))
        kn, an = two_bone(hip, an_t, SK["thigh"], SK["shin"], L.get("knee", (1, 0, 0)))
        J[side] = dict(s=s, sh=sh, el=el, wr=wr, Rhand=Rhand, ball=ball, grip=A["grip"],
                       hip=hip, kn=kn, an=an, Rfoot=fR, elbow_pole=Vector(A["elbow"]),
                       knee_pole=Vector(L.get("knee", (1, 0, 0))))
    return J


def bend_side(a, b, c, pole):
    """Unit vector at the joint b pointing to the inside of the bend a-b-c (the pole if straight)."""
    u = (b - a).normalized()
    w = c - b
    v = w - w.dot(u) * u
    if v.length < 0.02 * w.length:
        v = Vector(pole) - Vector(pole).dot(u) * u
    return v.normalized()


# ---------------------------------------------------------------- the athlete: the body

def body_parts(J):
    """The body's distance functions, grouped so the kit can reuse them."""
    Rp, Rm, Rc, pc, w, c = J["Rp"], J["Rm"], J["Rc"], J["pc"], J["waist"], J["chest"]
    E = sd_ellipsoid

    def at(R, o, off):
        return o + R @ Vector(off)

    def torso(p, inflate=0.0, chest=True, neck=True, lower=True):
        t = None
        if chest:
            t = E(p, at(Rc, c, (-0.008, 0, 0.085)), (0.104, 0.138, 0.16), Rc)
            t = smin(t, E(p, at(Rc, c, (-0.014, 0, 0.175)), (0.096, 0.19, 0.088), Rc), 0.05)
            t = smin(t, E(p, at(Rc, c, (0.045, 0, 0.14)), (0.05, 0.09, 0.075), Rc), 0.04)          # sternum: no cleavage
            t = smin(t, E(p, at(Rc, c, (0.05, 0, 0.152)), (0.034, 0.158, 0.064), Rc), 0.035)          # a broad, flat chest
            for s in (1, -1):
                lat = Rc @ r1.rot(x=s * 18)
                t = smin(t, E(p, at(Rc, c, (-0.032, s * 0.122, 0.08)), (0.07, 0.058, 0.135), lat), 0.04)
                t = smin(t, sd_cone(p, at(Rc, c, (-0.03, s * 0.045, 0.265)), at(Rc, c, (-0.03, s * 0.175, 0.21)), 0.05, 0.04), 0.04)
        if neck:
            n = sd_cone(p, at(Rc, c, (-0.014, 0, 0.17)), J["head"] + J["Rn"] @ Vector((-0.022, 0, -0.02)), 0.07, 0.06)
            t = n if t is None else smin(t, n, 0.05)
        if lower:
            ab = E(p, at(Rm, w, (0.01, 0, 0.03)), (0.094, 0.13, 0.112), Rm)
            for s in (1, -1):
                ab = smin(ab, E(p, at(Rm, w, (0.0, s * 0.078, 0.02)), (0.06, 0.042, 0.085), Rm), 0.04)
            ab = smin(ab, E(p, at(Rp, pc, (0.0, 0, -0.01)), (0.095, 0.135, 0.1), Rp), 0.06)
            for s in (1, -1):
                ab = smin(ab, E(p, at(Rp, pc, (-0.052, s * 0.058, -0.062)), (0.07, 0.068, 0.082), Rp), 0.04)
                ab = smin(ab, E(p, at(Rp, pc, (0.0, s * 0.118, -0.075)), (0.055, 0.036, 0.07), Rp), 0.04)
            t = ab if t is None else smin(t, ab, 0.06)
        return t - F(inflate)

    def upper_arm(p, side, inflate=0.0):
        S = J[side]
        sh, el, wr = S["sh"], S["el"], S["wr"]
        d1 = (el - sh).normalized()
        front = bend_side(sh, el, wr, -S["elbow_pole"])     # the biceps side faces away from the elbow
        R = r1.frame(d1, front)
        a = sd_cone(p, sh, el, 0.055, 0.043)
        a = smin(a, E(p, sh + d1 * 0.065 + (sh - c).normalized() * 0.004, (0.086, 0.054, 0.058), R), 0.03)
        a = smin(a, E(p, sh + d1 * 0.15 + front * 0.017, (0.09, 0.045, 0.046), R), 0.025)
        a = smin(a, E(p, sh + d1 * 0.13 - front * 0.015, (0.105, 0.045, 0.048), R), 0.025)
        return a - F(inflate)

    def forearm(p, side):
        S = J[side]
        el, wr = S["el"], S["wr"]
        d2 = (wr - el).normalized()
        front = bend_side(S["sh"], el, wr, -S["elbow_pole"])
        R = r1.frame(d2, front)
        f = sd_cone(p, el, wr, 0.044, 0.028)
        f = smin(f, sd_sphere(p, el - front * 0.006, 0.042), 0.02)
        f = smin(f, E(p, el + d2 * 0.075 + front * 0.007, (0.092, 0.048, 0.043), R), 0.025)
        return f

    def arm(p, side):
        return smin(upper_arm(p, side), forearm(p, side), 0.02)

    def thigh(p, side, inflate=0.0, flare=0.0):
        S = J[side]
        hip, kn, an = S["hip"], S["kn"], S["an"]
        d = (kn - hip).normalized()
        back = bend_side(hip, kn, an, -S["knee_pole"])
        R = r1.frame(d, back)
        t = sd_cone(p, hip + d * 0.02, kn, 0.09, 0.054)
        t = smin(t, E(p, hip + d * 0.21 - back * 0.024, (0.18, 0.074, 0.076), R), 0.04)
        t = smin(t, E(p, hip + d * 0.2 + back * 0.021, (0.165, 0.063, 0.066), R), 0.04)
        t = smin(t, E(p, hip + d * 0.1 + (pc - hip).normalized() * 0.03, (0.1, 0.06, 0.05), R), 0.04)
        if flare:
            t = t - F(flare) * np.clip(((p - v3(hip)) @ v3(d)) / F(0.25), 0, 1)
        return t - F(inflate)

    def shin(p, side, inflate=0.0):
        S = J[side]
        hip, kn, an = S["hip"], S["kn"], S["an"]
        d = (an - kn).normalized()
        back = -bend_side(hip, kn, an, -S["knee_pole"])
        R = r1.frame(d, back)
        s = sd_cone(p, kn, an, 0.05, 0.031)
        s = smin(s, sd_sphere(p, kn - back * 0.03, 0.03), 0.02)
        s = smin(s, E(p, kn + d * 0.125 + back * 0.028, (0.12, 0.054, 0.057), R), 0.04)
        return s - F(inflate)

    def leg(p, side):
        return smin(thigh(p, side), shin(p, side), 0.03 * near(p, J[side]["kn"], 0.12))

    def body(p):
        d = torso(p)
        for side in ("L", "R"):
            d = smin(d, arm(p, side), 0.035 * near(p, J[side]["sh"], 0.13))
        for side in ("L", "R"):
            d = smin(d, leg(p, side), 0.05 * near(p, J[side]["hip"], 0.16))
        return d

    return dict(torso=torso, upper_arm=upper_arm, forearm=forearm, arm=arm, thigh=thigh, shin=shin,
                leg=leg, body=body)


def skeleton_box(J, pad=0.2):
    pts = [J["pc"], J["chest"], J["neck"], J["head"]]
    for side in ("L", "R"):
        pts += [J[side][k] for k in ("sh", "el", "wr", "hip", "kn", "an")]
    lo = [min(q[i] for q in pts) - pad for i in range(3)]
    hi = [max(q[i] for q in pts) + pad for i in range(3)]
    return lo, hi


# ---------------------------------------------------------------- the athlete: the head
# In the head's frame: origin at the top of the neck, X the way the face looks, Y left, Z up.
# The eyes are 5.6 cm above the origin; the head is 25 cm from chin to crown (1/7 of the height).

EYE = (0.0765, 0.0328, 0.054)         # the left eyeball's centre; the right one is mirrored
EYE_R = 0.0153
HEAD_BOX = ((-0.14, -0.11, -0.16), (0.14, 0.11, 0.215))
LID = (0.0071, 0.0093)               # the upper and lower lid edges above and below the eye centre


def smoothstep(a, b, x):
    t = np.clip((x - F(a)) / F(b - a), 0, 1)
    return t * t * (3 - 2 * t)


def head_sdf(p):
    """The skin of the head and neck, with the eyelids (the eyeballs are separate)."""
    E = sd_ellipsoid
    d = E(p, (-0.012, 0, 0.083), (0.1, 0.078, 0.097))                     # cranium
    d = smin(d, E(p, (0.032, 0, 0.095), (0.062, 0.068, 0.068)), 0.03)       # forehead
    for s in (1, -1):
        d = smin(d, E(p, (0.056, s * 0.045, 0.029), (0.027, 0.024, 0.019)), 0.02)              # cheekbone
        d = smin(d, sd_cone(p, (-0.014, s * 0.05, -0.008), (0.066, s * 0.018, -0.051), 0.018, 0.016), 0.026)  # jaw
    d = smin(d, E(p, (0.06, 0, -0.01), (0.042, 0.035, 0.044)), 0.026)       # mouth and cheeks
    d = smin(d, E(p, (0.075, 0, -0.049), (0.021, 0.026, 0.02)), 0.02)       # chin
    d = smin(d, sd_cone(p, (-0.026, 0, -0.15), (-0.016, 0, -0.005), 0.059, 0.052), 0.035)    # neck
    d = smin(d, sd_cone(p, (0.084, -0.045, 0.074), (0.084, 0.045, 0.074), 0.012, 0.012), 0.016)  # brow
    for s in (1, -1):
        d = smax(d, -sd_sphere(p, (0.0885, s * EYE[1], EYE[2]), 0.019), 0.01)  # eye socket
    for s in (1, -1):
        c = (EYE[0], s * EYE[1], EYE[2])
        front = EYE[0] + EYE_R
        up = smax(sd_sphere(p, c, EYE_R + 0.0017), sd_plane(p, (front, c[1], c[2] + LID[0]), (0.55, 0, -1)), 0.0015)
        fold = smax(sd_sphere(p, c, EYE_R + 0.0034), sd_plane(p, (front, c[1], c[2] + LID[0] + 0.0052), (0.6, 0, -1)), 0.002)
        low = smax(sd_sphere(p, c, EYE_R + 0.0012), sd_plane(p, (front, c[1], c[2] - LID[1]), (0.4, 0, 1)), 0.0015)
        d = smin(d, np.minimum(np.minimum(up, fold), low), 0.004)
    d = smin(d, sd_cone(p, (0.088, 0, 0.048), (0.109, 0, 0.0145), 0.008, 0.0105), 0.008)  # nose
    for s in (1, -1):
        d = smin(d, sd_sphere(p, (0.0985, s * 0.0125, 0.0115), 0.0074), 0.007)          # nostril wings
    d = smin(d, E(p, (0.0985, 0, -0.0138), (0.0094, 0.0262, 0.0066)), 0.006)  # upper lip
    d = smin(d, E(p, (0.0965, 0, -0.0252), (0.0098, 0.0232, 0.0074)), 0.006)  # lower lip
    for s in (1, -1):                                                         # a slight smile
        d = smax(d, -sd_cone(p, (0.106, 0.0, -0.0193), (0.103, s * 0.0245, -0.0166), 0.0015, 0.0013), 0.002)
    for s in (1, -1):
        Re = r1.rot(x=-s * 8, y=14)
        ear = E(p, (-0.008, s * 0.0765, 0.045), (0.019, 0.008, 0.028), Re)
        ear = smax(ear, -E(p, (-0.0055, s * 0.0835, 0.042), (0.011, 0.005, 0.017), Re), 0.004)
        d = smin(d, ear, 0.006)
    return d


def head_colors(v):
    """Vertex masks for the skin shader: R warm (cheeks, nose, ears), G lips."""
    out = np.zeros((len(v), 4), F)
    out[:, 3] = 1
    warm = np.zeros(len(v), F)
    for c, r in (((0.085, 0.04, 0.025), 0.03), ((0.085, -0.04, 0.025), 0.03), ((0.11, 0, 0.015), 0.018),
                 ((-0.008, 0.08, 0.045), 0.03), ((-0.008, -0.08, 0.045), 0.03)):
        warm = np.maximum(warm, 1 - np.clip(norm(v - v3(c)) / F(r), 0, 1))
    out[:, 0] = warm * 0.8
    lips = np.maximum(1 - norm((v - v3((0.098, 0, -0.0195))) / v3((0.02, 0.026, 0.013))), 0)
    out[:, 1] = np.clip(lips * 3.0, 0, 1)
    return out


def lashes_sdf(p):
    """A dark line along each upper lid's edge, thicker towards the outer corner."""
    d = None
    for s in (1, -1):
        c = v3((EYE[0], s * EYE[1], EYE[2]))
        q = p - c
        edge = (q[:, 2] - F(LID[0]) + F(0.55) * (q[:, 0] - F(EYE_R))) / F(math.hypot(1, 0.55))
        outer = np.clip(s * q[:, 1] / F(EYE_R), -1, 1)
        band = np.abs(edge - F(0.0009)) - F(0.0009) - F(0.0005) * (outer + 1)
        shell = np.abs(norm(q) - F(EYE_R + 0.0019)) - F(0.0007)
        e = smax(smax(band, shell, 0.0004), F(0.003) - q[:, 0], 0.001)
        d = e if d is None else np.minimum(d, e)
    return d


def brows_sdf(p):
    d = None
    for s in (1, -1):
        b = sd_cone(p, (0.1, s * 0.011, 0.0792), (0.1, s * 0.031, 0.0822), 0.0052, 0.0047)
        b = np.minimum(b, sd_cone(p, (0.1, s * 0.031, 0.0822), (0.1, s * 0.051, 0.0786), 0.0047, 0.0025))
        b = smax(b, F(0.06) - p[:, 0], 0.001)
        d = b if d is None else np.minimum(d, b)
    return smax(d, head_sdf(p) - F(0.0017), 0.001)


def hairline(p):
    """Height of the hairline around the head (by the angle from the face), minus the point's height."""
    ang = np.degrees(np.arctan2(np.abs(p[:, 1]), p[:, 0] - F(0.0)))
    z = np.interp(ang, [0, 30, 50, 66, 82, 102, 126, 152, 180],
                  [0.13, 0.124, 0.112, 0.096, 0.088, 0.088, 0.042, 0.01, 0.0]).astype(F)
    return z - p[:, 2]


def hair_sdf(p):
    under = -hairline(p)
    top = smoothstep(0.1, 0.17, p[:, 2]) * smoothstep(-0.08, 0.05, p[:, 0])
    thick = (F(-0.003) + F(0.0062) * smoothstep(-0.003, 0.005, under)
             + (F(0.003) + F(0.016) * top) * smoothstep(0.008, 0.035, under))
    wave = p[:, 1] * F(2 * math.pi / 0.016) + F(0.9) * np.sin(p[:, 0] * F(31)) + F(0.6) * np.sin(p[:, 2] * F(47) + p[:, 1] * F(19))
    strands = np.sin(wave) * F(0.00025) * smoothstep(0.01, 0.035, under)
    cap = head_sdf(p) - thick - strands
    for y, rise, sweep in ((-0.04, 0.0, 0.006), (-0.02, 0.006, 0.002), (0.0, 0.01, -0.003),
                           (0.02, 0.008, -0.007), (0.039, 0.0, -0.011)):
        a, b, c = (-0.05, y * 0.9, 0.168), (0.02, y + sweep, 0.19 + rise * 0.3), (0.068, y + sweep * 2.2 - 0.008, 0.168 + rise * 0.5)
        clump = np.minimum(sd_cone(p, a, b, 0.0135, 0.015), sd_cone(p, b, c, 0.015, 0.0065))
        cap = smin(cap, clump, 0.01)
    return smax(cap, F(-0.02) - p[:, 2], 0.004)


def helmet_sdf(p):
    shell = sd_ellipsoid(p, (-0.006, 0, 0.078), (0.128, 0.104, 0.127))
    shell = smin(shell, sd_ellipsoid(p, (0.045, 0, 0.02), (0.098, 0.092, 0.095)), 0.03)
    return smax(shell, sd_plane(p, (0, 0, -0.06), (-0.25, 0, -1)), 0.012)


def visor_region(p):
    q = np.stack([p[:, 1], p[:, 2] - F(0.054)], 1)
    return smax(rounded_rect(q, (0.104, 0.047), 0.032), F(0.015) - p[:, 0], 0.01)


def rounded_rect(q, half, r):
    k = np.abs(q) - v3(half) + F(r)
    return norm(np.concatenate([np.maximum(k, 0), np.zeros((len(q), 1), F)], 1)) + np.minimum(k.max(axis=1), 0) - F(r)


def visor_sdf(p):
    return smax(helmet_sdf(p) - F(0.004), visor_region(p), 0.004)


def trim_sdf(p):
    """A raised frame round the visor, and a pod over each ear."""
    q = np.stack([p[:, 1], p[:, 2] - F(0.054)], 1)
    ring = np.abs(rounded_rect(q, (0.104, 0.047), 0.032)) - F(0.0055)
    frame_ = smax(smax(helmet_sdf(p) - F(0.0062), ring, 0.003), F(0.008) - p[:, 0], 0.006)
    pods = None
    for s in (1, -1):
        pod = sd_cone(p, (-0.012, s * 0.098, 0.045), (-0.012, s * 0.112, 0.045), 0.034, 0.03)
        pods = pod if pods is None else np.minimum(pods, pod)
    return np.minimum(frame_, pods)


def stripe_sdf(p):
    d = smax(helmet_sdf(p) - F(0.003), np.abs(p[:, 1]) - F(0.017), 0.003)
    d = smax(d, -visor_region(p) - F(0.008), 0.003)      # stops short of the visor
    return smax(d, F(0.03) - p[:, 2], 0.003)            # over the top only


# ---------------------------------------------------------------- materials for the athletes

def socket(node, identifier):
    return next(s for s in list(node.inputs) + list(node.outputs) if s.identifier == identifier)


def mix_color(nt, fac, a, b):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    nt.links.new(fac, socket(n, "Factor_Float"))
    for ident, v in (("A_Color", a), ("B_Color", b)):
        if isinstance(v, tuple):
            socket(n, ident).default_value = v
        else:
            nt.links.new(v, socket(n, ident))
    return socket(n, "Result_Color")


def skin_material(name, tone, warm=None, lips=None):
    """Skin with a little light scattering under it. On the head, painted masks (the 'mask'
    colour attribute) warm the cheeks, nose and ears, and colour the lips."""
    base = lin(tone)
    m = material(name, base, rough=0.48, sheen=0.15)
    b = r1.bsdf_of(m)
    b.inputs["Subsurface Weight"].default_value = 0.25
    b.inputs["Subsurface Radius"].default_value = (1.0, 0.4, 0.22)
    b.inputs["Subsurface Scale"].default_value = 0.008
    b.inputs["Specular IOR Level"].default_value = 0.4
    nt = m.node_tree
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "mask"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(at.outputs["Color"], sep.inputs[0])
    warm = lin(warm) if warm else mixc(base, lin("#ff5a4a"), 0.32)
    lips = lin(lips) if lips else mixc(base, lin("#b8484a"), 0.45)
    c = mix_color(nt, sep.outputs[0], base, warm)
    c = mix_color(nt, sep.outputs[1], c, lips)
    nt.links.new(c, b.inputs["Base Color"])
    return m


def eye_material(name, iris_hex):
    """A unit sphere looking along +X: pupil, iris and a dark ring, drawn from the object's coordinates."""
    m = material(name, lin("#f4f1ec"), rough=0.25, coat=1.0)
    b = r1.bsdf_of(m)
    b.inputs["Coat Roughness"].default_value = 0.02
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    r = r1.mnode(nt, "SQRT", r1.mnode(nt, "ADD", r1.mnode(nt, "MULTIPLY", sep.outputs["Y"], sep.outputs["Y"]),
                                      r1.mnode(nt, "MULTIPLY", sep.outputs["Z"], sep.outputs["Z"])))
    r = r1.mnode(nt, "MAXIMUM", r, r1.mnode(nt, "LESS_THAN", sep.outputs["X"], 0.0))
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    iris = lin(iris_hex)
    stops = [(0.0, (0.01, 0.01, 0.012, 1)), (0.22, (0.01, 0.01, 0.012, 1)), (0.26, mixc(iris, (1, 1, 1), 0.3)),
             (0.5, iris), (0.57, mixc(iris, (0, 0, 0), 0.65)), (0.61, lin("#f4f1ec")), (1.0, lin("#e6e0da"))]
    cr.elements[0].position, cr.elements[0].color = stops[0]
    cr.elements[1].position, cr.elements[1].color = stops[-1]
    for pos, col in stops[1:-1]:
        e = cr.elements.new(pos)
        e.color = col
    nt.links.new(r, ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return m


def hair_material(name, hex_col):
    base = lin(hex_col)
    m = material(name, base, rough=0.62, sheen=0.25)
    b = r1.bsdf_of(m)
    b.inputs["Sheen Tint"].default_value = mixc(base, (1, 0.85, 0.7, 1), 0.5)
    b.inputs["Sheen Roughness"].default_value = 0.5
    b.inputs["Specular IOR Level"].default_value = 0.25
    return m


def fabric(name, color, rough=0.62, sheen=0.35):
    """Sports fabric: matte, with a soft sheen at grazing angles and a fine knit in the bump."""
    m = material(name, color, rough=rough, sheen=sheen)
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 700.0
    nz.inputs["Detail"].default_value = 1.0
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.12
    bump.inputs["Distance"].default_value = 0.0004
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], r1.bsdf_of(m).inputs["Normal"])
    return m


def kit_materials(team):
    tc = lin(TEAM[team])
    # a deeper cloth colour, so it still reads as the team colour after warm sun and tone mapping
    cloth = mixc(tc, lin({"red": "#c8102e", "blue": "#0d5bd6"}[team]), 0.4)
    k = f"kit_{team}"
    white = fabric(k + "_white", lin("#f6f7fa"))
    navy = fabric(k + "_shorts", lin("#1e2338"), sheen=0.45)
    return dict(
        jersey=[fabric(k + "_jersey", cloth), white],
        shorts=[navy, fabric(k + "_stripe", cloth), white],
        socks=[white, fabric(k + "_sockstripe", tc)],
        band=[fabric(k + "_band", tc)],
        number=[fabric(k + "_number", lin("#ffffff"), rough=0.45, sheen=0.1)],
        shoe=[material(k + "_shoe", lin("#f5f6f8"), rough=0.4, coat=0.3), material(k + "_sole", lin("#e9ebef"), rough=0.6),
              material(k + "_shoe_accent", tc, rough=0.35, coat=0.4), material(k + "_laces", lin("#2b2f3c"), rough=0.7)],
        helmet=[material(k + "_helmet", tc, rough=0.22, coat=1.0)],
        visor=[visor_material(k + "_visor", team)],
        trim=[material(k + "_trim", lin("#f6f7f9"), rough=0.25, coat=0.8)],
    )


def visor_material(name, team):
    """A dark, glossy visor that turns the team's colour at grazing angles."""
    m = material(name, lin("#0a1020"), rough=0.06, metal=0.4, coat=1.0)
    nt = m.node_tree
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.35
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = lin("#0a1020")
    ramp.color_ramp.elements[1].color = mixc(lin(TEAM[team]), lin("#7b5cff"), 0.35)
    ramp.color_ramp.elements[1].position = 0.9
    nt.links.new(lw.outputs["Facing"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], r1.bsdf_of(m).inputs["Base Color"])
    return m


# ---------------------------------------------------------------- the athlete: the kit
# The kit reuses the body's shapes made a little looser, cut where the cloth ends, so the cut
# edges become hems.

def band(f, region, raise_):
    """A trim: the cloth's surface raised a little, only inside region (both distance functions)."""
    def g(p):
        c = f(p)
        return smax(smax(c - F(raise_), region(p), 0.0015), -c - F(0.004), 0.001)   # a thin shell
    return g


def slab(p, o, n, depth):
    """Between the plane (o, n) and depth behind it."""
    t = (p - v3(o)) @ v3(n)
    return np.maximum(t, -t - F(depth))


def jersey_parts(J, parts):
    """The shirt, and its white trims (collar, cuffs, hem)."""
    Rp, pc, nk, hd = J["Rp"], J["pc"], J["neck"], J["head"]
    hem = (pc + Rp @ Vector((0, 0, -0.04)), Rp @ Vector((0, 0, -1)))
    ax = (hd - nk).normalized()
    hole = (nk - ax * 0.08, hd + ax * 0.05)
    sleeves = {}
    for side in ("L", "R"):
        S = J[side]
        d1 = (S["el"] - S["sh"]).normalized()
        sleeves[side] = (S["sh"] + d1 * 0.14, d1)

    def f(p):
        d = parts["torso"](p, inflate=0.008, neck=False)
        d = smin(d, sd_ellipsoid(p, J["chest"] + J["Rm"] @ Vector((0.014, 0, -0.01)), (0.108, 0.15, 0.21), J["Rm"]), 0.05)  # hangs straight from the chest
        for side in ("L", "R"):
            o, n = sleeves[side]
            arm = smax(parts["upper_arm"](p, side, inflate=0.007), sd_plane(p, o, n), 0.004)
            d = smin(d, arm, 0.03 * near(p, J[side]["sh"], 0.15))
        d = smax(d, sd_plane(p, *hem), 0.004)
        return smax(d, -sd_cone(p, hole[0], hole[1], 0.075, 0.075), 0.008)

    def trims(p):
        rel = p - v3(nk)
        along = rel @ v3(ax)
        r = norm(rel - along[:, None] * v3(ax)[None, :])
        region = smax(np.abs(r - F(0.084)) - F(0.0085), F(-0.1) - along, 0.004)
        for side in ("L", "R"):
            o, n = sleeves[side]
            S = J[side]
            near_arm = sd_cone(p, S["sh"], S["el"], 0.074, 0.074)
            region = np.minimum(region, smax(slab(p, o, n, 0.018), near_arm, 0.004))
        region = np.minimum(region, slab(p, hem[0], hem[1], 0.022))
        return region

    return f, band(f, trims, 0.0018)


def shorts_parts(J, parts):
    """The shorts; their team-coloured waistband and side stripes; their white hems."""
    Rp, pc = J["Rp"], J["pc"]
    top = (pc + Rp @ Vector((0, 0, 0.07)), Rp @ Vector((0, 0, 1)))
    hems, stripes = {}, {}
    for side in ("L", "R"):
        S = J[side]
        d = (S["kn"] - S["hip"]).normalized()
        hems[side] = (S["hip"] + d * 0.28, d)
        out = (S["hip"] - pc)
        out = (out - out.dot(d) * d).normalized()
        stripes[side] = (S["hip"], d.cross(out).normalized(), out)

    def f(p):
        d = parts["torso"](p, inflate=0.015, chest=False, neck=False)
        d = smin(d, sd_ellipsoid(p, pc + Rp @ Vector((0.0, 0, -0.105)), (0.1, 0.13, 0.075), Rp) - F(0.012), 0.04)   # cloth between the legs
        for side in ("L", "R"):
            o, n = hems[side]
            t = smax(parts["thigh"](p, side, inflate=0.018, flare=0.02), sd_plane(p, o, n), 0.004)
            d = smin(d, t, 0.03 * near(p, J[side]["hip"], 0.16))
        return smax(d, sd_plane(p, *top), 0.004)

    def colour(p):
        region = slab(p, top[0], top[1], 0.034)
        for side in ("L", "R"):
            o, n, out = stripes[side]
            q = p - v3(o)
            stripe = smax(np.abs(q @ v3(n)) - F(0.012), -(q @ v3(out)), 0.002)
            region = np.minimum(region, stripe)
        return region

    def whites(p):
        region = None
        for side in ("L", "R"):
            o, n = hems[side]
            r = slab(p, o, n, 0.016)
            region = r if region is None else np.minimum(region, r)
        return region

    return f, band(f, colour, 0.0015), band(f, whites, 0.0017)


def sock_parts(J, parts, side):
    S = J[side]
    d = (S["an"] - S["kn"]).normalized()
    top = (S["an"] - d * 0.16, -d)

    def f(p):
        s = smax(parts["shin"](p, side, inflate=0.0035), sd_plane(p, *top), 0.003)
        return smax(s, sd_plane(p, S["an"] + d * 0.03, d), 0.003)

    def regions(fc, fn):
        t = -((fc - v3(top[0])) @ v3(top[1]))            # depth below the sock's top
        return (((t > 0.012) & (t < 0.022)) | ((t > 0.032) & (t < 0.042))).astype(np.int32)
    return f, regions


def wristband_sdf(J, parts, side):
    S = J[side]
    d2 = (S["wr"] - S["el"]).normalized()

    def f(p):
        w = parts["forearm"](p, side) - F(0.0068)
        w = smax(w, sd_plane(p, S["wr"] + d2 * 0.006, d2), 0.003)
        return smax(w, sd_plane(p, S["wr"] - d2 * 0.058, -d2), 0.003)
    return f


DIGITS = {           # strokes in a box 0.6 wide and 1 tall (u to the right, v up)
    "1": [((0.32, 0.0), (0.32, 1.0)), ((0.32, 1.0), (0.1, 0.82))],
    "4": [((0.46, 0.0), (0.46, 1.0)), ((0.46, 1.0), (0.0, 0.33)), ((0.0, 0.33), (0.62, 0.33))],
    "7": [((0.0, 1.0), (0.62, 1.0)), ((0.62, 1.0), (0.2, 0.0))],
}


def strokes_2d(u, v, text, h, w):
    d = np.full(len(u), 1.0, F)
    adv = 0.8 * h
    x0 = -(len(text) * adv - 0.18 * h) / 2
    for i, ch in enumerate(text):
        for (ax, ay), (bx, by) in DIGITS[ch]:
            a = (x0 + i * adv + ax * h, (ay - 0.5) * h)
            b = (x0 + i * adv + bx * h, (by - 0.5) * h)
            pu, pv = u - F(a[0]), v - F(a[1])
            bu, bv = b[0] - a[0], b[1] - a[1]
            t = np.clip((pu * F(bu) + pv * F(bv)) / F(bu * bu + bv * bv), 0, 1)
            d = np.minimum(d, np.sqrt((pu - t * F(bu)) ** 2 + (pv - t * F(bv)) ** 2))
    return d - F(w / 2)


def number_sdf(J, jersey_f, text):
    Rc = J["Rc"]
    centre = J["chest"] + Rc @ Vector((-0.1, 0, 0.115))
    u_ax, v_ax, back = Rc @ Vector((0, -1, 0)), Rc @ Vector((0, 0, 1)), Rc @ Vector((-1, 0, 0))

    def f(p):
        q = p - v3(centre)
        d2 = strokes_2d(q @ v3(u_ax), q @ v3(v_ax), text, 0.19, 0.036)
        dec = smax(jersey_f(p) - F(0.0024), d2, 0.0012)
        return smax(dec, F(-0.05) - q @ v3(back), 0.004)
    return f, centre


def shoe_sdf(p):
    """A chunky sneaker in the foot's frame: origin at the ankle, X forward, the sole on the ground."""
    sole = sd_box(p, (0.06, 0, -0.06), (0.137, 0.051, 0.0125), r=0.011)
    heel = sd_ellipsoid(p, (-0.03, 0, -0.028), (0.054, 0.044, 0.05))
    mid = sd_ellipsoid(p, (0.06, 0, -0.033), (0.1, 0.049, 0.042))
    toe = sd_ellipsoid(p, (0.145, 0, -0.046), (0.064, 0.048, 0.029))
    collar = sd_cone(p, (-0.012, 0, -0.04), (-0.014, 0, 0.014), 0.046, 0.042)
    d = smin(smin(smin(smin(heel, mid, 0.035), toe, 0.035), collar, 0.02), sole, 0.006)
    return smax(d, -sd_cone(p, (-0.014, 0, -0.01), (-0.016, 0, 0.08), 0.034, 0.034), 0.004)


def shoe_regions(fc, fn):
    idx = np.zeros(len(fc), np.int32)
    x, y, z = fc[:, 0], fc[:, 1], fc[:, 2]
    idx[z < -0.058] = 1
    idx[(z >= -0.058) & (z < -0.049)] = 2
    stripe = (np.abs(y) > 0.03) & (np.abs((x - 0.03) + 1.3 * (z + 0.03)) < 0.012) & (z > -0.049) & (z < -0.0)
    idx[stripe] = 2
    idx[(z > -0.03) & (x > 0.005) & (x < 0.115) & (np.abs(y) < 0.021) & (fn[:, 2] > 0.55)] = 3
    idx[(x < -0.07) & (z > -0.045) & (np.abs(y) < 0.016)] = 2      # heel tab
    return idx


# ---------------------------------------------------------------- the athlete: poses
# Where the hands (or a held ball) and the feet go, and which way elbows and knees point; IK does
# the rest. Turns are (yaw, lean forward, tilt right) in degrees. All face +X.

POSES2 = {
    "windup": dict(root=(-0.05, 0.02, -0.09), pelvis=(-50, 0, 0), chest=(-35, 0, 12), head=(80, 0, -10),
                   R=dict(ball=(-0.38, -0.05, 1.7), elbow=(-0.5, 0, -0.8), point=(-0.2, 0, 1), palm=(1, 0, 0.1), grip="ball"),
                   L=dict(hand=(0.62, 0.05, 1.38), elbow=(0, -0.2, -1), point=(1, 0, -0.05), palm=(0.3, -0.2, -1), grip="open"),
                   Lfoot=dict(at=(0.3, 0.12), yaw=-20, knee=(1, -0.2, 0)),
                   Rfoot=dict(at=(-0.38, -0.12), yaw=-80, knee=(0.3, -1, 0))),
    "release": dict(root=(0.06, 0.0, -0.11), pelvis=(25, 10, 0), chest=(28, 16, -6), head=(-32, -14, 4),
                    R=dict(hand=(0.56, 0.12, 1.12), elbow=(0.2, -1, -0.4), point=(0.9, 0.25, -0.35), palm=(0.2, 0.6, -1), grip="open"),
                    L=dict(hand=(-0.22, 0.34, 1.02), elbow=(-0.6, 0.5, -0.6), point=(-0.4, 0.2, -0.9), palm=(0.3, -1, 0), grip="relax"),
                    Lfoot=dict(at=(0.36, 0.12), yaw=12, knee=(1, 0.1, 0)),
                    Rfoot=dict(at=(-0.42, -0.14), yaw=-10, pitch=48, knee=(1, -0.1, 0))),
    "run": dict(root=(0.0, 0.0, -0.035), pelvis=(-8, 8, 0), chest=(16, 6, 0), head=(-8, -8, 0),
                R=dict(hand=(-0.26, -0.24, 0.98), elbow=(-1, -0.2, 0.4), point=(-0.3, 0.1, -0.9), palm=(0, 1, 0), grip="fist"),
                L=dict(hand=(0.28, 0.17, 1.2), elbow=(-0.4, 0.3, -0.8), point=(0.5, -0.4, 0.6), palm=(-0.3, -1, 0), grip="fist"),
                Rfoot=dict(at=(0.36, -0.1), pitch=-14, lift=0.05, knee=(1, 0, 0.3)),
                Lfoot=dict(at=(-0.3, 0.1), pitch=62, lift=0.26, knee=(1, 0, -0.4))),
    "ready": dict(root=(0.02, 0.0, -0.15), pelvis=(0, 20, 0), chest=(0, 10, 0), head=(0, -24, 0),
                  L=dict(hand=(0.44, 0.21, 1.05), elbow=(-0.2, 0.8, -0.6), point=(0.7, 0.25, 0.65), palm=(1, -0.3, -0.2), grip="open"),
                  R=dict(hand=(0.44, -0.21, 1.05), elbow=(-0.2, -0.8, -0.6), point=(0.7, -0.25, 0.65), palm=(1, 0.3, -0.2), grip="open"),
                  Lfoot=dict(at=(0.06, 0.25), yaw=14, knee=(1, 0.35, 0)),
                  Rfoot=dict(at=(-0.06, -0.25), yaw=-16, knee=(1, -0.35, 0))),
    "catch": dict(root=(0.0, 0.0, -0.08), pelvis=(0, 6, 0), chest=(0, -4, 0), head=(0, 8, 0),
                  L=dict(hand=(0.47, 0.12, 1.3), elbow=(-0.2, 1, -0.8), point=(0.55, -0.25, 0.8), palm=(1, -0.45, 0.1), grip="open"),
                  R=dict(hand=(0.47, -0.12, 1.3), elbow=(-0.2, -1, -0.8), point=(0.55, 0.25, 0.8), palm=(1, 0.45, 0.1), grip="open"),
                  Lfoot=dict(at=(0.2, 0.15), yaw=6, knee=(1, 0.2, 0)),
                  Rfoot=dict(at=(-0.22, -0.17), yaw=-22, pitch=16, knee=(1, -0.2, 0))),
    "dodge": dict(root=(0.0, 0.2, -0.13), pelvis=(10, 0, -14), chest=(-5, 6, -12), head=(0, 0, 14),
                  L=dict(hand=(0.1, 0.64, 1.18), elbow=(-0.5, 0.2, -1), point=(0.2, 0.9, 0.2), palm=(0.1, 0, -1), grip="open"),
                  R=dict(hand=(0.16, -0.38, 1.32), elbow=(-0.3, -0.3, -1), point=(0.3, -0.8, 0.4), palm=(0.2, 0, -1), grip="open"),
                  Lfoot=dict(at=(0.06, 0.54), yaw=28, knee=(1, 0.35, 0)),
                  Rfoot=dict(at=(0.0, -0.24), yaw=-12, pitch=28, knee=(1, -0.2, 0))),
    "stand": dict(root=(0, 0, -0.01), pelvis=(8, 0, 3), chest=(-6, -2, -4), head=(8, 3, 5),
                  L=dict(hand=(0.03, 0.27, 0.88), elbow=(-1, 0.3, 0), point=(0.1, 0.05, -1), palm=(0, -1, 0), grip="relax"),
                  R=dict(hand=(0.02, -0.27, 0.88), elbow=(-1, -0.3, 0), point=(0.1, -0.05, -1), palm=(0, 1, 0), grip="relax"),
                  Lfoot=dict(at=(0.04, 0.15), yaw=14), Rfoot=dict(at=(-0.04, -0.12), yaw=-16)),
}


def mirrored(P):
    """The same pose for the other hand: left and right swapped across the athlete's middle."""
    def v(t):
        return (t[0], -t[1]) + tuple(t[2:])

    def turn(t):
        return (-t[0], t[1], -t[2])
    Q = {k: (v(P[k]) if k == "root" else turn(P[k])) for k in ("root", "pelvis", "chest", "head") if k in P}
    for a, b in (("L", "R"), ("R", "L")):
        Q[b] = {k: (v(x) if isinstance(x, tuple) else x) for k, x in P[a].items()}
        F_ = dict(P[a + "foot"])
        F_["at"] = v(F_["at"])
        if "yaw" in F_:
            F_["yaw"] = -F_["yaw"]
        if "knee" in F_:
            F_["knee"] = v(F_["knee"])
        Q[b + "foot"] = F_
    return Q


POSES2["windup_left"] = mirrored(POSES2["windup"])


# ---------------------------------------------------------------- the athlete, assembled

CACHE = {}


def cached(key, build):
    if key not in CACHE:
        CACHE[key] = build()
    return CACHE[key]


def mesh_data(name, f, lo, hi, h, mats, regions=None, colors=None):
    o = mesh_from_sdf(name, f, lo, hi, h, None, mats, regions=regions, colors=colors)
    data = o.data
    bpy.data.objects.remove(o)
    return data


def put(coll, name, data, M, root, mats):
    o = bpy.data.objects.new(name, data)
    coll.objects.link(o)
    o.parent = root
    o.matrix_basis = M
    for i, m in enumerate(mats):
        o.material_slots[i].link = "OBJECT"
        o.material_slots[i].material = m
    return o


MIRROR_Y = Matrix.Diagonal((1, -1, 1, 1))
HEAD_SCALE = 1.06                  # heroic proportions: a slightly larger head on the broad body


def eyeball_data(mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0)
    me = bpy.data.meshes.new("eyeball")
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    me.materials.append(mat)
    return me


def athlete2(name, coll, pose, team, loc, yaw, head="face", look=None, number="7", ball_mat=None):
    """One athlete: the body and kit for the pose, the rigid parts (hands, shoes, head) placed on it."""
    look = look or LOOKS2[0]
    K = cached(("kit", team), lambda: kit_materials(team))
    skin = cached(("skin", look["skin"]), lambda: skin_material(f"skin_{look['skin']}", look["skin"]))
    J, parts = cached(("pose", pose), lambda: (lambda J: (J, body_parts(J)))(pose_skeleton(POSES2[pose])))
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    root.location = loc
    root.rotation_euler = (0, 0, radians(yaw))
    I = Matrix.Identity(4)
    lo, hi = skeleton_box(J)
    put(coll, name + "_body", cached(("body", pose), lambda: mesh_data(f"body_{pose}", parts["body"], lo, hi, 0.0048, [skin])), I, root, [skin])
    jf, jt = jersey_parts(J, parts)
    put(coll, name + "_jersey", cached(("jersey", pose), lambda: mesh_data(f"jersey_{pose}", jf, lo, hi, 0.0045, K["jersey"][:1])), I, root, K["jersey"][:1])
    put(coll, name + "_jersey_trim", cached(("jtrim", pose), lambda: mesh_data(f"jersey_trim_{pose}", jt, lo, hi, 0.0022, K["jersey"][1:])), I, root, K["jersey"][1:])
    sf, sc_, sw = shorts_parts(J, parts)
    slo2, shi2 = [J["pc"][i] - 0.36 for i in range(3)], [J["pc"][i] + 0.36 for i in range(3)]
    put(coll, name + "_shorts", cached(("shorts", pose), lambda: mesh_data(f"shorts_{pose}", sf, slo2, shi2, 0.0045, K["shorts"][:1])), I, root, K["shorts"][:1])
    put(coll, name + "_shorts_stripe", cached(("sstripe", pose), lambda: mesh_data(f"shorts_stripe_{pose}", sc_, slo2, shi2, 0.0022, K["shorts"][1:2])), I, root, K["shorts"][1:2])
    put(coll, name + "_shorts_hem", cached(("shem", pose), lambda: mesh_data(f"shorts_hem_{pose}", sw, slo2, shi2, 0.0022, K["shorts"][2:3])), I, root, K["shorts"][2:3])
    nf, nc = number_sdf(J, jf, number)
    nlo, nhi = [nc[i] - 0.17 for i in range(3)], [nc[i] + 0.17 for i in range(3)]
    put(coll, name + "_number", cached(("number", pose, number), lambda: mesh_data(f"number_{pose}_{number}", nf, nlo, nhi, 0.0028, K["number"])), I, root, K["number"])
    for side in ("L", "R"):
        S = J[side]
        kf, kr = sock_parts(J, parts, side)
        slo = [min(S["kn"][i], S["an"][i]) - 0.1 for i in range(3)]
        shi = [max(S["kn"][i], S["an"][i]) + 0.1 for i in range(3)]
        put(coll, name + "_sock" + side, cached(("sock", pose, side), lambda: mesh_data(f"sock_{pose}_{side}", kf, slo, shi, 0.002, K["socks"], kr)), I, root, K["socks"])
        wf = wristband_sdf(J, parts, side)
        wlo, whi = [S["wr"][i] - 0.1 for i in range(3)], [S["wr"][i] + 0.1 for i in range(3)]
        put(coll, name + "_band" + side, cached(("band", pose, side), lambda: mesh_data(f"band_{pose}_{side}", wf, wlo, whi, 0.0025, K["band"])), I, root, K["band"])
        g = S["grip"]
        hand = cached(("hand", g), lambda: mesh_data(f"hand_{g}", *hand_sdf(g), 0.0016, [skin]))
        put(coll, name + "_hand" + side, hand, Matrix.Translation(S["wr"]) @ S["Rhand"].to_4x4(), root, [skin])
        shoe = cached("shoe", lambda: mesh_data("shoe", shoe_sdf, (-0.11, -0.07, -0.09), (0.23, 0.07, 0.03), 0.0026, K["shoe"], shoe_regions))
        M = Matrix.Translation(S["an"]) @ S["Rfoot"].to_4x4()
        put(coll, name + "_shoe" + side, shoe, M @ MIRROR_Y if side == "L" else M, root, K["shoe"])
        if S["ball"] is not None and ball_mat is not None:
            b = r1.sphere(name + "_ball", coll, r1.affine(S["ball"], None, (0.15, 0.15, 0.15)), ball_mat, smooth_levels=2)
            b.parent = root
    H = Matrix.Translation(J["head"]) @ J["Rh"].to_4x4() @ Matrix.Scale(HEAD_SCALE, 4)
    lo, hi = HEAD_BOX
    headm = cached("head", lambda: mesh_data("head", head_sdf, lo, hi, 0.0021, [skin], colors=head_colors))
    put(coll, name + "_head", headm, H, root, [skin])
    if head == "face":
        hair = cached(("hairmat", look["hair"]), lambda: hair_material(f"hair_{look['hair']}", look["hair"]))
        eye = cached(("eyemat", look["iris"]), lambda: eye_material(f"eye_{look['iris']}", look["iris"]))
        lash = cached("lashmat", lambda: material("lash", lin("#1a100b"), rough=0.6))
        put(coll, name + "_hair", cached("hair", lambda: mesh_data("hair", hair_sdf, (-0.14, -0.11, -0.03), (0.13, 0.11, 0.24), 0.0018, [hair])), H, root, [hair])
        put(coll, name + "_brows", cached("brows", lambda: mesh_data("brows", brows_sdf, (0.06, -0.07, 0.05), (0.12, 0.07, 0.1), 0.0012, [hair])), H, root, [hair])
        put(coll, name + "_lashes", cached("lashes", lambda: mesh_data("lashes", lashes_sdf, (0.06, -0.06, 0.04), (0.1, 0.06, 0.075), 0.0006, [lash])), H, root, [lash])
        ball_eye = cached("eyeball", lambda: eyeball_data(eye))
        for s in (1, -1):
            gaze = Matrix.Rotation(-s * math.atan2(EYE[1], 1.4), 4, "Z")
            put(coll, name + "_eye", ball_eye, H @ Matrix.Translation((EYE[0], s * EYE[1], EYE[2])) @ gaze @ Matrix.Diagonal((EYE_R, EYE_R, EYE_R, 1)), root, [eye])
    else:
        put(coll, name + "_helmet", cached("helmet", lambda: mesh_data("helmet", helmet_sdf, (-0.15, -0.12, -0.1), (0.16, 0.12, 0.22), 0.0025, K["helmet"])), H, root, K["helmet"])
        put(coll, name + "_visor", cached("visor", lambda: mesh_data("visor", visor_sdf, (0.0, -0.12, 0.0), (0.16, 0.12, 0.11), 0.0018, K["visor"])), H, root, K["visor"])
        put(coll, name + "_stripe", cached("stripe", lambda: mesh_data("stripe", stripe_sdf, (-0.16, -0.03, 0.0), (0.16, 0.03, 0.22), 0.0018, K["trim"])), H, root, K["trim"])
        put(coll, name + "_trim", cached("trim", lambda: mesh_data("trim", trim_sdf, (-0.06, -0.13, -0.02), (0.16, 0.13, 0.12), 0.0018, K["trim"])), H, root, K["trim"])
    return root


# Skin, hair and eyes for the athletes (the same athlete; only these change between players)
LOOKS2 = [
    dict(skin="#e3ab82", hair="#3a2418", iris="#7a5230"),
    dict(skin="#9a6440", hair="#1a1410", iris="#4a2e1a"),
    dict(skin="#f0c4a0", hair="#c8903e", iris="#3f7a9a"),
    dict(skin="#c48a5c", hair="#2a1a12", iris="#5a3a20"),
    dict(skin="#6e4329", hair="#141010", iris="#3a2414"),
    dict(skin="#dba57c", hair="#5a3520", iris="#4f7a3a"),
]


# ---------------------------------------------------------------- the hall in vibrant colour and light

HALL_L, HALL_W, HALL_H = 32.0, 25.0, 17.0      # the hall inside: half length, half width, height
SUN_EL, SUN_AZ = 24.0, 101.5                  # a low sun from the left, a little behind (the game's camera looks along +X)
WIN_PITCH, WIN_WIDE, WIN_Z = 5.2, 3.0, (5.2, HALL_H - 1.6, 10.6)   # the left wall's tall windows: spacing, width, bottom/top/transom
BEAM_GLOW = 0.06                              # how bright the sunbeams glow
PALETTE = ["#16c4b4", "#ffc93c", "#6dd04e", "#8b6cff", "#ff9f43"]   # teal, sunflower, leaf, violet, tangerine


def to_sun():
    el, az = radians(SUN_EL), radians(SUN_AZ)
    return Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))


def planks(name, c1, c2, along="X", width=0.14, length=2.4, rough=0.24, coat=0.65, mortar="#a8733f"):
    """Wooden boards: a brick pattern for the planks, with grain on top."""
    m = material(name, lin(c1), rough=rough, coat=coat)
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    if along == "Y":
        mp.inputs["Rotation"].default_value = (0, 0, radians(90))
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.offset = 0.37
    br.squash_frequency = 1
    br.inputs["Color1"].default_value = lin(c1)
    br.inputs["Color2"].default_value = lin(c2)
    br.inputs["Mortar"].default_value = lin(mortar)
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Mortar Size"].default_value = 0.004
    br.inputs["Bias"].default_value = 0.0
    br.inputs["Brick Width"].default_value = length
    br.inputs["Row Height"].default_value = width
    nt.links.new(mp.outputs["Vector"], br.inputs["Vector"])
    grain = nt.nodes.new("ShaderNodeTexWave")
    grain.inputs["Scale"].default_value = 2.2
    grain.inputs["Distortion"].default_value = 3.0
    grain.inputs["Detail"].default_value = 3.0
    nt.links.new(mp.outputs["Vector"], grain.inputs["Vector"])
    c = mix_color(nt, r1.mnode(nt, "MULTIPLY", grain.outputs["Fac"], 0.22), br.outputs["Color"], lin(c2, 0.82))
    nt.links.new(c, r1.bsdf_of(m).inputs["Base Color"])
    return m


def hall2_materials():
    M = dict(
        floor=planks("h2_floor", "#efb46c", "#dc9a52", rough=0.3, coat=0.4),
        ceiling=planks("h2_ceiling", "#e0a362", "#c98a4c", along="Y", width=0.2, length=4.0, rough=0.6, coat=0.0),
        beam=planks("h2_beam", "#d4914c", "#c4803e", width=0.12, length=8.0, rough=0.5, coat=0.1, mortar="#b07038"),
        # satin paint: a mirror-like court would reflect the bright windows and wash the far half out
        red=material("h2_paint_red", mixc(lin(TEAM["red"]), lin("#8a1218"), 0.32), rough=0.42, coat=0.12),
        blue=material("h2_paint_blue", mixc(lin(TEAM["blue"]), lin("#0b2470"), 0.55), rough=0.42, coat=0.12),
        line=material("h2_line", lin("#ffffff"), rough=0.3, coat=0.6),
        wall=material("h2_wall", lin("#fbeedd"), rough=0.85),
        wall_low=material("h2_wall_low", lin("#1fb3a6"), rough=0.7),
        frame=material("h2_frame", lin("#fbfaf6"), rough=0.35, coat=0.3),
        seat=material("h2_seat", lin("#2c3550"), rough=0.6),
        dark=material("h2_dark", lin("#1d2232"), rough=0.5),
        pot=material("h2_pot", lin("#f7f3ec"), rough=0.5, coat=0.2),
        terracotta=material("h2_terracotta", lin("#d9774e"), rough=0.7),
        trunk=material("h2_trunk", lin("#8a5a36"), rough=0.8),
    )
    M["pal"] = [material(f"h2_pal{i}", lin(c), rough=0.5, coat=0.25) for i, c in enumerate(PALETTE)]
    M["leaf"] = [material(f"h2_leaf{i}", lin(c), rough=0.6, sheen=0.4) for i, c in enumerate(("#3fae4a", "#5cc451", "#2e9a52", "#86d45a", "#4dbb6a"))]
    M["crowd"] = [material(f"h2_crowd{i}", lin(c), rough=0.7) for i, c in enumerate(
        (TEAM["red"], TEAM["blue"], "#ffd23f", "#f4f4f4", "#16c4b4", "#ff9f43", "#8b6cff", "#2b2f3a", "#6dd04e"))]
    return M


def blobs(name, coll, centres, radii, mats, seed=1, sub=1):
    """Many small round shapes (leaves, clouds) as one mesh: copied from one template, which is fast."""
    tb = bmesh.new()
    bmesh.ops.create_icosphere(tb, subdivisions=sub, radius=1.0)
    tb.verts.index_update()
    tv = [v.co.copy() for v in tb.verts]
    tf = [[v.index for v in f.verts] for f in tb.faces]
    tb.free()
    rnd = np.random.default_rng(seed)
    verts, faces, mi = [], [], []
    for c, r in zip(centres, radii):
        base = len(verts)
        sx, sy, sz = (r * k for k in rnd.uniform(0.85, 1.15, 3))
        verts.extend((c[0] + v.x * sx, c[1] + v.y * sy, c[2] + v.z * sz) for v in tv)
        faces.extend([base + i for i in f] for f in tf)
        mi.extend([int(rnd.integers(len(mats)))] * len(tf))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    me.polygons.foreach_set("material_index", mi)
    me.shade_smooth()
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return o


def window_wall(coll, M, axis, at, span, z0, z1, pitch, transom, name):
    """A wall of big windows: frames and mullions only, open to the sky, so sunlight comes through."""
    a, b = span
    n = max(1, round((b - a) / pitch))
    xs = [a + (b - a) * i / n for i in range(n + 1)]
    t = 0.45

    def bx(nm, size_along, size_z, along, z, thick=t):
        if axis == "y":       # a wall at y = at, running along X
            return box(nm, coll, (size_along, thick, size_z), (along, at, z), M["frame"])
        return box(nm, coll, (thick, size_along, size_z), (at, along, z), M["frame"])

    for x in xs:
        bx(name + "_mullion", 0.24, z1 - z0, x, (z0 + z1) / 2)
    for z in (z0 + 0.12, transom, z1 - 0.12):
        bx(name + "_transom", b - a, 0.24, (a + b) / 2, z)
    return xs


def left_windows():
    n = int((2 * HALL_L - 2) // WIN_PITCH)
    return n, -(n * WIN_PITCH) / 2


def sunbeams(coll):
    """Soft shafts of light from each window pane, along the sun: what a browser game would draw
    instead of real light in haze. They glow additively and fade towards the floor and at their edges."""
    m = bpy.data.materials.new("h2_sunbeam")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = lin("#ffd796")
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "fade"
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    edge = r1.mnode(nt, "POWER", r1.mnode(nt, "SUBTRACT", 1.0, lw.outputs["Facing"], clamp=True), 3.0)
    strength = r1.mnode(nt, "MULTIPLY", r1.mnode(nt, "MULTIPLY", at.outputs["Fac"], edge), BEAM_GLOW)
    nt.links.new(strength, em.inputs["Strength"])
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(em.outputs[0], add.inputs[0])
    nt.links.new(nt.nodes.new("ShaderNodeBsdfTransparent").outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    m.surface_render_method = "BLENDED"
    m.use_backface_culling = False
    d = -to_sun()
    n, x0 = left_windows()
    y = HALL_W + 0.02
    verts, faces, fade = [], [], []
    z0, z1, zt = WIN_Z
    for i in range(n):
        xc = x0 + (i + 0.5) * WIN_PITCH
        for xa, xb in ((xc - WIN_WIDE / 2 + 0.12, xc - 0.12), (xc + 0.12, xc + WIN_WIDE / 2 - 0.12)):
            for za, zb in ((z0 + 0.24, zt - 0.12), (zt + 0.12, z1 - 0.24)):
                base = len(verts)
                for x, z in ((xa, za), (xb, za), (xb, zb), (xa, zb)):
                    w = Vector((x, y, z))
                    verts.append(tuple(w))
                    verts.append(tuple(w + d * (z / -d.z)))
                    fade += [1.0, 0.0]          # gone by the floor, so the shafts don't veil the players
                for k in range(4):
                    a, b = base + 2 * k, base + 2 * ((k + 1) % 4)
                    faces.append((a, b, b + 1, a + 1))
    me = bpy.data.meshes.new("sunbeams")
    me.from_pydata(verts, [], faces)
    me.update()
    me.attributes.new("fade", "FLOAT", "POINT").data.foreach_set("value", fade)
    me.materials.append(m)
    o = bpy.data.objects.new("sunbeams", me)
    coll.objects.link(o)
    o.visible_shadow = False
    return o


def env_hall2(coll, M):
    L, W, H = HALL_L, HALL_W, HALL_H
    box("floor", coll, (2 * L + 1, 2 * W + 1, 0.2), (0, 0, -0.1), M["floor"])
    box("half_red", coll, (HALF_L - 1.0, 2 * HALF_W, 0.004), (-(HALF_L + 1.0) / 2, 0, 0.002), M["red"])
    box("half_blue", coll, (HALF_L - 1.0, 2 * HALF_W, 0.004), ((HALF_L + 1.0) / 2, 0, 0.002), M["blue"])
    r1.court_lines(coll, M["line"], M["line"], M["line"])
    r1.torus("centre_circle", coll, 3.0, 0.05, r1.affine((0, 0, 0.006), None, (1, 1, 0.12)), M["line"], seg=96, ring=6)
    for s in (-1, 1):                          # padded side boards in the palette
        y = s * (HALF_W + 0.5)
        for i in range(8):
            x = -HALF_L + (i + 0.5) * (2 * HALF_L / 8)
            box("board", coll, (2 * HALF_L / 8 - 0.05, 0.25, 1.1), (x, y, 0.55), M["pal"][(i + (s > 0)) % len(PALETTE)], bevel=0.05)
    for sx, team in ((-1, "red"), (1, "blue")):
        x = sx * (HALF_L + 0.7)
        box("endwall", coll, (0.4, 2 * HALF_W + 1.0, 2.4), (x, 0, 1.2), M[team], bevel=0.08)
        box("endstripe", coll, (0.42, 2 * HALF_W + 1.0, 0.22), (x, 0, 1.6), M["line"])
    r1.stands_and_crowd(coll, M["seat"], M["crowd"], rows=8, start=3.2, base=0.6, seed=9)
    for s in (-1, 1):                          # the stands' fronts and rails in the palette
        y = s * (HALF_W + 3.2)
        box("stand_front", coll, (2 * HALF_L + 12, 0.12, 0.7), (0, y, 0.35), M["pal"][0 if s > 0 else 1])
    # the walls: big windows on the left (+Y) and over the far end (+X); warm cream elsewhere
    box("wall_left_low", coll, (2 * L, 0.5, 5.2), (0, W + 0.25, 2.6), M["wall_low"])
    box("wall_left_top", coll, (2 * L, 0.5, 1.6), (0, W + 0.25, H - 0.8), M["wall"])
    pitch, wide = WIN_PITCH, WIN_WIDE          # tall windows between solid piers: the sun comes in shafts
    n, x0 = left_windows()
    box("pier", coll, (L + x0 + 0.01, 0.5, H - 6.8), (-L + (L + x0) / 2, W + 0.25, 5.2 + (H - 6.8) / 2), M["wall"])
    box("pier", coll, (L + x0 + 0.01, 0.5, H - 6.8), (L - (L + x0) / 2, W + 0.25, 5.2 + (H - 6.8) / 2), M["wall"])
    for i in range(n):
        xc = x0 + (i + 0.5) * pitch
        if i < n - 1:
            box("pier", coll, (pitch - wide, 0.5, H - 6.8), (xc + pitch / 2, W + 0.25, 5.2 + (H - 6.8) / 2), M["wall"])
        window_wall(coll, M, "y", W + 0.25, (xc - wide / 2, xc + wide / 2), WIN_Z[0], WIN_Z[1], wide / 2, WIN_Z[2], "win_left")
    box("wall_right", coll, (2 * L, 0.5, H), (0, -W - 0.25, H / 2), M["wall"])
    box("wall_right_band", coll, (2 * L, 0.2, 5.2), (0, -W + 0.05, 2.6), M["wall_low"])
    for i in range(7):                         # tall banners in the palette on the right wall
        box("banner", coll, (3.2, 0.12, 6.5), (-24 + i * 8, -W + 0.2, 10.5), M["pal"][i % len(PALETTE)])
        box("banner_tip", coll, (3.2, 0.13, 0.5), (-24 + i * 8, -W + 0.21, 7.1), M["line"])
    box("wall_near", coll, (0.5, 2 * W, H), (-L - 0.25, 0, H / 2), M["wall"])
    box("wall_far_low", coll, (0.5, 2 * W, 6.5), (L + 0.25, 0, 3.25), M["wall"])
    box("wall_far_top", coll, (0.5, 2 * W, 1.6), (L + 0.25, 0, H - 0.8), M["wall"])
    box("wall_far_side", coll, (0.5, 1.6, H - 8.1), (L + 0.25, W - 0.8, 6.5 + (H - 8.1) / 2), M["wall"])
    box("wall_far_side", coll, (0.5, 1.6, H - 8.1), (L + 0.25, -W + 0.8, 6.5 + (H - 8.1) / 2), M["wall"])
    window_wall(coll, M, "x", L + 0.25, (-W + 1.6, W - 1.6), 6.5, H - 1.6, 3.0, 11.2, "win_far")
    # a scoreboard in the team colours, and a living green wall either side of it
    box("score_frame", coll, (0.4, 8.4, 3.2), (L - 0.3, 0, 4.2), M["dark"], bevel=0.08)
    for y, team in ((1.9, "red"), (-1.9, "blue")):
        box("score_" + team, coll, (0.05, 3.4, 2.2), (L - 0.52, y, 4.25), material(f"h2_score_{team}", (0, 0, 0, 1), emit=lin(TEAM[team]), strength=3.0))
    box("score_mid", coll, (0.05, 0.25, 2.2), (L - 0.52, 0, 4.25), material("h2_score_mid", (0, 0, 0, 1), emit=lin("#ffffff"), strength=4.0))
    rnd = np.random.default_rng(4)
    cs, rs = [], []
    for y0, y1 in ((-W + 2.5, -5.2), (5.2, W - 2.5)):
        for _ in range(1400):
            cs.append((L - 0.2 + rnd.uniform(-0.1, 0.12), rnd.uniform(y0, y1), rnd.uniform(0.6, 6.0)))
            rs.append(rnd.uniform(0.18, 0.34))
    blobs("green_wall", coll, cs, rs, M["leaf"], seed=5)
    # the ceiling: warm wooden boards on glued-laminated beams
    box("ceiling", coll, (2 * L + 1, 2 * W + 1, 0.4), (0, 0, H + 0.2), M["ceiling"])
    for i in range(13):
        box("beam", coll, (0.5, 2 * W, 1.1), (-L + 2.5 + i * (2 * L - 5) / 12, 0, H - 0.55), M["beam"])
    # plants: big planters behind the blue end and in the corners, round shrubs and small trees
    rnd = np.random.default_rng(11)
    cs, rs = [], []
    spots = [(L - 2.2, y) for y in np.linspace(-W + 3, W - 3, 9)] + [(HALF_L + 4.5, s * (HALF_W + 1.6)) for s in (-1, 1)] + \
            [(-HALF_L - 4.5, s * (HALF_W + 1.6)) for s in (-1, 1)]
    for k, (x, y) in enumerate(spots):
        tall = k % 3 == 1 or k >= 9
        pot = M["pot"] if k % 2 else M["terracotta"]
        box("planter", coll, (1.4, 1.4, 0.8), (x, y, 0.4), pot, bevel=0.12)
        if tall:
            box("trunk", coll, (0.16, 0.16, 2.6), (x, y, 2.0), M["trunk"])
            for _ in range(36):
                d = rnd.normal(0, 1, 3)
                d = d / np.linalg.norm(d) * rnd.uniform(0.2, 1.0)
                cs.append((x + d[0] * 1.2, y + d[1] * 1.2, 3.6 + d[2] * 1.0))
                rs.append(rnd.uniform(0.35, 0.6))
        else:
            for _ in range(22):
                d = rnd.normal(0, 1, 3)
                d = d / np.linalg.norm(d) * rnd.uniform(0.1, 0.8)
                cs.append((x + d[0] * 0.75, y + d[1] * 0.75, 1.25 + abs(d[2]) * 0.6))
                rs.append(rnd.uniform(0.28, 0.42))
    blobs("plants", coll, cs, rs, M["leaf"], seed=12, sub=2)
    # bunting across the hall, under the beams
    for k, y in enumerate((-9, 0, 9)):
        n = 44
        for i in range(n):
            x = -L + 2 + i * (2 * L - 4) / (n - 1)
            z = H - 2.3 - 1.6 * math.sin(math.pi * i / (n - 1))
            bm = bmesh.new()
            v = [bm.verts.new(q) for q in ((x - 0.38, y, z), (x + 0.38, y, z), (x, y, z - 0.8))]
            bm.faces.new(v)
            o = r1.new_obj("flag", bm, coll, [M["pal"][(i + k) % len(PALETTE)]], smooth=False)
            o.visible_shadow = False


def outside(coll):
    """Green hills, round trees and white clouds, seen through the windows."""
    grass = material("h2_grass", lin("#63c447"), rough=0.9)
    nt = grass.node_tree
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.03
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = lin("#3fa83e")
    ramp.color_ramp.elements[1].color = lin("#9ad84a")
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], r1.bsdf_of(grass).inputs["Base Color"])
    t = r1.terrain(coll, grass, seed=5)
    t.location.z = -0.4
    t.visible_shadow = False                   # the hills must not hide the low sun from the hall
    leaves = [material(f"h2_tree{i}", lin(c), rough=0.75, sheen=0.3) for i, c in enumerate(("#3f9d4a", "#57b65a", "#2f8a5a", "#7cc65e", "#4fae3e"))]
    trunk = material("h2_trunk_out", lin("#7a5a3c"), rough=0.8)
    rnd = np.random.default_rng(21)
    cs, rs = [], []
    for _ in range(80):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(48, 140)
        x, y = math.cos(a) * r * 1.15, math.sin(a) * r
        if x < 0 and abs(y) < 30:              # nothing behind the near end
            continue
        s = rnd.uniform(1.0, 2.0)
        box("trunk_out", coll, (0.4 * s, 0.4 * s, 3.0 * s), (x, y, 1.5 * s), trunk)
        for _ in range(7):
            d = rnd.normal(0, 1, 3)
            cs.append((x + d[0] * 1.3 * s, y + d[1] * 1.3 * s, 4.2 * s + d[2] * 0.9 * s))
            rs.append(rnd.uniform(1.4, 2.2) * s)
    blobs("trees_out", coll, cs, rs, leaves, seed=22, sub=2).visible_shadow = False
    cloud = material("h2_cloud", lin("#ffffff"), rough=1.0, sheen=0.6)
    r1.bsdf_of(cloud).inputs["Emission Color"].default_value = lin("#cfe6ff")
    r1.bsdf_of(cloud).inputs["Emission Strength"].default_value = 0.35
    cs, rs = [], []
    for k in range(22):
        a = radians(rnd.uniform(-75, 165))
        r = rnd.uniform(380, 700)
        cx, cy, cz = math.cos(a) * r, math.sin(a) * r, rnd.uniform(70, 170)
        size = rnd.uniform(18, 40)
        for _ in range(int(rnd.integers(7, 13))):
            d = rnd.normal(0, 1, 3) * np.array([1.6, 1.6, 0.45])
            cs.append((cx + d[0] * size, cy + d[1] * size, cz + abs(d[2]) * size))
            rs.append(rnd.uniform(0.6, 1.1) * size)
    o = blobs("clouds", coll, cs, rs, [cloud], seed=23, sub=3)
    o.visible_shadow = False


def world_sky(sc):
    """A bright blue sky, deeper overhead, with a warm glow around the sun."""
    w = bpy.data.worlds.new("h2_sky")
    w.use_nodes = True
    nt = w.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position, cr.elements[0].color = 0.0, lin("#d7f0ff")
    cr.elements[1].position, cr.elements[1].color = 1.0, lin("#2f86ef")
    for pos, c in ((0.08, "#a9dcff"), (0.3, "#5cb2ff")):
        e = cr.elements.new(pos)
        e.color = lin(c)
    nt.links.new(r1.mnode(nt, "MAXIMUM", sep.outputs["Z"], 0.0), ramp.inputs["Fac"])
    sun = to_sun()
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.inputs[1].default_value = tuple(sun)
    nt.links.new(tc.outputs["Generated"], dot.inputs[0])
    glow = r1.mnode(nt, "POWER", r1.mnode(nt, "MAXIMUM", dot.outputs["Value"], 0.0), 24.0)
    c = mix_color(nt, r1.mnode(nt, "MULTIPLY", glow, 0.8), ramp.outputs["Color"], lin("#fff0d0"))
    nt.links.new(c, bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.5
    sc.world = w
    return w


def lights_hall2(coll, sc):
    L, W, H = HALL_L, HALL_W, HALL_H
    world_sky(sc)
    sun = add_light(coll, "sun", "SUN", (0, 0, 60), None, 15.0, "#ffd49a")
    sun.data.angle = radians(1.0)
    sun.rotation_euler = (-to_sun()).to_track_quat("-Z", "Y").to_euler()
    # cool sky light through the windows, filling the shade (no glare on the floor, no haze)
    add_light(coll, "sky_left", "AREA", (0, W - 0.2, 10.4), (0, 0, 3), 6500, "#9cccff", size=2 * L - 2, size_y=10, haze=0.0, shine=0.0)
    add_light(coll, "sky_far", "AREA", (L - 0.2, 0, 11.2), (0, 0, 3), 5000, "#a6d2ff", size=2 * W - 4, size_y=8.6, haze=0.0, shine=0.0)
    # warm light bounced off the sunlit floor onto the ceiling and the far side
    add_light(coll, "bounce", "AREA", (4, -4, 0.6), (4, -4, 17), 3000, "#ffc887", size=40, size_y=26, haze=0.0, shine=0.0)
    haze = bpy.data.materials.new("h2_haze")
    haze.use_nodes = True
    hn = haze.node_tree
    hn.nodes.clear()
    pv = hn.nodes.new("ShaderNodeVolumePrincipled")
    pv.inputs["Color"].default_value = lin("#fff2de")
    pv.inputs["Density"].default_value = 0.0025      # a thin haze for depth; the visible shafts are sunbeams()
    pv.inputs["Anisotropy"].default_value = 0.4
    hn.links.new(pv.outputs[0], hn.nodes.new("ShaderNodeOutputMaterial").inputs["Volume"])
    hz = box("haze", coll, (2 * L - 0.6, 2 * W - 0.6, H - 0.3), (0, 0, H / 2), haze)
    hz.visible_shadow = False
    return sun


def setup_render2(sc):
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = RES_X, RES_Y
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 92
    ee = sc.eevee
    ee.taa_render_samples = SAMPLES
    ee.use_raytracing = True
    ee.ray_tracing_method = "SCREEN"
    ee.use_fast_gi = True
    ee.fast_gi_method = "GLOBAL_ILLUMINATION"
    ee.use_shadows = True
    ee.use_volumetric_shadows = True
    ee.volumetric_shadow_samples = 16 if QUICK else 48
    ee.volumetric_samples = 48 if QUICK else 128
    ee.volumetric_tile_size = "8" if QUICK else "4"
    ee.volumetric_end = 95.0
    try:
        ee.shadow_pool_size = "1024"
    except TypeError as e:
        print("shadow pool:", e)
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Punchy"
    sc.view_settings.exposure = -0.4
    ng = bpy.data.node_groups.new(f"{sc.name}_grade", "CompositorNodeTree")
    ng.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl = ng.nodes.new("CompositorNodeRLayers")
    rl.scene = sc
    glare = ng.nodes.new("CompositorNodeGlare")
    glare.inputs["Type"].default_value = "Bloom"
    glare.inputs["Strength"].default_value = 0.35
    glare.inputs["Size"].default_value = 0.6
    glare.inputs["Threshold"].default_value = 1.0
    cb = ng.nodes.new("CompositorNodeColorBalance")    # warm light, cool shade
    socket(cb, "Color Lift").default_value = (0.97, 1.0, 1.05, 1)
    socket(cb, "Color Gain").default_value = (1.05, 1.0, 0.95, 1)
    hs = ng.nodes.new("CompositorNodeHueSat")
    hs.inputs["Saturation"].default_value = 1.12
    out = ng.nodes.new("NodeGroupOutput")
    ng.links.new(rl.outputs["Image"], glare.inputs["Image"])
    ng.links.new(glare.outputs["Image"], cb.inputs["Image"])
    ng.links.new(cb.outputs["Image"], hs.inputs["Image"])
    ng.links.new(hs.outputs["Image"], out.inputs[0])
    sc.compositing_node_group = ng
    sc.render.use_compositing = True


# ---------------------------------------------------------------- the scene, the cameras, the renders

# Four a side, at places the game would put them: name, pose, team, position, facing, look, number
SQUADS = [
    ("Red_thrower", "windup_left", "red", (-6.0, -0.8), 0, 0, "7"),
    ("Red_mate", "release", "red", (-3.6, 4.6), -14, 3, "11"),
    ("Red_runner", "run", "red", (-9.2, -5.0), 20, 1, "4"),
    ("Red_back", "ready", "red", (-11.5, 3.0), -10, 5, "14"),
    ("Blue_catcher", "catch", "blue", (4.2, 2.2), 192, 2, "1"),
    ("Blue_side", "dodge", "blue", (8.0, -3.9), 168, 4, "17"),
    ("Blue_thrower", "windup", "blue", (10.6, 4.8), 196, 1, "41"),
    ("Blue_runner", "run", "blue", (6.4, 7.4), 216, 3, "44"),
]
PAIR = ((0.45, -2.8), 90)          # the two versions side by side, facing the sun: each in one pane's beam


def new_collection(sc, name):
    c = bpy.data.collections.new(name)
    sc.collection.children.link(c)
    return c


def build_scene(sc):
    t0 = time.time()
    hall = new_collection(sc, "Hall")
    M = hall2_materials()
    env_hall2(hall, M)
    outside(hall)
    lights_hall2(hall, sc)
    sunbeams(hall)
    print(f"hall built in {time.time() - t0:.1f}s")
    balls = {team: r1.ball_material(f"h2_ball_{team}", BALL[team], lin("#ffffff"), 0.0, 0.0) for team in ("red", "blue")}
    groups = {}
    for head in HEADS:
        t1 = time.time()
        coll = new_collection(sc, f"Athletes ({head})")
        for name, pose, team, (x, y), yaw, look, number in SQUADS:
            athlete2(f"{name}_{head}", coll, pose, team, (x, y, 0), yaw, head=head, look=LOOKS2[look], number=number, ball_mat=balls[team])
        groups[head] = coll
        print(f"athletes ({head}) built in {time.time() - t1:.1f}s")
    pair = new_collection(sc, "Athlete pair")
    (px, py), pyaw = PAIR
    side = Vector((-math.sin(radians(pyaw)), math.cos(radians(pyaw)), 0))
    for k, head in enumerate(("helmet", "face")):
        q = Vector((px, py, 0)) + side * (0.55 if k == 0 else -0.55)
        athlete2(f"Pair_{head}", pair, "stand", "red", tuple(q), pyaw, head=head, number="7")
    groups["pair"] = pair
    # the ball Red_mate has just thrown at Blue_catcher, with its trail
    start, end = Vector((-3.0, 4.5, 1.2)), Vector((3.75, 2.3, 1.32))
    pos = start.lerp(end, 0.72) + Vector((0, 0, 0.3))
    r1.flying_ball(hall, pos, end - start, balls["red"], r1.trail_material("h2_trail", lin("#ffd08a"), 2.2, 4.2), 4.2)
    cams = {
        # the game's own camera (main.js shoulderCamera): 0.75 m right of the player, 4.4 m back,
        # 2.3 m up, looking level 20 m ahead, 62 degrees tall
        "play": r1.camera(hall, "Cam_gameplay", (-10.4, -1.55, 2.3), (14.0, -1.55, 1.75), 20, vertical=True),
        "hero": r1.camera(hall, "Cam_closeup", (-3.45, 2.35, 1.45), (-6.0, -0.75, 1.4), 50, focus=4.0, fstop=2.4),
    }
    look = Vector((px, py, 0.92))
    fwd = Vector((math.cos(radians(pyaw)), math.sin(radians(pyaw)), 0))
    cams["pair"] = r1.camera(pair, "Cam_pair", tuple(look + fwd * 5.4 + side * 1.1 + Vector((0, 0, 0.18))), tuple(look), 40, focus=5.5, fstop=4.0)
    J = CACHE[("pose", "stand")][0]                  # the face version's head, for a portrait
    R = r1.rot(pyaw)
    face_at = Vector((px, py, 0)) - side * 0.55 + R @ (J["head"] + J["Rh"] @ Vector((0.06, 0, 0.05)) * HEAD_SCALE)
    cams["face"] = r1.camera(pair, "Cam_face", tuple(face_at + R @ Vector((1.15, 0.42, 0.04))), tuple(face_at), 85, focus=1.23, fstop=2.8)
    setup_render2(sc)
    print(f"scene built in {time.time() - t0:.1f}s")
    return cams, groups


def show(groups, visible):
    for key, coll in groups.items():
        coll.hide_render = key not in visible
        coll.hide_viewport = key not in visible


def main():
    os.makedirs(OUT, exist_ok=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for c in list(bpy.data.collections):     # the startup file's empty "Collection"
        bpy.data.collections.remove(c)
    sc = bpy.context.scene
    sc.name = "Sports hall, round 2"
    cams, groups = build_scene(sc)
    for shot in SHOTS:
        variants = HEADS if shot in ("play", "hero") else ["pair"]
        for v in variants:
            show(groups, {v})
            sc.camera = cams[shot]
            name = f"sample2-hall-{shot}-{v}.jpg" if v != "pair" else f"sample2-athlete-{shot}.jpg"
            path = os.path.join(OUT, name)
            sc.render.filepath = path
            t = time.time()
            bpy.ops.render.render(write_still=True, scene=sc.name)
            print(f"[{shot}/{v}] {path} in {time.time() - t:.1f}s")
    # Saved for looking around in Blender: the other versions are switched off with the outliner's
    # tick boxes (easier to find than the per-collection switches used for the renders)
    show(groups, set(groups))
    for lc in bpy.context.view_layer.layer_collection.children:
        lc.exclude = lc.collection in [c for k, c in groups.items() if k != HEADS[0]]
    sc.camera = cams["play"]
    blend = os.path.join(OUT, "style-samples-2.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    print("saved", blend)


if __name__ == "__main__":
    main()
