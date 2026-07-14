// SPDX-FileCopyrightText: 2026 Toshith Yadav
// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class CybermythPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Cybermyth',
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });
        window.add(page);

        const appearance = new Adw.PreferencesGroup({title: 'Appearance'});
        page.add(appearance);

        const themeModel = new Gtk.StringList();
        themeModel.append('Globe');
        const themeRow = new Adw.ComboRow({
            title: 'Theme',
            subtitle: 'Which look to render',
            model: themeModel,
            selected: settings.get_enum('active-theme'),
        });
        themeRow.connect('notify::selected',
            () => settings.set_enum('active-theme', themeRow.selected));
        appearance.add(themeRow);

        const bgGroup = new Adw.PreferencesGroup({
            title: 'Background',
            description: 'The sphere colour, and how much wallpaper shows through',
        });
        page.add(bgGroup);

        const colorRow = new Adw.ActionRow({
            title: 'Background colour',
            subtitle: 'Colour of the sphere and the surround',
        });
        const colorButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            valign: Gtk.Align.CENTER,
        });
        const initialRgba = new Gdk.RGBA();
        initialRgba.parse(settings.get_string('background-color'));
        colorButton.set_rgba(initialRgba);
        colorButton.connect('notify::rgba', () => {
            const c = colorButton.get_rgba();
            const hex = '#' + [c.red, c.green, c.blue]
                .map(v => Math.round(v * 255).toString(16).padStart(2, '0'))
                .join('');
            if (hex !== settings.get_string('background-color'))
                settings.set_string('background-color', hex);
        });
        colorRow.add_suffix(colorButton);
        colorRow.activatable_widget = colorButton;
        bgGroup.add(colorRow);

        bgGroup.add(this._sliderRow(settings, 'background-opacity',
            'Background opacity', '0 shows your wallpaper around the globe'));
        bgGroup.add(this._sliderRow(settings, 'globe-opacity',
            'Globe opacity', '0 makes the sphere itself see-through'));

        const motion = new Adw.PreferencesGroup({title: 'Motion'});
        page.add(motion);

        const speedRow = new Adw.SpinRow({
            title: 'Rotation speed',
            subtitle: 'Relative to the default spin',
            digits: 1,
            adjustment: new Gtk.Adjustment({
                lower: 0.0, upper: 5.0, step_increment: 0.1, page_increment: 0.5,
            }),
        });
        settings.bind('rotation-speed', speedRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        motion.add(speedRow);

        const fpsRow = new Adw.SpinRow({
            title: 'Frame rate',
            subtitle: 'Redraws per second (lower saves power)',
            adjustment: new Gtk.Adjustment({
                lower: 15, upper: 60, step_increment: 5, page_increment: 10,
            }),
        });
        fpsRow.value = settings.get_int('fps');
        fpsRow.connect('notify::value', () => {
            const v = Math.round(fpsRow.value);
            if (v !== settings.get_int('fps'))
                settings.set_int('fps', v);
        });
        motion.add(fpsRow);
    }

    _sliderRow(settings, key, title, subtitle) {
        const row = new Adw.ActionRow({title, subtitle});
        const scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: new Gtk.Adjustment({
                lower: 0.0, upper: 1.0, step_increment: 0.05, page_increment: 0.1,
            }),
            digits: 2,
            draw_value: true,
            value_pos: Gtk.PositionType.LEFT,
            hexpand: true,
            width_request: 220,
            valign: Gtk.Align.CENTER,
        });
        scale.set_value(settings.get_double(key));
        scale.connect('value-changed', () => {
            const v = scale.get_value();
            if (Math.abs(v - settings.get_double(key)) > 1e-4)
                settings.set_double(key, v);
        });
        row.add_suffix(scale);
        return row;
    }
}
