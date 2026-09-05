# Hero video — what to capture and how to encode it

The landing page hero can scrub a video with the scroll. The mechanism is
built and shipped; there is no file yet. This is the spec for the file.

## Turning it on

One edit. In `index.html`, put the path in the attribute that is currently
empty:

```html
<section class="hero" aria-labelledby="hero-title" data-hero-video="/assets/video/hero.mp4">
```

Empty means off, and off is the shipping state — nothing is requested and
nothing is created. If the path is wrong, or the file fails to decode, the
hero silently stays exactly as it is now. There is no broken state to hit.

## The one thing that makes or breaks it

**Keyframe interval.** Scrubbing is a continuous seek. To show frame N the
decoder must start at the last keyframe before N and decode forward. With
normal web encoding — a keyframe every 2 to 10 seconds — every scroll frame
decodes up to ten seconds of video, and it stutters no matter how fast the
machine is.

**Put a keyframe every 6 frames.** At 30fps that is one every 0.2s. The file
gets roughly 2–3× larger than the same footage encoded normally. That is the
trade, and it is not optional; a smaller file that stutters is worse than no
video at all.

## Encoding settings

| Setting | Value | Why |
|---|---|---|
| Container | MP4 | Widest seek support. Not WebM — VP9 seeking is measurably worse. |
| Codec | H.264 High profile | Hardware-decoded everywhere. H.265/AV1 are smaller but decode-heavy when seeking. |
| Resolution | 1920×1080 | It is a full-bleed background, and `object-fit: cover` crops it. |
| Frame rate | 30fps | 60 doubles the file and nobody perceives it while scrubbing. |
| Keyframe interval | **6 frames** | The whole ballgame. See above. |
| Bitrate | 4–6 Mbps VBR, capped | Dense keyframes need the headroom. |
| Duration | **6–10 seconds** | This is a length budget, not a creative one. See below. |
| Audio | **None** | Muted anyway. Strip it; it is dead weight. |
| `faststart` | Yes | Moves the index to the front so seeking works before the file finishes downloading. |
| Pixel format | yuv420p | Anything else fails to decode in Safari. |

### ffmpeg

```bash
ffmpeg -i capture.mov \
  -an \
  -c:v libx264 -profile:v high -pix_fmt yuv420p \
  -vf "scale=1920:-2,fps=30" \
  -g 6 -keyint_min 6 -sc_threshold 0 \
  -b:v 5M -maxrate 6M -bufsize 10M \
  -movflags +faststart \
  assets/video/hero.mp4
```

`-sc_threshold 0` matters as much as `-g 6`: without it the encoder inserts
keyframes on scene changes and ignores your interval on everything else.

Check the result actually has the keyframes you asked for:

```bash
ffprobe -select_streams v -show_frames -show_entries frame=key_frame \
  -of csv hero.mp4 | head -40
```

You want `frame,1` every sixth line. If you see long runs of `frame,0`, the
interval did not take and it will stutter.

## Weight, so you can decide what is acceptable

At 1920×1080, 30fps, keyframes every 6 frames:

| Duration | 4 Mbps | 5 Mbps | 6 Mbps |
|---|---|---|---|
| 6s | 3.0 MB | 3.8 MB | 4.5 MB |
| 8s | 4.0 MB | 5.0 MB | 6.0 MB |
| 10s | 5.0 MB | 6.3 MB | 7.5 MB |
| 15s | 7.5 MB | 9.4 MB | 11.3 MB |

For scale: the whole landing page today is **3.6 KB gzipped** of HTML plus
about 4 KB of CSS. Any of these numbers is three orders of magnitude more
than the entire site.

**Recommendation: 8 seconds at 5 Mbps, so about 5 MB.** Long enough that the
scrub has somewhere to go across a full-viewport hero, short enough to
finish downloading before most people have scrolled past it. Do not go past
10 seconds — the hero is only one viewport tall, so a longer clip just means
the scrub races through it faster, and you pay for footage nobody sees.

If 5 MB is more than you want to spend, cut the duration before you cut the
bitrate or the keyframe density. A 6-second clip that scrubs cleanly beats a
15-second one that stutters.

## Mobile: skipped entirely

Below **1024px viewport width the video is never requested**. No smaller
encode, no separate file — phones and small tablets keep the gradient hero.

Chosen over shipping a mobile encode because:

- Even a heavily compressed 720p version is well over a megabyte, which is a
  lot to spend on decoration over cellular.
- Seeking is the most expensive thing a mobile video decoder does, and the
  scrub is nothing but seeking.
- The gradient hero already looks right on a phone. It is not a fallback that
  needs apologising for.

Data Saver is also honoured: if the browser reports `saveData`, the video is
skipped at any width.

If you later want a mobile encode, that is a real change to the script rather
than a config tweak — the current code has one source and one breakpoint on
purpose.

## What to capture

Gameplay from the actual games, which is the reason this is worth doing at
all. Practical notes for footage that scrubs well:

- **Continuous motion, no cuts.** A cut mid-scrub reads as a broken seek.
- **Slow, steady movement.** The scroll controls the speed; the footage
  should not have its own competing pace.
- **Frame it for a crop.** `object-fit: cover` cuts the sides on a tall
  window and the top and bottom on a wide one. Keep the interesting part in
  the middle 60%.
- **Nothing important in the corners.** The wordmark sits over the left, the
  scroll cue over the bottom centre.
- **Darker footage grades better.** There is a scrim over it, but the type
  still has to hold; a bright frame under white text is the one thing that
  will look wrong.

## Reduced motion

With `prefers-reduced-motion: reduce`, the video loads and freezes on frame
one — a still image, no scrubbing, no parallax on the text. Same file, no
separate asset.
