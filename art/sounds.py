"""Builds the game's sounds from CC0 recordings (decision 132).

Writes into static/sounds/:

- sfx.oga: every short sound, one after the other, in one file (one download, one decode);
- sfx.json: where each sound's variants start in sfx.oga, how long they are and where they come from;
- music-lobby.oga and music-match.oga: the two music tracks.

They're Ogg Vorbis, named .oga (Ogg audio) rather than .ogg: download managers such as Internet
Download Manager grab .ogg, .mp3 and .wav requests from the browser, and the page gets nothing.

The sources are downloaded the first time into art/out/sound-sources/ (git-ignored):

- BigSoundBank's recordings by Joseph Sardin (bigsoundbank.com, CC0): the ball, the hits, the
  slaps, the whooshes, the shoe squeaks, the whistle and the crowd;
- Kenney's Voiceover Pack: Fighter and Interface Sounds (kenney.nl, CC0): the announcer and three
  interface sounds;
- the players' voices, from OpenGameArt (CC0): qubodup's "15 vocal male strain/hurt/pain/jump
  sounds" and three of the four voices in HaelDB's "Male Grunt/Yelling sounds";
- MintoDog's "Sunny City" (opengameart.org, CC0): the music.

THIRD_PARTY_NOTICES.md lists them. Claude can't hear: the cuts were chosen from measurements and
pictures of the recordings (art/out/sound-sheets/, made with --sheets), and the user judges them.

Run from the repository's root, with numpy, soundfile and py7zr (one source is a .7z):

    uv run --no-project --with numpy --with soundfile --with py7zr python art/sounds.py

(--sheets, with --with matplotlib as well, draws every cut into art/out/sound-sheets/.)
"""
import io
import json
import pathlib
import sys
import urllib.request
import zipfile

import numpy as np
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "art" / "out" / "sound-sources"
OUT = ROOT / "static" / "sounds"
RATE = 48000
UA = {"User-Agent": "dodgeball-sound-build (+https://github.com/amirtavakolihaghighi/dodgeball)"}

BSB = "https://bigsoundbank.com/UPLOAD/ogg/{}.ogg"
OGA = "https://opengameart.org/sites/default/files/"
# packs: (download, the file inside for a key)
PACKS = {"kenney-voice": (OGA + "kenney_voiceoverFighter.zip", "Audio/{}.ogg"),
         "kenney-ui": (OGA + "kenney_interfaceSounds.zip", "Audio/{}.ogg"),
         "haeldb": (OGA + "yelling%20sounds.zip", "yelling sounds/{}.wav"),
         "qubodup": (OGA + "slightscreams.7z", "slightscream-{}.flac")}
MUSIC = {"music-lobby": OGA + "sunny_city_bpm120_0.ogg",           # 120 BPM, 80 s, loops
         "music-match": OGA + "sunny_city_climax_bpm135_0.ogg"}    # the same tune faster, 71 s, loops

# BigSoundBank's titles, for sfx.json and the sound check page
TITLES = {
    "0019": "Applause: 150 people", "0236": "Shouts and applause of teens #1",
    "0237": "Shouts and applause of teens #2", "0444": "Punches", "0597": "Slaps", "1017": "Plastic whistle #1",
    "1044": "Ball kicked", "1045": "Ball rebounds", "1825": "Ball against a wall #1",
    "1826": "Ball against a wall #2", "2363": "Applause #1",
    **{str(n): f"Punch #{n - 2455}" for n in range(2459, 2469)},
    **{str(n): f"Whoosh #{w}" for n, w in zip(range(1795, 1803), (3, 4, 5, 10, 6, 7, 8, 9))},
    "0165": "Man footsteps on the wooden floor", "1103": "Breathless man", "1835": "Jumping on concrete #1",
    "1836": "Jumping on concrete #2", "1841": "Jumping on wooden pontoon #1", "1842": "Jumping on wooden pontoon #2",
    "2339": "Bass tom #2", "2341": "Bass tom #4", "2366": "Nepalese cymbal #1", "2367": "Nepalese cymbal #2",
    "2520": "Horn #1", "2522": "Horn #3", **{str(n): f"Body fall #{n - 2451}" for n in range(2452, 2457)},
}


