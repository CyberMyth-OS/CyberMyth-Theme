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

        const globeRow = new Adw.SwitchRow({
            title: 'Render the globe',
            subtitle: 'Turn off to stop redrawing the background and save power. ' +
                'The top bar and menus stay styled',
        });
        settings.bind('globe-enabled', globeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appearance.add(globeRow);

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
            subtitle: 'Colour of the sphere, the surround, and the top bar tint',
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

        const bgOpacityRow = this._sliderRow(settings, 'background-opacity',
            'Background opacity', '0 shows your wallpaper around the globe');
        const globeOpacityRow = this._sliderRow(settings, 'globe-opacity',
            'Globe opacity', '0 makes the sphere itself see-through');
        bgGroup.add(bgOpacityRow);
        bgGroup.add(globeOpacityRow);

        // Everything here only matters while the globe is actually drawn. The
        // colour is the exception: it also tints the top bar.
        for (const row of [themeRow, bgOpacityRow, globeOpacityRow])
            settings.bind('globe-enabled', row, 'sensitive', Gio.SettingsBindFlags.GET);

        const motion = new Adw.PreferencesGroup({title: 'Motion'});
        page.add(motion);
        settings.bind('globe-enabled', motion, 'sensitive', Gio.SettingsBindFlags.GET);

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

        const panelGroup = new Adw.PreferencesGroup({
            title: 'Top bar',
            description: 'In the overview, and behind a maximized window, the top ' +
                'bar goes back to your shell theme',
        });
        page.add(panelGroup);

        panelGroup.add(this._sliderRow(settings, 'panel-opacity',
            'Top bar opacity', '0 makes it fully see-through; 1 fills it with the background colour'));

        const menus = new Adw.PreferencesGroup({
            title: 'Menus',
            description: 'Applies to system menus, the app grid and the overview',
        });
        page.add(menus);

        const blurRow = new Adw.SwitchRow({
            title: 'Blur behind menus',
            subtitle: 'Blurs whatever is underneath, windows included. The ' +
                'overview keeps its blurred wallpaper either way',
        });
        settings.bind('menu-blur', blurRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        menus.add(blurRow);

        const menuColorRow = new Adw.ActionRow({
            title: 'Menu colour',
            subtitle: 'Laid over the blur in menus, the app grid and the overview',
        });
        const menuColorButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            valign: Gtk.Align.CENTER,
        });
        const menuRgba = new Gdk.RGBA();
        menuRgba.parse(settings.get_string('menu-color'));
        menuColorButton.set_rgba(menuRgba);
        menuColorButton.connect('notify::rgba', () => {
            const c = menuColorButton.get_rgba();
            const hex = '#' + [c.red, c.green, c.blue]
                .map(v => Math.round(v * 255).toString(16).padStart(2, '0'))
                .join('');
            if (hex !== settings.get_string('menu-color'))
                settings.set_string('menu-color', hex);
        });
        menuColorRow.add_suffix(menuColorButton);
        menuColorRow.activatable_widget = menuColorButton;
        menus.add(menuColorRow);

        menus.add(this._sliderRow(settings, 'menu-opacity',
            'Menu opacity', '0 leaves only the blur; 1 hides the blur completely'));

        const hoverRow = new Adw.ActionRow({
            title: 'Icon highlight colour',
            subtitle: 'Behind app grid, search and folder icons when hovered',
        });
        const hoverButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            valign: Gtk.Align.CENTER,
        });
        const hoverRgba = new Gdk.RGBA();
        hoverRgba.parse(settings.get_string('hover-color'));
        hoverButton.set_rgba(hoverRgba);
        hoverButton.connect('notify::rgba', () => {
            const c = hoverButton.get_rgba();
            const hex = '#' + [c.red, c.green, c.blue]
                .map(v => Math.round(v * 255).toString(16).padStart(2, '0'))
                .join('');
            if (hex !== settings.get_string('hover-color'))
                settings.set_string('hover-color', hex);
        });
        hoverRow.add_suffix(hoverButton);
        hoverRow.activatable_widget = hoverButton;
        menus.add(hoverRow);

        menus.add(this._sliderRow(settings, 'hover-opacity',
            'Icon highlight opacity', 'How solid that highlight is'));

        const radiusRow = new Adw.SpinRow({
            title: 'Blur radius',
            subtitle: 'How far the blur reaches, in pixels. Also sets the ' +
                'blur behind the overview',
            adjustment: new Gtk.Adjustment({
                lower: 2, upper: 120, step_increment: 2, page_increment: 8,
            }),
        });
        radiusRow.value = settings.get_int('menu-blur-radius');
        radiusRow.connect('notify::value', () => {
            const v = Math.round(radiusRow.value);
            if (v !== settings.get_int('menu-blur-radius'))
                settings.set_int('menu-blur-radius', v);
        });
        // Not tied to the menu-blur switch: the radius still drives the
        // blurred wallpaper behind the overview, which stays either way.
        menus.add(radiusRow);

        const dock = new Adw.PreferencesGroup({
            title: 'Dock',
            description: 'A dock on the desktop, styled with the menu colour ' +
                'and opacity above',
        });
        page.add(dock);

        const dockRow = new Adw.SwitchRow({
            title: 'Show the dock',
            subtitle: 'Replaces the need for a separate dock extension',
        });
        settings.bind('dock-enabled', dockRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        dock.add(dockRow);

        const portraitRow = new Adw.SwitchRow({
            title: 'Auto-hide on portrait monitors',
            subtitle: 'Slide the dock away when a window would sit under it',
        });
        settings.bind('dock-autohide-portrait', portraitRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('dock-enabled', portraitRow, 'sensitive', Gio.SettingsBindFlags.GET);
        dock.add(portraitRow);

        const landscapeRow = new Adw.SwitchRow({
            title: 'Auto-hide on landscape monitors',
            subtitle: 'Slide the dock away when a window would sit under it',
        });
        settings.bind('dock-autohide-landscape', landscapeRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('dock-enabled', landscapeRow, 'sensitive', Gio.SettingsBindFlags.GET);
        dock.add(landscapeRow);

        const iconSizeRow = new Adw.SpinRow({
            title: 'Dock icon size',
            subtitle: 'Height of the app icons, in pixels',
            adjustment: new Gtk.Adjustment({
                lower: 24, upper: 68, step_increment: 2, page_increment: 8,
            }),
        });
        iconSizeRow.value = settings.get_int('dock-icon-size');
        iconSizeRow.connect('notify::value', () => {
            const v = Math.round(iconSizeRow.value);
            if (v !== settings.get_int('dock-icon-size'))
                settings.set_int('dock-icon-size', v);
        });
        settings.bind('dock-enabled', iconSizeRow, 'sensitive', Gio.SettingsBindFlags.GET);
        dock.add(iconSizeRow);

        const dockRadiusRow = new Adw.SpinRow({
            title: 'Dock corner radius',
            subtitle: 'How rounded the dock is, in pixels',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 84, step_increment: 1, page_increment: 4,
            }),
        });
        dockRadiusRow.value = settings.get_int('dock-radius');
        dockRadiusRow.connect('notify::value', () => {
            const v = Math.round(dockRadiusRow.value);
            if (v !== settings.get_int('dock-radius'))
                settings.set_int('dock-radius', v);
        });
        settings.bind('dock-enabled', dockRadiusRow, 'sensitive', Gio.SettingsBindFlags.GET);
        dock.add(dockRadiusRow);
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
