"""Build the STOP/PROVE demo video as a HyperFrames composition.

    uv run python video/build.py            # voice-over (Kokoro) + word timings (Whisper) + composition
    cd brag-output/composition && npx hyperframes check && npx hyperframes render --output ../brag.mp4

Scenes live in video/scenes.json. Each scene gets its own narration file so its length follows the voice.
Subtitles are chunked from Whisper word timings. No music and no SFX (the user asked for voice-over only).
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIDEO = ROOT / "video"
OUT = ROOT / "brag-output" / "composition"
ASSETS = OUT / "assets"
VOICE = "am_michael"
HF = ["npx", "--yes", "hyperframes@0.8.149"]
LEAD = 0.35  # silence before the voice in each scene
TAIL = 0.55  # breathing room after it
XFADE = 0.5  # crossfade between scene visuals


def sh(cmd: list[str], cwd: Path | None = None) -> None:
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", shell=sys.platform == "win32")
    if r.returncode != 0:
        raise SystemExit(f"command failed: {' '.join(cmd)}\n{r.stdout[-1500:]}\n{r.stderr[-1500:]}")


def wav_seconds(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True)
    return float(r.stdout.strip())


def voice(scene: dict) -> tuple[Path, float, list[dict]]:
    vo_dir = ASSETS / "vo"
    vo_dir.mkdir(parents=True, exist_ok=True)
    text = scene["narration"]
    h = hashlib.sha1(f"{VOICE}|{text}".encode()).hexdigest()[:10]
    wav = vo_dir / f"{scene['id']}-{h}.wav"
    words_file = wav.with_suffix(".words.json")
    if not wav.exists():
        for old in vo_dir.glob(f"{scene['id']}-*"):
            old.unlink()
        sh(HF + ["tts", text, "--voice", VOICE, "--output", str(wav)])
    if not words_file.exists():
        sh(HF + ["transcribe", str(wav), "--model", "small.en"], cwd=vo_dir)
        made = next((p for p in (vo_dir / "transcript.json", wav.parent / "transcript.json") if p.exists()), None)
        if made is None:
            raise SystemExit(f"transcribe produced no transcript.json for {wav.name}")
        shutil.move(str(made), words_file)
    return wav, wav_seconds(wav), json.loads(words_file.read_text(encoding="utf-8"))


def caption_chunks(words: list[dict], script: str) -> list[tuple[float, float, str]]:
    """Subtitle lines use the script's own words (Whisper normalises numbers and names); their timing comes
    from Whisper by mapping each line's character position onto the transcribed words."""
    toks = re.findall(r"\S+", script)
    lines, cur = [], []
    for i, tok in enumerate(toks):
        cur.append(tok)
        if len(cur) >= 9 or (len(cur) >= 4 and re.search(r"[.,:;?!]$", tok)) or i == len(toks) - 1:
            lines.append(" ".join(cur))
            cur = []
    if not words:
        return []
    wtext = [w["text"].strip() for w in words]
    wcum, acc = [], 0
    for t in wtext:
        wcum.append(acc)
        acc += len(t) + 1
    wtotal = max(acc, 1)
    stotal = max(len(script), 1)

    def time_at(frac: float, edge: str) -> float:
        pos = frac * wtotal
        k = max(0, min(len(words) - 1, next((i for i, c in enumerate(wcum) if c > pos), len(words)) - 1))
        return words[k][edge]

    out, spos = [], 0
    for line in lines:
        a = time_at(spos / stotal, "start")
        spos += len(line) + 1
        b = time_at(min(spos, stotal) / stotal, "end")
        out.append([a, max(b, a + 0.5), line])
    out[-1][1] = max(out[-1][1], words[-1]["end"])
    for i in range(len(out) - 1):  # never overlap the next line
        out[i][1] = min(out[i][1], out[i + 1][0] - 0.02)
    return [(a, b, s) for a, b, s in out]


def fonts_css() -> str:
    fdir = ASSETS / "fonts"
    css = []
    for fam, file in (("Inter", "Inter.woff2"), ("Space Grotesk", "SpaceGrotesk.woff2"), ("JetBrains Mono", "JetBrainsMono.woff2")):
        if (fdir / file).exists():
            css.append(f"@font-face {{ font-family: '{fam}'; src: url('assets/fonts/{file}') format('woff2'); font-weight: 100 900; }}")
    return "\n".join(css)