def events(src, idx, **opts):
    return [dict(src=src, event=i, **opts) for i in idx]


# Each sound is a list of variants; the game picks one at random, never the same twice in a row.
#   src: "bsb:<number>" or "<kenney pack>:<file>";
#   event: the n-th separate sound in the recording; at: (from, to) seconds; else the whole file;
#   loudest: keep the loudest this many seconds; peak_at: start this long before the loudest moment;
#   max: at most this long; fade: the fade-out at the end; fade_in; hp: cut the rumble below (Hz).
SOUNDS = {
    # effects
    "throw": [dict(src=f"bsb:{n}", peak_at=0.07, max=0.4, fade=0.14) for n in range(1795, 1803)],
    "hit.thump": events("bsb:1044", range(5), max=0.22, fade=0.08),       # a ball kicked: the deep boof
    "hit.body": events("bsb:0444", range(9), max=0.25, fade=0.08),        # a punch: the body's smack
    "deflect": [dict(src=f"bsb:{n}", max=0.22, fade=0.1) for n in range(2459, 2469)],  # crisp punches
    "catch": events("bsb:0597", range(13), max=0.16, fade=0.05),          # slaps: the ball into the hands
    "bounce.floor": events("bsb:1045", range(6), max=0.2, fade=0.06),
    "bounce.wall": [dict(src="bsb:1825", max=0.25, fade=0.1), dict(src="bsb:1826", max=0.25, fade=0.1)],
    # the dash: a whoosh, a push-off and the feet landing hard (the user: "a sudden movement sound,
    # like a whoosh, with legs hitting the ground with more force"; shoe squeaks were rejected)
    "dash.whoosh": [dict(src=f"bsb:{n}", peak_at=0.05, max=0.3, fade=0.12) for n in (1795, 1796, 1800, 1801)],
    "dash.push": events("bsb:0165", (1, 2, 4, 6, 8), max=0.2, fade=0.08),
    "dash.land": [dict(src=f"bsb:{n}", event=0, max=0.25, fade=0.08) for n in (1835, 1836, 1841, 1842)],
    # the players: four voices, each a grunt when hit and a cry when knocked out; a body falling;
    # breathing when out of stamina (the user: "akh when got hit", "heavy breathing when low stamina")
    # a grunt stays under half a second (1yell14 under 0.38 s: a click follows)
    "hurt.0": [dict(src=f"qubodup:{n:02d}", max=0.45, fade=0.12) for n in (1, 3, 6, 8, 11, 14)],
    "ko.0": [dict(src=f"qubodup:{n:02d}", fade=0.12) for n in (5, 10, 15)],
    "hurt.1": [dict(src=f"haeldb:1yell{n}", max=0.38 if n == 14 else 0.45, fade=0.15) for n in (6, 7, 8, 14, 15)],
    "ko.1": [dict(src=f"haeldb:1yell{n}", fade=0.15) for n in (3, 11, 12)],
    "hurt.2": [dict(src=f"haeldb:{k}", max=0.45, fade=0.15) for k in ("3grunt1", "3grunt3", "3grunt4", "3grunt5", "3yell4")],
    "ko.2": [dict(src=f"haeldb:{k}", fade=0.15) for k in ("3grunt6", "3yell11", "3yell14")],
    "hurt.3": [dict(src=f"haeldb:yell{n}", max=0.45, fade=0.15) for n in (7, 12, 13)],
    "ko.3": [dict(src=f"haeldb:yell{n}", max=1.2, fade=0.3) for n in (3, 4, 6)],
    "bodyfall": [dict(src=f"bsb:{n}", peak_at=0.1, max=0.7, fade=0.25) for n in range(2452, 2457)],
    "breath": [dict(src="bsb:1103", loop=(4.0, 12.0))],      # repeats while tired
    # revives: an entrance for your team, a danger for the other (the user's request)
    "revive.boom": [dict(src=f"bsb:{n}", max=1.6, fade=0.8) for n in (2339, 2341)],     # a deep tom
    "revive.shine": [dict(src=f"bsb:{n}", max=2.5, fade=1.5) for n in (2366, 2367)],   # a bell-like cymbal
    "revive.horn": [dict(src=f"bsb:{n}", max=1.4, fade=0.6) for n in (2520, 2522)],    # played an octave down
    # the announcer and the referee
    "whistle.short": events("bsb:1017", (1, 2, 4), max=0.45, fade=0.06),
    "whistle.long": events("bsb:1017", (0, 5, 6), max=1.1, fade=0.15),
    **{f"voice.round{n}": [dict(src=f"kenney-voice:round_{n}", fade=0.05)] for n in range(1, 6)},
    "voice.final": [dict(src="kenney-voice:final_round", fade=0.05)],
    "voice.ready": [dict(src="kenney-voice:ready", fade=0.05)],
    "voice.fight": [dict(src="kenney-voice:fight", fade=0.05)],
    "voice.win": [dict(src="kenney-voice:you_win", fade=0.05)],
    "voice.lose": [dict(src="kenney-voice:you_lose", fade=0.05)],
    "voice.tie": [dict(src="kenney-voice:it's_a_tie", fade=0.05)],
    "voice.over": [dict(src="kenney-voice:game_over", fade=0.05)],
    # the crowd
    "crowd.cheer": [dict(src="bsb:0236", fade=0.8), dict(src="bsb:0237", max=4.0, fade=1.2)],
    "crowd.applause": [dict(src="bsb:2363", event=0, max=4.5, fade=1.5)],
    "crowd.big": [dict(src="bsb:0019", at=(11.5, 19.0), fade=2.5, fade_in=0.25)],
    # interface
    "ui.deny": [dict(src="kenney-ui:error_006")],
    "ui.revive": [dict(src="kenney-ui:confirmation_004")],
    "ui.heal": [dict(src="kenney-ui:confirmation_001")],
}


