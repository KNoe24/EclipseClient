# Launcher Update Systems

This launcher uses two different update systems:

1. Launcher updates
2. Client/game updates

Launcher updates update the Electron app itself: UI, renderer code, main process code, assets, and packaged launcher files.

Client/game updates update the custom Minecraft client version: custom version JSON, libraries, mods, configs, assets, and other files required by the launcher’s default installation.

## 1. Launcher Updates

Launcher updates are handled by `electron-updater`.

Use this for:

- launcher UI changes
- JavaScript/Electron code changes
- CSS changes
- launcher icons/assets
- preload/main process changes
- Discord RPC changes
- auth flow changes

Do not use this for:

- changing the custom Minecraft client version
- changing default client mods
- changing default client configs
- changing custom Minecraft runtime files

### Launcher update flow

1. Change the launcher source code.
2. Increase the app version in `package.json`.
3. Build the launcher.
4. Publish the packaged build to your launcher update provider.
5. The launcher checks for updates using `electron-updater`.
6. The user downloads and installs the launcher update.

## 2. Client/Game Updates

Client/game updates are controlled by:

```text
https://launcher.wawe.cc/launcher/default/manifest.json
```

Example: (manifest.json)

```text
{
  "name": "Default",
  "clientVersion": "1.0.1",
  "minecraftVersion": "1.21.1",
  "versionType": "release",
  "loaderType": "custom",
  "customVersionId": "wawe-client-1.21.1",
  "updateMode": "keep",
  "memory": {
    "min": "2G",
    "max": "4G"
  },
  "files": [
    {
      "path": "versions/wawe-client-1.21.1/wawe-client-1.21.1.json",
      "url": "https://launcher.wawe.cc/launcher/default/files/versions/wawe-client-1.21.1/wawe-client-1.21.1.json",
      "sha256": "PUT_SHA256_HASH_HERE"
    },
    {
      "path": "mods/example-mod.jar",
      "url": "https://launcher.wawe.cc/launcher/default/files/mods/example-mod.jar",
      "sha256": "PUT_SHA256_HASH_HERE"
    }
  ]
}
```

## 3. Portable Mode

In portable mode all launcher data (accounts, installations, skins, Minecraft files and Electron's own cache) is stored in an `EclipseData` folder next to the launcher instead of `%APPDATA%/.eclipse-client`.

The launcher runs portable when any of these is true:

- it is the portable build (`npm run build:portable`, creates `Eclipse Client-<version>-portable.exe`)
- a `portable.txt` (or `portable`) file is next to the launcher executable
- an `EclipseData` folder already exists next to the launcher executable
- the `ECLIPSE_DATA_DIR` environment variable points to a folder

Paths inside the data folder are saved relative to it, so the whole folder can be moved to another drive or PC.

### Portable updates

The portable `.exe` updates itself from the same launcher update folder:

1. Increase `version` in `package.json`.
2. Run `npm run build:portable` (or `npm run build:win` for installer + portable). This also writes `dist/latest-portable.json`.
3. Upload `Eclipse Client-<version>-portable.exe` and `latest-portable.json` to the launcher update folder, next to `latest.yml`.

The portable launcher reads `latest-portable.json`, downloads the new exe next to itself as `<name>.exe.update`, checks its sha512, and swaps it in when the launcher closes (or right away with "Restart & update"). If the swap can't happen, the old exe is left untouched.

A portable folder made with `portable.txt` (not the portable `.exe`) can't replace itself; update it by copying in the new launcher files.

### Releasing with one command

```
npm run release
```

This builds the installer and the portable exe, checks that `version` in `package.json` is higher than the one on the `launcher` branch, copies `latest.yml`, `latest-portable.json`, the installer (+ `.blockmap`) and the portable exe into its own copy of `eclipse-updates` (`launcher/release/eclipse-updates`, ignored by git), removes the previous version's exes, commits "Launcher <version>" and pushes to the `launcher` branch.

- `npm run release:dry` does everything except the push.
- `node scripts/release.js --skip-build` publishes what is already in `dist/`.
- The updates repo and branch are set under `"release"` in `package.json`.

## 4. Turning Auto-update Off

Settings → Updates has two separate switches:

- **Auto-update Launcher**: start-up check for the launcher (installer and portable). When an update is out you get a popup: **Yes** downloads it with a green progress bar and restarts into the new version, **No** skips that version until you press Check now.
- **Auto-update Client**: the start-up sync of the Default installation's client files.

With a switch off nothing happens automatically; **Check now** in Settings (or Check in the Launcher update widget) still checks and offers the update.

## 5. Shared Folders

Settings → Shared Folders → **Manage** opens the shared folders menu:

- Turn sharing on/off for everything, or per folder (`saves`, `resourcepacks`, `shaderpacks`,
  `screenshots`, `schematics`, `replay_recordings`).
- Click a folder's name to rename it. **Add folder** shares any other game folder by name
  (e.g. `XaeroWorldMap`); added folders can be removed again.
- **Change** moves the whole shared location, **Choose folder** points one folder somewhere else
  (e.g. your old `.minecraft/saves`).
- Files already in an installation are moved into the shared folder; a name clash is kept as
  `Name (installation)`. Nothing is deleted. Removing or turning off a folder leaves its files
  in the shared folder.

Per installation: installation editor → **Shared files** tab. Turn off "Use shared folders" or
single folders to give that installation its own folder. You can copy the shared files in or
start empty.

Each installation's folder is a link (a junction on Windows, no admin needed). Links are checked
every time you press Start.

Drives that can't hold links (FAT32/exFAT, common on USB sticks) use move mode instead: the shared
folder is moved into the installation when you press Start and moved back when the game closes
(instant on the same drive). A lease file next to the shared folder records who has it; if the
launcher crashes, the next start moves everything back. If two installations run at once, the
second one uses its own folder for that session. The Shared Folders menu shows a yellow note when
your drive uses move mode. Deleting an installation removes its links first, so shared worlds are
never deleted, and the client updater's delete mode skips shared folders.

## 6. Mods from Modrinth

Installation editor → Mods → **Browse Modrinth** searches mods for that installation's version
and loader. Before installing, it lists the required mods and lets you tick which to install.
Mods you already have are recognised, even jars you added by hand (matched by file hash), and
start unticked. The search box above the mod list filters installed mods.

## 7. Modpacks

Installations → **Modpack** searches Modrinth modpacks (or **Import .mrpack** for a file). Pick a
version and a name: the launcher makes a new installation, installs the loader (Fabric and Quilt
from their official servers, Forge/NeoForge from their official installers), downloads every
file (checksums verified, only Modrinth-approved hosts) and copies the pack's configs. If
something fails, the half-made installation is removed again.

## 8. Share Codes

Installation editor → **Share** makes one long text code with the installation's version, loader,
memory/arguments, `options.txt` (video, controls, sound), optionally the `config` folder, and the
list of mods. Mods are identified on Modrinth by file hash, so the same versions are downloaded.
Mods that aren't on Modrinth are listed so you can send them separately.

Installations → **Import code** → paste → a new installation is made with the same settings and
mods.

## 9. Baby Mode

Developer panel (↑↑↓↓←→←→ Enter) → **Baby Mode** hides everything technical (console, changelog,
Java paths, arguments, version JSON tools, shared folders, update switches, technical widgets)
and uses plainer words. Settings shows a "Baby Mode is on" switch to turn it off again.
