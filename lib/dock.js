// SPDX-FileCopyrightText: 2026 Toshith Yadav
// SPDX-License-Identifier: GPL-2.0-or-later
//
// The intelligent-autohide behaviour in this file follows the approach taken
// by Dash to Dock (https://github.com/micheleg/dash-to-dock), copyright
// Michele Gaio and contributors, licensed GPL-2.0-or-later: keep the dock on
// screen until a window on the active workspace would sit underneath it, then
// slide it away and give it back when the pointer reaches the screen edge.
// This is an independent implementation written against GNOME 48 rather than a
// copy of their code, but the idea is theirs and deserves the credit. Cybermyth
// Theme is GPL-2.0-or-later as well, so the lineage is licence-compatible
// either way.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as IconGrid from 'resource:///org/gnome/shell/ui/iconGrid.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const SLIDE_TIME = 200;
const REVEAL_STRIP = 3;
const SYNC_INTERVAL_US = 200_000;

export const DOCK_NAME = 'cybermythDock';
const TRASH_URI = 'trash:///';

export function trashDesktopPath(extensionPath) {
    return GLib.build_filenamev([extensionPath, 'data', 'trash.desktop']);
}

function createTrackedDash() {
    const targets = [
        Shell.AppSystem.get_default(),
        AppFavorites.getAppFavorites(),
        Main.overview,
    ];
    const conns = [];
    const saved = targets.map(t => [
        Object.prototype.hasOwnProperty.call(t, 'connect'),
        t.connect,
    ]);

    targets.forEach((target, i) => {
        const orig = saved[i][1];
        target.connect = function (...args) {
            const id = orig.apply(this, args);
            conns.push([target, id]);
            return id;
        };
    });

    try {
        return [new Dash.Dash(), conns];
    } finally {
        targets.forEach((target, i) => {
            const [owned, orig] = saved[i];
            if (owned)
                target.connect = orig;
            else
                delete target.connect;
        });
    }
}

function applyIconSize(dash, size) {
    if (!dash || dash.iconSize === size)
        return;

    dash.iconSize = size;
    dash._showAppsIcon?.icon?.setIconSize(size);

    for (const item of dash._box?.get_children() ?? []) {
        const icon = item.child?._delegate?.icon;
        icon?.setIconSize?.(size);
    }

    dash.emit('icon-size-changed');
}

export class OverviewDash {
    constructor(extensionPath) {
        this._dash = Main.overview.dash ?? null;
        this._origSize = this._dash ? this._dash.iconSize : null;
        this._patched = false;

        this._trashItem = attachTrash(this._dash, trashDesktopPath(extensionPath));
    }

    setSize(size) {
        if (!this._dash)
            return;

        if (!this._patched) {
            this._dash._adjustIconSize = () => {};
            this._patched = true;
        }

        applyIconSize(this._dash, size);
        this._trashItem?.icon.setIconSize(size);
    }

    destroy() {
        if (this._trashItem) {
            this._trashItem.cleanup();
            this._trashItem.destroy();
            this._trashItem = null;
        }

        if (this._dash && this._patched) {
            delete this._dash._adjustIconSize;
            this._patched = false;
            try {
                applyIconSize(this._dash, this._origSize);
                this._dash._adjustIconSize();
            } catch (e) {
            }
        }
        this._dash = null;
    }
}