def build() -> None:
    spec = json.loads((VIDEO / "scenes.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    (ASSETS / "media").mkdir(parents=True, exist_ok=True)
    t = 0.0
    parts: list[str] = []
    tl: list[str] = []
    for i, sc in enumerate(spec["scenes"]):
        wav, vo_len, words = voice(sc)
        dur = max(sc.get("min", 0), LEAD + vo_len + TAIL)
        start = t
        vis_start = max(0.0, start - (XFADE if i else 0))
        vis_dur = dur + (start - vis_start)
        src = VIDEO / sc["media"]
        dst = ASSETS / "media" / src.name
        if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
            shutil.copy2(src, dst)
        rel = f"assets/media/{src.name}"
        wid = f"w{i}"
        if src.suffix.lower() in (".mp4", ".webm", ".mov"):
            parts.append(f'<div class="vwrap" id="{wid}"><video id="v{i}" class="media" src="{rel}" data-start="{vis_start:.2f}" '
                         f'data-duration="{vis_dur:.2f}" data-track-index="0" muted playsinline></video></div>')
        else:
            parts.append(f'<div class="clip vwrap" id="{wid}" data-start="{vis_start:.2f}" data-duration="{vis_dur:.2f}" data-track-index="0">'
                         f'<img id="i{i}" class="media kb" src="{rel}" alt=""></div>')
            z = sc.get("zoom", 1.06)
            tl.append(f'tl.fromTo("#i{i}", {{scale: 1}}, {{scale: {z}, duration: {vis_dur:.2f}, ease: "none"}}, {vis_start:.2f});')
        if i:
            tl.append(f'tl.fromTo("#{wid}", {{opacity: 0}}, {{opacity: 1, duration: {XFADE}, ease: "power1.inOut"}}, {vis_start:.2f});')
        if sc.get("push"):
            tl.append(f'tl.fromTo("#{wid}", {{scale: 1}}, {{scale: {sc["push"]}, duration: {vis_dur:.2f}, ease: "none"}}, {vis_start:.2f});')
        parts.append(f'<audio id="vo{i}" src="assets/vo/{wav.name}" data-start="{start + LEAD:.2f}" data-track-index="5" data-volume="1"></audio>')
        for j, ov in enumerate(sc.get("overlays", [])):
            o_start = start + ov.get("at", 0.4)
            o_dur = ov.get("hold", dur - ov.get("at", 0.4) - 0.2)
            oid = f"o{i}-{j}"
            cls = ov.get("style", "title")
            parts.append(f'<div class="clip ov ov-{cls}" data-start="{o_start:.2f}" data-duration="{o_dur:.2f}" data-track-index="2">'
                         f'<div class="ov-inner" id="{oid}">{ov["html"]}</div></div>')
            tl.append(f'tl.fromTo("#{oid}", {{y: 24, opacity: 0}}, {{y: 0, opacity: 1, duration: 0.5, ease: "power3.out"}}, {o_start:.2f});')
            tl.append(f'tl.to("#{oid}", {{opacity: 0, duration: 0.3, ease: "power1.in"}}, {o_start + o_dur - 0.3:.2f});')
        for k, (a, b, text) in enumerate(caption_chunks(words, sc["narration"])):
            c_start = start + LEAD + a
            c_dur = max(0.4, b - a)
            text = text.replace("STOP PROVE", "STOP/PROVE")  # spoken as two words, written as the wordmark
            parts.append(f'<div class="clip cap" data-start="{c_start:.2f}" data-duration="{c_dur:.2f}" data-track-index="3">'
                         f'<span>{html.escape(text)}</span></div>')
        t = start + dur
    total = t
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>STOP/PROVE: demo</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
{fonts_css()}
html, body {{ margin: 0; background: #07090c; }}
#root {{ position: relative; width: 100%; height: 100%; overflow: hidden; background: #07090c; color: #e7e9ee; font-family: 'Inter', sans-serif; }}
.vwrap {{ position: absolute; inset: 0; overflow: hidden; }}
.media {{ position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }}
.ov {{ position: absolute; inset: 0; display: flex; pointer-events: none; }}
.ov-inner {{ will-change: transform, opacity; }}
.ov-title {{ align-items: flex-start; justify-content: flex-start; padding: 84px 96px; }}
.ov-title .ov-inner {{ font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 64px; line-height: 1.1; color: #f4f5f8; background: rgba(7,9,12,0.80); padding: 22px 32px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.10); max-width: 1180px; }}
.ov-center {{ align-items: center; justify-content: center; }}
.ov-center .ov-inner {{ text-align: center; }}
.ov-tag {{ align-items: flex-start; justify-content: flex-end; padding: 72px 96px; }}
.ov-tag .ov-inner {{ font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 30px; color: #07090c; background: #f5c518; padding: 12px 22px; border-radius: 10px; }}
.ov-chip {{ align-items: flex-end; justify-content: flex-start; padding: 0 96px 190px; }}
.ov-chip .ov-inner {{ font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 44px; color: #f4f5f8; background: rgba(7,9,12,0.86); border-left: 6px solid #f5c518; padding: 16px 28px; border-radius: 10px; }}
.wordmark {{ font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 168px; letter-spacing: 2px; color: #f4f5f8; }}
.wordmark b {{ color: #f5c518; font-weight: 700; }}
.tagline {{ margin-top: 18px; font-size: 42px; color: #c9ced8; }}
.loop {{ margin-top: 56px; display: flex; gap: 18px; justify-content: center; font-family: 'JetBrains Mono', monospace; font-size: 30px; font-weight: 600; }}
.loop span {{ padding: 12px 22px; border: 1px solid rgba(245,197,24,0.55); border-radius: 999px; color: #f5c518; background: rgba(245,197,24,0.08); }}
.small {{ margin-top: 26px; font-size: 30px; color: #a3abb9; }}
.cap {{ position: absolute; left: 0; right: 0; bottom: 54px; display: flex; justify-content: center; pointer-events: none; }}
.cap span {{ max-width: 1500px; text-align: center; font-family: 'Inter', sans-serif; font-weight: 600; font-size: 40px; line-height: 1.3; color: #ffffff; background: rgba(5,6,9,0.82); padding: 10px 24px; border-radius: 12px; }}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="{total:.2f}">
{chr(10).join(parts)}
</div>
<script>
const tl = gsap.timeline({{ paused: true }});
{chr(10).join(tl)}
window.__timelines["main"] = tl;
</script>
</body>
</html>
"""
    (OUT / "index.html").write_text(page, encoding="utf-8")
    print(f"composition: {len(spec['scenes'])} scenes, {total:.1f} s -> {OUT / 'index.html'}")


if __name__ == "__main__":
    build()
