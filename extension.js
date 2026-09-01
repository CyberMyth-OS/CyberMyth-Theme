// SPDX-FileCopyrightText: 2026 Toshith Yadav
// SPDX-License-Identifier: GPL-2.0-or-later

import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BlurManager, OverviewBackdrop, loadRoundedBlur, shouldSkipGlobe} from './lib/blur.js';
import {DynamicStylesheet, rgba} from './lib/dynamicStyle.js';
import {GlobeEffect, EFFECT_NAME} from './lib/globeEffect.js';
import {THEMES, THEME_ORDER} from './lib/themes.js';

const REFERENCE_FPS = 30;
// With the globe switched off nothing is being animated, but the top bar still
// has to notice windows being maximized. Poll slowly enough to cost nothing.
const IDLE_POLL_FPS = 5;
const PANEL_STYLE_CLASS = 'cybermyth-transparent-panel';
const BLUR_BRIGHTNESS = 1.0;
// How far to look inside a uiGroup child for a nested BoxPointer.
const BLUR_SEARCH_DEPTH = 3;

export default class CybermythExtension extends Extension {
    async enable() {
        this._settings = this.getSettings();
        this._effects = new Set();
        this._actorConns = new Map();
        this._maskContent = null;
        this._maskName = null;
        this._tickId = null;
        this._speed = 1.0;
        this._panelStyle = null;
        this._panelApplied = null;
        this._blur = new BlurManager();
        this._blurRadius = 48;
        this._uiGroupConn = null;
        this._globeOn = false;
        this._overviewBackdrop = null;
        this._style = new DynamicStylesheet(this.uuid);

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
            'changed::globe-enabled',
            'changed::background-color',
            'changed::background-opacity',
            'changed::globe-opacity',
            'changed::menu-blur',
            'changed::menu-blur-radius',
            'changed::menu-color',
            'changed::menu-opacity',
            'changed::hover-color',
            'changed::hover-opacity',
            'changed::panel-opacity',
            'changed::rotation-speed',
            'changed::fps',
        ].map(sig => this._settings.connect(sig, () => this._applySettings()));

        const self = this;
        this._origCreate = Background.BackgroundManager.prototype._createBackgroundActor;
        Background.BackgroundManager.prototype._createBackgroundActor = function () {
            const actor = self._origCreate.call(this);
            if (self._globeOn && !shouldSkipGlobe(this._container))
                self._attach(actor);
            return actor;
        };

        // Resolve the optional rounded-blur library before anything is drawn.
        // The shell awaits enable(), so this costs one import and nothing else.
        await loadRoundedBlur();

