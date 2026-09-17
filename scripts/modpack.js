#!/usr/bin/env node
/**
 * YuruMC modpack resolver.
 *
 * Give it the modpack links the servers actually run and it writes the
 * boring facts (name, version, Minecraft version, mod loader, download
 * link, ...) into data/modpacks.json. `build.js` then renders the modded
 * server cards on modded.html from that file, so updating the page after a
 * pack bump is: run this, run `npm run build`, commit.
 *
 * Usage:
 *   npm run modpack -- [key=]<url> [[key=]<url> ...]
 *
 * Accepted links:
 *   https://modrinth.com/modpack/<slug>[/version/<v>]     Modrinth project
 *   https://www.curseforge.com/minecraft/modpacks/<slug>[/files/<id>]
 *   https://.../whatever.mrpack                           a bare Modrinth-format pack
 *
 * `key=` gives the entry a stable id for the templates (`{{pack.<key>.name}}`).
 * Without one the id is derived from the slug, which can change when a pack
 * is renamed — so the templates use explicit keys.
 *
 * CurseForge needs an API key from https://console.curseforge.com/ in the
 * CF_API_KEY environment variable. Modrinth and plain .mrpack links need
 * nothing. No key is ever read from a server or written to the data file.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = join(ROOT, 'data', 'modpacks.json');
const UA = 'YuruMC-site-builder/2.0 (+https://mc.funami.tech; himesaka@noa.codes)';
const CF_GAME_MINECRAFT = 432;
const CF_CLASS_MODPACKS = 4471;
// A CurseForge modpack manifest lists every bundled project in one flat array,
// mods and resource packs and shaders alike. Only /v1/mods knows which is which.
const CF_CLASS_MODS = 6;
const CF_CLASS_RESOURCE_PACKS = 12;
const CF_CLASS_SHADER_PACKS = 6552;
const CF_BULK_CHUNK = 50;

/** A fatal, user-facing problem — printed without a stack trace. */
class LoudError extends Error {}

function die(message, hint) {
  throw new LoudError(hint ? `${message}\n  → ${hint}` : message);
}

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
  if (res.status === 403 || res.status === 401) {
    die(`${url} refused us (HTTP ${res.status}).`, 'For CurseForge that means CF_API_KEY is missing, wrong, or not allowed to read this game.');
  }
  if (res.status === 404) die(`${url} does not exist (HTTP 404).`, 'Check the slug/id in the link you passed.');
  if (!res.ok) die(`${url} returned HTTP ${res.status}.`);
  return res.json();
}

async function postJSON(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (res.status === 403 || res.status === 401) {
    die(`${url} refused us (HTTP ${res.status}).`, 'For CurseForge that means CF_API_KEY is missing, wrong, or not allowed to read this game.');
  }
  if (!res.ok) die(`${url} returned HTTP ${res.status}.`);
  return res.json();
}

/* ------------------------------------------------------------------ *
 * Reading one file out of a remote .zip/.mrpack without downloading the
 * whole thing: HTTP range requests over the central directory. Falls back
 * to a full download when the host will not do ranges.
 *
 * CurseForge's API still hands out edge.forgecdn.net URLs, which 404; the
 * live CDN is mediafilez.forgecdn.net. We try both.
 * ------------------------------------------------------------------ */

function candidateUrls(url) {
  const swapped = url.replace('//edge.forgecdn.net/', '//mediafilez.forgecdn.net/');
  return swapped === url ? [url] : [url, swapped];
}