def fetch(url, path):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print("downloading", url)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            path.write_bytes(r.read())
    return path


def resample(x, sr):
    """Band-limited (FFT) resampling to RATE; the clips start and end quiet, so the edges don't ring."""
    if sr == RATE:
        return x
    n = int(round(len(x) * RATE / sr))
    spec = np.fft.rfft(x)
    out = np.zeros(n // 2 + 1, complex)
    k = min(len(spec), len(out))
    out[:k] = spec[:k]
    return np.fft.irfft(out, n) * (n / len(x))


_loaded = {}


def unpack_7z(archive, folder):
    """Unpacks a .7z once, into its own folder (py7zr; paths checked to stay inside)."""
    if not folder.exists():
        import py7zr
        with py7zr.SevenZipFile(archive) as z:
            for name in z.getnames():
                assert not pathlib.PurePosixPath(name).is_absolute() and ".." not in pathlib.PurePosixPath(name).parts
            z.extractall(folder)
    return folder


def source(name):
    """A source recording as mono floats at RATE."""
    if name not in _loaded:
        kind, key = name.split(":", 1)
        if kind == "bsb":
            data = fetch(BSB.format(key), CACHE / "bigsoundbank" / f"{key}.ogg").read_bytes()
        else:
            url, inside = PACKS[kind]
            archive = fetch(url, CACHE / f"{kind}{pathlib.Path(url).suffix}")
            if archive.suffix == ".7z":
                data = (unpack_7z(archive, CACHE / kind) / inside.format(key)).read_bytes()
            else:
                with zipfile.ZipFile(archive) as z:
                    data = z.read(inside.format(key))
        x, sr = sf.read(io.BytesIO(data), always_2d=True)
        _loaded[name] = resample(x.mean(axis=1), sr)
    return _loaded[name]


def envelope(x, win=0.005):
    n = int(RATE * win)
    m = len(x) // n
    return 20 * np.log10(np.sqrt(np.mean(x[: m * n].reshape(m, n) ** 2, axis=1) + 1e-12)), n


def find_events(x, gap=0.12, on_db=-28, off_db=-48):
    """The separate sounds in a recording: where the level rises within on_db of its loudest after
    a quiet gap, until it stays below off_db for the length of the gap."""
    env, hop = envelope(x)
    top = env.max()
    out, i, quiet = [], 0, int(gap / 0.005)
    while i < len(env):
        if env[i] <= top + on_db:
            i += 1
            continue
        start = i
        while start > 0 and top + off_db < env[start - 1] < env[start]:
            start -= 1
        j, below = i, 0
        while j < len(env) and below < quiet:
            below = below + 1 if env[j] < top + off_db else 0
            j += 1
        out.append((start * hop, min(len(x), (j - below + 1) * hop)))
        i = j
    return out


def highpass(y, hz):
    pad = 4096
    z = np.concatenate([np.zeros(pad), y, np.zeros(pad)])
    spec = np.fft.rfft(z)
    f = np.fft.rfftfreq(len(z), 1 / RATE)
    spec *= np.clip((f - hz * 0.5) / (hz * 0.5), 0, 1)     # a gentle ramp from hz/2 to hz
    return np.fft.irfft(spec, len(z))[pad:-pad]


def render(spec):
    x = source(spec["src"])
    if "loop" in spec:          # a stretch to repeat: cut at the quietest moments near both ends, no fades
        env, hop = envelope(x, 0.02)

        def quiet(t):
            i, w = int(t * RATE / hop), int(0.6 * RATE / hop)
            return (max(0, i - w) + int(np.argmin(env[max(0, i - w):i + w]))) * hop

        a, b = quiet(spec["loop"][0]), quiet(spec["loop"][1])
        y = highpass(x[a:b] - np.mean(x[a:b]), 35)
        return y * (10 ** (-1 / 20) / np.abs(y).max())
    if "event" in spec:
        a, b = find_events(x)[spec["event"]]
    elif "at" in spec:
        a, b = (int(t * RATE) for t in spec["at"])
    else:
        a, b = 0, len(x)
    if "loudest" in spec:                       # the loudest stretch of this length
        n = int(spec["loudest"] * RATE)
        energy = np.convolve(x[a:b] ** 2, np.ones(n), "valid")
        a = max(0, a + int(np.argmax(energy)) - int(0.02 * RATE))
        b = min(len(x), a + n)
    if "peak_at" in spec:                       # a whoosh: start shortly before its loudest moment
        env, hop = envelope(x[a:b])
        a = max(a, a + int(np.argmax(env)) * hop - int(spec["peak_at"] * RATE))
    else:                                       # start right at the sound, not in the silence before it
        level = np.abs(x[a:b])
        a = max(0, a + int(np.argmax(level > level.max() * 0.03)) - int(0.003 * RATE))
    if "max" in spec:
        b = min(b, a + int(spec["max"] * RATE))
    y = x[a:b] - np.mean(x[a:b])
    y = highpass(y, spec.get("hp", 35))
    level = np.abs(y)
    y = y[: int(np.nonzero(level > level.max() * 10 ** (-60 / 20))[0][-1]) + 1]    # no silent tail
    fi = int(spec.get("fade_in", 0.002) * RATE)
    y[:fi] *= np.linspace(0, 1, fi)
    fo = min(len(y), int(spec.get("fade", 0.03) * RATE))
    y[len(y) - fo:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fo))
    return y * (10 ** (-1 / 20) / np.abs(y).max())      # peak at -1 dBFS; the game sets the mix