        this._applySettings();
    }

    disable() {
        this._stopTick();
        this._resetPanel();
        this._clearMenuBlur();
        this._blur = null;
        this._style.destroy();
        this._style = null;

        if (this._origCreate) {
            Background.BackgroundManager.prototype._createBackgroundActor = this._origCreate;
            this._origCreate = null;
        }

        this._detachGlobe();
        this._actorConns = null;
        this._effects = null;

        if (this._settingsIds) {
            for (const id of this._settingsIds)
                this._settings.disconnect(id);
            this._settingsIds = null;
        }

        this._settings = null;
        this._config = null;
        this._maskContent = null;
        this._maskName = null;
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

        const [r, g, b] = this._config.colors.bg.map(v => Math.round(v * 255));
        const alpha = this._settings.get_double('panel-opacity');
        this._panelStyle = `background-color: rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)});`;
        this._blurRadius = this._settings.get_int('menu-blur-radius');

        this._updateStyle();

        if (this._maskName !== theme.mask) {
            this._maskContent = this._loadMask(theme.mask);
            this._maskName = theme.mask;
            for (const effect of this._effects)
                effect.setMask(this._maskContent);
        }

        this._applyGlobe();
        this._startTick();
        this._updatePanel();
        this._applyMenuBlur();
        this._applyOverviewBackdrop();
    }

    // Switching the globe off drops the effects and lets the shell paint the
    // plain wallpaper again. The top bar and the menus are styled separately
    // and carry on regardless.
    _applyGlobe() {
        const on = this._settings.get_boolean('globe-enabled');
        if (on === this._globeOn)
            return;

        if (on) {
            this._globeOn = true;
            for (const child of Main.layoutManager._backgroundGroup.get_children())
                this._attach(child);
        } else {
            this._detachGlobe();
        }
    }

    _detachGlobe() {
        // Clear the flag first: rebuilding the backgrounds runs them back
        // through our patched _createBackgroundActor, which must not re-attach.
        this._globeOn = false;

        for (const [actor, id] of this._actorConns)
            actor.disconnect(id);
        this._actorConns.clear();

        for (const effect of this._effects)
            effect.get_actor()?.remove_effect_by_name(EFFECT_NAME);
        this._effects.clear();

        Main.layoutManager._updateBackgrounds();
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

        const id = actor.connect('destroy', () => {
            this._effects.delete(effect);
            this._actorConns.delete(actor);
        });
        this._actorConns.set(actor, id);
    }

    _startTick() {
        this._stopTick();
        const fps = this._globeOn ? this._config.fps : IDLE_POLL_FPS;
        const interval = Math.round(1000 / fps);
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => this._tick());
    }

    _stopTick() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = null;
        }
    }

    // A maximized or fullscreen window on the primary monitor sits directly
    // under the top bar, so the bar has to go back to being readable.
    _panelObscured() {
        const active = global.workspace_manager.get_active_workspace();
        const primary = Main.layoutManager.primaryIndex;

        return global.get_window_actors().some(a => {
            const w = a.meta_window;
            return !w.minimized &&
                w.window_type === Meta.WindowType.NORMAL &&
                w.get_monitor() === primary &&
                w.get_workspace() === active &&
                (w.is_fullscreen() || w.get_maximized() === Meta.MaximizeFlags.BOTH);
        });
    }

    // Hand the top bar back to the shell's own theme in the overview and
    // behind a maximized window; it already draws both of those states, and
    // fades between them over 250ms.
    _updatePanel() {
        const style = Main.overview.visible || this._panelObscured()
            ? null
            : this._panelStyle;

        if (style === this._panelApplied)
            return;
        this._panelApplied = style;

        if (style) {
            Main.panel.add_style_class_name(PANEL_STYLE_CLASS);
            Main.panel.set_style(style);
        } else {
            Main.panel.remove_style_class_name(PANEL_STYLE_CLASS);
            Main.panel.set_style(null);
        }
    }

    _resetPanel() {
        Main.panel.remove_style_class_name(PANEL_STYLE_CLASS);
        Main.panel.set_style(null);
        this._panelApplied = null;
        this._panelStyle = null;
    }

    // Every menu in the shell is a BoxPointer parented into Main.uiGroup, so
    // watching that one container catches menus belonging to other extensions
    // too, and menus that are built long after we were enabled.
    _applyMenuBlur() {
        if (!this._settings.get_boolean('menu-blur')) {
            this._clearMenuBlur();
            return;
        }

        this._blur.setParams({
            radius: this._blurRadius,
            brightness: BLUR_BRIGHTNESS,
        });

        this._uiGroupConn ??= Main.uiGroup.connect('child-added',
            (_group, child) => this._blurTarget(child));

        for (const child of Main.uiGroup.get_children())
            this._blurTarget(child);
    }

    // Most menus are a BoxPointer parented straight into uiGroup, but not all:
    // QuickSettingsMenu replaces its actor with a 0x0 St.Widget and nests the
    // real BoxPointer inside it, so blurring the uiGroup child would blur
    // nothing. Search a little way down for the BoxPointer that actually has
    // the menu in it.
    _blurTarget(actor, depth = 0) {
        if (!actor)
            return;

        if (actor instanceof BoxPointer.BoxPointer) {
            this._blur.add(actor);
            return;
        }

        if (depth >= BLUR_SEARCH_DEPTH)
            return;

        for (const child of actor.get_children())
            this._blurTarget(child, depth + 1);
    }

    // Everything the user can recolour lives here. It has to be real CSS
    // rather than inline styles: :hover and friends are pseudo-classes, and
    // St has no way to set those on an actor directly.
    _updateStyle() {
        const hex = h => this._hexToRgb(h);
        const menu = rgba(hex, this._settings.get_string('menu-color'),
            this._settings.get_double('menu-opacity'));
        const hover = rgba(hex, this._settings.get_string('hover-color'),
            this._settings.get_double('hover-opacity'));

        // Selectors are deliberately a notch more specific than the stock
        // theme's, so this sheet wins the cascade wherever both set a colour.
        this._style.update(`
.popup-menu .popup-menu-content,
.candidate-popup-boxpointer .candidate-popup-content,
#overviewGroup .app-folder-dialog {
    background-color: ${menu};
}

/* Surfaces the stock theme fills with a flat grey at rest: the folder tiles in
 * the app grid, and the search result rows. The :focus states matter as much as
 * :hover here — the shell focuses the first search result automatically, and
 * the stock theme paints that one with an accent-tinted background. */
#overviewGroup .app-folder,
#overviewGroup .search-section-content,
#overviewGroup .list-search-result,
#overviewGroup .search-provider-icon,
#overviewGroup .app-folder:hover,
#overviewGroup .app-folder:active,
#overviewGroup .app-folder:focus,
#overviewGroup .app-folder:checked,
#overviewGroup .app-folder:selected,
#overviewGroup .app-folder:highlighted,
#overviewGroup .overview-tile:hover,
#overviewGroup .overview-tile:active,
#overviewGroup .overview-tile:focus,
#overviewGroup .overview-tile:checked,
#overviewGroup .overview-tile:selected,
#overviewGroup .overview-tile:highlighted,
#overviewGroup .overview-tile:focus:hover,
#overviewGroup .overview-tile:active:hover,
#overviewGroup .overview-tile:active:focus,
#overviewGroup .grid-search-result:hover,
#overviewGroup .grid-search-result:active,
#overviewGroup .grid-search-result:focus,
#overviewGroup .grid-search-result:checked,
#overviewGroup .grid-search-result:selected,
#overviewGroup .grid-search-result:focus:hover,
#overviewGroup .grid-search-result:active:hover,
#overviewGroup .grid-search-result:active:focus,
#overviewGroup .app-folder-dialog .overview-tile:hover,
#overviewGroup .app-folder-dialog .overview-tile:active,
#overviewGroup .app-folder-dialog .grid-search-result:hover,
#overviewGroup .app-folder-dialog .grid-search-result:active,
#overviewGroup .list-search-result:hover,
#overviewGroup .list-search-result:active,
#overviewGroup .list-search-result:focus,
#overviewGroup .list-search-result:focus:hover,
#overviewGroup .list-search-result:active:focus,
#overviewGroup .list-search-result:selected,
#overviewGroup .search-provider-icon:hover,
#overviewGroup .search-provider-icon:active,
#overviewGroup .search-provider-icon:focus,
#overviewGroup .search-provider-icon:focus:hover,
#overviewGroup .search-provider-icon:active:focus,
#overviewGroup .app-folder-dialog .overview-tile:focus,
#overviewGroup .app-folder-dialog .grid-search-result:focus {
    background-color: ${hover};
}
`);
    }

    _applyOverviewBackdrop() {
        if (!this._settings.get_boolean('menu-blur')) {
            this._overviewBackdrop?.destroy();
            this._overviewBackdrop = null;
            return;
        }

        if (this._overviewBackdrop) {
            this._overviewBackdrop.setParams(this._blurRadius, BLUR_BRIGHTNESS);
            return;
        }
        this._overviewBackdrop = new OverviewBackdrop(this._blurRadius, BLUR_BRIGHTNESS);
    }

    _clearMenuBlur() {
        if (this._uiGroupConn) {
            Main.uiGroup.disconnect(this._uiGroupConn);
            this._uiGroupConn = null;
        }
        this._blur.removeAll();
        this._overviewBackdrop?.destroy();
        this._overviewBackdrop = null;
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
        this._updatePanel();
        this._blur?.syncAll();

        if (!this._globeOn || this._occluded())
            return GLib.SOURCE_CONTINUE;

        this._config.phi += this._config.spin * this._speed * (REFERENCE_FPS / this._config.fps);
        if (this._config.phi > Math.PI * 2.0)
            this._config.phi -= Math.PI * 2.0;

        for (const effect of this._effects)
            effect.queue_repaint();

        return GLib.SOURCE_CONTINUE;
    }
}
