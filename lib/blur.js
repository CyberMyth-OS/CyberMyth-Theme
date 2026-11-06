// SPDX-FileCopyrightText: 2026 Toshith Yadav
// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BLUR_EFFECT = 'cybermyth-blur';
const WATCH_EFFECT = 'cybermyth-blur-watch';

const skipGlobe = new WeakSet();

export function shouldSkipGlobe(container) {
    return !!container && skipGlobe.has(container);
}
const REPAINT_INTERVAL_US = 100_000;

const PaintWatcher = GObject.registerClass({
    GTypeName: 'CybermythPaintWatcher',
}, class PaintWatcher extends Clutter.Effect {
    setCallback(callback) {
        this._callback = callback;
    }

    vfunc_paint(node, paintContext, paintFlags) {
        this._callback?.(paintFlags);
        super.vfunc_paint(node, paintContext, paintFlags);
    }
});

let RoundedBlur = null;

export async function loadRoundedBlur() {
    if (RoundedBlur !== null)
        return RoundedBlur;

    RoundedBlur = false;
    try {
        const ns = (await import('gi://Blur')).default;
        const rounds = ns?.BlurEffect?.list_properties?.()
            .some(property => property.name === 'corner-radius');
        if (rounds)
            RoundedBlur = ns;
    } catch (e) {
    }
    return RoundedBlur;
}

export function hasRoundedBlur() {
    return !!RoundedBlur;
}

function readCornerRadius(actor) {
    try {
        return actor.get_theme_node().get_border_radius(St.Corner.TOPLEFT);
    } catch (e) {
        return 0;
    }
}

function makeBlurEffect(mode, radius, brightness, cornerRadius) {
    const ns = RoundedBlur || Shell;
    const effect = new ns.BlurEffect({
        name: BLUR_EFFECT,
        mode: mode === 'actor' ? ns.BlurMode.ACTOR : ns.BlurMode.BACKGROUND,
        radius: Math.max(0, radius),
        brightness,
    });
    if (RoundedBlur && cornerRadius !== undefined)
        effect.corner_radius = Math.max(0, cornerRadius);
    return effect;
}

export class BlurManager {
    constructor() {
        this._dynamic = new Map();
        this._radius = 30;
        this._brightness = 1.0;
    }

    setParams({radius, brightness}) {
        if (radius !== undefined)
            this._radius = radius;
        if (brightness !== undefined)
            this._brightness = brightness;

        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        for (const {blur} of this._dynamic.values()) {
            try {
                blur.set({
                    radius: Math.max(0, this._radius * scale),
                    brightness: this._brightness,
                });
            } catch (e) {
            }
        }
    }

    has(actor) {
        return this._dynamic.has(actor);
    }

    add(actor, opts = {}) {
        if (!actor || this.has(actor) || !actor.get_parent())
            return;

        this._addDynamic(actor, opts);
    }

    invalidate(actor) {
        const entry = this._dynamic.get(actor);
        if (!entry)
            return;

        try {
            const [w, h] = entry.target.get_size();
            if (w < 1 || h < 1)
                return;
        } catch (e) {
            return;
        }

        global.stage.queue_redraw();

        entry.cancelPending();
        entry.requeue();
    }

