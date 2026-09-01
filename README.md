# Cybermyth Theme

A GNOME Shell extension that turns the desktop into a slowly rotating globe —
continents traced out as glowing dots, spinning quietly behind your windows —
and carries that look through the rest of the shell: a transparent top bar,
translucent blurred menus, and a tinted app grid.

The globe is drawn straight onto the shell's own background, so there is no
extra window and nothing stacked on top. Leave it as a self-contained dark
scene, or fade the backdrop down until the globe floats over your wallpaper.

Part of the [CyberMyth OS](https://github.com/CyberMyth-OS) desktop.

## Requirements

- GNOME Shell 48 (Wayland or X11)

## Install

**From GNOME Extensions** — search for *Cybermyth Theme* on
[extensions.gnome.org](https://extensions.gnome.org) and toggle it on.

**From a release zip:**

```sh
gnome-extensions install --force cybermyth-theme@cybermyth.dev.shell-extension.zip
```

Then log out and back in (Wayland), or press <kbd>Alt</kbd>+<kbd>F2</kbd>,
type `r`, and press <kbd>Enter</kbd> (X11). Enable it with:

```sh
gnome-extensions enable cybermyth-theme@cybermyth.dev
```

**From source:**

```sh
git clone https://github.com/CyberMyth-OS/CyberMyth-Theme.git
cd CyberMyth-Theme
gnome-extensions pack . \
  --extra-source=lib --extra-source=assets \
  --extra-source=stylesheet-dark.css --extra-source=stylesheet-light.css \
  --extra-source=README.md --extra-source=LICENSE --force
gnome-extensions install --force cybermyth-theme@cybermyth.dev.shell-extension.zip
```

## Settings

```sh
gnome-extensions prefs cybermyth-theme@cybermyth.dev
```

### Appearance

| Setting | Default | What it does |
| --- | --- | --- |
| Render the globe | on | Turn off and the background stops being redrawn altogether — the setting to reach for on battery. Everything else keeps working. |
| Theme | Globe | Which look to render. More are on the way. |

### Background

| Setting | Default | What it does |
| --- | --- | --- |
| Background colour | `#05060a` | The colour of the sphere and the space around it, and the tint used for the top bar. |
| Background opacity | 0.0 | How solid that colour is. At 0 your wallpaper shows around the globe; turn it up to cover the desktop. |
| Globe opacity | 0.9 | How solid the sphere itself is. |

### Motion

| Setting | Default | What it does |
| --- | --- | --- |
| Rotation speed | 1.0 | Relative to the default spin. |
| Frame rate | 30 | Redraws per second. Lower it to save power. |

### Top bar

| Setting | Default | What it does |
| --- | --- | --- |
| Top bar opacity | 0.0 | Starts fully transparent, tinted with the background colour as you raise it. |

### Menus

| Setting | Default | What it does |
| --- | --- | --- |
| Blur behind menus | on | Blurs whatever is genuinely underneath menus, the app grid and the overview — windows included. |
| Menu colour | `#0a0a0a` | The tint laid over that blur. |
| Menu opacity | 0.45 | How solid the tint is. |
| Icon highlight colour | `#000000` | The colour behind an app grid, search or folder icon. |
| Icon highlight opacity | 0.5 | How solid that highlight is. |
| Blur radius | 28 | How far the blur reaches, in pixels. |

The top bar is handed back to your shell theme in the overview, and whenever a
window is maximized or fullscreen on the primary monitor, so it stays readable.

## Optional: rounded blur corners

A blur effect covers its actor's rectangle, so behind a rounded menu its corners
are square. The optional system library **gnome-rounded-blur** adds a
`corner-radius` property that fixes this; the extension detects it at startup and
uses it automatically. Without it everything still works.

It is not bundled and cannot be — it is a C library compiled against your exact
Mutter version and installed into `/usr`. See [README-def.md](README-def.md) for
install instructions.

## Project layout

```
extension.js            shell process: globe, top bar, menu styling
prefs.js                preferences window (Adw/Gtk only)
lib/globeEffect.js      the GLSL shader the globe is drawn with
lib/blur.js             menu blur and the overview backdrop
lib/dynamicStyle.js     runtime stylesheet for user-chosen colours
lib/themes.js           per-theme constants
assets/land-mask.png    continent mask sampled by the shader
schemas/                GSettings schema
stylesheet*.css         static styling (one is loaded, per shell variant)
```

Each `stylesheet*.css` is standalone: GNOME Shell loads exactly one of them, so
they are kept in step rather than layered.

## Development

Implementation notes — how the blur is made to render, which shell internals are
worked around, and why — live in [README-def.md](README-def.md).

Watch the shell's log while testing:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

## Contributing

Issues and pull requests are welcome at
[CyberMyth-OS/CyberMyth-Theme](https://github.com/CyberMyth-OS/CyberMyth-Theme).

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