async function openRemoteZip(url) {
  let head = null;
  for (const candidate of candidateUrls(url)) {
    const res = await fetch(candidate, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (res.ok) {
      head = {
        url: res.url || candidate,
        size: Number(res.headers.get('content-length')) || 0,
        ranges: (res.headers.get('accept-ranges') || '').includes('bytes'),
      };
      break;
    }
  }
  if (!head) die(`Could not reach ${url} (every candidate URL answered with an error).`);

  if (head.ranges && head.size) {
    return {
      url: head.url,
      size: head.size,
      // Explicit start-end ranges only: some CDNs answer 501 to a suffix range.
      async read(start, len) {
        const end = Math.min(start + len, head.size) - 1;
        const r = await fetch(head.url, { headers: { 'User-Agent': UA, Range: `bytes=${start}-${end}` } });
        if (r.status !== 206) die(`${head.url} ignored our Range request (HTTP ${r.status}).`);
        return Buffer.from(await r.arrayBuffer());
      },
    };
  }

  const res = await fetch(head.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) die(`Could not download ${head.url} (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { url: head.url, size: buf.length, read: async (start, len) => buf.subarray(start, start + len) };
}

/** Return one named entry from a remote zip, plus the URL it really came from. */
async function readZipEntry(url, wanted) {
  const zip = await openRemoteZip(url);
  const tailLen = Math.min(66000, zip.size);
  const tail = await zip.read(zip.size - tailLen, tailLen);

  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) die(`${zip.url} is not a zip archive (no end-of-central-directory record).`);

  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) die(`${zip.url} is a zip64 archive, which this script does not read.`);
  const cd = await zip.read(cdOffset, cdSize);

  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    if (name === wanted) {
      const header = await zip.read(localOffset, 30);
      const skip = 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      const raw = await zip.read(localOffset + skip, compSize);
      if (method !== 0 && method !== 8) {
        die(`${wanted} inside ${zip.url} uses unsupported compression method ${method}.`);
      }
      return { data: method === 0 ? raw : inflateRawSync(raw), url: zip.url };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { data: null, url: zip.url };
}

const LOADER_NAMES = {
  neoforge: 'NeoForge', forge: 'Forge', 'fabric-loader': 'Fabric', fabric: 'Fabric',
  quilt: 'Quilt', 'quilt-loader': 'Quilt', liteloader: 'LiteLoader',
};
const prettyLoader = (id) => LOADER_NAMES[id.toLowerCase()] || id;

/** Pull loader + mod count out of a Modrinth-format pack's index. */
async function readMrpack(url) {
  const { data } = await readZipEntry(url, 'modrinth.index.json');
  if (!data) die(`${url} has no modrinth.index.json — that is not a Modrinth-format modpack.`);
  const index = JSON.parse(data.toString('utf8'));
  const deps = index.dependencies || {};
  const loaderId = Object.keys(deps).find((k) => k !== 'minecraft');
  const files = index.files || [];
  const under = (dir) => files.filter((f) => (f.path || '').startsWith(`${dir}/`)).length;
  return {
    name: index.name || null,
    version: index.versionId || null,
    summary: index.summary || null,
    minecraft: deps.minecraft || null,
    loader: loaderId ? prettyLoader(loaderId) : null,
    loaderVersion: loaderId ? deps[loaderId] : null,
    fileCount: files.length,
    modCount: under('mods'),
    resourcePackCount: under('resourcepacks'),
    shaderCount: under('shaderpacks'),
  };
}

/** Pull loader + mod count out of a CurseForge pack's manifest. */
async function readCurseManifest(url) {
  const { data, url: realUrl } = await readZipEntry(url, 'manifest.json');
  if (!data) die(`${realUrl} has no manifest.json — that is not a CurseForge modpack archive.`);
  const manifest = JSON.parse(data.toString('utf8'));
  const loader = (manifest.minecraft && manifest.minecraft.modLoaders || [])
    .find((l) => l.primary) || (manifest.minecraft && manifest.minecraft.modLoaders || [])[0];
  const [loaderId, loaderVersion] = loader ? String(loader.id).split(/-(.+)/) : [];
  return {
    name: manifest.name || null,
    version: manifest.version || null,
    minecraft: manifest.minecraft && manifest.minecraft.version || null,
    loader: loaderId ? prettyLoader(loaderId) : null,
    loaderVersion: loaderVersion || null,
    fileCount: (manifest.files || []).length,
    projectIds: (manifest.files || []).map((f) => f.projectID).filter((id) => Number.isInteger(id)),
    directUrl: realUrl,
  };
}

/**
 * Split a modpack's bundled projects into mods / resource packs / shaders.
 * The manifest only carries project ids, so ask /v1/mods in bulk (the endpoint
 * takes a list) and bucket the answers by classId.
 */
async function classifyCurseProjects(projectIds, headers) {
  const counts = { modCount: 0, resourcePackCount: 0, shaderCount: 0, otherCount: 0 };
  let seen = 0;
  for (let i = 0; i < projectIds.length; i += CF_BULK_CHUNK) {
    const chunk = projectIds.slice(i, i + CF_BULK_CHUNK);
    const { data } = await postJSON('https://api.curseforge.com/v1/mods', { modIds: chunk }, headers);
    for (const mod of data || []) {
      seen += 1;
      if (mod.classId === CF_CLASS_MODS) counts.modCount += 1;
      else if (mod.classId === CF_CLASS_RESOURCE_PACKS) counts.resourcePackCount += 1;
      else if (mod.classId === CF_CLASS_SHADER_PACKS) counts.shaderCount += 1;
      else counts.otherCount += 1;
    }
  }
  if (seen !== projectIds.length) {
    // Never publish a count we could not account for.
    die(`CurseForge only classified ${seen} of ${projectIds.length} bundled projects.`,
      'Re-run; if it keeps happening the pack references a deleted project and the count cannot be trusted.');
  }
  return counts;
}

/* ----------------------------- resolvers ----------------------------- */

async function resolveModrinth(slug, wantedVersion) {
  const project = await getJSON(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}`);
  if (project.project_type !== 'modpack') {
    die(`Modrinth project "${slug}" is a ${project.project_type}, not a modpack.`);
  }
  const versions = await getJSON(`https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}/version`);
  if (!versions.length) die(`Modrinth project "${slug}" has no published versions.`);
  const version = wantedVersion
    ? versions.find((v) => v.id === wantedVersion || v.version_number === wantedVersion)
    : versions[0];
  if (!version) die(`Modrinth project "${slug}" has no version "${wantedVersion}".`);

  const file = (version.files.find((f) => f.primary) || version.files[0]) || {};
  const fromPack = file.url && file.filename && file.filename.endsWith('.mrpack')
    ? await readMrpack(file.url) : {};

  return {
    source: 'modrinth',
    name: project.title,
    summary: project.description || null,
    version: version.version_number,
    minecraft: (version.game_versions || [])[0] || fromPack.minecraft || null,
    loader: (version.loaders || []).map(prettyLoader)[0] || fromPack.loader || null,
    loaderVersion: fromPack.loaderVersion || null,
    modCount: fromPack.modCount ?? null,
    resourcePackCount: fromPack.resourcePackCount ?? null,
    shaderCount: fromPack.shaderCount ?? null,
    pageUrl: `https://modrinth.com/modpack/${project.slug}`,
    downloadUrl: file.url || null,
    fileName: file.filename || null,
    iconUrl: project.icon_url || null,
    updated: (version.date_published || project.updated || '').slice(0, 10) || null,
    slug: project.slug,
  };
}

async function resolveCurseForge(slug, fileId) {
  const key = process.env.CF_API_KEY;
  if (!key) {
    die('CurseForge links need an API key, and CF_API_KEY is not set.',
      'Make one at https://console.curseforge.com/ and run: CF_API_KEY=… npm run modpack -- <url>');
  }
  const headers = { 'x-api-key': key };
  const search = await getJSON(
    `https://api.curseforge.com/v1/mods/search?gameId=${CF_GAME_MINECRAFT}&classId=${CF_CLASS_MODPACKS}&slug=${encodeURIComponent(slug)}`,
    headers);
  const mod = (search.data || [])[0];
  if (!mod) die(`CurseForge has no modpack with the slug "${slug}".`, 'Copy the slug straight out of the project URL.');

  const id = fileId || mod.mainFileId;
  if (!id) die(`CurseForge modpack "${mod.name}" has no downloadable file.`);
  const { data: file } = await getJSON(`https://api.curseforge.com/v1/mods/${mod.id}/files/${id}`, headers);

  const gameVersions = file.gameVersions || [];
  const minecraft = gameVersions.find((v) => /^\d+\.\d+/.test(v)) || null;
  const loaderTag = gameVersions.find((v) => LOADER_NAMES[v.toLowerCase()]);
  if (!file.downloadUrl) {
    die(`CurseForge will not hand out a direct download for "${file.displayName}".`,
      'The author disabled third-party downloads; link the project page instead.');
  }
  const fromPack = await readCurseManifest(file.downloadUrl);
  const counts = await classifyCurseProjects(fromPack.projectIds, headers);

  return {
    source: 'curseforge',
    name: mod.name,
    summary: mod.summary || null,
    version: fromPack.version || file.displayName,
    minecraft: minecraft || fromPack.minecraft || null,
    loader: loaderTag ? prettyLoader(loaderTag) : fromPack.loader || null,
    loaderVersion: fromPack.loaderVersion || null,
    fileCount: fromPack.fileCount,
    modCount: counts.modCount,
    resourcePackCount: counts.resourcePackCount,
    shaderCount: counts.shaderCount,
    pageUrl: (mod.links && mod.links.websiteUrl) || `https://www.curseforge.com/minecraft/modpacks/${slug}`,
    downloadUrl: `${(mod.links && mod.links.websiteUrl) || `https://www.curseforge.com/minecraft/modpacks/${slug}`}/files/${file.id}`,
    directUrl: fromPack.directUrl,
    fileName: file.fileName || null,
    iconUrl: (mod.logo && mod.logo.url) || null,
    updated: (file.fileDate || mod.dateModified || '').slice(0, 10) || null,
    slug,
  };
}

async function resolveMrpackUrl(url) {
  const pack = await readMrpack(url);
  return {
    source: 'mrpack',
    name: pack.name,
    summary: pack.summary,
    version: pack.version,
    minecraft: pack.minecraft,
    loader: pack.loader,
    loaderVersion: pack.loaderVersion,
    modCount: pack.modCount,
    resourcePackCount: pack.resourcePackCount,
    shaderCount: pack.shaderCount,
    fileCount: pack.fileCount,
    pageUrl: url.slice(0, url.lastIndexOf('/') + 1),
    downloadUrl: url,
    fileName: decodeURIComponent(url.slice(url.lastIndexOf('/') + 1)),
    iconUrl: null,
    updated: null,
    slug: null,
  };
}

/* ------------------------------- driver ------------------------------- */

async function resolve(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    die(`"${url}" is not a URL.`, 'Paste the modpack page link, e.g. https://modrinth.com/modpack/<slug>');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    die(`"${url}" is not an http(s) link.`);
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (host === 'modrinth.com' || host === 'api.modrinth.com') {
    const i = parts.indexOf('modpack');
    if (i < 0 || !parts[i + 1]) {
      die(`"${url}" is not a Modrinth modpack link.`, 'Expected https://modrinth.com/modpack/<slug>');
    }
    return resolveModrinth(parts[i + 1], parts[i + 2] === 'version' ? parts[i + 3] : null);
  }
  if (host === 'curseforge.com') {
    const i = parts.indexOf('modpacks');
    if (i < 0 || !parts[i + 1]) {
      die(`"${url}" is not a CurseForge modpack link.`,
        'Expected https://www.curseforge.com/minecraft/modpacks/<slug>[/files/<id>]');
    }
    const fileId = parts[i + 2] === 'files' && /^\d+$/.test(parts[i + 3] || '') ? Number(parts[i + 3]) : null;
    return resolveCurseForge(parts[i + 1], fileId);
  }
  if (parsed.pathname.endsWith('.mrpack')) return resolveMrpackUrl(url);

  die(`Don't know how to resolve "${url}".`,
    'Give a modrinth.com/modpack/… link, a curseforge.com/minecraft/modpacks/… link, or a direct .mrpack URL.');
}

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main(args) {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log([
      'Usage: npm run modpack -- [key=]<url> [[key=]<url> ...]',
      '',
      '  https://modrinth.com/modpack/<slug>                 (no API key needed)',
      '  https://www.curseforge.com/minecraft/modpacks/<slug>  (needs CF_API_KEY)',
      '  https://host/path/pack.mrpack                       (no API key needed)',
      '',
      'Writes data/modpacks.json, which build.js renders into modded.html.',
    ].join('\n'));
    process.exit(args.length ? 0 : 1);
  }

  let file = { generated: null, packs: {} };
  try {
    file = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    if (!file.packs) file.packs = {};
  } catch (err) {
    if (err.code !== 'ENOENT') die(`data/modpacks.json exists but is not valid JSON: ${err.message}`);
  }

  for (const arg of args) {
    const match = /^([\w-]+)=(https?:\/\/.*)$/.exec(arg);
    const url = match ? match[2] : arg;
    console.log(`resolving ${url}`);
    const pack = await resolve(url);
    const key = match ? match[1] : slugify(pack.slug || pack.name || 'pack');
    file.packs[key] = { id: key, sourceUrl: url, ...pack };
    console.log(`  ${key}: ${pack.name} ${pack.version ?? ''} — Minecraft ${pack.minecraft ?? '?'}, ` +
      `${pack.loader ?? '?'} ${pack.loaderVersion ?? ''}${pack.modCount != null ? `, ${pack.modCount} mods` : ''}` +
      `${pack.resourcePackCount ? `, ${pack.resourcePackCount} resource packs` : ''}` +
      `${pack.shaderCount ? `, ${pack.shaderCount} shaderpacks` : ''}`);
  }

  file.generated = new Date().toISOString().slice(0, 10);
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(file, null, 2) + '\n');
  console.log(`wrote data/modpacks.json (${Object.keys(file.packs).length} pack(s)) — now run \`npm run build\``);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`\nmodpack.js: ${err instanceof LoudError ? err.message : (err.stack || err.message)}\n`);
  process.exit(1);
});