const TrashIcon = GObject.registerClass(
class TrashIcon extends Dash.DashItemContainer {
    _init(desktopPath) {
        super._init();

        this._info = Gio.DesktopAppInfo.new_from_filename(desktopPath);
        this._full = false;
        this._iconActor = null;

        this.button = new St.Button({
            style_class: 'overview-tile',
            track_hover: true,
            can_focus: true,
        });

        this.icon = new IconGrid.BaseIcon(this._info?.get_name() ?? 'Trash', {
            setSizeManually: true,
            showLabel: false,
            createIcon: size => {
                this._iconActor = new St.Icon({
                    gicon: Gio.ThemedIcon.new(this._full ? 'user-trash-full' : 'user-trash'),
                    icon_size: size,
                });
                return this._iconActor;
            },
        });
        this.icon.y_align = Clutter.ActorAlign.CENTER;

        this.button.child = this.icon;
        this.button._delegate = this;
        this.setChild(this.button);
        this.setLabelText(this._info?.get_name() ?? 'Trash');

        this.button.connectObject(
            'clicked', () => this._launch(),
            'button-press-event', (_a, event) => {
                if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                    this._popupMenu();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            },
            'popup-menu', () => this._popupMenu(),
            this);

        this._watchTrash();
        this.connect('destroy', () => this.cleanup());
    }

    _context() {
        return global.create_app_launch_context(0, -1);
    }

    _launch() {
        this._menu?.close();
        Main.overview.hide();
        try {
            this._info?.launch([], this._context());
        } catch (e) {
            Main.notifyError('Trash', e.message);
        }
    }

    _popupMenu() {
        if (!this._menu) {
            this._menu = new PopupMenu.PopupMenu(this.button, 0.5, St.Side.BOTTOM);
            this._menu.addAction('Open Trash', () => this._launch());

            for (const action of this._info?.list_actions() ?? []) {
                this._menu.addAction(this._info.get_action_name(action), () => {
                    try {
                        this._info.launch_action(action, this._context());
                    } catch (e) {
                        Main.notifyError('Trash', e.message);
                    }
                });
            }

            Main.uiGroup.add_child(this._menu.actor);
            this._menu.actor.hide();

            new PopupMenu.PopupMenuManager(this.button).addMenu(this._menu);
        }

        this._menu.toggle();
    }

    _watchTrash() {
        this._trash = Gio.File.new_for_uri(TRASH_URI);
        this._syncState();
        try {
            this._monitor = this._trash.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connectObject('changed', () => this._syncState(), this);
        } catch (e) {
        }
    }

    _syncState() {
        let full = false;
        try {
            const info = this._trash.query_info('trash::item-count',
                Gio.FileQueryInfoFlags.NONE, null);
            full = info.get_attribute_uint32('trash::item-count') > 0;
        } catch (e) {
        }

        if (full === this._full)
            return;

        this._full = full;
        if (this._iconActor) {
            this._iconActor.gicon =
                Gio.ThemedIcon.new(full ? 'user-trash-full' : 'user-trash');
        }
    }

    cleanup() {
        if (this._monitor) {
            this._monitor.disconnectObject(this);
            this._monitor.cancel();
            this._monitor = null;
        }

        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
        }

        this.button?.disconnectObject(this);

        this._iconActor?.destroy();
        this._iconActor = null;
        this.icon?.destroy();
        this.icon = null;
        this.button?.destroy();
        this.button = null;
        this.child = null;

        this._info = null;
        this._trash = null;
    }
});

function attachTrash(dash, desktopPath) {
    if (!dash || !desktopPath)
        return null;

    if (!GLib.file_test(desktopPath, GLib.FileTest.EXISTS)) {
        console.warn(`cybermyth: no trash desktop entry at ${desktopPath}`);
        return null;
    }

    const item = new TrashIcon(desktopPath);
    dash._dashContainer.insert_child_below(item, dash._showAppsIcon);
    dash._hookUpLabel(item);
    item.show(false);
    return item;
}