    _addDynamic(actor, opts = {}) {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;

        const origRedirect = actor.get_offscreen_redirect();
        actor.set_offscreen_redirect(0);

        const dim = actor.get_effect('dim');
        const dimWasEnabled = dim ? dim.enabled : null;
        if (dim)
            dim.enabled = false;

        const target = actor.bin?.get_child?.() ?? actor;
        const blur = makeBlurEffect('background', this._radius * scale,
            this._brightness, readCornerRadius(target));
        target.add_effect_with_name(BLUR_EFFECT, blur);

        const entry = {
            blur, timeoutId: 0, lastRepaint: 0, skipNext: false,
            origRedirect, target, dim, dimWasEnabled,
        };

        const requeue = () => {
            if (RoundedBlur) {
                const r = readCornerRadius(target);
                if (r !== entry.cornerRadius) {
                    entry.cornerRadius = r;
                    try {
                        blur.corner_radius = r;
                    } catch (e) {
                    }
                }
            }
            entry.lastRepaint = GLib.get_monotonic_time();
            entry.skipNext = true;
            try {
                blur.queue_repaint();
            } catch (e) {
                entry.skipNext = false;
            }
        };
        entry.cancelPending = () => {
            if (entry.timeoutId) {
                GLib.Source.remove(entry.timeoutId);
                entry.timeoutId = 0;
            }
        };

        const watcher = opts.selfPaint === false ? null : new PaintWatcher();
        watcher?.setCallback(flags => {
            if (entry.skipNext) {
                entry.skipNext = false;
                return;
            }
            if (!(flags & Clutter.EffectPaintFlags.ACTOR_DIRTY))
                return;

            const elapsed = GLib.get_monotonic_time() - entry.lastRepaint;
            if (elapsed >= REPAINT_INTERVAL_US) {
                entry.cancelPending();
                requeue();
                return;
            }
            if (entry.timeoutId)
                return;

            const delay = Math.max(1, Math.ceil((REPAINT_INTERVAL_US - elapsed) / 1000));
            entry.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                entry.timeoutId = 0;
                requeue();
                return GLib.SOURCE_REMOVE;
            });
        });
        if (watcher)
            target.add_effect_with_name(WATCH_EFFECT, watcher);

        entry.watcher = watcher;

        const forget = boxPointerSurvives => {
            entry.cancelPending();
            watcher?.setCallback(null);
            this._dynamic.delete(actor);

            if (boxPointerSurvives) {
                try {
                    if (entry.dim && entry.dimWasEnabled !== null)
                        entry.dim.enabled = entry.dimWasEnabled;
                    actor.set_offscreen_redirect(entry.origRedirect);
                } catch (e) {
                }
            }
        };

        actor.connectObject('destroy', () => forget(false), this);
        if (target !== actor)
            target.connectObject('destroy', () => forget(true), this);

        entry.requeue = requeue;
        const [iw, ih] = target.get_size();
        entry.w = iw;
        entry.h = ih;

        this._dynamic.set(actor, entry);
        requeue();
    }

    syncAll() {
        for (const entry of this._dynamic.values()) {
            try {
                const [w, h] = entry.target.get_size();
                if (w === entry.w && h === entry.h)
                    continue;

                entry.w = w;
                entry.h = h;
                entry.lastRepaint = 0;
                entry.cancelPending();
                entry.requeue();

                if (entry.dim && entry.dim.enabled)
                    entry.dim.enabled = false;
            } catch (e) {
            }
        }
    }

    remove(actor) {
        const entry = this._dynamic.get(actor);
        if (!entry)
            return;

        this._dynamic.delete(actor);
        entry.cancelPending();
        entry.watcher?.setCallback(null);
        actor.disconnectObject(this);
        entry.target.disconnectObject(this);

        try {
            entry.target.remove_effect_by_name(BLUR_EFFECT);
            entry.target.remove_effect_by_name(WATCH_EFFECT);
            actor.set_offscreen_redirect(entry.origRedirect);
            if (entry.dim && entry.dimWasEnabled !== null)
                entry.dim.enabled = entry.dimWasEnabled;
        } catch (e) {
        }
    }

    removeAll() {
        for (const actor of [...this._dynamic.keys()])
            this.remove(actor);
    }
}

export class OverviewBackdrop {
    constructor(radius, brightness) {
        this._radius = radius;
        this._brightness = brightness;
        this._entries = [];
        this._rebuildId = 0;

        this._build();

        Main.layoutManager.connectObject('monitors-changed',
            () => this._queueRebuild(), this);
        St.ThemeContext.get_for_stage(global.stage).connectObject(
            'notify::scale-factor', () => this._queueRebuild(), this);
    }

    _queueRebuild() {
        if (this._rebuildId)
            GLib.source_remove(this._rebuildId);
        this._rebuildId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._rebuildId = 0;
            this._teardown();
            this._build();
            return GLib.SOURCE_REMOVE;
        });
    }

    _build() {
        const radius = this._radius;
        const brightness = this._brightness;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const group = Main.layoutManager.overviewGroup;

        Main.layoutManager.monitors.forEach((monitor, index) => {
            const container = new St.Widget({
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
                reactive: false,
            });

            const wallpaper = new St.Widget({
                width: monitor.width,
                height: monitor.height,
                reactive: false,
            });
            skipGlobe.add(wallpaper);
            wallpaper.add_effect_with_name(BLUR_EFFECT,
                makeBlurEffect('actor', radius * scale, brightness));
            const bgManager = new Background.BackgroundManager({
                container: wallpaper,
                monitorIndex: index,
                controlPosition: false,
            });
            container.add_child(wallpaper);

            group.add_child(container);
            group.set_child_below_sibling(container, null);

            this._entries.push({container, wallpaper, bgManager});
        });
    }

    setParams(radius, brightness) {
        this._radius = radius;
        this._brightness = brightness;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        for (const {wallpaper} of this._entries) {
            wallpaper.get_effect(BLUR_EFFECT)?.set({
                radius: Math.max(0, radius * scale),
                brightness,
            });
        }
    }

    _teardown() {
        for (const {container, bgManager} of this._entries) {
            bgManager?.destroy();
            container?.destroy();
        }
        this._entries = [];
    }

    destroy() {
        if (this._rebuildId) {
            GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
        }
        Main.layoutManager.disconnectObject(this);
        St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);
        this._teardown();
    }
}
