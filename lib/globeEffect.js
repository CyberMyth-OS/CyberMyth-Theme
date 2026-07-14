// SPDX-FileCopyrightText: 2026 Toshith Yadav
// SPDX-License-Identifier: GPL-2.0-or-later

import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

export const EFFECT_NAME = 'cybermyth-globe';

const DECLARATIONS = `
uniform float u_phi;
uniform float u_aspect;
uniform float u_bg_opacity;
uniform float u_globe_opacity;
uniform vec3  u_bg;
uniform vec3  u_land;
uniform vec3  u_glow;
uniform sampler2D u_mask;

const float PI   = 3.14159265;
const float NX   = 220.0;
const float NY   = 110.0;
const float ZOOM = 3.0;

mat3 rotY(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat3(c, 0.0, -s,
                0.0, 1.0, 0.0,
                s, 0.0, c);
}
`;

const FRAGMENT = `
vec2 tc = cogl_tex_coord_in[0].st;
vec2 uv = (tc - 0.5) * vec2(u_aspect, 1.0);
uv.y = -uv.y;

vec3 wall  = texture2D(cogl_sampler0, tc).rgb;
vec3 space = mix(wall, u_bg, u_bg_opacity);

vec3 ro = vec3(0.0, 0.0, 3.0);
vec3 rd = normalize(vec3(uv * ZOOM, -3.0));

mat3 tilt = mat3(1.0,  0.0,   0.0,
                 0.0,  0.966, 0.259,
                 0.0, -0.259, 0.966);

float b = dot(ro, rd);
float c = dot(ro, ro) - 1.0;
float h = b * b - c;

vec3 col;
if (h > 0.0) {
    col = mix(wall, u_bg, u_globe_opacity);

    float t = -b - sqrt(h);
    vec3  n = normalize(ro + t * rd);
    vec3  p = rotY(u_phi) * (tilt * n);

    float lat = asin(clamp(p.y, -1.0, 1.0));
    float lon = atan(p.z, p.x);
    vec2  sph = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);

    vec2  cell = sph * vec2(NX, NY);
    vec2  f    = fract(cell) - 0.5;
    f.x *= max(cos(lat), 0.08) * (NX / NY);

    float land = step(0.5, texture2D(u_mask, sph).r);
    float dotm = smoothstep(0.34, 0.18, length(f)) * land;

    float diff = max(dot(n, normalize(vec3(0.55, 0.45, 0.75))), 0.0);
    col = mix(col, u_land * (0.30 + 1.15 * diff), dotm);

    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    col += u_glow * rim * 0.30;
} else {
    col = space;
    float halo = exp(-max(length(uv * ZOOM) - 1.02, 0.0) * 14.0);
    col += u_glow * halo * 0.30;
}

cogl_color_out = vec4(col, 1.0);
`;

export const GlobeEffect = GObject.registerClass(
class GlobeEffect extends Shell.GLSLEffect {
    setup(config, maskContent) {
        this._config = config;
        this.setMask(maskContent);
        return this;
    }

    setMask(maskContent) {
        this._maskContent = maskContent;
        this._maskBound = false;
    }

    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, FRAGMENT, true);
    }

    vfunc_paint_target(node, paintContext) {
        const cfg = this._config;
        const actor = this.get_actor();
        const w = actor ? actor.width : 1;
        const h = actor ? actor.height : 1;

        if (!this._maskBound && this._maskContent) {
            const pipeline = this.get_pipeline();
            pipeline.set_layer_texture(1, this._maskContent.get_texture());
            pipeline.set_layer_filters(1, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
            pipeline.set_layer_wrap_mode_s(1, Cogl.PipelineWrapMode.REPEAT);
            pipeline.set_layer_wrap_mode_t(1, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
            const maskLoc = this.get_uniform_location('u_mask');
            if (maskLoc >= 0)
                pipeline.set_uniform_1i(maskLoc, 1);
            this._maskBound = true;
        }

        this._setFloat('u_phi', 1, [cfg.phi]);
        this._setFloat('u_aspect', 1, [h > 0 ? w / h : 1.0]);
        this._setFloat('u_bg_opacity', 1, [cfg.bgOpacity]);
        this._setFloat('u_globe_opacity', 1, [cfg.globeOpacity]);
        this._setFloat('u_bg', 3, cfg.colors.bg);
        this._setFloat('u_land', 3, cfg.colors.land);
        this._setFloat('u_glow', 3, cfg.colors.glow);

        super.vfunc_paint_target(node, paintContext);
    }

    _setFloat(name, n, value) {
        const loc = this.get_uniform_location(name);
        if (loc >= 0)
            this.set_uniform_float(loc, n, value);
    }
});
