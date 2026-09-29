// GLSL ES 3.00 sources for the renderer passes.
//
//   scene (MRT)  : instanced quads → albedo (lit later) + emissive (unlit, bloom source) + flat (unlit, no bloom)
//   lights       : additive radial quads → light accumulation
//   composite    : albedo × (ambient + soft-shouldered light) + emissive + flat + haze → hdr, plus bloom bright-pass
//   halo         : 3×3 blur of the bright pass at virtual resolution → a tight glow made of whole virtual pixels
//   bloom        : dual-filter downsample / upsample chain (the wide, smooth glow)
//   top          : same instanced quads, unlit, into a crisp overlay target
//   final        : device-resolution upscale (nearest, sub-pixel camera shift) + bloom + grading + overlay
//
// All offscreen targets are stored "top row first": target row 0 is the top of the view, so texelFetch uses
// virtual pixel coordinates directly. Only the final pass flips to the default framebuffer's bottom-up rows.

export const SPRITE_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec4 aPosSize;   // pivot (target px), quad size (px)
layout(location = 1) in vec3 aPivotRot;  // pivot inside quad (px), rotation (rad)
layout(location = 2) in vec2 aParams;    // shape params: thickness, arc
layout(location = 3) in uvec4 aFrame;    // atlas texel origin, frame texel size
layout(location = 4) in uvec4 aMeta;     // page, kind, flags, emissive
layout(location = 5) in vec4 aTint;
layout(location = 6) in vec4 aFlash;
layout(location = 7) in vec4 aOutline;

uniform vec2 uTarget;

out vec2 vLocal;
flat out uvec4 vFrame;
flat out uvec4 vMeta;
flat out vec4 vTint;
flat out vec4 vFlash;
flat out vec4 vOutline;
flat out vec4 vShape;   // quad size, params (lines: thickness, major-axis factor)

