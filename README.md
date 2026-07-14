# Cybermyth Theme

Cybermyth-Theme turns your GNOME desktop into a slowly rotating globe — continents
traced out as glowing dots, spinning quietly behind your windows.

It draws straight onto the shell's background, so there's no extra window and
nothing stacked on top: just the globe, where your wallpaper used to be. Leave
it as a self-contained dark scene, or fade the background and the sphere down
until the globe floats over your own wallpaper.

## Requirements

- GNOME Shell 48 (Wayland or X11)

## Settings

Right-click the extension and open its settings, or run:

```sh
gnome-extensions prefs cybermyth-theme@cybermyth.dev
```

- **Theme** — the overall look. Just *Globe* today; more are on the way.
- **Background colour** — the colour of the sphere and the space around it.
- **Background opacity** — how solid that colour is. Turn it down to let your
  wallpaper show around the globe.
- **Globe opacity** — how solid the sphere is. Turn it down to make the globe
  itself see-through.
- **Rotation speed** — how fast it spins.
- **Frame rate** — redraws per second; lower it to save battery.

## Trying it locally

Link the folder into place and compile the settings schema:

```sh
ln -s "$PWD/cybermyth-theme@cybermyth.dev" \
      ~/.local/share/gnome-shell/extensions/cybermyth-theme@cybermyth.dev
glib-compile-schemas ~/.local/share/gnome-shell/extensions/cybermyth-theme@cybermyth.dev/schemas/
```

On X11, press `Alt`+`F2`, type `r`, and hit `Enter` to reload the shell. On
Wayland, log out and back in — or try it in a throwaway nested session first:

```sh
dbus-run-session -- gnome-shell --nested --wayland
gnome-extensions enable cybermyth-theme@cybermyth.dev
```

## Building a release

```sh
gnome-extensions pack cybermyth-theme@cybermyth.dev \
  --extra-source=lib --extra-source=assets --extra-source=LICENSE --force
```

This produces `cybermyth-theme@cybermyth.dev.shell-extension.zip`, ready to
upload at <https://extensions.gnome.org/upload/>.

## License

Copyright © 2026 Toshith Yadav.
Released under the GNU General Public License v2.0 or later — see [LICENSE](LICENSE).