export class Dock {
    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        this._trashItem = null;
        this._sources = new Set();
        this._dashConns = [];
        this._dash = null;
        this._container = null;
        this._reveal = null;
        this._hidden = false;
        this._revealed = false;
        this._autohide = false;
        this._lastSync = 0;
        this._geometry = {x: -1, y: -1, w: -1, h: -1};
    }

    get actor() {
        return this._container;
    }

    _track(obj, signal, cb) {
        obj.connectObject(signal, cb, this);
        this._sources.add(obj);
    }

    build() {
        if (this._container)
            return;

        const [dash, dashConns] = createTrackedDash();
        this._dash = dash;
        this._dashConns = dashConns;

        this._container = new St.Widget({
            name: DOCK_NAME,
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
        });
        this._container.add_child(dash);

        Main.layoutManager.addChrome(this._container, {trackFullscreen: true});

        this._track(dash.showAppsButton, 'notify::checked', () => {
            if (dash.showAppsButton.checked)
                Main.overview.show(OverviewControls.ControlsState.APP_GRID);
            else
                Main.overview.hide();
        });

        this._track(this._container, 'notify::hover', () => {
            if (!this._container.hover)
                this._revealed = false;
            this.sync(true);
        });
        this._track(dash, 'icon-size-changed', () => this.sync(true));
        this._track(Main.layoutManager, 'monitors-changed', () => this.sync(true));
        this._track(Main.overview, 'showing', () => this.sync(true));
        this._track(Main.overview, 'hidden', () => {
            dash.showAppsButton.checked = false;
            this.sync(true);
        });
        this._track(global.display, 'restacked', () => this.sync(true));
        this._track(global.window_manager, 'switch-workspace', () => this.sync(true));

        this._trashItem = attachTrash(dash, trashDesktopPath(this._extensionPath));

        this._reveal = new St.Widget({
            name: 'cybermythDockReveal',
            opacity: 0,
            reactive: true,
            track_hover: true,
        });
        Main.layoutManager.addChrome(this._reveal, {trackFullscreen: true});
        this._track(this._reveal, 'notify::hover', () => {
            if (this._reveal.hover) {
                this._revealed = true;
                this.sync(true);
            }
        });

        this.sync(true);
    }

    _autohideWanted(portrait, landscape) {
        const mon = Main.layoutManager.primaryMonitor;
        if (!mon)
            return false;
        return mon.height > mon.width ? portrait : landscape;
    }

    setParams({autohidePortrait, autohideLandscape, iconSize}) {
        this._autohide = this._autohideWanted(autohidePortrait, autohideLandscape);

        if (iconSize !== undefined) {
            applyIconSize(this._dash, iconSize);
            this._trashItem?.icon.setIconSize(iconSize);
        }

        this.sync(true);
    }

    _reposition() {
        const mon = Main.layoutManager.primaryMonitor;
        if (!mon || !this._container)
            return;

        const [, natW] = this._dash.get_preferred_width(-1);
        const [, natH] = this._dash.get_preferred_height(natW);
        const x = mon.x + Math.max(0, Math.round((mon.width - natW) / 2));
        const y = mon.y + mon.height - natH;

        const g = this._geometry;
        if (g.x !== x || g.y !== y || g.w !== natW || g.h !== natH) {
            this._container.set_position(x, y);
            this._container.set_size(natW, natH);
            this._geometry = {x, y, w: natW, h: natH};
        }

        this._reveal.set_position(mon.x, mon.y + mon.height - REVEAL_STRIP);
        this._reveal.set_size(mon.width, REVEAL_STRIP);
    }

    _obscured() {
        const mon = Main.layoutManager.primaryMonitor;
        if (!mon)
            return false;

        const {x, y, w, h} = this._geometry;
        const ws = global.workspace_manager.get_active_workspace();

        for (const win of ws.list_windows()) {
            if (win.get_monitor() !== Main.layoutManager.primaryIndex)
                continue;
            if (win.minimized || !win.showing_on_its_workspace())
                continue;

            const type = win.get_window_type();
            if (type !== Meta.WindowType.NORMAL && type !== Meta.WindowType.DIALOG)
                continue;

            const r = win.get_frame_rect();
            if (r.x < x + w && r.x + r.width > x &&
                r.y < y + h && r.y + r.height > y)
                return true;
        }

        return false;
    }

    sync(force = false) {
        if (!this._container)
            return;

        const now = GLib.get_monotonic_time();
        if (!force && now - this._lastSync < SYNC_INTERVAL_US)
            return;
        this._lastSync = now;

        this._reposition();

        if (Main.overview.visibleTarget) {
            this._container.hide();
            this._reveal.hide();
            return;
        }

        this._container.show();
        this._reveal.visible = this._autohide;

        let hidden = false;
        if (this._autohide && !this._revealed && !this._container.hover)
            hidden = this._obscured();

        this._setHidden(hidden);
    }

    _setHidden(hidden) {
        if (this._hidden === hidden)
            return;
        this._hidden = hidden;

        this._container.remove_all_transitions();
        this._container.ease({
            translation_y: hidden ? this._geometry.h : 0,
            opacity: hidden ? 0 : 255,
            duration: SLIDE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    destroy() {
        for (const obj of this._sources)
            obj.disconnectObject(this);
        this._sources.clear();

        for (const [obj, id] of this._dashConns)
            obj.disconnect(id);
        this._dashConns = [];

        if (this._reveal) {
            Main.layoutManager.removeChrome(this._reveal);
            this._reveal.destroy();
            this._reveal = null;
        }

        if (this._trashItem) {
            this._trashItem.cleanup();
            this._trashItem.destroy();
            this._trashItem = null;
        }

        if (this._container) {
            this._container.remove_all_transitions();
            Main.layoutManager.removeChrome(this._container);
            this._container.destroy();
            this._container = null;
        }

        this._dash = null;
    }
}