void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 size = aPosSize.zw;
  // Shapes get one pixel of slack around their edge; outlined sprites for the outline ring.
  float grow = (aMeta.y != 0u || aOutline.a > 0.0) ? 1.0 : 0.0;
  vec2 local = corner * (size + 2.0 * grow) - grow;
  vec2 p = local - aPivotRot.xy;
  float c = cos(aPivotRot.z);
  float s = sin(aPivotRot.z);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec2 pos = aPosSize.xy + p;
  gl_Position = vec4(pos / uTarget * 2.0 - 1.0, 0.0, 1.0);
  vLocal = local;
  vFrame = aFrame;
  vMeta = aMeta;
  vTint = aTint;
  vFlash = aFlash;
  vOutline = aOutline;
  vShape = vec4(size, aParams);
  // Lines measure their half-width along the major axis, so a 1px line has one pixel per column (Bresenham).
  if (aMeta.y == 3u) vShape.w = max(abs(c), abs(s));
}
`;

export const SPRITE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray uAlbedo;
uniform sampler2DArray uEmissive;
uniform int uUnlit;          // 1 = overlay pass: write everything, unlit, into the first target
uniform vec3 uAmbient;       // frame ambient (actor lift and rim are proportional to it)
uniform vec3 uActor;         // actor lift, rim gain, rim base

in vec2 vLocal;
flat in uvec4 vFrame;
flat in uvec4 vMeta;
flat in vec4 vTint;
flat in vec4 vFlash;
flat in vec4 vOutline;
flat in vec4 vShape;

// Three premultiplied outputs: colour that the lights multiply, emissive glow that feeds bloom, and flat unlit
// colour (hit flashes, rarity outlines, actor lift) that stays crisp — visible in darkness without blooming.
layout(location = 0) out vec4 oLit;
layout(location = 1) out vec4 oEmissive;
layout(location = 2) out vec4 oFlat;

const uint F_FLIP_X = 1u;
const uint F_FLIP_Y = 2u;
const uint F_ADDITIVE = 4u;
const uint F_SHADOW = 8u;
const uint F_OUTLINE8 = 16u;
const uint F_BORDER = 32u;
const uint F_ACTOR = 64u;

const float TAU = 6.28318530718;

ivec2 frameTexel(vec2 local, vec2 texPerPx) {
  ivec2 t = ivec2(floor(local * texPerPx));
  ivec2 wh = ivec2(vFrame.zw);
  if ((vMeta.z & F_FLIP_X) != 0u) t.x = wh.x - 1 - t.x;
  if ((vMeta.z & F_FLIP_Y) != 0u) t.y = wh.y - 1 - t.y;
  return t;
}

bool inFrame(ivec2 t) {
  return t.x >= 0 && t.y >= 0 && t.x < int(vFrame.z) && t.y < int(vFrame.w);
}

float alphaAt(vec2 local, vec2 texPerPx) {
  ivec2 t = frameTexel(local, texPerPx);
  if (!inFrame(t)) return 0.0;
  return texelFetch(uAlbedo, ivec3(ivec2(vFrame.xy) + t, int(vMeta.x)), 0).a;
}

// Pixel-stepped band test: offset o inside the half-open interval (-hw, hw]. Adjacent pixels along the band's
// normal never both pass at an exact tie, so thin lines and rings stay one pixel wide without gaps.
float band(float o, float hw) {
  return (o > -hw && o <= hw) ? 1.0 : 0.0;
}

void main() {
  uint kind = vMeta.y;
  uint flags = vMeta.z;
  vec3 base = vec3(1.0);
  float cover = 0.0;
  vec4 mask = vec4(0.0);
  bool outline = false;
  bool rim = false;

  if (kind == 0u) {
    vec2 texPerPx = vec2(vFrame.zw) / vShape.xy;
    ivec2 t = frameTexel(vLocal, texPerPx);
    if (inFrame(t)) {
      ivec3 at = ivec3(ivec2(vFrame.xy) + t, int(vMeta.x));
      vec4 c = texelFetch(uAlbedo, at, 0);
      mask = texelFetch(uEmissive, at, 0);
      base = c.rgb;
      cover = c.a;
    }
    if (cover < 0.5 && vOutline.a > 0.0) {
      float n = max(max(alphaAt(vLocal + vec2(1.0, 0.0), texPerPx), alphaAt(vLocal - vec2(1.0, 0.0), texPerPx)),
                    max(alphaAt(vLocal + vec2(0.0, 1.0), texPerPx), alphaAt(vLocal - vec2(0.0, 1.0), texPerPx)));
      if ((flags & F_OUTLINE8) != 0u) {
        n = max(n, max(max(alphaAt(vLocal + vec2(1.0, 1.0), texPerPx), alphaAt(vLocal + vec2(-1.0, 1.0), texPerPx)),
                       max(alphaAt(vLocal + vec2(1.0, -1.0), texPerPx), alphaAt(vLocal + vec2(-1.0, -1.0), texPerPx))));
      }
      outline = n >= 0.5;
    }
    // Sky rim: the top screen pixel of an actor's silhouette.
    rim = (flags & F_ACTOR) != 0u && cover >= 0.5 && alphaAt(vLocal - vec2(0.0, 1.0), texPerPx) < 0.5;
  } else if (kind == 1u) {
    // Rect (optionally with a 1px border in the outline colour).
    vec2 q = vLocal;
    vec2 sz = vShape.xy;
    cover = (q.x >= 0.0 && q.y >= 0.0 && q.x <= sz.x && q.y <= sz.y) ? 1.0 : 0.0;
    if (cover > 0.0 && (flags & F_BORDER) != 0u &&
        (q.x < 1.0 || q.y < 1.0 || q.x > sz.x - 1.0 || q.y > sz.y - 1.0)) outline = true;
  } else if (kind == 2u) {
    // Circle / ring, pixel-stepped, with an optional clockwise arc sweep from 12 o'clock. Rings measure their
    // width along the major axis of the normal, like lines, so a 1px ring is a clean midpoint-style circle.
    vec2 q = vLocal - vShape.xy * 0.5;
    float r = vShape.x * 0.5;
    float d = length(q);
    float thickness = vShape.z;
    if (thickness > 0.0) {
      vec2 n = abs(q) / max(d, 1e-4);
      cover = band(d - (r - thickness * 0.5), thickness * 0.5 * max(n.x, n.y));
    } else {
      cover = d <= r ? 1.0 : 0.0;
    }
    float arc = vShape.w;
    if (arc < 1.0) {
      float ang = atan(q.x, -q.y);
      if (ang < 0.0) ang += TAU;
      if (ang > arc * TAU) cover = 0.0;
    }
  } else {
    // Line segment, pixel-stepped; quad = (length + t) x t with the pivot at (t/2, t/2); round-ish caps.
    float hw = max(vShape.z, 1.0) * 0.5 * vShape.w;
    float h = vShape.y * 0.5;
    float len = vShape.x - vShape.y;
    vec2 q = vLocal - vec2(h);
    float along = max(max(-q.x, q.x - len), 0.0);
    cover = along > 0.0 ? (length(vec2(along, q.y)) <= hw ? 1.0 : 0.0) : band(q.y, hw);
  }

  float alpha;
  vec3 lit = vec3(0.0);
  vec3 glow = vec3(0.0);
  vec3 flat_ = vec3(0.0);
  if (outline) {
    alpha = vOutline.a * vTint.a;
    flat_ = vOutline.rgb;
    mask = vec4(0.0);
  } else {
    alpha = cover * vTint.a;
    vec3 col = base * vTint.rgb;
    float e = float(vMeta.w) / 255.0;
    float fl = vFlash.a;
    // Emissive-mask pixels ignore lighting: their albedo only shows through where the mask is partial.
    lit = col * (1.0 - e) * (1.0 - fl) * (1.0 - mask.a);
    glow = col * e * (1.0 - fl);
    flat_ = vFlash.rgb * fl;
    if ((flags & F_ACTOR) != 0u) {
      // Actor lift: characters, monsters, props and drops receive extra ambient fill (written here as unlit colour;
      // it is exactly albedo × ambient × lift), so dark palettes keep a readable body outside light pools.
      flat_ += lit * uAmbient * uActor.x;
      // The top edge catches the sky: a lit 'selective outline' that separates silhouettes from the dark floor.
      // The base term lets near-black outline pixels light up too.
      if (rim) flat_ += (col + uActor.z) * uAmbient * uActor.y * (1.0 - fl) * (1.0 - e);
    }
  }
  // Emissive mask glows even where the albedo is transparent (halo pixels); tint multiplies it.
  vec3 maskGlow = mask.rgb * mask.a * vTint.rgb * vTint.a * (1.0 - vFlash.a);
  if (alpha <= 0.002 && dot(maskGlow, vec3(1.0)) <= 0.002) discard;

  float a = (flags & F_ADDITIVE) != 0u ? 0.0 : alpha;
  oLit = vec4(lit * alpha, a);
  oEmissive = vec4(glow * alpha + maskGlow, a);
  oFlat = vec4(flat_ * alpha, a);
  if ((flags & F_SHADOW) != 0u) {
    // Shadows only darken what the lights see.
    oEmissive = vec4(0.0);
    oFlat = vec4(0.0);
  }
  if (uUnlit == 1) oLit = vec4(oLit.rgb + oEmissive.rgb + oFlat.rgb, a);
}
`;

