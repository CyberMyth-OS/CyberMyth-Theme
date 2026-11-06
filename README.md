# Cybermyth Theme

A GNOME Shell extension that renders a slowly rotating globe on the desktop background, with its continents drawn as glowing dots. The same look carries through the rest of the shell: a transparent top bar, translucent blurred menus, a tinted app grid, and a matching dock.

The globe is drawn directly onto the shell's own background, so there is no extra window and nothing stacked on top. Leave it as a solid dark scene, or lower the background opacity until the globe floats over your wallpaper.

Part of the [CyberMyth OS](https://cybermyth.dev) desktop.

## Requirements

- GNOME Shell 50 on Wayland

## Install

**From GNOME Extensions.** Search for *Cybermyth Theme* on [extensions.gnome.org](https://extensions.gnome.org) and toggle it on.

**From a release zip.**

```sh
gnome-extensions install --force cybermyth-theme@cybermyth.dev.shell-extension.zip
```

Log out and back in, then enable it:

```sh
gnome-extensions enable cybermyth-theme@cybermyth.dev
```

**From source.**

```sh
git clone https://github.com/CyberMyth-OS/CyberMyth-Theme.git
cd CyberMyth-Theme
gnome-extensions pack . \
  --extra-source=lib --extra-source=assets --extra-source=data \
  --extra-source=stylesheet-dark.css --extra-source=stylesheet-light.css \
  --extra-source=README.md --extra-source=LICENSE --force
gnome-extensions install --force cybermyth-theme@cybermyth.dev.shell-extension.zip
```

## Settings

Open the settings from the Extensions app, or run:

```sh
gnome-extensions prefs cybermyth-theme@cybermyth.dev
```

### Appearance

| Setting | Default | What it does |
| --- | --- | --- |
| Render the globe | on | When off, the background is no longer redrawn, which is the setting to reach for on battery. The top bar and menu styling keep working. |
| Theme | Globe | Which look to render. Only `Globe` is available today, more are planned. |

### Background

| Setting | Default | What it does |
| --- | --- | --- |
| Background colour | `#05060a` | The colour of the sphere and the space around it, and the tint used for the top bar. |
| Background opacity | 0.0 | How solid that colour is. At `0.0` the wallpaper shows around the globe. Raise it to cover the desktop. |
| Globe opacity | 0.9 | How solid the sphere itself is. |

### Motion

| Setting | Default | What it does |
| --- | --- | --- |
| Rotation speed | 1.0 | Spin speed relative to the default, from `0.0` to `5.0`. |
| Frame rate | 30 | Redraws per second, from `15` to `60`. Lower it to save power. |

### Top bar

| Setting | Default | What it does |
| --- | --- | --- |
| Top bar opacity | 0.0 | Starts fully transparent and fills with the background colour as you raise it. |

### Menus

| Setting | Default | What it does |
| --- | --- | --- |
| Blur behind menus | on | Blurs whatever sits under a menu, windows included. The overview keeps its blurred wallpaper either way. |
| Menu colour | `#0a0a0a` | The tint laid over the blur. |
| Menu opacity | 0.45 | How solid that tint is. |
| Icon highlight colour | `#000000` | The colour shown behind an app grid, search, or folder icon when it is hovered or pressed. |
| Icon highlight opacity | 0.5 | How solid the highlight is. |
| Blur radius | 28 | How far the blur reaches, in pixels, from `2` to `120`. This also sets the blur behind the overview. |

### Dock

| Setting | Default | What it does |
| --- | --- | --- |
| Show the dock | on | Turn off to leave the desktop clear. |
| Auto-hide on portrait monitors | on | On a monitor taller than it is wide, slide the dock away when a window on the active workspace would cover it. |
| Auto-hide on landscape monitors | on | The same, on a monitor wider than it is tall. |
| Dock icon size | 46 | Height of the app icons in pixels, from `24` to `68`. The dock sizes itself around them. |
| Dock corner radius | 64 | How rounded the dock is, in pixels, from `0` to `84`. `0` gives square corners. |

The dock sits on the desktop, outside the overview, and uses the same tint as the menus, so it needs no separate dock extension. The overview's own dash is given the same styling so the two match.

Auto-hide is intelligent. The dock stays in place until a window would actually cover it, instead of hiding on a timer. Move the pointer to the bottom edge of the screen to bring a hidden dock back.

Trash is pinned at the end of the dock, next to the apps button, on both the desktop dock and the overview dash. It shows whether the trash is empty or full and updates live. Clicking opens it, right-clicking offers `Empty Trash`. It is a permanent item rather than a favourite, so it cannot be unpinned by accident and nothing is written to your `favorite-apps`. Its icon, action, and menu come from `data/trash.desktop`, so adding another `Desktop Action` there adds another entry to its menu.

The top bar is handed back to your shell theme in the overview, and whenever a window is maximized or fullscreen on the primary monitor, so it stays readable.

## Optional: rounded blur corners

A blur effect covers its actor's full rectangle, so behind a rounded menu the corners look square. The optional system library `gnome-rounded-blur` adds a `corner-radius` property that rounds the blur. The extension detects it at startup and uses it automatically. Without it everything still works, with square blur corners.

The library is not bundled and cannot be, because it is a C library compiled against your exact Mutter version and installed into `/usr`.

**On CyberMyth OS, or Debian with the CyberMyth repo**, it is packaged as `gnome-rounded-corners`. Add the repository once:

```sh
sudo install -D -m 0644 cybermyth-archive-keyring.gpg \
    /usr/share/keyrings/cybermyth-archive-keyring.gpg

sudo tee /etc/apt/sources.list.d/cybermyth.sources <<'EOF'
Types: deb
URIs: https://repo.cybermyth.dev/
Suites: stable
Components: main
Signed-By: /usr/share/keyrings/cybermyth-archive-keyring.gpg
EOF
```

The keyring is at <https://repo.cybermyth.dev/cybermyth-archive-keyring.gpg>. Then:

```sh
sudo apt update
sudo apt install gnome-rounded-corners
```

Log out and back in afterwards. The package is built per GNOME release and depends on `libmutter-<abi>-0`, so apt refuses an install that does not match your Mutter.

**On other distributions**, Arch has it on the AUR as `gnome-rounded-blur`, and Fedora has a copr (`aneagle/gnome-rounded-blur`). The upstream project is [gnome-rounded-blur](https://github.com/kancko/gnome-rounded-blur).

However it is installed, it links against the running Mutter, so it has to be rebuilt or reinstalled after a GNOME Shell update, or the blur falls back to square corners.

## Project layout

```
extension.js            shell process: globe, top bar, menu styling
prefs.js                preferences window
lib/globeEffect.js      the GLSL shader the globe is drawn with
lib/blur.js             menu blur and the overview backdrop
lib/dock.js             the desktop dock, its auto-hide, and the trash item
lib/dynamicStyle.js     runtime stylesheet for user-chosen colours
lib/themes.js           per-theme constants
data/trash.desktop      the dock's Trash entry
assets/land-mask.png    continent mask sampled by the shader
schemas/                GSettings schema
stylesheet*.css         static styling, one is loaded per shell variant
```

Each `stylesheet*.css` is standalone. GNOME Shell loads exactly one of them, so they are kept in step rather than layered.

## Development

Watch the shell log while testing:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

## Contributing

Issues and pull requests are welcome at [CyberMyth-OS/CyberMyth-Theme](https://github.com/CyberMyth-OS/CyberMyth-Theme).

## Credits

The dock's intelligent auto-hide follows the approach taken by [Dash to Dock](https://github.com/micheleg/dash-to-dock) (copyright Michele Gaio and contributors, GPL-2.0-or-later): hold the dock on screen until a window on the active workspace would sit under it, then slide it away and bring it back at the screen edge. The implementation here is written independently rather than copied. Both projects are GPL-2.0-or-later, so the lineage is licence-compatible.

The dock reuses GNOME Shell's own `Dash`, so favourites, running-app indicators, drag and drop, and the apps button behave exactly as they do in the overview. GNOME Shell is copyright its contributors, GPL-2.0-or-later.

Rounded blur corners come from [gnome-rounded-blur](https://github.com/kancko/gnome-rounded-blur) by kancko, GPL-3.0-or-later, an optional system library this extension detects at startup and uses if present. The `gnome-rounded-corners` Debian package is only a repackaging of it.

The method for retargeting that library at whichever Mutter is installed is taken from the installer script in [Blur my Shell](https://github.com/aunetx/blur-my-shell) by Aurélien Hamy (aunetx) and contributors, GPL-3.0-or-later.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
