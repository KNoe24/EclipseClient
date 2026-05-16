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