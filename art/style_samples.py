"""Style samples, round 1: three art directions for the user to choose from.

Builds three scenes from nothing (Night, Day, Hall) at the game's real sizes and colours,
renders two views of each (over a player's shoulder, as in the game, and a close-up of one
athlete), and saves them all in one .blend to look around in Blender.

Run with Blender 5.2 in the background (docs/LOOK_AND_FEEL.md):

    blender --background --factory-startup --python art/style_samples.py -- [options]

Options: --out art/out   --only night,day,hall   --shots play,hero   --samples 64   --size 1280x720

Nothing is downloaded: every shape and material is made here.
"""
import math
import os
import random
import sys
import time
from math import radians

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


OUT = os.path.abspath(opt("--out", os.path.join(HERE, "out")))
ONLY = opt("--only", "night,day,hall").split(",")
SHOTS = opt("--shots", "play,hero").split(",")
SAMPLES = int(opt("--samples", "64"))
RES_X, RES_Y = (int(v) for v in opt("--size", "1280x720").split("x"))

# The game's numbers: a 4-a-side court (config.py), team, ball and rally colours (world.js, config.py)
HALF_L, HALF_W = 14.0, 10.5
TEAM = {"red": "#ff4d5e", "blue": "#3fa9ff"}
BALL = {"red": "#ff8a2a", "blue": "#4f6dff"}


# ---------------------------------------------------------------- colours and materials

def lin(hexcol, mult=1.0):
    """sRGB hex -> linear RGBA, as Blender's colour inputs expect."""
    h = hexcol.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (c[0] * mult, c[1] * mult, c[2] * mult, 1.0)


def mixc(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3)) + (1.0,)


