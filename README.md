# Seyble

Promotional site for **Seyble**, a free-to-play 2D top-down pixel-art dark-fantasy MMO by Sable Studios (`@sabledept`), made in Godot.

Live at [https://seyble.com/](https://seyble.com/). The game plays at [/play/](https://seyble.com/play/).

The game is in **open beta**. It is free to play, with no pay-to-win: nobody can buy an advantage. Anything sold is cosmetic only.

## Run locally

This is a static site. Open it through a local server so the module script and images load.

```bash
python3 -m http.server 47231
```

Then visit [http://127.0.0.1:47231](http://127.0.0.1:47231).

The homepage is `index.html`. The homepage, patch notes and legal pages share `css/site.css`. There is no build step. Host the site at the domain root so root-absolute paths (`/css/site.css`, `/#latest`, `/favicon.ico`) resolve.

## Layout

- `index.html` — the homepage
- `js/site.js` — screenshot viewer, section links and world status
- `assets/scenes/` — gameplay captures, thumbnails and world artwork
- `assets/title_logo_pixel09.png` — Seyble wordmark
- `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png` — site icons from the wordmark S
- `assets/fonts/` — Alegreya (SIL Open Font License)
- `assets/skill_sky_full.mp4` — player-controlled film in the schools of magic section
