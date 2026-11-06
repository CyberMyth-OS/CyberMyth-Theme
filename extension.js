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
import {Dock, DOCK_NAME, OverviewDash} from './lib/dock.js';
import {DynamicStylesheet, rgba} from './lib/dynamicStyle.js';
import {GlobeEffect, EFFECT_NAME} from './lib/globeEffect.js';
import {THEMES, THEME_ORDER} from './lib/themes.js';

const REFERENCE_FPS = 30;
const IDLE_POLL_FPS = 5;
const PANEL_STYLE_CLASS = 'cybermyth-transparent-panel';
const BLUR_BRIGHTNESS = 1.0;
const BLUR_SEARCH_DEPTH = 3;

export default class CybermythExtension extends Extension {
    async enable() {
        this._settings = this.getSettings();
        this._effects = new Set();
        this._actorConns = new Set();
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
        this._dock = null;
        this._overviewDash = null;
        this._style = new DynamicStylesheet(this.uuid);

        this._config = {
            phi: 0.0,
            spin: THEMES.globe.spin,
            fps: REFERENCE_FPS,
            bgOpacity: 1.0,
            globeOpacity: 1.0,
            colors: {...THEMES.globe.colors},
        };

        const settingsSignals = [
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
            'changed::dock-enabled',
            'changed::dock-autohide-portrait',
            'changed::dock-autohide-landscape',
            'changed::dock-radius',
            'changed::dock-icon-size',
            'changed::rotation-speed',
            'changed::fps',
        ];
        for (const signal of settingsSignals)
            this._settings.connectObject(signal, () => this._applySettings(), this);

        const self = this;
        this._origCreate = Background.BackgroundManager.prototype._createBackgroundActor;
        Background.BackgroundManager.prototype._createBackgroundActor = function () {
            const actor = self._origCreate.call(this);
            if (self._globeOn && !shouldSkipGlobe(this._container))
                self._attach(actor);
            return actor;
        };

        await loadRoundedBlur();

        this._applySettings();
    }

    disable() {
        this._stopTick();
        this._dock?.destroy();
        this._dock = null;
        this._overviewDash?.destroy();
        this._overviewDash = null;
        this._resetPanel();
        this._clearMenuBlur();
        this._overviewBackdrop?.destroy();
        this._overviewBackdrop = null;
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

        this._settings.disconnectObject(this);
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
        this._applyDock();
    }

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
        this._globeOn = false;

        for (const actor of this._actorConns)
            actor.disconnectObject(this);
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

        actor.connectObject('destroy', () => {
            this._effects.delete(effect);
            this._actorConns.delete(actor);
        }, this);
        this._actorConns.add(actor);
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

    _panelObscured() {
        const active = global.workspace_manager.get_active_workspace();
        const primary = Main.layoutManager.primaryIndex;

        return global.get_window_actors().some(a => {
            const w = a.meta_window;
            return !w.minimized &&
                w.window_type === Meta.WindowType.NORMAL &&
                w.get_monitor() === primary &&
                w.get_workspace() === active &&
                (w.is_fullscreen() || w.is_maximized());
        });
    }

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

    _applyMenuBlur() {
        if (!this._settings.get_boolean('menu-blur')) {
            this._clearMenuBlur();
            return;
        }

        this._blur.setParams({
            radius: this._blurRadius,
            brightness: BLUR_BRIGHTNESS,
        });

        if (!this._uiGroupConn) {
            Main.uiGroup.connectObject('child-added',
                (_group, child) => this._blurTarget(child), this);
            this._uiGroupConn = true;
        }

        for (const child of Main.uiGroup.get_children())
            this._blurTarget(child);
    }

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