export const LIGHT_VS = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec4 aLight;   // x, y (target px), radius, flicker
layout(location = 1) in vec4 aColor;   // rgb × intensity, seed 0..1

uniform vec2 uTarget;
uniform float uTime;

out vec2 vQ;
flat out vec3 vColor;

const float TAU = 6.28318530718;

void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  float seed = aColor.w;
  float flicker = aLight.w;
  // Layered sines give an organic, non-repeating flame flicker. The seed is a continuous function of position and
  // every phase term is a whole multiple of 2π·seed, so a moving light drifts smoothly through phase (no pops
  // when the seed wraps) while static lights stay decorrelated.
  float n = sin(uTime * 8.3 + seed * TAU) * 0.5
          + sin(uTime * 13.7 + seed * TAU * 3.0) * 0.3
          + sin(uTime * 23.1 + seed * TAU * 2.0) * 0.2;
  float k = 1.0 - flicker * (0.3 + 0.3 * n);
  float r = aLight.z * (1.0 + flicker * 0.06 * n);
  vec2 pos = aLight.xy + corner * r;
  gl_Position = vec4(pos / uTarget * 2.0 - 1.0, 0.0, 1.0);
  vQ = corner;
  vColor = aColor.rgb * k;
}
`;

export const LIGHT_FS = /* glsl */ `#version 300 es
precision highp float;

uniform float uInvRange;
in vec2 vQ;
flat in vec3 vColor;
out vec4 oLight;

