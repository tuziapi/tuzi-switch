# Synthetic media

These files contain only generated test patterns, no provider output or user data.
Recreate with ffmpeg:

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=25 -t 1 -c:v libx264 -pix_fmt yuv420p synthetic-video.mp4
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=8000 -t 1 -c:a pcm_s16le synthetic-audio.wav
```
