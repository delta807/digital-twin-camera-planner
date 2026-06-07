# Real-camera fallback stills

When the live overlay stream (the Jetson MJPEG URL) can't load, the Sensor View
overlay shows a committed backup image instead (see SensorView `compare.fallbackSrc`).

Drop two images here (same names, any reasonable JPG/PNG renamed to .jpg):

- `fallback-overhead.jpg`  — the real overhead D435i frame
- `fallback-wrist.jpg`     — the real wrist-camera frame

They're served from the site root (`/fallback-overhead.jpg`, `/fallback-wrist.jpg`)
and committed so teammates / the hosted site get them too.