void main() {
  float d2 = dot(vQ, vQ);
  if (d2 >= 1.0) discard;
  float f = 1.0 - d2;
  f *= f;                                   // smooth quadratic falloff, zero slope at the rim
  f += 0.15 * exp(-d2 * 18.0);              // small hot core so light sources read as sources
  oLight = vec4(vColor * f * uInvRange, 1.0);
}
`;

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uAlbedo;
uniform sampler2D uEmissive;
uniform sampler2D uFlat;
uniform sampler2D uLight;
uniform vec3 uAmbient;
uniform float uRange;
uniform float uBands;        // light quantisation steps (0 = smooth)
uniform float uHaze;         // share of the dynamic light that glows in the air (volumetric feel)

layout(location = 0) out vec4 oHdr;
layout(location = 1) out vec4 oBright;

float bayer4(ivec2 p) {
  int x = p.x & 3;
  int y = p.y & 3;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[y * 4 + x]) + 0.5) / 16.0;
}

// Overlapping lights add up quickly (a pack of burning monsters, a volley of projectiles). Keep one light's response
// linear and roll the sum off smoothly towards ~2.2 so crowds of lights brighten a spot without bleaching it white.
vec3 softLight(vec3 l) {
  const float KNEE = 1.2;
  vec3 over = max(l - KNEE, 0.0);
  return min(l, vec3(KNEE)) + over / (1.0 + over);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 albedo = texelFetch(uAlbedo, p, 0);
  vec3 emissive = texelFetch(uEmissive, p, 0).rgb;
  vec3 dynamicLight = softLight(texelFetch(uLight, p, 0).rgb * uRange);
  vec3 light = uAmbient + dynamicLight;
  if (uBands > 0.0) light = floor(light * uBands + bayer4(p)) / uBands;
  vec3 col = albedo.rgb * light + emissive + texelFetch(uFlat, p, 0).rgb + dynamicLight * uHaze;
  oHdr = vec4(col / uRange, 1.0);
  // Bloom source: bright emissive (soft threshold, so large dim glows like telegraph fills and halos stay crisp),
  // plus lit surfaces only under genuinely intense light (explosions, stacked pulses). Pale albedo under an
  // ordinary light keeps its detail instead of blooming into a white blob.
  float glowPeak = max(emissive.r, max(emissive.g, emissive.b));
  float lightPeak = max(dynamicLight.r, max(dynamicLight.g, dynamicLight.b));
  vec3 bright = emissive * smoothstep(0.2, 0.8, glowPeak) + albedo.rgb * light * smoothstep(1.3, 2.0, lightPeak) * 0.5;
  oBright = vec4(bright / uRange, 1.0);
}
`;

export const HALO_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uSrc;      // bright pass, virtual resolution
out vec4 o;

vec3 tap(ivec2 p, ivec2 hi) {
  return texelFetch(uSrc, clamp(p, ivec2(0), hi), 0).rgb;
}

// 3×3 binomial blur at virtual resolution. The final pass samples the result with nearest filtering, so the tight
// glow around emissive pixels is itself built from whole virtual pixels (pixel-art glow, not a smooth smear).
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hi = textureSize(uSrc, 0) - 1;
  vec3 s = tap(p, hi) * 4.0
         + (tap(p + ivec2(-1, 0), hi) + tap(p + ivec2(1, 0), hi) + tap(p + ivec2(0, -1), hi) + tap(p + ivec2(0, 1), hi)) * 2.0
         + tap(p + ivec2(-1, -1), hi) + tap(p + ivec2(1, -1), hi) + tap(p + ivec2(-1, 1), hi) + tap(p + ivec2(1, 1), hi);
  o = vec4(s / 16.0, 1.0);
}
`;

export const BLOOM_DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;     // source texel size
in vec2 vUv;
out vec4 o;
void main() {
  vec4 s = texture(uSrc, vUv) * 4.0;
  s += texture(uSrc, vUv + vec2(-1.0, -1.0) * uTexel);
  s += texture(uSrc, vUv + vec2(1.0, -1.0) * uTexel);
  s += texture(uSrc, vUv + vec2(-1.0, 1.0) * uTexel);
  s += texture(uSrc, vUv + vec2(1.0, 1.0) * uTexel);
  o = s * 0.125;
}
`;

