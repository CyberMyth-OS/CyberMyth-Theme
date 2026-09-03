// SPDX-FileCopyrightText: 2026 Toshith Yadav
// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BLUR_EFFECT = 'cybermyth-blur';
const WATCH_EFFECT = 'cybermyth-blur-watch';

// Containers whose background must stay free of the globe effect. A WeakSet
// rather than a property on the actor: an expando set on a GObject wrapper is
// lost if that wrapper is ever collected and rebuilt from C.
const skipGlobe = new WeakSet();

export function shouldSkipGlobe(container) {
    return !!container && skipGlobe.has(container);
}
// Shell.BlurEffect in background mode never recomputes its sample on its own,
// so it has to be invalidated by hand each time the actor repaints.
// Rate limit the invalidation, or an actor that paints constantly pins the GPU.
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

// gnome-rounded-blur is an optional system library. When it is installed its
// BlurEffect grows a corner-radius property, which rounds the blur itself; that
// is the only way to stop a blurred rectangle showing square corners behind a
// rounded menu. Absent it, everything still works with square blur corners.
//
// Resolved once from enable(), never at module scope: an extension must not do
// work while its module is being loaded.
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
        // not installed; square corners it is
    }
    return RoundedBlur;
}

export function hasRoundedBlur() {
    return !!RoundedBlur;
}

// Menus do not share one radius: .popup-menu-content is 20px, but the quick
// settings menu overrides it to 36px via .quick-settings. Measured from the
// live tree — a hardcoded value rounds the blur tighter than the menu and the
// corners poke out. Always read it from the element being blurred.
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

