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
// Height of the invisible strip along the bottom edge that brings a hidden
// dock back. Deep enough to hit with a flick of the mouse, shallow enough not
// to swallow clicks meant for the window underneath.
const REVEAL_STRIP = 3;
// Intellihide is driven off the extension's existing tick rather than a signal
// on every window, which would mean bookkeeping for handlers on actors that
// come and go. Rate limit it so a fast tick does not walk the window list 30
// times a second.
const SYNC_INTERVAL_US = 200_000;

export const DOCK_NAME = 'cybermythDock';
const TRASH_URI = 'trash:///';

export function trashDesktopPath(extensionPath) {
    return GLib.build_filenamev([extensionPath, 'data', 'trash.desktop']);
}

// Dash._init() connects to Shell.AppSystem, AppFavorites and Main.overview
// without keeping the handler ids (dash.js:384-400). The shell's own dash lives
// for the whole session so that costs it nothing, but ours is built and torn
// down with the extension: left alone, every enable/disable cycle would strand
// another set of handlers on three global singletons, each one holding a
// destroyed dash alive and firing into it. Borrow connect() for the length of
// the constructor so the ids can be collected and undone in destroy().
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

// The dash hands every icon it builds the current this.iconSize (dash.js:527),
// so setting that is enough for icons added later; the ones already on screen
// have to be told separately.
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

// The overview's dash is the shell's own, and it re-derives its icon size from
// the space the overview gives it on every redisplay (_adjustIconSize), so a
// size assigned to it is gone again at the next relayout. Our dock avoids that
// by never calling setMaxSize; this one cannot, because the overview sets it.
// Shadow the method with a no-op instead — an own property over the prototype's
// — and delete the shadow to put the shell's behaviour back exactly as it was.
export class OverviewDash {
    constructor(extensionPath) {
        this._dash = Main.overview.dash ?? null;
        this._origSize = this._dash ? this._dash.iconSize : null;
        this._patched = false;

        // The same trash item the desktop dock gets, so the two dashes hold the
        // same things. It survives the dash's redisplay for the same reason it
        // does there — see attachTrash.
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
                // dash gone, or it declined to resize; nothing to undo
            }
        }
        this._dash = null;
    }
}


// Trash, permanently on the dock. It is deliberately not a favourite: making it
// one would mean writing to the user's favorite-apps, and it could then be
// unpinned. This is its own item, always present, and it touches no settings.
//
// Everything it does comes out of data/trash.desktop — the icon, what a click
// runs, and the Empty Trash entry on the right-click menu — read straight from
// the file with DesktopAppInfo, so nothing has to be installed into the app grid
// or into ~/.local/share for the shell to index.
const TrashIcon = GObject.registerClass(
class TrashIcon extends Dash.DashItemContainer {
    _init(desktopPath) {
        super._init();

        this._info = Gio.DesktopAppInfo.new_from_filename(desktopPath);
        this._full = false;
        this._iconActor = null;

        this.button = new St.Button({
            // The same style class the dash gives an app, so the icon-highlight
            // colours apply to it exactly as they do to everything else here.
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

        // connectObject ties these to this item, so they come off by themselves
        // when it is destroyed, and cleanup() can drop them earlier than that.
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
        // A safety net only: Dock.destroy() calls cleanup() directly, so the
        // teardown order does not depend on when the destroy signal arrives.
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

            // Whatever the desktop file declares, so adding an action there is
            // all it takes to get another entry here.
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

            // The manager is deliberately not kept: addMenu() connects the
            // menu's own destroy to removeMenu(), which pops the modal grab and
            // disconnects everything, and until then the shell's signal tracker
            // (a Map, so a strong reference) holds the manager alive. Keeping a
            // field for it would only add a reference with nothing to release —
            // PopupMenuManager has no destroy() to call.
            new PopupMenu.PopupMenuManager(this.button).addMenu(this._menu);
        }

        this._menu.toggle();
    }

    // The icon has an empty and a full form, and the dock is the place people
    // look to find out which. Watch the trash rather than poll it.
    _watchTrash() {
        this._trash = Gio.File.new_for_uri(TRASH_URI);
        this._syncState();
        try {
            this._monitor = this._trash.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = this._monitor.connect('changed', () => this._syncState());
        } catch (e) {
            // no trash backend; the icon just stays in its empty form
        }
    }

    _syncState() {
        let full = false;
        try {
            const info = this._trash.query_info('trash::item-count',
                Gio.FileQueryInfoFlags.NONE, null);
            full = info.get_attribute_uint32('trash::item-count') > 0;
        } catch (e) {
            // trash:// can be unavailable; treat that as empty
        }

        if (full === this._full)
            return;

        this._full = full;
        if (this._iconActor) {
            this._iconActor.gicon =
                Gio.ThemedIcon.new(full ? 'user-trash-full' : 'user-trash');
        }
    }

    // Idempotent: called directly by Dock.destroy(), and again from the destroy
    // signal if something else tears the actor down first.
    cleanup() {
        if (this._monitor && this._monitorId) {
            this._monitor.disconnect(this._monitorId);
            this._monitorId = 0;
        }
        this._monitor?.cancel();
        this._monitor = null;

        // Destroying the menu is what unwinds its manager, via the destroy
        // handler addMenu() installed on it.
        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
        }

        this.button?.disconnectObject(this);

        // Innermost first, then clear this.child so DashItemContainer's own
        // destroy handler does not reach for a button that is already gone.
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

// Put a trash item on a dash. It goes in _dashContainer rather than _box,
// because _box is rebuilt from favourites and running apps on every redisplay
// and anything of ours in there would be thrown away with it. Used for both
// dashes: ours on the desktop, and the shell's in the overview.
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

// A dash of our own, parked on the desktop. The shell's dash stays where it is
// and keeps running the overview; this is a second instance, so nothing about
// the overview has to be monkey-patched or reparented.
export class Dock {
    constructor(extensionPath) {
        this._extensionPath = extensionPath;
        this._trashItem = null;
        this._conns = [];
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
        this._conns.push([obj, obj.connect(signal, cb)]);
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

        // addChrome, not addTopChrome: the dock belongs above windows but
        // below menus, the same as the top bar.
        Main.layoutManager.addChrome(this._container, {trackFullscreen: true});

        // Nothing wires up a free-standing dash's apps button — in the overview
        // that is overviewControls' job — so it has to be done here.
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

        // Trash sits at the far end of the dock, next to the apps button.
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

    // Whether autohide applies right now: a rotated monitor is taller than it
    // is wide, and the two cases get their own setting.
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

        // Deliberately no setMaxSize() here. _adjustIconSize() returns early
        // while _maxWidth/_maxHeight are -1 (dash.js:596), and that early
        // return is what stops the dash re-deciding the icon size for itself
        // and overruling the one the user picked.

        // Measure the dash, not the container. set_size() pins an actor's
        // natural size, so a container that is asked for its own preferred size
        // after having been sized once just reports that same size back for
        // ever — and the dock would never grow when an app is added.
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

    // True when any ordinary window on the active workspace would sit under the
    // dock. Rectangles are compared as plain numbers: Meta.Rectangle is gone in
    // Mutter 48 and there is nothing here that needs a real one.
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

        // The overview brings its own dash; two of them on screen at once is
        // just clutter.
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
        for (const [obj, id] of this._conns) {
            try {
                obj.disconnect(id);
            } catch (e) {
                // object already gone
            }
        }
        this._conns = [];

        // The handlers the Dash constructor left on the global singletons.
        for (const [obj, id] of this._dashConns) {
            try {
                obj.disconnect(id);
            } catch (e) {
                // object already gone
            }
        }
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
