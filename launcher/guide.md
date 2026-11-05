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

- **Auto-update Launcher**: start-up check, background download and install-on-close for the launcher (installer and portable).
- **Auto-update Client**: the start-up sync of the Default installation's client files.

With a switch off nothing happens automatically; **Check now** in Settings (or Check in the Launcher update widget) still checks and offers the update.
