// SPDX-FileCopyrightText: 2026 Toshith Yadav
// SPDX-License-Identifier: GPL-2.0-or-later

import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlobeEffect, EFFECT_NAME} from './lib/globeEffect.js';
import {THEMES, THEME_ORDER} from './lib/themes.js';

const REFERENCE_FPS = 30;

export default class CybermythExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._effects = new Set();
        this._maskContent = null;
        this._maskName = null;
        this._tickId = null;
        this._speed = 1.0;

        this._config = {
            phi: 0.0,
            spin: THEMES.globe.spin,
            fps: REFERENCE_FPS,
            bgOpacity: 1.0,
            globeOpacity: 1.0,
            colors: {...THEMES.globe.colors},
        };

        this._settingsIds = [
            'changed::active-theme',
            'changed::background-color',
            'changed::background-opacity',
            'changed::globe-opacity',
            'changed::rotation-speed',
            'changed::fps',
        ].map(sig => this._settings.connect(sig, () => this._applySettings()));

        const self = this;
        this._origCreate = Background.BackgroundManager.prototype._createBackgroundActor;
        Background.BackgroundManager.prototype._createBackgroundActor = function () {
            const actor = self._origCreate.call(this);
            self._attach(actor);
            return actor;
        };

        for (const child of Main.layoutManager._backgroundGroup.get_children())
            this._attach(child);

        this._applySettings();
    }

    disable() {
        this._stopTick();

        if (this._origCreate) {
            Background.BackgroundManager.prototype._createBackgroundActor = this._origCreate;
            this._origCreate = null;
        }

        for (const effect of this._effects)
            effect.get_actor()?.remove_effect_by_name(EFFECT_NAME);
        this._effects.clear();

        if (this._settingsIds) {
            for (const id of this._settingsIds)
                this._settings.disconnect(id);
            this._settingsIds = null;
        }

        this._settings = null;
        this._config = null;
        this._maskContent = null;
        this._maskName = null;

        Main.layoutManager._updateBackgrounds();
    }

    _applySettings() {
        const themeId = THEME_ORDER[this._settings.get_enum('active-theme')] ?? 'globe';
        const theme = THEMES[themeId] ?? THEMES.globe;

        this._config.spin = theme.spin;
        this._config.colors = {
            bg: this._hexToRgb(this._settings.get_string('background-color')),
            land: theme.colors.land,
            glow: theme.colors.glow,
        };
        this._config.bgOpacity = this._settings.get_double('background-opacity');
        this._config.globeOpacity = this._settings.get_double('globe-opacity');
        this._config.fps = this._settings.get_int('fps');
        this._speed = this._settings.get_double('rotation-speed');

        if (this._maskName !== theme.mask) {
            this._maskContent = this._loadMask(theme.mask);
            this._maskName = theme.mask;
            for (const effect of this._effects)
                effect.setMask(this._maskContent);
        }

        this._startTick();
    }

    _hexToRgb(hex) {
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex).trim());
        if (!m)
            return [0.0, 0.0, 0.0];
        return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
    }

    _loadMask(fileName) {
        const path = this.dir.get_child('assets').get_child(fileName).get_path();
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
        const content = St.ImageContent.new_with_preferred_size(pixbuf.width, pixbuf.height);
        const format = pixbuf.has_alpha ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;

        content.set_data(
            global.stage.context.get_backend().get_cogl_context(),
            pixbuf.get_pixels(), format,
            pixbuf.width, pixbuf.height, pixbuf.rowstride);

        return content;
    }

    _attach(actor) {
        if (!actor || actor.get_effect(EFFECT_NAME))
            return;

        const effect = new GlobeEffect();
        effect.setup(this._config, this._maskContent);
        actor.add_effect_with_name(EFFECT_NAME, effect);
        this._effects.add(effect);

        actor.connect('destroy', () => this._effects.delete(effect));
    }

    _startTick() {
        this._stopTick();
        const interval = Math.round(1000 / this._config.fps);
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => this._tick());
    }

    _stopTick() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = null;
        }
    }

    _occluded() {
        if (Main.overview.visible)
            return false;

        const active = global.workspace_manager.get_active_workspace();

        return global.get_window_actors().some(a => {
            const w = a.meta_window;
            return !w.minimized &&
                w.get_workspace() === active &&
                (w.is_fullscreen() || w.get_maximized() === Meta.MaximizeFlags.BOTH);
        });
    }

    _tick() {
        if (this._occluded())
            return GLib.SOURCE_CONTINUE;

        this._config.phi += this._config.spin * this._speed * (REFERENCE_FPS / this._config.fps);
        if (this._config.phi > Math.PI * 2.0)
            this._config.phi -= Math.PI * 2.0;

        for (const effect of this._effects)
            effect.queue_repaint();

        return GLib.SOURCE_CONTINUE;
    }
}
