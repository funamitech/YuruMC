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
│   ├── index.html        # the front page (vanilla SMP)
│   ├── modded.html       # both modded servers
│   ├── 500.html          # maintenance page (nginx: error_page 503 /500.html)
│   └── error/            # 403 / 404 / 50x (one include line each)
├── src/                  # deployable webroot — generated pages + static assets
│   └── assets/           # css (input.css + built tailwind.css), js, fonts, img
├── data/modpacks.json    # generated modpack facts (committed) — see below
├── scripts/modpack.js    # resolves modpack links -> data/modpacks.json
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

## Modpack data (`npm run modpack`)

Every modpack fact on `modded.html` — pack name, pack version, Minecraft version, mod
loader and its version, mod count, download link — is rendered from `data/modpacks.json`
rather than typed into the HTML. That file is produced by `scripts/modpack.js` from the
real Modrinth / CurseForge listings, so a pack bump is three commands, not a hunt through
templates.

```bash
npm run modpack -- modded="https://mirror.funami.tech/yurumc/YuruMC%20Pack%20NeoForged%201.21.mrpack"
CF_API_KEY=… npm run modpack -- modded-survival="https://www.curseforge.com/minecraft/modpacks/terrafirmagreg-modern/files/8813051"
npm run build        # re-renders the pages from the new data
git add data/modpacks.json src && git commit
```

**Link forms it accepts**

| Link | Needs a key? | Where the facts come from |
| --- | --- | --- |
| `https://modrinth.com/modpack/<slug>[/version/<v>]` | no | `api.modrinth.com` + the version's `.mrpack` index |
| `https://www.curseforge.com/minecraft/modpacks/<slug>[/files/<id>]` | **yes** | `api.curseforge.com` + the pack zip's `manifest.json` |
| `https://…/anything.mrpack` | no | the pack's own `modrinth.index.json` |

Loader version and mod count are read straight out of the pack archive, over HTTP range
requests — it reads a few kilobytes of a 170 MB zip instead of downloading it.

**`key=` prefix.** `modded=…` stores the entry under that id, and templates then use
`{{pack.modded.name}}`, `{{pack.modded-survival.loaderVersion}}` and friends. Without a
prefix the id is derived from the pack slug, which moves when a pack is renamed — the two
keys above are wired into `templates/modded.html` and `templates/index.html`, so keep them.

**The CurseForge key.** Make your own at <https://console.curseforge.com/> and pass it in
the `CF_API_KEY` environment variable. The script never reads a key from a server, never
stores one, and never writes one into `data/modpacks.json` (that file holds public
metadata only). Modrinth and plain `.mrpack` links need no key at all.

**When something is wrong** the script stops with a plain-English message and a non-zero
exit — bad or unrecognised URL, missing `CF_API_KEY`, unknown slug, an author who has
disabled third-party downloads — rather than writing half a file.

## Updating the content

- Server addresses, rules and the modded teaser: `templates/index.html`
- The modded servers page: `templates/modded.html`
- Modpack names/versions/loaders: **don't edit the HTML** — run `npm run modpack` (above), then `npm run build`
- Navigation and footer links: `templates/partials/nav.html`, `templates/partials/footer.html`
- Maintenance message: `templates/500.html`
- Page title, description and `og:image` are passed as parameters to `partials/head.html` from each page
- Icons: add Lucide symbols to `templates/partials/icons.html`

## Scripts

- `npm run dev` — dev server
- `npm run build` — templates + minified CSS (production)
- `npm run modpack -- [key=]<url> …` — refresh `data/modpacks.json` from Modrinth/CurseForge
- `npm run build-css` — CSS watch mode
- `npm run lint` / `npm run lint:fix` — ESLint

## License

GPL-3.0 — see [LICENSE](LICENSE). Design system shared with
[funamitech/mirror](https://github.com/funamitech/mirror).