    _updateStyle() {
        const hex = h => this._hexToRgb(h);
        const menu = rgba(hex, this._settings.get_string('menu-color'),
            this._settings.get_double('menu-opacity'));
        const hover = rgba(hex, this._settings.get_string('hover-color'),
            this._settings.get_double('hover-opacity'));
        const dockRadius = this._settings.get_int('dock-radius');

        const dashRoots = [`#${DOCK_NAME}`, '#overviewGroup'];
        const dashSel = sel => dashRoots.map(r => `${r} ${sel}`).join(',\n');

        const DASH_ITEMS = ['show-apps', 'overview-tile', 'grid-search-result'];
        const DASH_STATES = [
            ':focus .overview-icon',
            ':focus .overview-icon:hover',
            ':hover .overview-icon',
            ':active .overview-icon',
            ':active .overview-icon:hover',
            ':active .overview-icon:focus',
            ':checked .overview-icon',
            ':checked .overview-icon:hover',
            ':checked .overview-icon:active',
        ];
        const dashIconsRest = dashSel(DASH_ITEMS
            .map(k => `#dash .dash-item-container .${k} .overview-icon`)
            .join(',\n'));
        const dashStates = dashRoots.flatMap(r =>
            DASH_ITEMS.flatMap(k => DASH_STATES.map(st =>
                `${r} #dash .dash-item-container .${k}${st}`))).join(',\n');

        const DASH_BUTTON_STATES = [
            ':hover', ':focus', ':focus:hover',
            ':active', ':active:hover', ':active:focus',
            ':checked', ':checked:hover', ':checked:active',
            ':selected', ':selected:hover', ':selected:active',
            ':highlighted', ':highlighted:hover', ':highlighted:active',
            ':insensitive',
        ];
        const dashButtons = dashRoots.flatMap(r =>
            DASH_ITEMS.flatMap(k => DASH_BUTTON_STATES.map(st =>
                `${r} #dash .dash-item-container .${k}${st}`))).join(',\n');

        this._style.update(`
.popup-menu .popup-menu-content,
.candidate-popup-boxpointer .candidate-popup-content,
#overviewGroup .app-folder-dialog {
    background-color: ${menu};
}

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

${dashSel('#dash .dash-background')} {
    background-color: ${menu};
    border-radius: ${dockRadius}px;
    box-shadow: none;
}

${dashIconsRest} {
    background-color: transparent;
}

${dashStates} {
    background-color: ${hover};
}

${dashButtons} {
    background-color: transparent;
    box-shadow: none !important;
}

.quick-toggle-menu,
.popup-menu-content .quick-toggle-menu {
    background-color: transparent;
    box-shadow: none;
}
`);
    }

    _applyOverviewBackdrop() {
        if (this._overviewBackdrop) {
            this._overviewBackdrop.setParams(this._blurRadius, BLUR_BRIGHTNESS);
            return;
        }
        this._overviewBackdrop = new OverviewBackdrop(this._blurRadius, BLUR_BRIGHTNESS);
    }

    _applyDock() {
        this._overviewDash ??= new OverviewDash(this.path);
        this._overviewDash.setSize(this._settings.get_int('dock-icon-size'));

        if (!this._settings.get_boolean('dock-enabled')) {
            this._dock?.destroy();
            this._dock = null;
            return;
        }

        if (!this._dock) {
            this._dock = new Dock(this.path);
            this._dock.build();
        }

        this._dock.setParams({
            autohidePortrait: this._settings.get_boolean('dock-autohide-portrait'),
            autohideLandscape: this._settings.get_boolean('dock-autohide-landscape'),
            iconSize: this._settings.get_int('dock-icon-size'),
        });
    }

    _clearMenuBlur() {
        if (this._uiGroupConn) {
            Main.uiGroup.disconnectObject(this);
            this._uiGroupConn = false;
        }
        this._blur.removeAll();
    }

    _occluded() {
        if (Main.overview.visible)
            return false;

        const active = global.workspace_manager.get_active_workspace();

        return global.get_window_actors().some(a => {
            const w = a.meta_window;
            return !w.minimized &&
                w.get_workspace() === active &&
                (w.is_fullscreen() || w.is_maximized());
        });
    }

    _tick() {
        this._updatePanel();
        this._blur?.syncAll();
        this._dock?.sync();

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
