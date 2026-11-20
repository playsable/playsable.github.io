# Seyble

Promotional site for **Seyble**, a free-to-play 2D top-down pixel-art dark-fantasy MMO by Sable Studios (`@sabledept`), made in Godot.

Live at [https://playsable.github.io/](https://playsable.github.io/). The game plays at [/play/](https://playsable.github.io/play/).

The game is in **open beta**. It is free to play, with no pay-to-win: nobody can buy an advantage. Anything sold is cosmetic only.

## Run locally

This is a static site. Open it through a local server so the module script and images load.

```bash
python3 -m http.server 47231
```

Then visit [http://127.0.0.1:47231](http://127.0.0.1:47231).

The site is the repository root. `index.html` is the page. Styles are in that file. There is no build step.

Asset paths are relative to the site root, so the folder can be hosted at a subpath such as `/sable-site/`.

## Layout

- `index.html` — the page
- `js/site.js` — starfield, navigation, gallery, skill sky, server status
- `assets/sky/` — parallax starfield, horizon, twinkle strip, `sky_twinkles.json`
- `assets/scenes/` — scene art
- `assets/title_logo.png` — title
- `assets/fonts/` — Alegreya (SIL Open Font License)
- `assets/skill_sky_full.mp4` — skill sky film, muted and looping
- `assets/skill_sky_map.json` — constellation drawn if the film cannot play

## Skill sky film

`assets/skill_sky_full.mp4` autoplays muted and looped in the skill sky section. The drawn constellation stays up until that file loads, and stays if the file is missing.
