# Cybermyth Theme

A GNOME Shell extension that turns the desktop into a slowly rotating globe —
continents traced out as glowing dots, spinning quietly behind your windows —
and carries that look through the rest of the shell: a transparent top bar,
translucent blurred menus, a tinted app grid, and a matching dock.

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
| Blur behind menus | on | Blurs whatever is genuinely underneath menus — windows included. The overview keeps its blurred wallpaper whether this is on or off. |
| Menu colour | `#0a0a0a` | The tint laid over that blur. |
| Menu opacity | 0.45 | How solid the tint is. |
| Icon highlight colour | `#000000` | The colour behind an app grid, search or folder icon. |
| Icon highlight opacity | 0.5 | How solid that highlight is. |
| Blur radius | 28 | How far the blur reaches, in pixels. |

### Dock

A dock on the desktop, outside the overview, drawn with the same tint as the
menus — so it needs no separate dock extension. The overview's own dash is given
the same treatment, so the two match. The dock is tinted and translucent rather
than blurred: blurring a surface that repaints on every hover made the panel
flicker, and the tint alone reads better over a busy desktop.

| Setting | Default | What it does |
| --- | --- | --- |
| Show the dock | on | Turn off to leave the desktop clear. |
| Auto-hide on portrait monitors | on | On a monitor taller than it is wide, slide the dock away when a window on the active workspace would sit under it. |
| Auto-hide on landscape monitors | on | The same, on a monitor wider than it is tall. |
| Dock icon size | 46 | Height of the app icons, in pixels (24–68). The dock sizes itself around them. |
| Dock corner radius | 64 | How rounded the dock is, in pixels (0–84). 0 gives square corners. |

Auto-hide is *intelligent*: the dock stays put until a window would actually
cover it, rather than hiding on a timer. Move the pointer to the bottom edge of
the screen to bring a hidden dock back.

**Trash** is always pinned, at the end next to the apps button — on the desktop
dock *and* on the overview's dash, so the two match. It shows whether the trash
is empty or full and follows that live; clicking opens it, right-clicking offers
*Empty Trash*. It is not a favourite: it is a permanent item, so it cannot be
unpinned by accident and nothing is written to your `favorite-apps`. What it does
comes from `data/trash.desktop`, so adding another `Desktop Action` there adds
another entry to its menu.

The top bar is handed back to your shell theme in the overview, and whenever a
window is maximized or fullscreen on the primary monitor, so it stays readable.

## Optional: rounded blur corners

A blur effect covers its actor's rectangle, so behind a rounded menu its corners
are square. The optional system library **gnome-rounded-blur** adds a
`corner-radius` property that fixes this; the extension detects it at startup and
uses it automatically. Without it everything still works.

It is not bundled and cannot be — it is a C library compiled against your exact
Mutter version and installed into `/usr`.

### On CyberMyth OS, or Debian with the CyberMyth repo

It is packaged as `gnome-rounded-corners`. Add the repository once:

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

The keyring is at <https://repo.cybermyth.dev/cybermyth-archive-keyring.gpg>.
Then:

```sh
sudo apt update
sudo apt install gnome-rounded-corners
```

Log out and back in afterwards. The package is built per GNOME release and
depends on `libmutter-<abi>-0`, so apt refuses a build that does not match your
Mutter rather than installing a library that cannot load.

### Elsewhere

Arch has it on the AUR as `gnome-rounded-blur`, and Fedora has a copr
(`aneagle/gnome-rounded-blur`). On other distributions upstream's own installer
builds it; see [README-def.md](README-def.md).

However it is installed, it links against the running Mutter, so it has to be
rebuilt or reinstalled after a GNOME Shell update or the blur falls back to
square corners.

## Project layout

```
extension.js            shell process: globe, top bar, menu styling
prefs.js                preferences window (Adw/Gtk only)
lib/globeEffect.js      the GLSL shader the globe is drawn with
lib/blur.js             menu blur and the overview backdrop
lib/dock.js             the desktop dock, its auto-hide, and the trash item
data/trash.desktop      the dock's Trash entry (icon, action, Empty Trash)
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

## Credits

The dock's intelligent auto-hide follows the approach taken by
[Dash to Dock](https://github.com/micheleg/dash-to-dock) (copyright Michele Gaio
and contributors, GPL-2.0-or-later): hold the dock on screen until a window on
the active workspace would sit underneath it, then slide it away and give it
back at the screen edge. The implementation here is written independently
against GNOME 48 rather than copied, but the idea is theirs. Both projects are
GPL-2.0-or-later, so the lineage is licence-compatible either way.

The dock itself reuses GNOME Shell's own `Dash`, so favourites, running-app
indicators, drag-and-drop and the apps button behave exactly as they do in the
overview. GNOME Shell is copyright its contributors, GPL-2.0-or-later.

Rounded blur corners come from
[gnome-rounded-blur](https://github.com/kancko/gnome-rounded-blur) by kancko,
GPL-3.0-or-later — an optional system library this extension detects at startup
and uses if present. The `gnome-rounded-corners` Debian package is only a
repackaging of it; the library is entirely upstream's work.

The method for retargeting that library at whichever Mutter is installed is
taken from the installer script in
[Blur my Shell](https://github.com/aunetx/blur-my-shell) by Aurélien Hamy
(aunetx) and contributors, GPL-3.0-or-later.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