// Owns every blurred surface so disable() hands them all back untouched.
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
                // effect's actor is already gone; it will be reaped on destroy
            }
        }
    }

    has(actor) {
        return this._dynamic.has(actor);
    }

    // opts.selfPaint: whether the actor repainting itself should re-sample the
    // blur. True for menus, whose whole life is short and whose backdrop cannot
    // change without them repainting. False for a long-lived surface like the
    // dock, which repaints on its own hover states — see _addDynamic.
    add(actor, opts = {}) {
        if (!actor || this.has(actor) || !actor.get_parent())
            return;

        this._addDynamic(actor, opts);
    }

    // Re-sample now. For surfaces added with selfPaint: false this is the only
    // thing that refreshes the blur, so the owner has to drive it.
    invalidate(actor) {
        const entry = this._dynamic.get(actor);
        if (!entry)
            return;

        // Re-sampling a surface with no area makes Cogl try to build a
        // zero-width texture, which it complains about loudly.
        try {
            const [w, h] = entry.target.get_size();
            if (w < 1 || h < 1)
                return;
        } catch (e) {
            return;
        }

        // A background blur copies the framebuffer under its actor at paint
        // time. If that paint is a clipped redraw — the kind a moving pointer
        // produces — the region under the actor was not redrawn this frame, so
        // the buffer still holds the last fully composited frame, this actor
        // included. Sampling that blurs the surface back over itself and the
        // whole panel darkens until something forces a full repaint. Ask for
        // that full repaint up front so the copy is always taken from a frame
        // that was actually drawn.
        global.stage.queue_redraw();

        entry.cancelPending();
        entry.requeue();
    }

    _addDynamic(actor, opts = {}) {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;

        // BoxPointer paints itself into an offscreen framebuffer, and inside
        // that buffer there is nothing behind it to sample — which is why
        // background blur comes out empty. Paint it inline instead, and put the
        // redirect back when we let go of the actor.
        const origRedirect = actor.get_offscreen_redirect();
        actor.set_offscreen_redirect(0);

        // GNOME dims the whole BoxPointer when a quick-settings submenu opens
        // (quickSettings.js adds a BrightnessContrastEffect named 'dim'). That
        // assumes an opaque menu; over a translucent one it washes the panel
        // out and lets the desktop show through. Hold it off while our theme
        // is on, and put it back exactly as found.
        const dim = actor.get_effect('dim');
        const dimWasEnabled = dim ? dim.enabled : null;
        if (dim)
            dim.enabled = false;

        // Blur the styled content box rather than the BoxPointer: the pointer
        // is larger by its arrow rise and padding, so blurring it spills past
        // every edge of the menu you can actually see.
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
                        // actor gone; the destroy handler will reap the entry
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

        // A background blur re-reads what is behind its actor. Tying that to the
        // actor's own paint is right for a menu, but wrong for the dock: an
        // icon's hover state makes the dock dirty, and the re-read then happens
        // during the small clipped redraw that the pointer caused, where the
        // buffer behind still holds the previous frame — the dock's own
        // composited output included. Blurring that back over itself darkens
        // the whole panel until the next full redraw clears it.
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
            entry.destroyId = 0;
            entry.targetDestroyId = 0;
            this._dynamic.delete(actor);

            // Hand the BoxPointer back exactly as we found it. Without this the
            // redirect stays off for the life of the menu, which changes how its
            // translucent layers composite — visible as light patches at the
            // corners that outlive both turning blur off and disabling us.
            if (boxPointerSurvives) {
                try {
                    if (entry.dim && entry.dimWasEnabled !== null)
                        entry.dim.enabled = entry.dimWasEnabled;
                    actor.set_offscreen_redirect(entry.origRedirect);
                } catch (e) {
                    // the BoxPointer went too; nothing to restore
                }
            }
        };

        entry.destroyId = actor.connect('destroy', () => forget(false));
        // A menu can rebuild its content box while the BoxPointer lives on. If
        // we keep the entry, the next settings change touches a disposed actor.
        if (target !== actor)
            entry.targetDestroyId = target.connect('destroy', () => forget(true));

        entry.requeue = requeue;
        const [iw, ih] = target.get_size();
        entry.w = iw;
        entry.h = ih;

        this._dynamic.set(actor, entry);
        requeue();
    }

    // A menu grows when a submenu expands, and Shell.BlurEffect keeps showing
    // the sample it took at the old size: the new area is left unblurred, and
    // even at rest a stale sample reads as square patches in the corners.
    // notify::allocation does not fire reliably here, so the extension's tick
    // drives this instead; it only does work when the size actually changed.
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

                // The shell turns 'dim' back on each time a submenu opens.
                if (entry.dim && entry.dim.enabled)
                    entry.dim.enabled = false;
            } catch (e) {
                // actor disposed; its destroy handler will reap the entry
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

        try {
            if (entry.destroyId)
                actor.disconnect(entry.destroyId);
            if (entry.targetDestroyId)
                entry.target.disconnect(entry.targetDestroyId);
            entry.target.remove_effect_by_name(BLUR_EFFECT);
            entry.target.remove_effect_by_name(WATCH_EFFECT);
            actor.set_offscreen_redirect(entry.origRedirect);
            if (entry.dim && entry.dimWasEnabled !== null)
                entry.dim.enabled = entry.dimWasEnabled;
        } catch (e) {
            // the actor went away underneath us; nothing left to undo
        }
    }

    removeAll() {
        for (const actor of [...this._dynamic.keys()])
            this.remove(actor);
    }
}

// The overview and the app grid share #overviewGroup, whose flat grey we clear
// in CSS. This parks a blurred copy of the wallpaper underneath it, per
// monitor, so both pages sit on the desktop rather than on a slab. No tint
// here on purpose: the menu colour belongs to menus, not to the wallpaper.
export class OverviewBackdrop {
    constructor(radius, brightness) {
        this._entries = [];
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
            // The BackgroundManager below is handed this actor as its
            // container, so this is what the globe patch checks. Tagging the
            // outer container instead silently does nothing: the overview
            // should show the plain wallpaper, not a second globe.
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
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        for (const {wallpaper} of this._entries) {
            wallpaper.get_effect(BLUR_EFFECT)?.set({
                radius: Math.max(0, radius * scale),
                brightness,
            });
        }
    }

    destroy() {
        for (const {container, bgManager} of this._entries) {
            bgManager?.destroy();
            container?.destroy();
        }
        this._entries = [];
    }
}
