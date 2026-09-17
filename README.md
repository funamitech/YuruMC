# YuruMC

Website for [mc.funami.tech](https://mc.funami.tech) — YuruMC, a laid-back semi-vanilla
SMP Minecraft server running since 2021, hosted in Gyeonggi, South Korea. Part of the
[YuruVerse](https://funami.tech) and built on the same design system as
[YuruMirror](https://github.com/funamitech/mirror).

## Tech stack

- Tailwind CSS 4 (CSS-first config in `src/assets/css/input.css` — no `tailwind.config.js`)
- A ~90-line template builder (`build.js`) that expands shared partials into static pages
- Vanilla JS, self-hosted Inter variable font, inline SVG icon sprite — **no CDNs, no frameworks**
- Plain nginx serving `src/` as the webroot

## Project structure

```
YuruMC/
├── templates/            # HTML sources — EDIT THESE
│   ├── partials/         # head, nav, footer, icon sprite, error-page shell
│   ├── index.html        # the one and only page
│   ├── 500.html          # maintenance page (nginx: error_page 503 /500.html)
│   └── error/            # 403 / 404 / 50x (one include line each)
├── src/                  # deployable webroot — generated pages + static assets
│   └── assets/           # css (input.css + built tailwind.css), js, fonts, img
├── build.js              # expands templates/ -> src/
└── dev/server.js         # tiny dev server (re-expands templates on every refresh)
```

`src/*.html`, `src/error/*.html` and `src/assets/css/tailwind.css` are build artifacts
(committed so that `src/` can be deployed as-is). Edit `templates/` and `input.css`,
then rebuild.

## Development

```bash
npm install
npm run dev          # http://localhost:8080 — templates re-expand on every refresh
npm run build-css    # Tailwind in watch mode (run alongside `npm run dev`)
```

Append `?theme=dark` or `?theme=light` to any page to force a color scheme while
testing (the toggle in the header persists the choice in `localStorage`).

No dev server needed for a quick look either: `python3 -m http.server 8080 --directory src`.

## Build & deploy

```bash
npm run build        # expand templates + minified CSS
```

Deploy the `src/` directory as the webroot. Error pages live at the paths nginx
expects for this host:

```nginx
error_page 503 /500.html;          # maintenance
error_page 403 /error/403.html;
error_page 404 /error/404.html;
error_page 500 502 504 /error/50x.html;
```

## Updating the content

- Server addresses, rules and the modded server card: `templates/index.html`
- Navigation and footer links: `templates/partials/nav.html`, `templates/partials/footer.html`
- Maintenance message: `templates/500.html`
- Modpack version / loader (chip and "Version" row in the modded card): `templates/index.html` — check `modrinth.index.json` inside the `.mrpack` on the mirror when the pack updates
- Page title, description and `og:image` are passed as parameters to `partials/head.html` from each page
- Icons: add Lucide symbols to `templates/partials/icons.html`

## Scripts

- `npm run dev` — dev server
- `npm run build` — templates + minified CSS (production)
- `npm run build-css` — CSS watch mode
- `npm run lint` / `npm run lint:fix` — ESLint

## License

GPL-3.0 — see [LICENSE](LICENSE). Design system shared with
[funamitech/mirror](https://github.com/funamitech/mirror).