def bsdf_of(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def material(name, color, rough=0.5, metal=0.0, coat=0.0, emit=None, strength=0.0, alpha=1.0, sheen=0.0, blended=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = bsdf_of(m)
    b.inputs["Base Color"].default_value = color
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.04
    b.inputs["Sheen Weight"].default_value = sheen
    if emit is not None:
        b.inputs["Emission Color"].default_value = emit
        b.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED" if blended else "DITHERED"   # blended: smooth glass, no grain
    m.diffuse_color = color
    return m


def mnode(nt, op, a, b=None, clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def ball_material(name, base_hex, seam_color, seam_strength, glow):
    """A coated ball with two seams cut around it, so its spin would show."""
    m = material(name, lin(base_hex), rough=0.3, coat=0.8, emit=lin(base_hex), strength=glow)
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    seam = nt.nodes.new("ShaderNodeBsdfPrincipled")
    seam.inputs["Base Color"].default_value = seam_color
    seam.inputs["Roughness"].default_value = 0.35
    seam.inputs["Emission Color"].default_value = seam_color
    seam.inputs["Emission Strength"].default_value = seam_strength
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    z = mnode(nt, "LESS_THAN", mnode(nt, "ABSOLUTE", sep.outputs["Z"]), 0.012)
    y = mnode(nt, "LESS_THAN", mnode(nt, "ABSOLUTE", sep.outputs["Y"]), 0.012)
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(mnode(nt, "MAXIMUM", z, y), mix.inputs[0])
    nt.links.new(bsdf_of(m).outputs[0], mix.inputs[1])
    nt.links.new(seam.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def trail_material(name, color, strength, length):
    """Glow that fades out along the trail's length (object X from 0 at the ball)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color
    em.inputs["Strength"].default_value = strength
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    fade = mnode(nt, "POWER", mnode(nt, "SUBTRACT", 1.0, mnode(nt, "DIVIDE", sep.outputs["X"], length), clamp=True), 1.7)
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fade, mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    m.surface_render_method = "DITHERED"
    return m


# ---------------------------------------------------------------- geometry helpers

def rot(z=0.0, y=0.0, x=0.0):
    return Matrix.Rotation(radians(z), 3, "Z") @ Matrix.Rotation(radians(y), 3, "Y") @ Matrix.Rotation(radians(x), 3, "X")


def frame(x_axis, y_hint):
    """Rotation whose X axis is x_axis and Y axis is as close to y_hint as possible."""
    x = x_axis.normalized()
    y = y_hint - y_hint.dot(x) * x
    if y.length < 1e-6:
        y = Vector((0, 0, 1)) - x.z * x
    y.normalize()
    return Matrix((x, y, x.cross(y))).transposed()


def affine(loc, rot3=None, scale=(1, 1, 1)):
    M = Matrix.Translation(Vector(loc))
    if rot3 is not None:
        M = M @ rot3.to_4x4()
    return M @ Matrix.Diagonal((*scale, 1.0))


def new_obj(name, bm, coll, mats, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    return o


def modifier(o, kind, **kw):
    md = o.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(md, k, v)
    return md


def subsurf(o, levels=2):
    return modifier(o, "SUBSURF", levels=1, render_levels=levels)


def box(name, coll, size, loc, mat, rot3=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=affine(loc, rot3, size), verts=bm.verts)
    o = new_obj(name, bm, coll, [mat], smooth=False)
    if bevel:
        modifier(o, "BEVEL", width=bevel, segments=3)
    return o


def rounded(name, coll, size, M, mat, roundness=0.35):
    """A rounded box: a bevelled, then smoothed cube (gloves, shoes)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=M @ Matrix.Diagonal((*size, 1.0)), verts=bm.verts)
    o = new_obj(name, bm, coll, [mat])
    modifier(o, "BEVEL", width=min(size) * roundness, segments=3)
    subsurf(o, 2)
    return o


def sphere(name, coll, M, mat, u=32, v=16, smooth_levels=1):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    o = new_obj(name, bm, coll, [mat])
    if smooth_levels:
        subsurf(o, smooth_levels)
    return o


def shell(name, coll, keep, M, mat, thickness, u=40, v=20):
    """Part of a sphere's surface (kept where keep(unit-sphere point) is true), given thickness."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    drop = [f for f in bm.faces if not keep(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    o = new_obj(name, bm, coll, [mat])
    modifier(o, "SOLIDIFY", thickness=thickness, offset=1.0)
    subsurf(o, 2)
    return o


def torus(name, coll, R, r, M, mat, seg=40, ring=10):
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        c = Vector((math.cos(a) * R, math.sin(a) * R, 0))
        out = Vector((math.cos(a), math.sin(a), 0))
        rings.append([bm.verts.new(c + out * (math.cos(2 * math.pi * j / ring) * r) + Vector((0, 0, math.sin(2 * math.pi * j / ring) * r))) for j in range(ring)])
    for i in range(seg):
        for j in range(ring):
            a0, a1 = rings[i][j], rings[i][(j + 1) % ring]
            b0, b1 = rings[(i + 1) % seg][j], rings[(i + 1) % seg][(j + 1) % ring]
            bm.faces.new((a0, b0, b1, a1))
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, coll, [mat])


def loft(bm, centers, radii, frames=None, ring=14, side_hint=Vector((0, 1, 0))):
    """A closed tube through centers, with elliptical cross-sections (side radius, front radius)."""
    n = len(centers)
    if frames is None:
        tans = []
        for i in range(n):
            if i == 0:
                t = centers[1] - centers[0]
            elif i == n - 1:
                t = centers[-1] - centers[-2]
            else:
                t = (centers[i + 1] - centers[i]).normalized() + (centers[i] - centers[i - 1]).normalized()
            tans.append(t.normalized())
        side = side_hint - side_hint.dot(tans[0]) * tans[0]
        if side.length < 1e-5:
            side = Vector((1, 0, 0)) - tans[0].x * tans[0]
        frames = []
        for t in tans:
            side = side - side.dot(t) * t
            side.normalize()
            frames.append((side.copy(), t.cross(side).normalized()))
    rings = []
    for c, (s, f), (ra, rb) in zip(centers, frames, radii):
        rings.append([bm.verts.new(c + s * (math.cos(2 * math.pi * k / ring) * ra) + f * (math.sin(2 * math.pi * k / ring) * rb)) for k in range(ring)])
    for i in range(n - 1):
        for k in range(ring):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % ring], rings[i + 1][(k + 1) % ring], rings[i + 1][k]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


# ---------------------------------------------------------------- the athletes

BODIES = {
    "sleek": dict(hip_h=0.97, hip_w=0.095, sh_w=0.205, upper=0.29, fore=0.26, thigh=0.45, shin=0.41, ankle=0.085,
                  girth=1.0, limb=1.0, head=1.0, hand=1.0, foot=1.0),
    "chunky": dict(hip_h=0.9, hip_w=0.11, sh_w=0.235, upper=0.27, fore=0.24, thigh=0.4, shin=0.36, ankle=0.1,
                   girth=1.14, limb=1.22, head=1.32, hand=1.45, foot=1.3),
}

# Torso cross-sections: height above the pelvis, half width, half depth, forward offset,
# and how much of the upper body's turn and lean applies at that height.
TORSO = [(-0.09, 0.12, 0.09, 0.0, 0.0), (0.0, 0.148, 0.102, 0.0, 0.0), (0.13, 0.122, 0.088, 0.004, 0.45),
         (0.25, 0.148, 0.102, 0.012, 0.75), (0.35, 0.172, 0.112, 0.016, 0.95), (0.44, 0.182, 0.104, 0.008, 1.0),
         (0.51, 0.15, 0.085, 0.0, 1.0), (0.555, 0.07, 0.062, 0.0, 1.0), (0.64, 0.056, 0.056, 0.008, 1.0)]

# Facing +X, left is +Y. Arm directions are in the upper body's frame (turned by twist, lean);
# leg directions are in the athlete's frame.
POSES = {
    "windup": dict(twist=-40, lean=-6, hold="R",
                   Lupper=(0.7, 0.6, 0.15), Lfore=(0.85, 0.45, 0.3), Rupper=(-0.3, -0.85, 0.4), Rfore=(-0.3, -0.05, 0.95),
                   Lthigh=(0.45, 0.12, -0.88), Lshin=(0.08, 0.04, -1.0), Rthigh=(-0.4, -0.1, -0.9), Rshin=(-0.6, -0.04, -0.8),
                   Lfoot=(1.0, 0.15, -0.05), Rfoot=(0.8, -0.15, -0.55)),
    "ready": dict(twist=0, lean=20,
                  Lupper=(0.5, 0.5, -0.6), Lfore=(0.9, -0.2, 0.38), Rupper=(0.5, -0.5, -0.6), Rfore=(0.9, 0.2, 0.38),
                  Lthigh=(0.35, 0.42, -0.84), Lshin=(-0.12, 0.12, -0.98), Rthigh=(0.35, -0.42, -0.84), Rshin=(-0.12, -0.12, -0.98),
                  Lfoot=(1.0, 0.3, 0.0), Rfoot=(1.0, -0.3, 0.0)),
    "stand": dict(twist=8, lean=4,
                  Lupper=(0.05, 0.28, -0.96), Lfore=(0.4, 0.12, -0.9), Rupper=(0.0, -0.25, -0.97), Rfore=(0.3, -0.05, -0.95),
                  Lthigh=(0.06, 0.1, -1.0), Lshin=(-0.02, 0.03, -1.0), Rthigh=(-0.04, -0.1, -1.0), Rshin=(-0.05, -0.03, -1.0),
                  Lfoot=(1.0, 0.2, 0.0), Rfoot=(0.95, -0.3, 0.0)),
}


def skeleton(pose, B):
    P = POSES[pose]
    Tu = rot(P["twist"], P["lean"])
    pel = Vector((0.0, 0.0, B["hip_h"]))
    J = {"P": P, "Tu": Tu}
    for side, s in (("L", 1), ("R", -1)):
        sh = pel + Tu @ Vector((0.0, s * B["sh_w"], 0.465))
        d1 = (Tu @ Vector(P[side + "upper"])).normalized()
        el = sh + d1 * B["upper"]
        d2 = (Tu @ Vector(P[side + "fore"])).normalized()
        hip = pel + Vector((0.0, s * B["hip_w"], -0.03))
        t1 = Vector(P[side + "thigh"]).normalized()
        kn = hip + t1 * B["thigh"]
        t2 = Vector(P[side + "shin"]).normalized()
        J[side] = dict(s=s, sh=sh, el=el, wr=el + d2 * B["fore"], d1=d1, d2=d2, hip=hip, kn=kn,
                       an=kn + t2 * B["shin"], t1=t1, t2=t2, foot=Vector(P[side + "foot"]).normalized())
    lift = Vector((0, 0, B["ankle"] - min(J["L"]["an"].z, J["R"]["an"].z)))   # the lower foot on the ground
    J["pel"] = pel + lift
    for side in ("L", "R"):
        for k in ("sh", "el", "wr", "hip", "kn", "an"):
            J[side][k] = J[side][k] + lift
    return J


def athlete(name, coll, look, team, pose, loc, yaw, holding=None):
    B = BODIES[look["body"]]
    M = look["mats"](team)
    J = skeleton(pose, B)
    P, Tu = J["P"], J["Tu"]
    g, lm, hs = B["girth"], B["limb"], B["head"]
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    root.location = loc
    root.rotation_euler = (0, 0, radians(yaw))

    def add(o):
        o.parent = root
        return o

    def torso_loft(rows, scale, mat, part):
        bm = bmesh.new()
        cs, fr, rr = [], [], []
        for dz, hw, hd, xo, f in rows:
            Tf = rot(P["twist"] * f, P["lean"] * f)
            cs.append(J["pel"] + Tf @ Vector((xo, 0, dz)))
            fr.append((Tf @ Vector((0, 1, 0)), Tf @ Vector((1, 0, 0))))
            rr.append((hw * g * scale, hd * g * scale))
        loft(bm, cs, rr, frames=fr, ring=20)
        subsurf(add(new_obj(f"{name}_{part}", bm, coll, [mat])))

    torso_loft(TORSO, 1.0, M["suit"], "torso")
    if look.get("jersey"):
        torso_loft(TORSO[1:7], 1.07, M["jersey"], "jersey")
        # a white belt instead of shorts: lofted shorts came out frilly where they met the legs
        Tw = rot(P["twist"] * 0.45, P["lean"] * 0.45)
        add(torus(f"{name}_belt", coll, 0.14 * g, 0.022, affine(J["pel"] + Tw @ Vector((0.004, 0, 0.06)), Tw, (0.1 / 0.148, 1.0, 1.0)), M["shorts"]))

    for side in ("L", "R"):
        S = J[side]
        # arm: shoulder ball, upper arm, forearm
        bm = bmesh.new()
        pts = [S["sh"] - S["d1"] * 0.03, S["sh"] + S["d1"] * B["upper"] * 0.45, S["el"], S["el"] + S["d2"] * B["fore"] * 0.5, S["wr"]]
        rad = [(0.076, 0.076), (0.07, 0.064), (0.052, 0.05), (0.058, 0.052), (0.04, 0.036)]
        loft(bm, pts, [(a * lm, b * lm) for a, b in rad], side_hint=Tu @ Vector((1, 0, 0)))
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.08 * lm, matrix=Matrix.Translation(S["sh"]))
        subsurf(add(new_obj(f"{name}_arm{side}", bm, coll, [M["suit"]])))
        # leg
        bm = bmesh.new()
        pts = [S["hip"] + Vector((0, 0, 0.07)), S["hip"] + S["t1"] * B["thigh"] * 0.45, S["kn"], S["kn"] + S["t2"] * B["shin"] * 0.45, S["an"]]
        rad = [(0.1, 0.1), (0.094, 0.088), (0.064, 0.061), (0.073, 0.066), (0.045, 0.043)]
        loft(bm, pts, [(a * lm, b * lm) for a, b in rad], side_hint=Vector((1, 0, 0)))
        subsurf(add(new_obj(f"{name}_leg{side}", bm, coll, [M["suit"]])))
        # glove and shoe
        hand = B["hand"]
        add(rounded(f"{name}_glove{side}", coll, (0.11 * hand, 0.085 * hand, 0.05 * hand),
                    affine(S["wr"] + S["d2"] * 0.05 * hand, frame(S["d2"], Tu @ Vector((0, S["s"], 0)))), M["glove"]))
        foot = B["foot"]
        add(rounded(f"{name}_shoe{side}", coll, (0.27 * foot, 0.1 * foot, 0.085 * foot),
                    affine(S["an"] + S["foot"] * 0.07 * foot + Vector((0, 0, -0.035)), frame(S["foot"], Vector((0, 0, 1)).cross(S["foot"]))), M["shoe"]))
        if look.get("armor"):
            # shoulder pad, forearm guard and shin guard, with glowing (or white) rings
            Mp = affine(S["sh"] + Tu @ Vector((0, S["s"] * 0.012, 0.03)), Tu @ rot(x=-S["s"] * 20), (0.095 * g, 0.1 * g, 0.07 * g))
            add(shell(f"{name}_pad{side}", coll, lambda c: c.z > -0.2, Mp, M["armor"], 0.018))
            a0, a1 = S["el"] + S["d2"] * B["fore"] * 0.22, S["el"] + S["d2"] * B["fore"] * 0.88
            bm = bmesh.new()
            loft(bm, [a0, (a0 + a1) / 2, a1], [(0.068 * lm, 0.063 * lm), (0.07 * lm, 0.064 * lm), (0.056 * lm, 0.051 * lm)], side_hint=Tu @ Vector((1, 0, 0)))
            subsurf(add(new_obj(f"{name}_guard{side}", bm, coll, [M["armor"]])))
            add(torus(f"{name}_ring{side}", coll, 0.058 * lm, 0.006, affine(a1, S["d2"].to_track_quat("Z", "Y").to_matrix()), M["accent"]))
            s0, s1 = S["kn"] + S["t2"] * B["shin"] * 0.1, S["kn"] + S["t2"] * B["shin"] * 0.8
            bm = bmesh.new()
            loft(bm, [s0, (s0 + s1) / 2, s1], [(0.08 * lm, 0.077 * lm), (0.081 * lm, 0.075 * lm), (0.061 * lm, 0.058 * lm)], side_hint=Vector((1, 0, 0)))
            subsurf(add(new_obj(f"{name}_shin{side}", bm, coll, [M["armor"]])))
            add(torus(f"{name}_shinring{side}", coll, 0.082 * lm, 0.006, affine(s0, S["t2"].to_track_quat("Z", "Y").to_matrix()), M["accent"]))
        if look.get("jersey"):
            bm = bmesh.new()
            pts = [S["sh"] - S["d1"] * 0.04, S["sh"] + S["d1"] * B["upper"] * 0.5]
            loft(bm, pts, [(0.075 * lm, 0.075 * lm), (0.066 * lm, 0.063 * lm)], side_hint=Tu @ Vector((1, 0, 0)))
            subsurf(add(new_obj(f"{name}_sleeve{side}", bm, coll, [M["jersey"]])))
            add(sphere(f"{name}_kneepad{side}", coll, affine(S["kn"] + Vector((0.035, 0, 0)), frame(S["t1"], Vector((0, 1, 0))), (0.07 * lm, 0.068 * lm, 0.075 * lm)), M["pad"]))

    if look.get("armor"):
        Tc = rot(P["twist"] * 0.95, P["lean"] * 0.95)
        # flatter, upper-chest plates: wide and tall, not deep, so the body reads athletic, not round
        add(shell(f"{name}_chest", coll, lambda c: c.x > 0.3 and -0.35 < c.z < 0.85,
                  affine(J["pel"] + Tc @ Vector((0.045, 0, 0.375)), Tc, (0.085 * g, 0.178 * g, 0.17 * g)), M["armor"], 0.02))
        add(shell(f"{name}_back", coll, lambda c: c.x < -0.3 and -0.3 < c.z < 0.85,
                  affine(J["pel"] + Tc @ Vector((0.0, 0, 0.38)), Tc, (0.085 * g, 0.172 * g, 0.165 * g)), M["armor"], 0.018))
        Tw = rot(P["twist"] * 0.45, P["lean"] * 0.45)
        add(torus(f"{name}_belt", coll, 0.125 * g, 0.011, affine(J["pel"] + Tw @ Vector((0.004, 0, 0.13)), Tw, (0.088 / 0.122, 1.0, 1.0)), M["accent"]))

    # helmet with a visor and a stripe; the head stays more upright than the body leans
    Th = rot(P["twist"], P["lean"] * 0.35)
    hc = J["pel"] + Tu @ Vector((0.012, 0, 0.64)) + Th @ Vector((0, 0, 0.105 * hs))
    r = 0.122 * hs
    add(sphere(f"{name}_helmet", coll, affine(hc, Th, (r * 1.07, r * 0.95, r * 1.08)), M["helmet"]))
    add(shell(f"{name}_visor", coll, lambda c: c.x > 0.38 and -0.3 < c.z < 0.34, affine(hc, Th, (r * 1.1, r * 0.98, r * 1.1)), M["visor"], 0.008))
    add(shell(f"{name}_stripe", coll, lambda c: abs(c.y) < 0.16 and c.z > -0.05 and c.x < 0.36, affine(hc, Th, (r * 1.09, r * 0.97, r * 1.1)), M["stripe"], 0.006))

    if holding:
        S = J[P.get("hold", "R")]
        c = S["wr"] + S["d2"] * (0.06 * B["hand"] + 0.15)   # the game draws a held ball smaller (0.15 m)
        add(sphere(f"{name}_ball", coll, affine(c, None, (0.15, 0.15, 0.15)), holding, smooth_levels=2))
    return root


# ---------------------------------------------------------------- the court and its surroundings

def court_lines(coll, line, red, blue, z=0.008, w=0.08):
    for y in (-HALF_W, HALF_W):
        box("line_side", coll, (2 * HALF_L + w, w, 0.006), (0, y, z), line)
    box("line_end_red", coll, (w * 1.6, 2 * HALF_W, 0.006), (-HALF_L, 0, z), red)
    box("line_end_blue", coll, (w * 1.6, 2 * HALF_W, 0.006), (HALF_L, 0, z), blue)
    box("line_centre", coll, (w * 1.5, 2 * HALF_W, 0.006), (0, 0, z), line)
    n = 21
    for x in (-1.0, 1.0):          # the centre gap nobody may cross, dashed
        for i in range(n):
            box("line_gap", coll, (w * 0.8, 2 * HALF_W / n * 0.55, 0.006), (x, -HALF_W + (i + 0.5) * 2 * HALF_W / n, z), line)


def stands_and_crowd(coll, step_mat, crowd_mats, phone_mat=None, rows=9, seed=7, start=2.2, base=0.7):
    rnd = random.Random(seed)
    for s in (-1, 1):
        for i in range(rows):
            y = s * (HALF_W + start + i * 0.9 + 0.45)
            top = base + i * 0.5
            box("stand_step", coll, (2 * HALF_L + 12, 0.9, top), (0, y, top / 2), step_mat)

    def template(build):
        tb = bmesh.new()
        build(tb)
        tb.verts.index_update()
        shape = ([v.co.copy() for v in tb.verts], [[v.index for v in f.verts] for f in tb.faces])
        tb.free()
        return shape

    # One person (and one phone) made once, then copied: building them one by one is slow
    person = template(lambda tb: (
        bmesh.ops.create_cone(tb, cap_ends=True, cap_tris=False, segments=8, radius1=0.2, radius2=0.15, depth=0.55, matrix=Matrix.Translation((0, 0, 0.28))),
        bmesh.ops.create_uvsphere(tb, u_segments=8, v_segments=6, radius=0.105, matrix=Matrix.Translation((0, 0, 0.66)))))
    phone = template(lambda tb: bmesh.ops.create_cube(tb, size=1.0, matrix=Matrix.Diagonal((0.07, 0.015, 0.12, 1.0))))
    verts, faces, mat_index = [], [], []

    def place(shape, offset, zscale, mi):
        base = len(verts)
        verts.extend((offset[0] + v.x, offset[1] + v.y, offset[2] + v.z * zscale) for v in shape[0])
        faces.extend([base + i for i in f] for f in shape[1])
        mat_index.extend([mi] * len(shape[1]))

    nmat = len(crowd_mats)
    for s in (-1, 1):
        for i in range(rows):
            y = s * (HALF_W + start + i * 0.9 + 0.5)
            top = base + i * 0.5
            x = -(HALF_L + 5.5)
            while x < HALF_L + 5.5:
                x += 0.62 + rnd.uniform(-0.05, 0.1)
                if rnd.random() < 0.14:
                    continue
                px = x + rnd.uniform(-0.08, 0.08)
                hgt = rnd.uniform(0.9, 1.08)
                place(person, (px, y, top), hgt, rnd.randrange(nmat))
                if phone_mat and rnd.random() < 0.05:
                    place(phone, (px, y - s * 0.12, top + 0.95 * hgt), 1.0, nmat)
    me = bpy.data.meshes.new("crowd")
    me.from_pydata(verts, [], faces)
    me.update()
    me.polygons.foreach_set("material_index", mat_index)
    for m in list(crowd_mats) + ([phone_mat] if phone_mat else []):
        me.materials.append(m)
    o = bpy.data.objects.new("crowd", me)
    coll.objects.link(o)
    return o


def flying_ball(coll, pos, direction, ball_mat, trail_mat, length):
    d = Vector(direction).normalized()
    q = d.to_track_quat("X", "Z").to_matrix()
    b = sphere("ball_flying", coll, affine(pos, q, (0.2 * 1.12, 0.2 * 0.95, 0.2 * 0.95)), ball_mat, smooth_levels=2)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, cap_tris=False, segments=24, radius1=0.17, radius2=0.015, depth=length,
                          matrix=Matrix.Translation((length / 2, 0, 0)) @ Matrix.Rotation(radians(90), 4, "Y"))
    t = new_obj("trail", bm, coll, [trail_mat])
    t.location = pos
    t.rotation_euler = (-d).to_track_quat("X", "Z").to_euler()
    t.visible_shadow = False
    return b, t


def terrain(coll, mat, seed=3):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=180, y_segments=180, size=1.0)
    span = max(abs(v.co.x) for v in bm.verts)
    k = 450.0 / span
    for v in bm.verts:
        x, y = v.co.x * k, v.co.y * k
        r = math.hypot(x * 0.8, y)
        t = max(0.0, min(1.0, (r - 34) / 260))
        n = noise.fractal(Vector((x / 170 + seed, y / 170, 0.3)), 0.9, 2.0, 4)
        bump = noise.noise(Vector((x / 22, y / 22, 1.7))) * min(1.0, max(0.0, (r - 30) / 25))
        v.co = Vector((x, y, -0.3 + t * t * (70 + 55 * n) + 1.6 * bump))
    return new_obj("terrain", bm, coll, [mat])


def trees(coll, trunk, leaves, n=46, seed=11):
    rnd = random.Random(seed)
    for i in range(n):
        a = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(27, 75)
        x, y = math.cos(a) * r * 1.2, math.sin(a) * r
        if abs(y) < 22 and -25 < x < 0:      # keep the view behind the near player open
            continue
        s = rnd.uniform(0.8, 1.5)
        z = -0.3
        box(f"trunk{i}", coll, (0.35 * s, 0.35 * s, 2.6 * s), (x, y, z + 1.3 * s), trunk)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
        bmesh.ops.transform(bm, matrix=affine((x, y, z + 3.4 * s), rot(rnd.uniform(0, 360)), (2.1 * s, 2.0 * s, 2.4 * s)), verts=bm.verts)
        new_obj(f"canopy{i}", bm, coll, [rnd.choice(leaves)])


# ---------------------------------------------------------------- the three directions

def mats_night(team):
    tc = lin(TEAM[team])
    glow = mixc(tc, (1, 1, 1), 0.3)
    k = f"night_{team}"
    return dict(
        suit=material(k + "_suit", lin("#1b1e27"), rough=0.55, sheen=0.4),
        armor=material(k + "_armor", tc, rough=0.25, metal=0.2, coat=1.0),
        accent=material(k + "_accent", (0, 0, 0, 1), emit=glow, strength=14.0),
        visor=material(k + "_visor", lin("#05060a"), rough=0.08, coat=1.0, emit=glow, strength=1.6),
        glove=material(k + "_glove", lin("#121419"), rough=0.4, coat=0.6),
        shoe=material(k + "_shoe", lin("#121419"), rough=0.4, coat=0.6),
        helmet=material(k + "_helmet", tc, rough=0.22, metal=0.2, coat=1.0),
        stripe=material(k + "_stripe", (0, 0, 0, 1), emit=glow, strength=10.0),
    )


def mats_day(team):
    tc = lin(TEAM[team])
    k = f"day_{team}"
    return dict(
        suit=material(k + "_suit", lin("#eef1f5"), rough=0.55, sheen=0.3),
        armor=material(k + "_armor", tc, rough=0.35, coat=0.5),
        accent=material(k + "_accent", lin("#ffffff"), rough=0.3, coat=0.4),
        visor=material(k + "_visor", lin("#0d1830"), rough=0.05, metal=0.6, coat=1.0),
        glove=material(k + "_glove", mixc(tc, (0, 0, 0), 0.45), rough=0.5),
        shoe=material(k + "_shoe", lin("#f4f6f8"), rough=0.45, coat=0.3),
        helmet=material(k + "_helmet", lin("#f6f7f9"), rough=0.2, coat=1.0),
        stripe=material(k + "_stripe", tc, rough=0.3, coat=0.6),
    )


def mats_hall(team):
    tc = lin(TEAM[team])
    k = f"hall_{team}"
    return dict(
        suit=material(k + "_suit", lin("#2a2f3d"), rough=0.6, sheen=0.3),
        jersey=material(k + "_jersey", tc, rough=0.6, sheen=0.5),
        shorts=material(k + "_shorts", lin("#f3f5f8"), rough=0.6, sheen=0.3),
        pad=material(k + "_pad", lin("#f3f5f8"), rough=0.5),
        accent=material(k + "_accent", lin("#ffffff"), rough=0.4),
        visor=material(k + "_visor", lin("#101a33"), rough=0.05, metal=0.5, coat=1.0),
        glove=material(k + "_glove", tc, rough=0.5, coat=0.3),
        shoe=material(k + "_shoe", lin("#f6f7f9"), rough=0.45, coat=0.3),
        helmet=material(k + "_helmet", lin("#f7f8fb"), rough=0.2, coat=1.0),
        stripe=material(k + "_stripe", tc, rough=0.3, coat=0.6),
    )


def env_night(coll):
    floor = material("night_floor", lin("#0a0d16"), rough=0.16, coat=0.6)
    court = material("night_court", lin("#0e1526"), rough=0.12, coat=0.8)
    line = material("night_line", (0, 0, 0, 1), emit=lin("#bff3ff"), strength=5.0)
    red = material("night_line_red", (0, 0, 0, 1), emit=lin(TEAM["red"]), strength=7.0)
    blue = material("night_line_blue", (0, 0, 0, 1), emit=lin(TEAM["blue"]), strength=7.0)
    glass = material("night_glass", lin("#9fd8ff"), rough=0.04, alpha=0.08, emit=lin("#9fd8ff"), strength=0.03, blended=True)
    frame_m = material("night_frame", lin("#20242f"), rough=0.3, metal=0.8)
    rail = material("night_rail", (0, 0, 0, 1), emit=lin("#dff6ff"), strength=8.0)
    kick = material("night_kick", lin("#121620"), rough=0.4)
    stand = material("night_stand", lin("#0f121a"), rough=0.8)
    rig = material("night_rig", (0, 0, 0, 1), emit=lin("#f2f7ff"), strength=20.0)
    box("floor", coll, (80, 64, 0.2), (0, 0, -0.1), floor)
    box("court", coll, (2 * HALF_L, 2 * HALF_W, 0.01), (0, 0, 0.0), court)
    court_lines(coll, line, red, blue)
    for s in (-1, 1):
        y = s * (HALF_W + 0.35)
        g = box("glass", coll, (2 * HALF_L + 0.8, 0.03, 2.3), (0, y, 1.4), glass)
        g.visible_shadow = False
        box("rail", coll, (2 * HALF_L + 0.8, 0.07, 0.05), (0, y, 2.58), rail)
        for team, sx, glow in (("red", -1, red), ("blue", 1, blue)):
            box("kick", coll, (HALF_L + 0.4, 0.14, 0.26), (sx * (HALF_L + 0.4) / 2, y, 0.13), kick)
            box("kick_glow", coll, (HALF_L + 0.4, 0.15, 0.035), (sx * (HALF_L + 0.4) / 2, y, 0.22), glow)
        for i in range(9):
            box("post", coll, (0.06, 0.09, 2.6), (-HALF_L - 0.4 + i * (2 * HALF_L + 0.8) / 8, y, 1.3), frame_m)
    for sx, team in ((-1, "red"), (1, "blue")):
        x = sx * (HALF_L + 0.6)
        box("endwall", coll, (0.3, 2 * HALF_W + 1.0, 3.6), (x, 0, 1.8), kick)
        led = material(f"night_led_{team}", (0, 0, 0, 1), emit=lin(TEAM[team]), strength=2.6)
        box("led", coll, (0.03, 2 * HALF_W, 1.3), (x - sx * 0.17, 0, 1.55), led)
        for k in range(7):                    # dark slats make the board read as a screen
            box("slat", coll, (0.04, 2 * HALF_W, 0.03), (x - sx * 0.19, 0, 0.98 + k * 0.19), kick)
    crowd_mats = [material(f"night_crowd{i}", lin(c), rough=0.85) for i, c in enumerate(("#0d0f15", "#13161e", "#1a1219", "#101722"))]
    stands_and_crowd(coll, stand, crowd_mats, phone_mat=material("night_phone", (0, 0, 0, 1), emit=lin("#e8f4ff"), strength=12.0))
    for s in (-1, 1):                         # the light rig over the court
        box("rig", coll, (2 * HALF_L + 4, 0.35, 0.12), (0, s * (HALF_W - 1), 13.5), rig)
    for sx in (-1, 0, 1):
        box("rig", coll, (0.35, 2 * HALF_W - 2, 0.12), (sx * (HALF_L + 2), 0, 13.5), rig)


def lights_night(coll, sc):
    world = bpy.data.worlds.new("night_world")
    world.use_nodes = True
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = lin("#04060c")
    bg.inputs["Strength"].default_value = 1.0
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = lin("#b9c9ff")
    vol.inputs["Density"].default_value = 0.003
    vol.inputs["Anisotropy"].default_value = 0.45
    nt.links.new(vol.outputs[0], next(n for n in nt.nodes if n.type == "OUTPUT_WORLD").inputs["Volume"])
    sc.world = world
    # Narrow beams aimed at the court's sides, so their pools don't land in front of the camera
    for x in (-11, 0, 11):
        for y in (-12, 12):
            add_light(coll, "spot", "SPOT", (x, y, 14.5), (x * 0.6, y * 0.5, 0), 16000, "#e6efff", size=0.3, spot=radians(27), blend=0.3)
    add_light(coll, "fill", "AREA", (0, 0, 13.4), (0, 0, 0), 5000, "#cfe0ff", size=30, size_y=22)
    # Team-coloured glow on the floor and walls at each end. No reflections: the glossy floor
    # mirrored each 2.5 m lamp as a big round blob in the middle of the court.
    add_light(coll, "teamglow_red", "POINT", (-HALF_L - 0.3, 0, 2.0), None, 4000, TEAM["red"], size=2.5, haze=0.0, shine=0.0)
    add_light(coll, "teamglow_blue", "POINT", (HALF_L + 0.3, 0, 2.0), None, 4000, TEAM["blue"], size=2.5, haze=0.0, shine=0.0)


def env_day(coll):
    grass = material("day_grass", lin("#5db552"), rough=0.9)
    nt = grass.node_tree
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.035
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = lin("#2f8f3c")
    ramp.color_ramp.elements[1].color = lin("#7cc444")
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf_of(grass).inputs["Base Color"])
    surround = material("day_surround", lin("#2fa37a"), rough=0.7)
    court = material("day_court", lin("#2f80d8"), rough=0.65)
    line = material("day_line", lin("#ffffff"), rough=0.5)
    red = material("day_line_red", lin(TEAM["red"]), rough=0.5)
    blue = material("day_line_blue", lin(TEAM["blue"]), rough=0.5)
    glass = material("day_glass", lin("#dff3ff"), rough=0.03, alpha=0.12, blended=True)
    white = material("day_frame", lin("#f4f6f8"), rough=0.35, coat=0.4)
    terrain(coll, grass)
    box("slab", coll, (42, 33, 0.5), (0, 0, -0.25), surround)
    box("court", coll, (2 * HALF_L, 2 * HALF_W, 0.01), (0, 0, 0.0), court)
    court_lines(coll, line, red, blue)
    for s in (-1, 1):
        y = s * (HALF_W + 0.35)
        g = box("glass", coll, (2 * HALF_L + 0.8, 0.025, 1.9), (0, y, 1.1), glass)
        g.visible_shadow = False
        box("rail", coll, (2 * HALF_L + 0.8, 0.07, 0.07), (0, y, 2.07), white)
        box("base", coll, (2 * HALF_L + 0.8, 0.12, 0.16), (0, y, 0.08), white)
        for i in range(9):
            box("post", coll, (0.07, 0.09, 2.1), (-HALF_L - 0.4 + i * (2 * HALF_L + 0.8) / 8, y, 1.05), white)
    for sx, team in ((-1, "red"), (1, "blue")):
        x = sx * (HALF_L + 0.6)
        panel = material(f"day_endwall_{team}", lin(TEAM[team]), rough=0.45, coat=0.3)
        box("endwall", coll, (0.25, 2 * HALF_W + 1.0, 3.0), (x, 0, 1.5), panel)
        box("endtrim", coll, (0.3, 2 * HALF_W + 1.0, 0.12), (x, 0, 3.0), white)
        box("endstripe", coll, (0.27, 2 * HALF_W + 1.0, 0.18), (x, 0, 1.0), white)
    trunk = material("day_trunk", lin("#7a5a3c"), rough=0.8)
    leaves = [material(f"day_leaves{i}", lin(c), rough=0.75, sheen=0.3) for i, c in enumerate(("#3f9d4a", "#57b65a", "#2f8a5a", "#7cc65e"))]
    trees(coll, trunk, leaves)


def lights_day(coll, sc):
    world = bpy.data.worlds.new("day_world")
    world.use_nodes = True
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    sky = nt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "MULTIPLE_SCATTERING"
    except TypeError:
        pass
    sky.sun_disc = False
    sky.sun_elevation = radians(30)
    sky.sun_rotation = radians(200)
    sky.altitude = 400.0
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.55
    sc.world = world
    # Haze for the distant hills. Not a world volume: EEVEE treats that as endless, and it then
    # blocks the sun and the sky completely (the picture renders black). A big box of haze instead.
    haze_mat = bpy.data.materials.new("day_haze")
    haze_mat.use_nodes = True
    hn = haze_mat.node_tree
    hn.nodes.clear()
    pv = hn.nodes.new("ShaderNodeVolumePrincipled")
    pv.inputs["Color"].default_value = lin("#d6e8ff")
    pv.inputs["Density"].default_value = 0.0007
    pv.inputs["Anisotropy"].default_value = 0.3
    hn.links.new(pv.outputs[0], hn.nodes.new("ShaderNodeOutputMaterial").inputs["Volume"])
    box("haze", coll, (2400, 2400, 300), (0, 0, 140), haze_mat)
    sun = add_light(coll, "sun", "SUN", (0, 0, 50), None, 5.0, "#fff1dc")
    sun.data.angle = radians(1.5)
    az, el = math.atan2(-1.0, -0.35), radians(32)          # from behind-left of the gameplay view
    to_sun = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    sun.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()


def env_hall(coll):
    nt_wood = material("hall_wood", lin("#d9a86c"), rough=0.22, coat=0.7)
    nt = nt_wood.node_tree
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 1.4
    wave.inputs["Distortion"].default_value = 1.2
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = lin("#c98f52")
    ramp.color_ramp.elements[1].color = lin("#e6b97f")
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf_of(nt_wood).inputs["Base Color"])
    line = material("hall_line", lin("#ffffff"), rough=0.3, coat=0.7)
    paint_red = material("hall_paint_red", lin(TEAM["red"]), rough=0.25, coat=0.7)
    paint_blue = material("hall_paint_blue", lin(TEAM["blue"]), rough=0.25, coat=0.7)
    wall = material("hall_wall", lin("#e9e6f2"), rough=0.8)
    ceiling = material("hall_ceiling", lin("#3a3f52"), rough=0.8)
    panel_light = material("hall_panel", (0, 0, 0, 1), emit=lin("#fff6ea"), strength=12.0)
    palette = ["#ff3d8b", "#ffc93c", "#16c7b7", "#7b5cff", "#ff8a2a"]
    pal = [material(f"hall_pal{i}", lin(c), rough=0.55, coat=0.2) for i, c in enumerate(palette)]
    box("floor", coll, (64, 50, 0.2), (0, 0, -0.1), nt_wood)
    box("half_red", coll, (HALF_L - 1.0, 2 * HALF_W, 0.004), (-(HALF_L + 1.0) / 2, 0, 0.002), paint_red)
    box("half_blue", coll, (HALF_L - 1.0, 2 * HALF_W, 0.004), ((HALF_L + 1.0) / 2, 0, 0.002), paint_blue)
    court_lines(coll, line, line, line)
    torus("centre_circle", coll, 3.0, 0.05, affine((0, 0, 0.006), None, (1, 1, 0.12)), line, seg=96, ring=6)
    for s in (-1, 1):                          # padded side boards in alternating colours
        y = s * (HALF_W + 0.5)
        for i in range(8):
            x = -HALF_L + (i + 0.5) * (2 * HALF_L / 8)
            box("board", coll, (2 * HALF_L / 8 - 0.05, 0.25, 1.1), (x, y, 0.55), pal[(i + (s > 0)) % 4], bevel=0.05)
    for sx, team, paint in ((-1, "red", paint_red), (1, "blue", paint_blue)):
        x = sx * (HALF_L + 0.7)
        box("endwall", coll, (0.4, 2 * HALF_W + 1.0, 2.4), (x, 0, 1.2), paint, bevel=0.08)
        box("endstripe", coll, (0.42, 2 * HALF_W + 1.0, 0.22), (x, 0, 1.6), line)
    for x in (-32, 32):
        box("hallwall", coll, (0.5, 50, 17), (x, 0, 8.5), wall)
    for y in (-25, 25):
        box("hallwall", coll, (64, 0.5, 17), (0, y, 8.5), wall)
        for i in range(6):                     # big colour blocks on the long walls
            box("block", coll, (8.5, 0.2, 5.0), (-26 + i * 10.4, y - math.copysign(0.3, y), 11.5), pal[i % len(pal)])
    box("ceiling", coll, (64, 50, 0.4), (0, 0, 17.2), ceiling)
    for ix in range(4):
        for iy in range(3):
            box("lightpanel", coll, (5.0, 2.5, 0.08), (-15 + ix * 10, -10 + iy * 10, 16.9), panel_light)
    rnd = random.Random(5)                    # bunting across the hall
    for k, y in enumerate((-8, 0, 8)):
        n = 40
        for i in range(n):
            x = -30 + i * 60 / (n - 1)
            z = 14.8 - 1.4 * math.sin(math.pi * i / (n - 1))
            bm = bmesh.new()
            v = [bm.verts.new(p) for p in ((x - 0.35, y, z), (x + 0.35, y, z), (x, y, z - 0.75))]
            bm.faces.new(v)
            o = new_obj("flag", bm, coll, [pal[(i + k) % len(pal)]], smooth=False)
            o.visible_shadow = False
    seat = material("hall_seat", lin("#3a3f52"), rough=0.6)
    crowd_cols = ["#ff4d5e", "#3fa9ff", "#ffd23f", "#f2f2f2", "#2b2f3a", "#ff8a2a", "#16c7b7"]
    crowd_mats = [material(f"hall_crowd{i}", lin(c), rough=0.7) for i, c in enumerate(crowd_cols)]
    stands_and_crowd(coll, seat, crowd_mats, rows=8, start=3.2, base=0.6, seed=9)


def lights_hall(coll, sc):
    world = bpy.data.worlds.new("hall_world")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = lin("#b9c0d0")
    bg.inputs["Strength"].default_value = 0.3
    sc.world = world
    for ix in range(4):
        for iy in range(3):
            add_light(coll, "panel", "AREA", (-15 + ix * 10, -10 + iy * 10, 16.7), (-15 + ix * 10, -10 + iy * 10, 0), 3200, "#fff6ea", size=5, size_y=2.5)
    add_light(coll, "accent_pink", "AREA", (0, -23, 8), (0, 0, 2), 2500, "#ff3d8b", size=12, size_y=4)
    add_light(coll, "accent_teal", "AREA", (0, 23, 8), (0, 0, 2), 2500, "#16c7b7", size=12, size_y=4)


def add_light(coll, name, kind, loc, target, energy, color_hex, size=0.5, size_y=None, spot=None, blend=0.3, haze=1.0, shine=1.0):
    d = bpy.data.lights.new(name, type=kind)
    d.energy = energy
    d.color = lin(color_hex)[:3]
    d.volume_factor = haze                   # how much this light lights up the haze
    d.specular_factor = shine                # how much it shows up in glossy reflections
    if kind == "AREA":
        d.shape = "RECTANGLE"
        d.size = size
        d.size_y = size_y or size
    elif kind in ("POINT", "SPOT"):
        d.shadow_soft_size = size
    if kind == "SPOT":
        d.spot_size = spot
        d.spot_blend = blend
    o = bpy.data.objects.new(name, d)
    coll.objects.link(o)
    o.location = loc
    if target is not None:
        look_at(o, target)
    return o


LOOKS = {
    "night": dict(title="Night arena", body="sleek", armor=True, mats=mats_night, env=env_night, lights=lights_night,
                  ball=lambda: ball_material("night_ball_red", BALL["red"], lin("#fff2c0"), 6.0, 0.6),
                  ball_fly=lambda: ball_material("night_ball_blue", BALL["blue"], lin("#e0f0ff"), 2.5, 0.35),
                  trail=lambda L: trail_material("night_trail", lin("#6f86ff"), 2.5, L),
                  exposure=0.0, bloom=(0.5, 0.35, 1.3), volume_end=90.0),
    "day": dict(title="Daylight court", body="sleek", armor=True, mats=mats_day, env=env_day, lights=lights_day,
                ball=lambda: ball_material("day_ball_red", BALL["red"], lin("#ffffff"), 0.0, 0.0),
                ball_fly=lambda: ball_material("day_ball_blue", BALL["blue"], lin("#ffffff"), 0.0, 0.0),
                trail=lambda L: trail_material("day_trail", lin("#ffffff"), 1.4, L),
                exposure=-0.5, bloom=(0.2, 0.5, 1.4), volume_end=1500.0),
    "hall": dict(title="Sports hall", body="chunky", jersey=True, mats=mats_hall, env=env_hall, lights=lights_hall,
                 ball=lambda: ball_material("hall_ball_red", BALL["red"], lin("#ffffff"), 0.0, 0.0),
                 ball_fly=lambda: ball_material("hall_ball_blue", BALL["blue"], lin("#ffffff"), 0.4, 0.2),
                 trail=lambda L: trail_material("hall_trail", lin("#9fb0ff"), 2.5, L),
                 exposure=-1.0, bloom=(0.3, 0.5, 1.2), volume_end=60.0),
}


# ---------------------------------------------------------------- scene, cameras, rendering

def setup_render(sc, look):
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = RES_X, RES_Y
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 90
    ee = sc.eevee
    ee.taa_render_samples = SAMPLES
    ee.use_raytracing = True
    ee.use_fast_gi = True
    ee.use_shadows = True
    ee.volumetric_end = look["volume_end"]
    ee.volumetric_tile_size = "8"
    try:
        ee.shadow_pool_size = "1024"         # the hall's 14 lamps overflowed the default
    except TypeError as e:
        print(f"[{sc.name}] shadow pool: {e}")
    sc.view_settings.view_transform = "AgX"
    for name in ("AgX - Punchy", "Punchy"):
        try:
            sc.view_settings.look = name
            break
        except TypeError:
            continue
    sc.view_settings.exposure = look["exposure"]
    print(f"[{sc.name}] colour: {sc.view_settings.view_transform}, look {sc.view_settings.look!r}")
    try:                                     # bloom: the compositor's Glare node (Blender 5: a node group)
        ng = bpy.data.node_groups.new(f"{sc.name}_comp", "CompositorNodeTree")
        ng.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        rl = ng.nodes.new("CompositorNodeRLayers")
        rl.scene = sc
        glare = ng.nodes.new("CompositorNodeGlare")
        try:
            glare.inputs["Type"].default_value = "Bloom"
        except TypeError:
            glare.inputs["Type"].default_value = "BLOOM"
        strength, size, threshold = look["bloom"]
        glare.inputs["Strength"].default_value = strength
        glare.inputs["Size"].default_value = size
        glare.inputs["Threshold"].default_value = threshold
        out = ng.nodes.new("NodeGroupOutput")
        ng.links.new(rl.outputs["Image"], glare.inputs["Image"])
        ng.links.new(glare.outputs["Image"], out.inputs[0])
        sc.compositing_node_group = ng
        sc.render.use_compositing = True
    except Exception as e:                   # the samples still render, just without bloom
        print(f"[{sc.name}] no bloom: {e}")


def camera(coll, name, loc, target, lens, focus=None, fstop=2.2, vertical=False):
    cam = bpy.data.cameras.new(name)
    cam.lens = lens
    if vertical:                             # lens 20 on a 24 mm tall sensor = the game's 62 degree view
        cam.sensor_fit = "VERTICAL"
        cam.sensor_height = 24.0
    cam.clip_end = 3000
    if focus is not None:
        cam.dof.use_dof = True
        cam.dof.focus_distance = focus
        cam.dof.aperture_fstop = fstop
    o = bpy.data.objects.new(name, cam)
    coll.objects.link(o)
    o.location = loc
    look_at(o, target)
    return o


def build(key, sc):
    look = LOOKS[key]
    coll = bpy.data.collections.new(look["title"])
    sc.collection.children.link(coll)
    look["env"](coll)
    look["lights"](coll, sc)
    ball_red, ball_blue = look["ball"](), look["ball_fly"]()
    # Red (the near team, throwing towards +X) and Blue, at places the game would put them
    athlete("Red_thrower", coll, look, "red", "windup", (-6.0, -0.8, 0), 0, holding=ball_red)
    athlete("Red_mate", coll, look, "red", "ready", (-7.6, 5.2, 0), -12)
    athlete("Red_back", coll, look, "red", "stand", (-10.8, 2.6, 0), 8)
    athlete("Blue_catcher", coll, look, "blue", "ready", (4.2, 1.5, 0), 186)
    athlete("Blue_side", coll, look, "blue", "stand", (8.2, -3.9, 0), 170)
    athlete("Blue_thrower", coll, look, "blue", "windup", (10.6, 4.6, 0), 196, holding=ball_blue)
    L = 4.2
    start, end = Vector((-7.6, 5.2, 1.5)), Vector((4.2, 1.5, 1.25))
    pos = start.lerp(end, 0.72) + Vector((0, 0, 0.35))
    flying_ball(coll, pos, end - start, ball_blue if key != "night" else look["ball_fly"](), look["trail"](L), L)
    # The game's own camera (main.js shoulderCamera): 0.75 m right of the player, 4.4 m back,
    # 2.3 m up, looking level 20 m ahead, 62 degrees tall
    cams = {
        "play": camera(coll, "Cam_gameplay", (-10.4, -1.55, 2.3), (14.0, -1.55, 1.75), 20, vertical=True),
        "hero": camera(coll, "Cam_closeup", (-3.3, -3.25, 1.3), (-6.0, -0.78, 1.28), 55, focus=3.7, fstop=2.0),
    }
    setup_render(sc, look)
    return cams


def main():
    os.makedirs(OUT, exist_ok=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    first = True
    made = []
    for key in ONLY:
        t0 = time.time()
        if first:
            sc = bpy.context.scene
            sc.name = LOOKS[key]["title"]
            first = False
        else:
            sc = bpy.data.scenes.new(LOOKS[key]["title"])
        cams = build(key, sc)
        n = len(sc.collection.all_objects)
        print(f"[{key}] built {n} objects in {time.time() - t0:.1f}s")
        for shot in SHOTS:
            t1 = time.time()
            sc.camera = cams[shot]
            path = os.path.join(OUT, f"sample-{key}-{shot}.jpg")
            sc.render.filepath = path
            bpy.ops.render.render(write_still=True, scene=sc.name)
            print(f"[{key}] {shot}: {path} in {time.time() - t1:.1f}s")
            made.append(path)
        sc.camera = cams["play"]
    blend = os.path.join(OUT, "style-samples.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    print("saved", blend)


if __name__ == "__main__":      # round 2 (style_samples_2.py) imports the helpers above
    main()