def write_ogg(path, x, sr, quality):
    # compression_level 0.5 is about 90 kbps for mono, 0.6 about 120 kbps for stereo.
    # libsndfile's Vorbis encoder crashes on one big write, so it's fed in blocks.
    channels = 1 if x.ndim == 1 else x.shape[1]
    with sf.SoundFile(str(path), "w", sr, channels, format="OGG", subtype="VORBIS", compression_level=quality) as f:
        for i in range(0, len(x), 4096):
            f.write(x[i:i + 4096])


def credit(src):
    kind, key = src.split(":", 1)
    if kind == "bsb":
        return f"BigSoundBank #{key}, {TITLES[key]} (Joseph Sardin, CC0)"
    if kind == "haeldb":
        return f"HaelDB, Male Grunt/Yelling sounds: {key}.wav (OpenGameArt, CC0)"
    if kind == "qubodup":
        return f"qubodup, 15 vocal male strain/hurt/pain/jump sounds: slightscream-{key}.flac (OpenGameArt, CC0)"
    pack = {"kenney-voice": "Voiceover Pack: Fighter", "kenney-ui": "Interface Sounds"}[kind]
    return f"Kenney, {pack}: {key}.ogg (CC0)"


def sheets(rendered):
    """Pictures of every variant (waveform and spectrogram), to check the cuts without hearing them."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    folder = ROOT / "art" / "out" / "sound-sheets"
    folder.mkdir(parents=True, exist_ok=True)
    for name, variants in rendered.items():
        fig, axes = plt.subplots(len(variants), 2, figsize=(12, 1.4 * len(variants)), squeeze=False)
        for row, y in enumerate(variants):
            t = np.arange(len(y)) / RATE
            axes[row][0].plot(t, y, lw=0.5)
            axes[row][0].set_ylim(-1, 1)
            axes[row][0].set_title(f"{name} [{row}]  {len(y) / RATE:.2f} s", fontsize=8, loc="left")
            axes[row][1].specgram(y + 1e-9, NFFT=512, Fs=RATE, noverlap=384, cmap="magma", vmin=-130)
            for ax in axes[row]:
                ax.tick_params(labelsize=6)
        fig.tight_layout()
        fig.savefig(folder / f"{name}.png", dpi=60)
        plt.close(fig)
    print("sheets in", folder)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    gap = np.zeros(int(0.08 * RATE))           # silence between sounds, so none bleeds into the next
    parts, pos, table, sources, rendered = [gap], len(gap), {}, {}, {}
    for name, specs in SOUNDS.items():
        for spec in specs:
            y = render(spec)
            rendered.setdefault(name, []).append(y)
            table.setdefault(name, []).append([round(pos / RATE, 5), round(len(y) / RATE, 5)])
            sources.setdefault(name, []).append(credit(spec["src"]))
            parts += [y, gap]
            pos += len(y) + len(gap)
    sprite = np.concatenate(parts)
    write_ogg(OUT / "sfx.oga", sprite, RATE, 0.5)
    (OUT / "sfx.json").write_text(json.dumps({"rate": RATE, "sounds": table, "from": sources}, indent=1) + "\n",
                                  newline="\n")     # not CRLF on Windows
    print(f"sfx.oga: {len(sprite) / RATE:.1f} s, {sum(map(len, table.values()))} variants of {len(table)} sounds,"
          f" {(OUT / 'sfx.oga').stat().st_size // 1024} KB")
    for name, url in MUSIC.items():
        x, sr = sf.read(str(fetch(url, CACHE / "music" / url.rsplit("/", 1)[1])), always_2d=True)
        write_ogg(OUT / f"{name}.oga", x * (10 ** (-1 / 20) / np.abs(x).max()), sr, 0.6)
        print(f"{name}.oga: {len(x) / sr:.0f} s, {(OUT / f'{name}.oga').stat().st_size // 1024} KB")
    if "--sheets" in sys.argv:
        sheets(rendered)


if __name__ == "__main__":
    main()
