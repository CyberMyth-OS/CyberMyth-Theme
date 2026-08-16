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

- **Render the globe** — on by default. Turn it off and the background stops
  being redrawn altogether, which is the setting to reach for on battery. The
  transparent top bar and the translucent menus keep working either way.
- **Theme** — the overall look. Just *Globe* today; more are on the way.
- **Background colour** — the colour of the sphere and the space around it,
  and the tint used for the top bar.
- **Background opacity** — how solid that colour is. Defaults to 0, so your
  wallpaper shows around the globe. Turn it up to cover the desktop.
- **Globe opacity** — how solid the sphere is. Defaults to 0.9. Turn it down
  to make the globe itself see-through.
- **Top bar opacity** — how solid the top bar is. It starts fully transparent,
  tinted with the background colour as you raise it. In the overview, and
  whenever a window is maximized or fullscreen on the primary monitor, the top
  bar is handed back to your shell theme so it stays readable.
- **Blur behind menus** — experimental. See the note below.
- **Blur radius** — how far that blur reaches.
- **Rotation speed** — how fast it spins.
- **Frame rate** — redraws per second; lower it to save battery.

System menus are translucent whenever the extension is enabled; there is no
switch for that, and the colour follows your light/dark preference.

## About the menu blur

GNOME Shell's CSS has no `backdrop-filter`, so the blur is not a style rule —
it is a `Shell.BlurEffect` in background mode, attached to each menu. GNOME
Shell itself never uses that mode anywhere, and on some drivers it draws
nothing at all or leaves a grey rectangle behind the menu's rounded corner.
That is why it ships turned off. Turn it on, open a few menus over a busy
wallpaper, and keep it only if it looks right on your machine. The menus stay
translucent either way — the blur only ever adds to that.

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

## License

Copyright © 2026 Toshith Yadav.
Released under the GNU General Public License v2.0 or later — see [LICENSE](LICENSE).