export const BLOOM_UP_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;     // source texel size
in vec2 vUv;
out vec4 o;
void main() {
  vec4 s = texture(uSrc, vUv + vec2(-2.0, 0.0) * uTexel);
  s += texture(uSrc, vUv + vec2(2.0, 0.0) * uTexel);
  s += texture(uSrc, vUv + vec2(0.0, -2.0) * uTexel);
  s += texture(uSrc, vUv + vec2(0.0, 2.0) * uTexel);
  s += texture(uSrc, vUv + vec2(-1.0, -1.0) * uTexel) * 2.0;
  s += texture(uSrc, vUv + vec2(1.0, -1.0) * uTexel) * 2.0;
  s += texture(uSrc, vUv + vec2(-1.0, 1.0) * uTexel) * 2.0;
  s += texture(uSrc, vUv + vec2(1.0, 1.0) * uTexel) * 2.0;
  o = s / 12.0;
}
`;

export const FINAL_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uHdr;      // virtual-res scene (nearest)
uniform sampler2D uBloom;    // bloom chain result (linear)
uniform sampler2D uHalo;     // virtual-res tight halo (nearest)
uniform sampler2D uTop;      // virtual-res unlit overlay (nearest)
uniform vec2 uDevice;        // canvas size in device px
uniform vec2 uOffset;        // device offset of the virtual view
uniform vec2 uFrac;          // sub-pixel camera remainder (virtual px)
uniform float uScale;        // integer pixel scale
uniform vec2 uTargetSize;    // offscreen target size (virtual px)
uniform float uRange;
uniform float uBloomWide;
uniform float uBloomTight;
uniform float uExposure;
uniform float uSaturation;
uniform float uVignette;
uniform float uChromatic;
uniform vec4 uFlash;

out vec4 oColor;

vec3 tonemap(vec3 c) {
  // Over-bright channels bleed into the others so hot cores turn white instead of a flat clipped hue.
  float peak = max(c.r, max(c.g, c.b));
  c += vec3(max(peak - 1.0, 0.0) * 0.2);
  // Linear up to the knee (authored pixel colours stay exact), then a long rational shoulder towards 1: it
  // converges more slowly than an exponential, so pale surfaces under light keep their internal detail.
  const float K = 0.8;
  vec3 over = max(c - K, 0.0);
  vec3 shoulder = K + over / (1.0 + over / (1.0 - K));
  return mix(c, shoulder, step(K, c));
}

vec3 grade(vec3 c) {
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float l = dot(c, LUMA);
  // Split toning: violet-tinted blacks, faintly warm highlights.
  c += vec3(0.012, 0.004, 0.024) * (1.0 - smoothstep(0.0, 0.22, l));
  c *= mix(vec3(1.0), vec3(1.035, 1.0, 0.955), smoothstep(0.35, 0.95, l));
  // Gentle S-curve for depth.
  c = clamp(c, 0.0, 1.0);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.16);
  l = dot(c, LUMA);
  return mix(vec3(l), c, uSaturation * 1.05);
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

ivec2 clampTexel(vec2 v) {
  return clamp(ivec2(floor(v)), ivec2(0), ivec2(uTargetSize) - 1);
}

void main() {
  vec2 device = vec2(gl_FragCoord.x, uDevice.y - gl_FragCoord.y);
  vec2 v = (device - uOffset) / uScale + uFrac;       // continuous target coordinate
  ivec2 k = clampTexel(v);

  vec3 col;
  if (uChromatic > 0.0) {
    vec2 centre = uTargetSize * 0.5;
    vec2 dir = (v - centre) / centre;
    vec2 shift = dir * uChromatic * 3.0;               // in whole virtual pixels at the edges → crisp fringes
    col.r = texelFetch(uHdr, clampTexel(v + shift), 0).r;
    col.g = texelFetch(uHdr, k, 0).g;
    col.b = texelFetch(uHdr, clampTexel(v - shift), 0).b;
  } else {
    col = texelFetch(uHdr, k, 0).rgb;
  }
  col *= uRange;

  vec2 uv = v / uTargetSize;
  col += texture(uBloom, uv).rgb * (uRange * uBloomWide);
  col += texelFetch(uHalo, k, 0).rgb * (uRange * uBloomTight);

  col *= uExposure;
  col = tonemap(col);
  col = grade(col);

  vec2 sc = (device / uDevice - 0.5) * vec2(uDevice.x / uDevice.y, 1.0);
  float r = length(sc) / length(vec2(uDevice.x / uDevice.y, 1.0) * 0.5);
  col *= 1.0 - uVignette * 0.85 * smoothstep(0.32, 1.08, r);

  col = 1.0 - (1.0 - col) * (1.0 - uFlash.rgb * uFlash.a);

  vec4 top = texelFetch(uTop, k, 0);
  col = col * (1.0 - top.a) + top.rgb;

  col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  oColor = vec4(col, 1.0);
}
`;
