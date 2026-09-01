// SPDX-FileCopyrightText: 2026 Toshith Yadav
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

// Colours that the user can change have to reach states like :hover, and a
// pseudo-class cannot be set as an inline style. So the parts of the theme that
// depend on settings are written out as a small stylesheet and handed to St at
// runtime, next to the static one that ships with the extension.
export class DynamicStylesheet {
    constructor(uuid) {
        this._dir = GLib.build_filenamev([GLib.get_user_cache_dir(), uuid]);
        this._file = null;
        this._serial = 0;
    }

    _theme() {
        return St.ThemeContext.get_for_stage(global.stage).get_theme();
    }

    // St keys its stylesheet cache on the file, so each revision is written to
    // a fresh name; otherwise an edited file loads with its old contents.
    update(css) {
        const dir = Gio.File.new_for_path(this._dir);
        try {
            if (!dir.query_exists(null))
                dir.make_directory_with_parents(null);
        } catch (e) {
            return;
        }

        const next = Gio.File.new_for_path(
            GLib.build_filenamev([this._dir, `style-${this._serial++}.css`]));

        try {
            next.replace_contents(new TextEncoder().encode(css), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            return;
        }

        const theme = this._theme();
        try {
            theme.load_stylesheet(next);
        } catch (e) {
            try {
                next.delete(null);
            } catch (_) {}
            return;
        }

        this._unload();
        this._file = next;
    }

    _unload() {
        if (!this._file)
            return;

        try {
            this._theme().unload_stylesheet(this._file);
        } catch (e) {
            // theme already gone; the file still needs clearing up
        }
        try {
            this._file.delete(null);
        } catch (e) {
            // best effort: a leftover in the cache directory is harmless
        }
        this._file = null;
    }

    destroy() {
        this._unload();
    }
}

export function rgba(hexToRgb, hex, alpha) {
    const [r, g, b] = hexToRgb(hex).map(v => Math.round(v * 255));
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}
