// Bearfall — built from the bearfall repo by build.js; do not edit here. Runs as one ES module (strict mode).
'use strict';
const BUILD_FLAGS = { site: 'studio22', sw: false };
// ===== 00_math.js =====
// ---------------------------------------------------------------------------
// Minimal column-major mat4 / vec3 helpers (gl-matrix style, Float32Array)
// ---------------------------------------------------------------------------
const M4 = {
  create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  identity(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  copy(o, a) { o.set(a); return o; },
  mul(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    o[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30; o[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32; o[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    o[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30; o[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32; o[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    o[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30; o[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32; o[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    o[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30; o[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32; o[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    return o;
  },
  // o = T(x,y,z) * Ry * Rx * Rz * S(sx,sy,sz)
  trs(o, x, y, z, rx, ry, rz, sx, sy, sz) {
    const cx = Math.cos(rx), sxn = Math.sin(rx), cy = Math.cos(ry), syn = Math.sin(ry), cz = Math.cos(rz), szn = Math.sin(rz);
    // R = Ry * Rx * Rz
    const r00 = cy * cz + syn * sxn * szn, r01 = cx * szn, r02 = -syn * cz + cy * sxn * szn;
    const r10 = -cy * szn + syn * sxn * cz, r11 = cx * cz, r12 = syn * szn + cy * sxn * cz;
    const r20 = syn * cx, r21 = -sxn, r22 = cy * cx;
    o[0] = r00 * sx; o[1] = r01 * sx; o[2] = r02 * sx; o[3] = 0;
    o[4] = r10 * sy; o[5] = r11 * sy; o[6] = r12 * sy; o[7] = 0;
    o[8] = r20 * sz; o[9] = r21 * sz; o[10] = r22 * sz; o[11] = 0;
    o[12] = x; o[13] = y; o[14] = z; o[15] = 1;
    return o;
  },
  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o.fill(0); o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf; return o;
  },
  ortho(o, l, r, b, t, n, f) {
    const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
    o.fill(0); o[0] = -2 * lr; o[5] = -2 * bt; o[10] = 2 * nf; o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = (f + n) * nf; o[15] = 1; return o;
  },
  lookAt(o, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    let zx = ex - cx, zy = ey - cy, zz = ez - cz; let l = 1 / Math.hypot(zx, zy, zz); zx *= l; zy *= l; zz *= l;
    let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx; l = Math.hypot(xx, xy, xz); if (l < 1e-6) { xx = 1; xy = 0; xz = 0; l = 1; } l = 1 / l; xx *= l; xy *= l; xz *= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0; o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0; o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * ex + xy * ey + xz * ez); o[13] = -(yx * ex + yy * ey + yz * ez); o[14] = -(zx * ex + zy * ey + zz * ez); o[15] = 1;
    return o;
  },
  invert(o, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null; det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  // transform point, returns [x,y,z,w]
  xf(m, x, y, z, out) {
    out = out || [0, 0, 0, 0];
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12]; out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14]; out[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
    return out;
  }
};

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
const angleLerp = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const smooth = (t) => t * t * (3 - 2 * t);
const TAU = Math.PI * 2;
// Small seeded RNG for deterministic world layout
function mulberry(seed) { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// Colors as [r,g,b] 0..1 from hex
function hex(h) { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; }
function fmtMoney(n) {
  n = Math.floor(n);
  if (n < 1000) return '$' + n;
  if (n < 1e6) return '$' + (n / 1000).toFixed(n < 10000 ? 2 : 1).replace(/\.?0+$/, '') + 'K';
  if (n < 1e9) return '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
}
function fmtNum(n) {
  n = Math.floor(n);
  if (n < 10000) return '' + n;
  if (n < 1e6) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
}

// ===== 01_gl.js =====
// ---------------------------------------------------------------------------
// Tiny WebGL2 renderer: instanced flat-shaded meshes, directional shadow map,
// ground decals, fog, hemisphere + sun lighting.
// ---------------------------------------------------------------------------
const MAIN_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec3 aCol;
layout(location=3) in vec4 m0; layout(location=4) in vec4 m1; layout(location=5) in vec4 m2; layout(location=6) in vec4 m3;
layout(location=7) in vec4 aTint;
uniform mat4 uVP; uniform mat4 uLightVP;
out vec3 vNor; out vec3 vCol; out float vFlash; out vec3 vShadow; out vec3 vWorld;
void main(){
  mat4 M = mat4(m0,m1,m2,m3);
  vec4 w = M * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNor = normalize(mat3(M) * aNor);
  vCol = aCol * aTint.rgb;
  vFlash = aTint.a;
  vec4 sp = uLightVP * w;
  vShadow = sp.xyz / sp.w * 0.5 + 0.5;
  gl_Position = uVP * w;
}`;
const MAIN_FS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vNor; in vec3 vCol; in float vFlash; in vec3 vShadow; in vec3 vWorld;
uniform vec3 uLightDir; uniform vec3 uSun; uniform vec3 uSky; uniform vec3 uGround; uniform vec3 uFog; uniform vec2 uFogRange;
uniform vec3 uCamPos; uniform sampler2DShadow uShadow; uniform float uShadowTexel; uniform vec3 uNight;
out vec4 frag;
void main(){
  vec3 n = normalize(vNor);
  float ndl = dot(n, uLightDir);
  float bias = 0.0015 + 0.003 * (1.0 - clamp(ndl,0.0,1.0));
  float sh = 0.0;
  if (vShadow.x > 0.0 && vShadow.x < 1.0 && vShadow.y > 0.0 && vShadow.y < 1.0 && vShadow.z < 1.0) {
    for (int i=-1;i<=1;i++) for (int j=-1;j<=1;j++) {
      sh += texture(uShadow, vec3(vShadow.xy + vec2(float(i),float(j)) * uShadowTexel, vShadow.z - bias));
    }
    sh /= 9.0;
  } else sh = 1.0;
  float d = clamp(ndl, 0.0, 1.0);
  d = d * 0.55 + smoothstep(0.05, 0.45, d) * 0.45;
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
  vec3 light = amb + uSun * d * sh;
  vec3 col = vCol * light;
  // subtle rim to lift silhouettes
  vec3 v = normalize(uCamPos - vWorld);
  float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0) * 0.12;
  col += rim * uSky;
  col = mix(col, vec3(1.0, 0.98, 0.9), vFlash);
  float dist = distance(uCamPos, vWorld);
  float f = smoothstep(uFogRange.x, uFogRange.y, dist);
  col = mix(col, uFog, f);
  frag = vec4(col, 1.0);
}`;
const SHADOW_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=3) in vec4 m0; layout(location=4) in vec4 m1; layout(location=5) in vec4 m2; layout(location=6) in vec4 m3;
uniform mat4 uLightVP;
void main(){ mat4 M = mat4(m0,m1,m2,m3); gl_Position = uLightVP * M * vec4(aPos,1.0); }`;
const SHADOW_FS = `#version 300 es
precision mediump float; out vec4 frag; void main(){ frag = vec4(1.0); }`;
const DECAL_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform mat4 uVP; uniform mat4 uM;
out vec2 vUV;
void main(){ vUV = aPos * 0.5 + 0.5; vUV.y = 1.0 - vUV.y; gl_Position = uVP * uM * vec4(aPos.x, 0.0, -aPos.y, 1.0); }`;
const DECAL_FS = `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uTex; uniform vec4 uColor; out vec4 frag;
void main(){ vec4 c = texture(uTex, vUV) * uColor; if (c.a < 0.01) discard; frag = c; }`;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.meshes = [];
    this.decals = [];
    this.progMain = this._prog(MAIN_VS, MAIN_FS);
    this.progShadow = this._prog(SHADOW_VS, SHADOW_FS);
    this.progDecal = this._prog(DECAL_VS, DECAL_FS);
    this.u = {}; for (const p of ['progMain', 'progShadow', 'progDecal']) { this.u[p] = {}; const n = gl.getProgramParameter(this[p], gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(this[p], i); this.u[p][info.name] = gl.getUniformLocation(this[p], info.name); } }
    // shadow map
    this.maxDpr = 2; this.shadowFbo = gl.createFramebuffer(); this.shadowTex = null; this.setShadowSize(2048);
    // decal quad
    this.decalVao = gl.createVertexArray(); gl.bindVertexArray(this.decalVao);
    const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
    // camera / light state
    this.view = M4.create(); this.proj = M4.create(); this.vp = M4.create(); this.invVP = M4.create(); this.lightVP = M4.create();
    this.camPos = [0, 20, 12]; this.camTarget = [0, 0, 0];
    this.lightDir = [0.45, 0.8, 0.35]; // toward light
    this.cullOn = true; this.cullMargin = 7; this.culled = 0; this.shadowEvery = 2; this.frameNo = 0; // shadow map re-rendered every 2nd frame (imperceptible, halves the shadow pass)
    this.env = { sun: [0.75, 0.72, 0.66], sky: [0.62, 0.66, 0.74], ground: [0.42, 0.38, 0.34], fog: [0.82, 0.87, 0.93], fogRange: [48, 115] };
    this.width = 1; this.height = 1; this.dpr = 1;
    this.tmp = M4.create(); this.tmp2 = M4.create();
    this.frameInstances = 0;
    this.resize();
  }
  setShadowSize(size) { this.shadowReady = false;
    const gl = this.gl; if (this.shadowTex) gl.deleteTexture(this.shadowTex); this.shadowSize = size;
    this.shadowTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // quality: 2 high, 1 medium, 0 low
  setQuality(q) { this.quality = q; this.setShadowSize(q >= 2 ? 2048 : 1024); this.maxDpr = q >= 2 ? 2 : q === 1 ? 1.5 : 1; this.width = -1; this.resize(); }
  _prog(vs, fs) {
    const gl = this.gl; const p = gl.createProgram();
    for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); gl.attachShader(p, sh); }
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr || 2);
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (w === this.width && h === this.height) return;
    this.canvas.width = w; this.canvas.height = h; this.width = w; this.height = h; this.dpr = dpr;
  }
  // geo: {pos:Float32Array, nor:Float32Array, col:Float32Array}
  createMesh(geo, isStatic = false) {
    const gl = this.gl;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const mk = (loc, data, size) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); return b; };
    mk(0, geo.pos, 3); mk(1, geo.nor, 3); mk(2, geo.col, 3);
    const inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    const stride = 20 * 4;
    for (let i = 0; i < 4; i++) { gl.enableVertexAttribArray(3 + i); gl.vertexAttribPointer(3 + i, 4, gl.FLOAT, false, stride, i * 16); gl.vertexAttribDivisor(3 + i, 1); }
    gl.enableVertexAttribArray(7); gl.vertexAttribPointer(7, 4, gl.FLOAT, false, stride, 64); gl.vertexAttribDivisor(7, 1);
    gl.bindVertexArray(null);
    let r2 = 0; for (let i = 0; i < geo.pos.length; i += 3) { const d = geo.pos[i] * geo.pos[i] + geo.pos[i + 1] * geo.pos[i + 1] + geo.pos[i + 2] * geo.pos[i + 2]; if (d > r2) r2 = d; }
    const mesh = { vao, inst, count: geo.pos.length / 3, data: new Float32Array(20 * 64), n: 0, cap: 64, isStatic, dirty: false, castShadow: true, uploaded: 0, radius: Math.sqrt(r2) };
    this.meshes.push(mesh);
    return mesh;
  }
  // push one instance: matrix (Float32Array16) + tint
  draw(mesh, m, r = 1, g = 1, b = 1, flash = 0) {
    // frustum cull: skip instances whose bounding sphere (plus room for the shadow it casts) is off screen
    if (!mesh.isStatic && this.cullOn) {
      const vp = this.vp; const x = m[12], y = m[13], z = m[14];
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (cw > 0) {
        const s0 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2], s1 = m[4] * m[4] + m[5] * m[5] + m[6] * m[6], s2 = m[8] * m[8] + m[9] * m[9] + m[10] * m[10];
        const rad = mesh.radius * Math.sqrt(Math.max(s0, s1, s2)) + this.cullMargin;
        const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
        if (Math.abs(cx) > cw + rad * this.proj[0] || Math.abs(cy) > cw + rad * this.proj[5]) { this.culled++; return; }
      }
    }
    if (mesh.n >= mesh.cap) { mesh.cap *= 2; const nd = new Float32Array(20 * mesh.cap); nd.set(mesh.data); mesh.data = nd; }
    const o = mesh.n * 20, d = mesh.data;
    d[o] = m[0]; d[o + 1] = m[1]; d[o + 2] = m[2]; d[o + 3] = m[3]; d[o + 4] = m[4]; d[o + 5] = m[5]; d[o + 6] = m[6]; d[o + 7] = m[7];
    d[o + 8] = m[8]; d[o + 9] = m[9]; d[o + 10] = m[10]; d[o + 11] = m[11]; d[o + 12] = m[12]; d[o + 13] = m[13]; d[o + 14] = m[14]; d[o + 15] = m[15];
    d[o + 16] = r; d[o + 17] = g; d[o + 18] = b; d[o + 19] = flash;
    mesh.n++; mesh.dirty = true;
  }
  clearStatic(mesh) { mesh.n = 0; mesh.dirty = true; }
  setCamera(fovDeg, aspect, near, far) { M4.perspective(this.proj, fovDeg * Math.PI / 180, aspect, near, far); }
  lookAt(ex, ey, ez, tx, ty, tz) { this.camPos = [ex, ey, ez]; this.camTarget = [tx, ty, tz]; M4.lookAt(this.view, ex, ey, ez, tx, ty, tz, 0, 1, 0); M4.mul(this.vp, this.proj, this.view); M4.invert(this.invVP, this.vp); }
  project(x, y, z, out) { const p = M4.xf(this.vp, x, y, z, out); if (p[3] <= 0) { p[0] = -9999; p[1] = -9999; return p; } p[0] = (p[0] / p[3] * 0.5 + 0.5) * this.canvas.clientWidth; p[1] = (1 - (p[1] / p[3] * 0.5 + 0.5)) * this.canvas.clientHeight; return p; }
  // screen (css px) -> ground plane y=0 world point
  unprojectGround(sx, sy) {
    const nx = sx / this.canvas.clientWidth * 2 - 1, ny = 1 - sy / this.canvas.clientHeight * 2;
    const a = M4.xf(this.invVP, nx, ny, -1), b = M4.xf(this.invVP, nx, ny, 1);
    for (let i = 0; i < 3; i++) { a[i] /= a[3]; b[i] /= b[3]; }
    const t = -a[1] / (b[1] - a[1]);
    return [a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t];
  }
  addDecal(tex, x, z, w, h, rot = 0, color = [1, 1, 1, 1]) { const d = { tex, x, z, w, h, rot, color, m: M4.create(), visible: true, y: 0.02 }; this._decalMat(d); this.decals.push(d); return d; }
  _decalMat(d) { M4.trs(d.m, d.x, d.y, d.z, 0, d.rot, 0, d.w / 2, 1, d.h / 2); }
  updateDecal(d) { this._decalMat(d); }
  removeDecal(d) { const i = this.decals.indexOf(d); if (i >= 0) this.decals.splice(i, 1); }
  createTexture(canvas) { const gl = this.gl; const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
  updateTexture(t, canvas) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.generateMipmap(gl.TEXTURE_2D); }
  _upload(mesh) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, mesh.inst); if (mesh.uploaded < mesh.cap) { gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.DYNAMIC_DRAW); mesh.uploaded = mesh.cap; } else gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.data, 0, mesh.n * 20); mesh.dirty = false; }
  render(shadowCenter) {
    const gl = this.gl; const env = this.env;
    this.frameInstances = 0; this.culledLast = this.culled; this.culled = 0;
    // upload instance data
    for (const m of this.meshes) { if (m.n > 0 && m.dirty) this._upload(m); this.frameInstances += m.n; }
    // ---- shadow pass (every shadowEvery-th frame; the map and its light matrix are kept in between) ----
    const L = this.lightDir; this.frameNo++;
    if (this.frameNo % this.shadowEvery === 0 || !this.shadowReady) {
      const sc = shadowCenter || this.camTarget; const R = 40; const lightView = this.tmp, lightProj = this.tmp2;
      M4.lookAt(lightView, sc[0] + L[0] * 60, sc[1] + L[1] * 60, sc[2] + L[2] * 60, sc[0], sc[1], sc[2], 0, 1, 0);
      M4.ortho(lightProj, -R, R, -R, R, 5, 140);
      M4.mul(this.lightVP, lightProj, lightView);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo); gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.0, 4.0);
      gl.useProgram(this.progShadow); gl.uniformMatrix4fv(this.u.progShadow.uLightVP, false, this.lightVP);
      for (const m of this.meshes) { if (m.n === 0 || !m.castShadow) continue; gl.bindVertexArray(m.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, m.n); }
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.cullFace(gl.BACK); this.shadowReady = true;
    } else { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
    // ---- main pass ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(env.fog[0], env.fog[1], env.fog[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.progMain); const u = this.u.progMain;
    gl.uniformMatrix4fv(u.uVP, false, this.vp); gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP);
    gl.uniform3fv(u.uLightDir, L); gl.uniform3fv(u.uSun, env.sun); gl.uniform3fv(u.uSky, env.sky); gl.uniform3fv(u.uGround, env.ground); gl.uniform3fv(u.uFog, env.fog); gl.uniform2fv(u.uFogRange, env.fogRange);
    gl.uniform3fv(u.uCamPos, this.camPos); gl.uniform1f(u.uShadowTexel, 1 / this.shadowSize);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(u.uShadow, 0);
    for (const m of this.meshes) { if (m.n === 0) continue; gl.bindVertexArray(m.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, m.n); }
    // ---- decals ----
    if (this.decals.length) {
      gl.useProgram(this.progDecal); const ud = this.u.progDecal; gl.uniformMatrix4fv(ud.uVP, false, this.vp);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.decalVao); gl.activeTexture(gl.TEXTURE1); gl.uniform1i(ud.uTex, 1);
      const cp = this.camPos;
      for (const d of this.decals) { if (!d.visible) continue; if (dist2(d.x, d.z, cp[0], cp[2]) > 70 * 70) continue; gl.bindTexture(gl.TEXTURE_2D, d.tex); gl.uniformMatrix4fv(ud.uM, false, d.m); gl.uniform4fv(ud.uColor, d.color); gl.drawArrays(gl.TRIANGLES, 0, 6); }
      gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
    }
    gl.bindVertexArray(null);
    // reset dynamic meshes
    for (const m of this.meshes) if (!m.isStatic) m.n = 0;
  }
}

// ===== 02_geo.js =====
// ---------------------------------------------------------------------------
// Flat-shaded geometry builder (positions, per-face normals, vertex colors)
// ---------------------------------------------------------------------------
class Geo {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.jitter = 0; }
  tri(a, b, c, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    let r = col[0], g = col[1], bl = col[2];
    if (this.jitter) { const j = 1 + (Math.random() - 0.5) * this.jitter; r *= j; g *= j; bl *= j; }
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.col.push(r, g, bl, r, g, bl, r, g, bl);
    return this;
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); return this; }
  // box centered at (x,y,z)
  box(w, h, d, col, x = 0, y = 0, z = 0, o = {}) {
    const hw = w / 2, hh = h / 2, hd = d / 2; const top = o.top || col, bottom = o.bottom || col, side = o.side || col;
    const p = (sx, sy, sz) => [x + sx * hw, y + sy * hh, z + sz * hd];
    const a = p(-1, -1, 1), b = p(1, -1, 1), c = p(1, 1, 1), dd = p(-1, 1, 1), e = p(-1, -1, -1), f = p(1, -1, -1), g = p(1, 1, -1), hh2 = p(-1, 1, -1);
    this.quad(a, b, c, dd, side); // front (+z)
    this.quad(f, e, hh2, g, side); // back
    this.quad(e, a, dd, hh2, side); // left
    this.quad(b, f, g, c, side); // right
    this.quad(dd, c, g, hh2, top); // top
    this.quad(e, f, b, a, bottom); // bottom
    return this;
  }
  // box with bottom at y
  boxB(w, h, d, col, x = 0, y = 0, z = 0, o = {}) { return this.box(w, h, d, col, x, y + h / 2, z, o); }
  // cylinder / cone, bottom at y
  cyl(rb, rt, h, seg, col, x = 0, y = 0, z = 0, o = {}) {
    const top = o.top || col, bottom = o.bottom || col; const rot = o.rot || 0;
    for (let i = 0; i < seg; i++) {
      const a0 = rot + i / seg * TAU, a1 = rot + (i + 1) / seg * TAU;
      const b0 = [x + Math.cos(a0) * rb, y, z + Math.sin(a0) * rb], b1 = [x + Math.cos(a1) * rb, y, z + Math.sin(a1) * rb];
      const t0 = [x + Math.cos(a0) * rt, y + h, z + Math.sin(a0) * rt], t1 = [x + Math.cos(a1) * rt, y + h, z + Math.sin(a1) * rt];
      if (rt > 0.0001) this.quad(b1, b0, t0, t1, col); else this.tri(b1, b0, [x, y + h, z], col);
      if (rb > 0.0001 && !o.noBottom) this.tri([x, y, z], b0, b1, bottom);
      if (rt > 0.0001 && !o.noTop) this.tri([x, y + h, z], t1, t0, top);
    }
    return this;
  }
  cone(r, h, seg, col, x, y, z, o) { return this.cyl(r, 0, h, seg, col, x, y, z, o); }
  // low-poly sphere (uv), centered
  sphere(r, seg, col, x = 0, y = 0, z = 0, o = {}) {
    const rings = o.rings || Math.max(3, Math.round(seg / 2)); const sy = o.sy || 1, sx = o.sx || 1, sz = o.sz || 1;
    const P = (i, j) => { const th = i / rings * Math.PI, ph = j / seg * TAU; return [x + Math.sin(th) * Math.cos(ph) * r * sx, y + Math.cos(th) * r * sy, z + Math.sin(th) * Math.sin(ph) * r * sz]; };
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if (i === 0) this.tri(a, c, b, col); else if (i === rings - 1) this.tri(a, d, b, col); else this.quad(a, d, c, b, col);
    }
    return this;
  }
  // flat ground quad (y up), centered at x,z
  ground(w, d, col, x = 0, y = 0, z = 0) { const hw = w / 2, hd = d / 2; return this.quad([x - hw, y, z + hd], [x + hw, y, z + hd], [x + hw, y, z - hd], [x - hw, y, z - hd], col); }
  // append geometry with transform matrix
  append(g, m) {
    const n = g.pos.length / 3; const p = g.pos, nn = g.nor; const t = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      M4.xf(m, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], t); this.pos.push(t[0], t[1], t[2]);
      const nx = nn[i * 3], ny = nn[i * 3 + 1], nz = nn[i * 3 + 2];
      let ox = m[0] * nx + m[4] * ny + m[8] * nz, oy = m[1] * nx + m[5] * ny + m[9] * nz, oz = m[2] * nx + m[6] * ny + m[10] * nz; const l = Math.hypot(ox, oy, oz) || 1;
      this.nor.push(ox / l, oy / l, oz / l);
    }
    for (let i = 0; i < g.col.length; i++) this.col.push(g.col[i]);
    return this;
  }
  transform(m) { const g = new Geo(); g.pos = this.pos; g.nor = this.nor; g.col = this.col; this.pos = []; this.nor = []; this.col = []; return this.append(g, m); }
  // build a sub-geometry and append it transformed by matrix m (or trs args)
  sub(m, fn) { const s = new Geo(); s.jitter = this.jitter; fn(s); return this.append(s, m); }
  // convenience: sub with trs
  at(x, y, z, rx, ry, rz, fn) { return this.sub(M4.trs(M4.create(), x, y, z, rx || 0, ry || 0, rz || 0, 1, 1, 1), fn); }
  translate(x, y, z) { for (let i = 0; i < this.pos.length; i += 3) { this.pos[i] += x; this.pos[i + 1] += y; this.pos[i + 2] += z; } return this; }
  scale(sx, sy = sx, sz = sx) { for (let i = 0; i < this.pos.length; i += 3) { this.pos[i] *= sx; this.pos[i + 1] *= sy; this.pos[i + 2] *= sz; } return this; }
  // vertex displacement noise (for snow ground)
  displace(fn) { for (let i = 0; i < this.pos.length; i += 3) { const r = fn(this.pos[i], this.pos[i + 1], this.pos[i + 2]); this.pos[i] = r[0]; this.pos[i + 1] = r[1]; this.pos[i + 2] = r[2]; } return this; }
  colorize(fn) { for (let i = 0; i < this.pos.length; i += 3) { const c = fn(this.pos[i], this.pos[i + 1], this.pos[i + 2], [this.col[i], this.col[i + 1], this.col[i + 2]]); this.col[i] = c[0]; this.col[i + 1] = c[1]; this.col[i + 2] = c[2]; } return this; }
  pack() { return { pos: new Float32Array(this.pos), nor: new Float32Array(this.nor), col: new Float32Array(this.col) }; }
}

// ===== 03_models.js =====
// ---------------------------------------------------------------------------
// Procedural low-poly models. Rigs = sets of part meshes drawn with matrices.
// All models: y up, "front" = +z, bottom at y=0 unless noted.
// ---------------------------------------------------------------------------
const C = {
  snow: hex(0xF5F8FC), snow2: hex(0xE8EEF5), dirt: hex(0xCFA77E), dirt2: hex(0xC49B72), path: hex(0xD9B58E),
  wood: hex(0xB9834F), woodL: hex(0xE3C08F), woodD: hex(0x8E5E37), bark: hex(0x8A5A3A), plank: hex(0xD2A46B),
  pine: hex(0x7ED0A0), pine2: hex(0x66BB8A), pine3: hex(0x9FDCB9), frostPine: hex(0x9CCFE0), frostPine2: hex(0x7FB8CE), darkPine: hex(0x4F8F6A),
  fence: hex(0xDDBE92), fenceTip: hex(0xF7F9FB),
  skin: hex(0xF3CBA6), skinD: hex(0xE0B48E), blue: hex(0x3E8FE0), blueD: hex(0x2C6BB0), navy: hex(0x2B4B77), white: hex(0xF4F4F4), fur: hex(0xF7F3EA),
  brown: hex(0x8B5A3C), brownD: hex(0x5A3A25), red: hex(0xD64541), redD: hex(0xA33330), green: hex(0x2FB36A), greenD: hex(0x228C50),
  dark: hex(0x2B2B33), gray: hex(0xA7ADB5), grayD: hex(0x7B828A), iron: hex(0xB9C4CC), ironD: hex(0x7F8A92), gold: hex(0xF2C14E), goldD: hex(0xC9992E),
  meat: hex(0xE94F6A), meatL: hex(0xF9E4E6), meatD: hex(0xC33B54), cash: hex(0x3FBF5F), cashL: hex(0xB4EBB0), cashD: hex(0x2E9B49),
  bear: hex(0xF6F5F0), bearD: hex(0xE2DFD6), bearNose: hex(0x2E2A2A), frostBear: hex(0xC8D9E8), frostBearD: hex(0xA9C0D3), blackBear: hex(0x4B4040), blackBearD: hex(0x352C2C),
  armorBear: hex(0xE0DCD4), king: hex(0xEFE9DE), kingD: hex(0xD8CFC0), scar: hex(0xC2555F),
  stone: hex(0xA9B0B8), stoneD: hex(0x858C95), ice: hex(0xBFE6F5), iceD: hex(0x8FD0EA), flame: hex(0xFF8F2A), flame2: hex(0xFFD23F), coal: hex(0x3A3A3A),
  canvas: hex(0xE7D9BF), canvasD: hex(0xC9B89A), roof: hex(0xB35A3A), roof2: hex(0x8E4630), banner: hex(0x2E86DE), sign: hex(0xE8D8B8)
};
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const HPI = Math.PI / 2;

const Models = {
  cache: {}, R: null,
  get(key, builder, isStatic = false) { let m = this.cache[key]; if (!m) { const g = builder(new Geo()); m = this.R.createMesh(g.pack(), isStatic); this.cache[key] = m; } return m; },

  // ---- humans: outfit = {id, parka, parkaD, pants, beard, hat, mitt, belt}
  human(outfit) {
    const k = 'h_' + outfit.id; if (this.cache[k]) return this.cache[k];
    const P = outfit.parka, PD = outfit.parkaD || mul(outfit.parka, 0.8);
    const torso = this.get(k + 'torso', g => {
      g.box(0.62, 0.62, 0.42, P, 0, 0.31, 0, { top: PD }); g.box(0.68, 0.1, 0.48, C.fur, 0, 0.03, 0);
      g.cyl(0.24, 0.2, 0.12, 8, C.fur, 0, 0.58, 0); g.box(0.06, 0.4, 0.02, PD, 0, 0.33, 0.22);
      if (outfit.belt) g.box(0.66, 0.08, 0.46, C.brownD, 0, 0.2, 0);
      return g;
    });
    const head = this.get(k + 'head', g => {
      g.sphere(0.24, 8, C.skin, 0, 0, 0.04); g.sphere(0.28, 8, P, 0, 0.04, -0.07);
      g.box(0.05, 0.05, 0.03, C.dark, -0.09, 0.03, 0.26); g.box(0.05, 0.05, 0.03, C.dark, 0.09, 0.03, 0.26); g.box(0.05, 0.05, 0.05, C.skinD, 0, -0.03, 0.28);
      if (outfit.beard) { g.box(0.3, 0.16, 0.16, outfit.beard, 0, -0.16, 0.16); g.box(0.2, 0.1, 0.1, outfit.beard, 0, -0.26, 0.14); }
      if (outfit.hat) { g.cyl(0.3, 0.3, 0.06, 8, outfit.hat, 0, 0.2, -0.02); g.cyl(0.2, 0.17, 0.2, 8, outfit.hat, 0, 0.24, -0.02); }
      if (outfit.helmet) { g.sphere(0.3, 8, C.ironD, 0, 0.08, -0.03, { sy: 0.8 }); g.box(0.62, 0.06, 0.62, C.iron, 0, 0.0, -0.03); }
      return g;
    });
    const arm = this.get(k + 'arm', g => { g.box(0.17, 0.5, 0.17, P, 0, -0.25, 0); g.box(0.19, 0.14, 0.19, C.fur, 0, -0.44, 0); g.sphere(0.1, 6, outfit.mitt || C.brownD, 0, -0.56, 0); return g; });
    const leg = this.get(k + 'leg', g => { g.box(0.21, 0.42, 0.23, outfit.pants || C.navy, 0, -0.21, 0); g.box(0.23, 0.2, 0.27, outfit.boots || C.brownD, 0, -0.52, 0.02); if (outfit.bootTrim) { g.box(0.25, 0.06, 0.29, outfit.bootTrim, 0, -0.43, 0.02); } return g; });
    const rig = { torso, head, arm, leg }; this.cache[k] = rig; return rig;
  },
  // tools are in right-arm space: hand at (0,-0.5,0), pointing +z
  axe() { return this.get('axe', g => { g.at(0, -0.5, 0, HPI, 0, 0, s => s.cyl(0.035, 0.035, 0.78, 6, C.woodD)); g.box(0.07, 0.3, 0.2, C.iron, 0, -0.5, 0.64); g.box(0.09, 0.32, 0.06, C.ironD, 0, -0.5, 0.55); return g; }); },
  pickaxe() { return this.get('pickaxe', g => { g.at(0, -0.5, 0, HPI, 0, 0, s => s.cyl(0.035, 0.035, 0.78, 6, C.woodD)); g.box(0.06, 0.55, 0.09, C.ironD, 0, -0.5, 0.66); return g; }); },
  spear() { return this.get('spear', g => { g.at(0, -0.5, -0.35, HPI, 0, 0, s => { s.cyl(0.03, 0.03, 1.35, 6, C.woodD); s.cone(0.06, 0.26, 4, C.iron, 0, 1.35, 0); }); return g; }); },
  bow() { return this.get('bow', g => { g.at(0, -0.5, 0.1, 0.35, 0, 0, s => { s.cyl(0.025, 0.025, 1.0, 5, C.woodD, 0, -0.5, 0); s.box(0.01, 1.0, 0.01, C.white, 0, 0, 0.1); }); return g; }); },
  sack() { return this.get('sack', g => { g.sphere(0.22, 6, C.canvas, 0, -0.5, 0.15, { sy: 1.2 }); return g; }); },
  arrow() { return this.get('arrow', g => { g.at(0, 0, 0, HPI, 0, 0, s => { s.cyl(0.025, 0.025, 0.7, 4, C.woodL, 0, -0.35, 0); s.cone(0.05, 0.14, 4, C.iron, 0, 0.35, 0); s.box(0.02, 0.12, 0.1, C.red, 0, -0.3, 0); }); return g; }); },

  // ---- bears: variant = {id, body, bodyD, scale, armor, king}
  bear(v) {
    const k = 'b_' + v.id; if (this.cache[k]) return this.cache[k];
    const B = v.body, BD = v.bodyD;
    const body = this.get(k + 'body', g => {
      g.box(0.78, 0.74, 1.3, B, 0, 0.66, 0, { bottom: BD }); g.sphere(0.46, 8, B, 0, 0.9, 0.3, { sy: 0.55, sx: 0.95, sz: 0.9 }); g.sphere(0.42, 8, B, 0, 0.78, -0.5, { sy: 0.6, sz: 0.7 });
      g.box(0.6, 0.3, 1.0, BD, 0, 0.36, 0); g.sphere(0.1, 5, BD, 0, 0.7, -0.7);
      if (v.armor) { g.box(0.86, 0.3, 0.7, C.ironD, 0, 0.95, 0.05); g.box(0.9, 0.12, 0.76, C.iron, 0, 1.1, 0.05); g.box(0.12, 0.12, 0.12, C.iron, -0.3, 1.16, 0.2); g.box(0.12, 0.12, 0.12, C.iron, 0.3, 1.16, -0.1); }
      if (v.king) { g.box(0.16, 0.05, 0.5, C.scar, -0.3, 1.04, 0.1); g.box(0.16, 0.05, 0.4, C.scar, 0.25, 1.0, -0.25); }
      return g;
    });
    const head = this.get(k + 'head', g => {
      g.sphere(0.34, 8, B, 0, 0, 0); g.box(0.28, 0.22, 0.26, BD, 0, -0.07, 0.3); g.box(0.12, 0.09, 0.08, C.bearNose, 0, -0.01, 0.44);
      g.box(0.06, 0.06, 0.04, C.dark, -0.13, 0.08, 0.31); g.box(0.06, 0.06, 0.04, C.dark, 0.13, 0.08, 0.31);
      g.sphere(0.1, 6, B, -0.24, 0.24, -0.05); g.sphere(0.1, 6, B, 0.24, 0.24, -0.05); g.sphere(0.05, 5, BD, -0.24, 0.24, 0.0); g.sphere(0.05, 5, BD, 0.24, 0.24, 0.0);
      if (v.king) { g.cyl(0.3, 0.3, 0.08, 8, C.gold, 0, 0.2, -0.02); for (let i = 0; i < 5; i++) g.cone(0.07, 0.22 + (i === 2 ? 0.1 : 0), 4, C.gold, -0.24 + i * 0.12, 0.26, -0.02); g.box(0.05, 0.14, 0.03, C.scar, 0.2, 0.0, 0.33); }
      if (v.armor) g.box(0.5, 0.2, 0.5, C.ironD, 0, 0.22, -0.02);
      return g;
    });
    const leg = this.get(k + 'leg', g => { g.box(0.26, 0.5, 0.28, B, 0, -0.25, 0); g.box(0.3, 0.14, 0.34, BD, 0, -0.45, 0.03); return g; });
    const rig = { body, head, leg, scale: v.scale || 1 }; this.cache[k] = rig; return rig;
  },

  // ---- items carried / dropped (bottom at y=0, centered)
  item(type) {
    switch (type) {
      case 'wood': return this.get('i_wood', g => { g.at(-0.36, 0.14, 0, 0, 0, -HPI, s => s.cyl(0.14, 0.14, 0.72, 7, C.wood, 0, 0, 0, { top: C.woodL, bottom: C.woodL })); return g; });
      case 'meat': return this.get('i_meat', g => { g.box(0.52, 0.14, 0.36, C.meat, 0, 0.07, 0, { top: C.meatD }); g.box(0.08, 0.15, 0.3, C.meatL, 0.1, 0.07, 0); g.box(0.3, 0.15, 0.06, C.meatL, -0.05, 0.07, 0.1); g.at(-0.3, 0.06, 0.05, 0, 0, -HPI, s => s.cyl(0.05, 0.05, 0.18, 5, C.meatL)); return g; });
      case 'cash': return this.get('i_cash', g => { g.box(0.5, 0.11, 0.3, C.cash, 0, 0.055, 0, { top: C.cashL }); g.box(0.12, 0.12, 0.31, C.cashD, 0, 0.055, 0); return g; });
      case 'stone': return this.get('i_stone', g => { g.jitter = 0.15; g.sphere(0.24, 5, C.stone, 0, 0.2, 0, { sy: 0.8 }); return g; });
      case 'gold': return this.get('i_gold', g => { g.box(0.44, 0.13, 0.24, C.gold, 0, 0.065, 0, { top: mul(C.gold, 1.1), side: C.goldD }); return g; });
    }
  },
  // ---- trees (variants: 0 pine, 1 light pine, 2 frost pine, 3 dark pine, 4 ice tree)
  tree(variant) {
    const cols = { 0: [C.pine, C.pine2], 1: [C.pine3, C.pine], 2: [C.frostPine, C.frostPine2], 3: [C.darkPine, mul(C.darkPine, 0.85)], 4: [C.ice, C.iceD] }[variant] || [C.pine, C.pine2];
    return this.get('t_' + variant, g => {
      g.jitter = 0.06; g.cyl(0.2, 0.16, 1.0, 7, C.bark, 0, 0, 0);
      const tiers = variant === 4 ? [[0.9, 1.7, 0.5], [0.6, 1.5, 1.6]] : [[1.15, 1.5, 0.55], [0.9, 1.4, 1.45], [0.6, 1.3, 2.4]];
      tiers.forEach((t, i) => { g.cone(t[0], t[1], 7, i % 2 ? cols[1] : cols[0], 0, t[2], 0, { rot: i * 0.4 }); g.cone(t[0] * 0.55, t[1] * 0.42, 7, C.snow, 0, t[2] + t[1] * 0.58, 0, { rot: i * 0.4 }); });
      return g;
    });
  },
  stump() { return this.get('stump', g => { g.cyl(0.24, 0.2, 0.36, 7, C.bark, 0, 0, 0, { top: C.woodL }); return g; }); },
  rock(kind) { return this.get('rock_' + kind, g => { g.jitter = 0.12; const c = kind === 'gold' ? C.stoneD : kind === 'ice' ? C.ice : C.stone; g.sphere(0.9, 6, c, 0, 0.5, 0, { sy: 0.7 }); g.sphere(0.6, 5, mul(c, 0.9), 0.6, 0.35, 0.3, { sy: 0.7 }); g.sphere(0.5, 5, c, -0.5, 0.3, -0.4); if (kind === 'gold') { g.box(0.3, 0.2, 0.3, C.gold, 0.3, 0.9, 0.2); g.box(0.25, 0.22, 0.2, C.gold, -0.4, 0.7, 0.4); g.box(0.2, 0.2, 0.25, C.gold, 0.1, 0.55, -0.7); } return g; }); },
  mound() { return this.get('mound', g => { g.jitter = 0.03; g.sphere(1, 7, C.snow, 0, 0, 0, { sy: 0.35 }); return g; }); },
  crystal() { return this.get('crystal', g => { g.jitter = 0.08; g.cone(0.35, 1.4, 5, C.ice, 0, 0, 0); g.cone(0.22, 0.9, 5, C.iceD, 0.35, 0, 0.2); g.cone(0.18, 0.7, 5, C.ice, -0.3, 0, 0.25); return g; }); },
  deadTree() { return this.get('deadtree', g => { g.jitter = 0.08; g.cyl(0.18, 0.1, 2.4, 6, C.brownD, 0, 0, 0); g.at(0, 1.5, 0, 0, 0, 0.9, s => s.cyl(0.07, 0.03, 1.0, 5, C.brownD)); g.at(0, 1.9, 0, 0, 0, -1.0, s => s.cyl(0.07, 0.03, 0.8, 5, C.brownD)); return g; }); },
  bones() { return this.get('bones', g => { g.at(0, 0.06, 0, 0, 0.5, HPI, s => s.cyl(0.06, 0.06, 0.8, 5, C.white, 0, -0.4, 0)); g.sphere(0.1, 5, C.white, -0.4, 0.08, 0); g.sphere(0.1, 5, C.white, 0.4, 0.08, 0); g.sphere(0.22, 6, C.white, 0.6, 0.2, 0.5); g.box(0.2, 0.14, 0.24, C.white, 0.6, 0.12, 0.72); return g; }); },
  // ---- fences / walls (segments are 2 units long along x, centered)
  fencePost() { return this.get('fpost', g => { g.cyl(0.13, 0.11, 1.1, 6, C.fence, 0, 0, 0); g.cone(0.11, 0.3, 6, C.fenceTip, 0, 1.1, 0); return g; }); },
  fenceSeg() { return this.get('fseg', g => { for (let i = 0; i < 4; i++) { const x = -0.75 + i * 0.5; g.cyl(0.12, 0.1, 1.0 + (i % 2) * 0.1, 6, C.fence, x, 0, 0); g.cone(0.1, 0.28, 6, C.fenceTip, x, 1.0 + (i % 2) * 0.1, 0); } g.box(2, 0.1, 0.08, C.woodD, 0, 0.45, 0.1); g.box(2, 0.1, 0.08, C.woodD, 0, 0.8, 0.1); return g; }); },
  wallSeg(level) { const L = Math.min(level, 4); return this.get('wall' + L, g => { const n = 5; for (let i = 0; i < n; i++) { const x = -0.8 + i * 0.4; g.cyl(0.19, 0.16, 1.5 + L * 0.15, 6, L >= 3 ? C.stoneD : C.fence, x, 0, 0); g.cone(0.16, 0.3, 6, C.fenceTip, x, 1.5 + L * 0.15, 0); } g.box(2, 0.12, 0.1, C.woodD, 0, 0.6, 0.18); g.box(2, 0.12, 0.1, C.woodD, 0, 1.1, 0.18); if (L >= 2) g.box(2.0, 0.4, 0.5, C.stoneD, 0, 0.2, 0); if (L >= 4) g.box(2.0, 0.2, 0.3, C.iron, 0, 1.6 + L * 0.15, 0); return g; }); },
  gateDoor() { return this.get('gatedoor', g => { g.box(1.3, 1.5, 0.12, C.red, 0.65, 0.85, 0, { side: C.redD }); g.box(1.2, 0.12, 0.15, C.woodL, 0.65, 0.4, 0); g.box(1.2, 0.12, 0.15, C.woodL, 0.65, 1.3, 0); g.at(0.65, 0.85, 0.02, 0, 0, 0.72, s => s.box(0.12, 1.5, 0.15, C.woodL, 0, 0, 0)); return g; }); },
  gatePost() { return this.get('gatepost', g => { g.cyl(0.2, 0.17, 2.0, 6, C.fence, 0, 0, 0); g.cone(0.17, 0.35, 6, C.fenceTip, 0, 2.0, 0); return g; }); },
  // ---- effects
  chip() { return this.get('chip', g => { g.box(0.14, 0.14, 0.14, C.white, 0, 0, 0); return g; }); },
  snowflake() { return this.get('flake', g => { g.box(0.08, 0.08, 0.08, C.white, 0, 0, 0); return g; }); },
  arrowIndicator() { return this.get('arrowind', g => { g.at(0, 0.6, 0, Math.PI, 0, 0, s => s.cone(0.35, 0.6, 4, C.gold)); g.box(0.3, 0.5, 0.3, C.gold, 0, 0.85, 0); return g; }); },
  ring() { return this.get('ring', g => { for (let i = 0; i < 20; i++) { const a = i / 20 * TAU, a2 = (i + 1) / 20 * TAU; g.quad([Math.cos(a), 0.02, Math.sin(a)], [Math.cos(a2), 0.02, Math.sin(a2)], [Math.cos(a2) * 1.12, 0.02, Math.sin(a2) * 1.12], [Math.cos(a) * 1.12, 0.02, Math.sin(a) * 1.12], C.green); } return g; }); },
  flame() { return this.get('flame', g => { g.cone(0.32, 0.8, 5, C.flame, 0, 0, 0); g.cone(0.18, 0.55, 5, C.flame2, 0.05, 0.05, 0.05); return g; }); },
  smoke() { return this.get('smoke', g => { g.sphere(0.25, 5, hex(0xC9CDD3), 0, 0, 0); return g; }); },
  coin() { return this.get('coin', g => { g.cyl(0.18, 0.18, 0.06, 8, C.gold, 0, 0, 0); return g; }); },
  cashPile() { return this.get('cashpile', g => { for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) g.box(0.5, 0.11, 0.3, C.cash, -0.3 + i * 0.55, 0.055 + j * 0.12, 0, { top: C.cashL }); return g; }); },
  // ---- buildings (bottom at y=0, facing +z)
  building(type, level) {
    const L = Math.min(level, 4);
    return this.get('bld_' + type + '_' + L, g => {
      g.jitter = 0.04;
      const gable = (w, h, z, col) => { g.tri([-w / 2, 0, z], [w / 2, 0, z], [0, h, z], col); };
      const roof2 = (w, h, len, y, col, pitch = 0.6) => { for (const sgn of [-1, 1]) g.at(sgn * -w / 2 * Math.cos(pitch) * 0.98, y, 0, 0, 0, sgn * pitch, s => { s.box(w, 0.14, len, col, 0, 0, 0); s.box(w * 0.55, 0.12, len * 0.7, C.snow, -sgn * w * 0.18, 0.1, 0); s.box(w * 0.3, 0.1, len * 0.4, C.snow, sgn * w * 0.2, 0.1, len * 0.2); }); };
      switch (type) {
        case 'post': {
          g.box(3.2, 0.9, 1.0, C.plank, 0, 0.45, 0.6, { top: C.woodL }); g.box(3.3, 0.12, 1.1, C.woodD, 0, 0.9, 0.6);
          g.cyl(0.1, 0.1, 2.5, 6, C.woodD, -1.5, 0, -0.6); g.cyl(0.1, 0.1, 2.5, 6, C.woodD, 1.5, 0, -0.6); g.cyl(0.1, 0.1, 2.1, 6, C.woodD, -1.5, 0, 1.1); g.cyl(0.1, 0.1, 2.1, 6, C.woodD, 1.5, 0, 1.1);
          g.at(0, 2.4, 0.25, 0.22, 0, 0, s => { for (let i = 0; i < 6; i++) s.box(0.58, 0.08, 2.2, i % 2 ? C.white : C.red, -1.45 + i * 0.58, 0, 0); });
          g.box(0.5, 0.35, 0.4, C.dark, 0.9, 1.1, 0.5); g.box(0.4, 0.06, 0.3, C.cashL, 0.9, 1.3, 0.5);
          g.box(1.2, 0.5, 0.08, C.sign, 0, 1.7, -0.62); g.box(0.9, 0.12, 0.1, C.green, 0, 1.7, -0.6);
          if (L >= 2) g.box(0.4, 0.15, 0.3, C.cash, -0.9, 1.0, 0.5); if (L >= 3) g.box(0.6, 0.6, 0.6, C.woodD, -2.0, 0.3, 1.2); if (L >= 4) g.box(0.5, 0.3, 0.3, C.gold, -2.0, 0.75, 1.2);
          break; }
        case 'fire': {
          for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; g.sphere(0.22, 5, C.stoneD, Math.cos(a) * 0.8, 0.12, Math.sin(a) * 0.8); }
          g.at(0, 0.12, 0, 0, 0.4, HPI, s => s.cyl(0.1, 0.1, 1.0, 5, C.brownD, 0, -0.5, 0)); g.at(0, 0.12, 0, 0, -0.9, HPI, s => s.cyl(0.1, 0.1, 1.0, 5, C.brownD, 0, -0.5, 0)); g.box(0.8, 0.1, 0.8, C.coal, 0, 0.08, 0);
          if (L >= 2) g.box(2.6, 0.35, 0.4, C.woodD, 0, 0.17, 1.6); if (L >= 3) { g.cyl(0.12, 0.12, 1.8, 5, C.woodD, 1.3, 0, -1.3); g.box(0.35, 0.35, 0.35, C.flame2, 1.3, 1.85, -1.3); } if (L >= 4) g.box(2.6, 0.35, 0.4, C.woodD, 0, 0.17, -1.6);
          break; }
        case 'lumber': {
          g.at(-0.72, 0.95, 0, 0, 0, 0.95, s => s.box(2.4, 0.1, 2.6, C.canvas)); g.at(0.72, 0.95, 0, 0, 0, -0.95, s => s.box(2.4, 0.1, 2.6, C.canvas));
          g.tri([-1.45, 0, -1.3], [1.45, 0, -1.3], [0, 1.9, -1.3], C.canvasD); g.tri([1.45, 0, 1.3], [-1.45, 0, 1.3], [0, 1.9, 1.3], mul(C.canvasD, 0.85));
          const pile = (px) => { for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) g.at(px + j * 0.34 + i * 0.17 - 0.3, 0.16 + i * 0.3, 0.7, HPI, 0, 0, s => s.cyl(0.16, 0.16, 1.4, 6, C.wood, 0, 0, 0, { top: C.woodL, bottom: C.woodL })); };
          pile(2.1); if (L >= 2) pile(-2.1); if (L >= 3) g.box(0.5, 0.5, 0.08, C.sign, 0, 1.2, 1.35); if (L >= 4) { g.cyl(0.1, 0.1, 2.5, 5, C.woodD, 0, 0, 1.5); g.box(0.6, 0.4, 0.05, C.banner, 0.3, 2.2, 1.5); }
          break; }
        case 'sawmill': {
          g.cyl(0.14, 0.14, 2.2, 6, C.woodD, -1.6, 0, -1.2); g.cyl(0.14, 0.14, 2.2, 6, C.woodD, 1.6, 0, -1.2); g.cyl(0.14, 0.14, 1.8, 6, C.woodD, -1.6, 0, 1.2); g.cyl(0.14, 0.14, 1.8, 6, C.woodD, 1.6, 0, 1.2);
          g.at(0, 2.15, 0, 0.17, 0, 0, s => { s.box(3.8, 0.14, 3.0, C.roof, 0, 0, 0); s.box(2.4, 0.12, 1.6, C.snow, -0.4, 0.1, -0.4); s.box(1.2, 0.1, 1.0, C.snow, 1.0, 0.1, 0.8); });
          g.box(3.4, 0.6, 0.9, C.plank, 0, 0.3, 0, { top: C.woodL }); g.at(0, 0.85, 0, 0, 0, HPI, s => s.cyl(0.55, 0.55, 0.08, 12, C.iron, 0, -0.04, 0));
          g.box(0.9, 0.9, 0.9, C.dark, 1.4, 0.45, -0.9); g.cyl(0.14, 0.12, 1.2, 6, C.grayD, 1.4, 0.9, -0.9);
          for (let i = 0; i < 4; i++) g.box(1.2, 0.08, 0.3, C.plank, -1.2, 0.05 + i * 0.09, 1.0 + i * 0.02);
          if (L >= 2) for (let i = 0; i < 4; i++) g.box(1.2, 0.08, 0.3, C.plank, -1.2, 0.05 + i * 0.09, 1.5); if (L >= 3) g.box(3.9, 0.14, 0.4, C.roof2, 0, 2.5, -1.4); if (L >= 4) g.box(0.6, 0.6, 0.6, C.gold, 1.5, 0.3, 1.2);
          break; }
        case 'butcher': {
          g.box(3.0, 1.8, 2.6, C.plank, 0, 0.9, 0, { top: C.woodL }); roof2(2.0, 0.12, 3.2, 2.45, C.roof, 0.58); gable(3.0, 1.1, -1.3, C.roof2); g.tri([1.5, 1.8, 1.3], [-1.5, 1.8, 1.3], [0, 2.9, 1.3], C.roof2);
          g.box(0.5, 1.0, 0.5, C.stoneD, 0.9, 2.6, -0.5); g.box(0.9, 1.3, 0.1, C.woodD, 0, 0.65, 1.32);
          g.box(0.5, 0.14, 0.36, C.meat, -1.0, 1.4, 1.4); g.box(0.5, 0.14, 0.36, C.meat, -1.0, 1.15, 1.4);
          if (L >= 2) g.box(0.5, 0.14, 0.36, C.meat, 1.0, 1.4, 1.4); if (L >= 3) g.box(1.0, 0.5, 0.6, C.woodD, -2.0, 0.25, 0.8); if (L >= 4) g.box(0.5, 1.0, 0.5, C.stoneD, -0.9, 2.6, 0.4);
          break; }
        case 'lodge': {
          for (let i = 0; i < 6; i++) { g.at(1.6, 0.17 + i * 0.3, 1.2, 0, 0, HPI, s => s.cyl(0.17, 0.17, 3.2, 6, C.wood)); g.at(1.6, 0.17 + i * 0.3, -1.2, 0, 0, HPI, s => s.cyl(0.17, 0.17, 3.2, 6, C.wood)); g.at(1.6, 0.17 + i * 0.3, -1.3, HPI, 0, 0, s => s.cyl(0.17, 0.17, 2.6, 6, C.woodD)); g.at(-1.6, 0.17 + i * 0.3, -1.3, HPI, 0, 0, s => s.cyl(0.17, 0.17, 2.6, 6, C.woodD)); }
          roof2(2.1, 0.12, 3.3, 2.45, C.roof, 0.6); g.tri([-1.7, 1.9, 1.25], [1.7, 1.9, 1.25], [0, 3.0, 1.25], C.plank); g.tri([1.7, 1.9, -1.25], [-1.7, 1.9, -1.25], [0, 3.0, -1.25], C.plank);
          g.box(0.8, 1.2, 0.1, C.woodD, 0, 0.6, 1.4); g.at(-0.3, 2.1, 1.4, 0, 0, 0.5, s => s.cyl(0.05, 0.02, 0.5, 4, C.white)); g.at(0.3, 2.1, 1.4, 0, 0, -0.5, s => s.cyl(0.05, 0.02, 0.5, 4, C.white));
          g.box(0.3, 1.6, 0.3, C.canvas, 2.4, 0.8, 0.8); g.sphere(0.25, 6, C.canvas, 2.4, 1.85, 0.8);
          if (L >= 2) g.box(0.5, 0.14, 0.36, C.meat, 2.4, 0.3, -0.5); if (L >= 3) g.box(0.6, 0.6, 0.06, C.banner, 0, 2.2, 1.4); if (L >= 4) g.box(0.4, 0.4, 0.4, C.gold, -2.2, 0.2, 0.8);
          break; }
        case 'armory': {
          g.box(2.4, 1.4, 1.6, C.stoneD, -0.6, 0.7, -0.6, { top: C.stone }); g.box(0.9, 0.6, 0.2, C.flame, -0.6, 0.6, 0.22); g.cyl(0.3, 0.25, 1.4, 6, C.grayD, -0.6, 1.4, -0.9);
          g.box(0.9, 0.3, 0.4, C.ironD, 1.2, 0.75, 0.4); g.box(0.4, 0.6, 0.4, C.woodD, 1.2, 0.3, 0.4);
          g.box(2.0, 1.6, 0.1, C.woodD, 1.0, 0.8, -1.3); g.box(0.08, 1.2, 0.08, C.iron, 0.5, 0.8, -1.2); g.box(0.08, 1.2, 0.08, C.iron, 1.0, 0.8, -1.2); g.box(0.08, 1.2, 0.08, C.iron, 1.5, 0.8, -1.2);
          if (L >= 2) g.box(0.5, 0.5, 0.5, C.iron, 2.0, 0.25, 0.8); if (L >= 3) g.box(2.6, 0.12, 2.2, C.roof2, -0.5, 2.2, -0.2); if (L >= 4) g.box(0.6, 0.3, 0.6, C.gold, 2.0, 0.65, 0.8);
          break; }
        case 'tower': {
          const H = 3.2 + L * 0.3;
          for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) g.cyl(0.14, 0.12, H, 6, C.woodD, x, 0, z);
          g.box(2.0, 0.16, 2.0, C.plank, 0, H, 0); g.box(2.1, 0.5, 0.1, C.plank, 0, H + 0.3, 1.0); g.box(2.1, 0.5, 0.1, C.plank, 0, H + 0.3, -1.0); g.box(0.1, 0.5, 2.1, C.plank, 1.0, H + 0.3, 0); g.box(0.1, 0.5, 2.1, C.plank, -1.0, H + 0.3, 0);
          g.box(1.2, 0.1, 0.12, C.woodD, 0, 1.2, 0.72); g.box(1.2, 0.1, 0.12, C.woodD, 0, 2.2, 0.72);
          for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) g.cyl(0.1, 0.1, 1.0, 4, C.woodD, x, H + 0.1, z);
          g.cone(1.5, 1.1, 4, C.roof, 0, H + 1.1, 0, { rot: Math.PI / 4 });
          if (L >= 3) { g.cyl(0.04, 0.04, 1.2, 4, C.woodD, 0, H + 2.0, 0); g.box(0.5, 0.4, 0.06, C.banner, 0.3, H + 2.9, 0); }
          break; }
        case 'warehouse': {
          g.box(4.2, 2.2, 3.2, C.plank, 0, 1.1, 0, { top: C.woodL }); roof2(2.6, 0.14, 3.6, 2.9, C.roof2, 0.6);
          g.tri([-2.1, 2.2, 1.6], [2.1, 2.2, 1.6], [0, 3.6, 1.6], C.woodD); g.tri([2.1, 2.2, -1.6], [-2.1, 2.2, -1.6], [0, 3.6, -1.6], C.woodD);
          g.box(1.4, 1.6, 0.12, C.woodD, 0, 0.8, 1.62); g.box(0.1, 1.6, 0.14, C.woodL, 0, 0.8, 1.64);
          for (let i = 0; i < 2 + L; i++) g.box(0.7, 0.7, 0.7, C.woodD, 2.6 + (i % 2) * 0.75, 0.35 + Math.floor(i / 2) * 0.72, -0.6 + (i % 3) * 0.3);
          break; }
        case 'barracks': {
          g.box(4.4, 1.9, 2.8, C.woodD, 0, 0.95, 0, { top: C.wood }); roof2(2.7, 0.14, 3.2, 2.5, C.roof, 0.58);
          g.tri([-2.2, 1.9, 1.4], [2.2, 1.9, 1.4], [0, 3.15, 1.4], C.plank); g.tri([2.2, 1.9, -1.4], [-2.2, 1.9, -1.4], [0, 3.15, -1.4], C.plank);
          for (let i = 0; i < 3; i++) g.at(-1.2 + i * 1.2, 1.2, 1.45, HPI, 0, 0, s => { s.cyl(0.32, 0.32, 0.08, 8, C.red); s.cyl(0.1, 0.1, 0.12, 6, C.gold); });
          g.box(0.9, 1.4, 0.1, C.brownD, 0, 0.7, 1.42); g.cyl(0.06, 0.06, 3.5, 4, C.woodD, 2.5, 0, 1.0); g.box(0.9, 0.55, 0.05, C.red, 2.95, 3.0, 1.0);
          if (L >= 3) { g.cyl(0.06, 0.06, 3.5, 4, C.woodD, -2.5, 0, 1.0); g.box(0.9, 0.55, 0.05, C.banner, -2.95, 3.0, 1.0); }
          break; }
        case 'quarry': {
          g.jitter = 0.1; g.sphere(1.3, 6, C.stone, -0.8, 0.5, -0.5, { sy: 0.7 }); g.sphere(0.9, 6, C.stoneD, 1.0, 0.4, 0.2, { sy: 0.7 }); g.jitter = 0.04;
          g.box(1.2, 0.6, 0.8, C.woodD, 1.8, 0.5, 1.2); g.at(1.3, 0.3, 1.7, 0, 0, HPI, s => s.cyl(0.3, 0.3, 0.12, 8, C.dark)); g.at(2.3, 0.3, 1.7, 0, 0, HPI, s => s.cyl(0.3, 0.3, 0.12, 8, C.dark));
          g.box(0.7, 0.35, 0.4, C.stone, 1.8, 0.9, 1.2); g.box(1.6, 1.2, 0.1, C.woodD, -1.5, 0.6, 1.4); if (L >= 2) g.box(0.7, 0.35, 0.4, C.stone, -1.5, 0.2, 2.0); if (L >= 3) g.box(0.5, 0.5, 0.5, C.gold, -1.5, 0.25, -1.6);
          break; }
        case 'mine': {
          g.box(3.2, 2.6, 2.2, C.stoneD, 0, 1.3, -0.4, { top: C.stone }); g.box(1.4, 1.7, 0.6, C.dark, 0, 0.85, 0.8); g.box(0.2, 1.9, 0.25, C.woodD, -0.8, 0.95, 1.0); g.box(0.2, 1.9, 0.25, C.woodD, 0.8, 0.95, 1.0); g.box(1.9, 0.25, 0.25, C.woodD, 0, 1.9, 1.0);
          g.box(0.3, 0.4, 0.3, C.gold, 1.9, 0.2, 1.0); g.box(1.2, 0.6, 0.8, C.ironD, -2.0, 0.5, 1.0); g.box(0.9, 0.3, 0.5, C.gold, -2.0, 0.9, 1.0);
          for (let i = 0; i < 2; i++) g.box(0.12, 0.12, 2.0, C.woodD, -0.4 + i * 0.8, 0.06, 2.0); if (L >= 2) g.box(0.5, 0.5, 0.5, C.gold, 1.9, 0.25, -1.6); if (L >= 3) g.box(2.0, 0.3, 0.4, C.roof, 0, 2.8, 0.9);
          break; }
        case 'hall': {
          g.box(5.0, 2.4, 3.6, C.wood, 0, 1.2, 0, { top: C.woodL }); roof2(3.0, 0.16, 4.2, 3.2, C.roof2, 0.6);
          g.tri([-2.5, 2.4, 1.8], [2.5, 2.4, 1.8], [0, 4.0, 1.8], C.woodD); g.tri([2.5, 2.4, -1.8], [-2.5, 2.4, -1.8], [0, 4.0, -1.8], C.woodD);
          g.box(1.3, 1.9, 0.12, C.brownD, 0, 0.95, 1.82); g.box(0.6, 0.8, 0.06, C.banner, -1.6, 1.4, 1.84); g.box(0.6, 0.8, 0.06, C.banner, 1.6, 1.4, 1.84);
          g.cyl(0.07, 0.07, 2.0, 4, C.woodD, 0, 4.0, 0); g.box(0.9, 0.5, 0.05, C.gold, 0.45, 5.6, 0);
          if (L >= 2) g.box(0.5, 0.5, 0.5, C.gold, -2.2, 0.25, 2.3); if (L >= 3) { g.cyl(0.12, 0.12, 2.4, 6, C.woodD, -2.9, 0, 2.2); g.cyl(0.12, 0.12, 2.4, 6, C.woodD, 2.9, 0, 2.2); } if (L >= 4) g.box(0.9, 0.5, 0.05, C.red, -0.45, 5.6, 0);
          break; }
      }
      return g;
    });
  },
  merchant() { return this.human({ id: 'merchant', parka: hex(0xD98C3F), parkaD: hex(0xB56F2C), beard: hex(0xE8E8E8), hat: hex(0xB05A2A), pants: C.brownD }); }
};

// ===== 04_audio.js =====
// ---------------------------------------------------------------------------
// Synth audio: SFX + light ambient music (WebAudio, unlocked on first touch)
// ---------------------------------------------------------------------------
const Sound = {
  ctx: null, master: null, sfxGain: null, musGain: null, enabled: true, music: true, unlocked: false, musicTimer: null, noiseBuf: null,
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = this.enabled ? 1 : 0; this.sfxGain.connect(this.master);
      this.musGain = this.ctx.createGain(); this.musGain.gain.value = this.music ? 0.35 : 0; this.musGain.connect(this.master);
      const len = this.ctx.sampleRate * 1.5; this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate); const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startMusic(); this.wind();
    } catch (e) { this.ctx = null; }
  },
  unlock() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); this.unlocked = true; },
  setSfx(on) { this.enabled = on; if (this.sfxGain) this.sfxGain.gain.value = on ? 1 : 0; },
  setMusic(on) { this.music = on; if (this.musGain) this.musGain.gain.setTargetAtTime(on ? 0.35 : 0, this.ctx.currentTime, 0.1); },
  _osc(type, f0, f1, t0, dur, vol, dest) { const c = this.ctx; const o = c.createOscillator(); const g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); o.connect(g); g.connect(dest || this.sfxGain); o.start(t0); o.stop(t0 + dur + 0.02); },
  _noise(t0, dur, vol, filterHz, q = 1, type = 'lowpass') { const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = filterHz; f.Q.value = q; const g = c.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); s.connect(f); f.connect(g); g.connect(this.sfxGain); s.start(t0); s.stop(t0 + dur + 0.02); },
  play(name, vol = 1) {
    if (!this.ctx || !this.enabled) return; const t = this.ctx.currentTime; const v = vol;
    switch (name) {
      case 'chop': this._noise(t, 0.09, 0.5 * v, 1800, 0.8); this._osc('triangle', 220, 90, t, 0.1, 0.35 * v); break;
      case 'treefall': this._noise(t, 0.5, 0.5 * v, 600, 0.6); this._osc('sine', 120, 40, t, 0.5, 0.5 * v); break;
      case 'hit': this._noise(t, 0.12, 0.6 * v, 900, 0.7); this._osc('square', 160, 60, t, 0.12, 0.25 * v); break;
      case 'hurt': this._osc('sawtooth', 300, 120, t, 0.25, 0.3 * v); this._noise(t, 0.2, 0.3 * v, 700); break;
      case 'growl': this._osc('sawtooth', 90, 60, t, 0.5, 0.3 * v); this._noise(t, 0.45, 0.35 * v, 300, 2); break;
      case 'bearDie': this._osc('sawtooth', 140, 30, t, 0.6, 0.35 * v); this._noise(t, 0.5, 0.4 * v, 400); break;
      case 'pickup': this._osc('sine', 700, 1100, t, 0.08, 0.2 * v); break;
      case 'coin': this._osc('sine', 1200, 1200, t, 0.07, 0.18 * v); this._osc('sine', 1800, 1800, t + 0.06, 0.12, 0.15 * v); break;
      case 'cash': this._osc('triangle', 900, 1400, t, 0.12, 0.2 * v); this._osc('triangle', 1400, 2000, t + 0.08, 0.15, 0.15 * v); break;
      case 'sell': for (let i = 0; i < 4; i++) this._osc('sine', 800 + i * 200, 800 + i * 200, t + i * 0.05, 0.1, 0.15 * v); break;
      case 'build': for (let i = 0; i < 5; i++) this._osc('triangle', 330 * Math.pow(1.26, i), 330 * Math.pow(1.26, i), t + i * 0.07, 0.35, 0.18 * v); this._noise(t, 0.3, 0.3 * v, 1200); break;
      case 'upgrade': for (let i = 0; i < 3; i++) this._osc('triangle', 520 * Math.pow(1.5, i), 520 * Math.pow(1.5, i), t + i * 0.08, 0.3, 0.2 * v); break;
      case 'click': this._osc('square', 900, 600, t, 0.05, 0.12 * v); break;
      case 'error': this._osc('square', 200, 150, t, 0.15, 0.15 * v); this._osc('square', 160, 120, t + 0.12, 0.2, 0.15 * v); break;
      case 'full': this._osc('square', 500, 400, t, 0.1, 0.12 * v); break;
      case 'horn': this._osc('sawtooth', 110, 110, t, 1.2, 0.3 * v); this._osc('sawtooth', 165, 160, t + 0.05, 1.1, 0.2 * v); this._osc('sawtooth', 82, 80, t + 0.4, 1.0, 0.25 * v); break;
      case 'dawn': for (let i = 0; i < 5; i++) this._osc('sine', [523, 659, 784, 1047, 1319][i], [523, 659, 784, 1047, 1319][i], t + i * 0.1, 0.6, 0.18 * v); break;
      case 'arrow': this._noise(t, 0.12, 0.25 * v, 3000, 0.5, 'highpass'); break;
      case 'unlock': for (let i = 0; i < 6; i++) this._osc('triangle', 440 * Math.pow(1.19, i), 440 * Math.pow(1.19, i), t + i * 0.09, 0.5, 0.2 * v); break;
      case 'quest': this._osc('sine', 880, 880, t, 0.15, 0.2 * v); this._osc('sine', 1320, 1320, t + 0.12, 0.3, 0.2 * v); break;
      case 'slam': this._noise(t, 0.6, 0.8 * v, 250); this._osc('sine', 80, 25, t, 0.6, 0.8 * v); break;
      case 'die': this._osc('sawtooth', 400, 60, t, 0.9, 0.3 * v); break;
      case 'stone': this._noise(t, 0.1, 0.5 * v, 2500, 1.5); this._osc('square', 300, 200, t, 0.06, 0.15 * v); break;
      case 'victory': [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this._osc('triangle', f, f, t + i * 0.13, 0.5, 0.22 * v)); break;
    }
  },
  wind() { if (!this.ctx) return; const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320; const g = c.createGain(); g.gain.value = 0.045; s.connect(f); f.connect(g); g.connect(this.musGain); s.start(); const lfo = c.createOscillator(); lfo.frequency.value = 0.08; const lg = c.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(f.frequency); lfo.start(); },
  startMusic() {
    if (!this.ctx) return; const c = this.ctx; const self = this;
    // gentle pentatonic pluck sequence (C major pentatonic), 100 bpm, evolving pattern
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];
    let step = 0; const bpm = 92; const beat = 60 / bpm;
    let nextT = c.currentTime + 0.5;
    const pattern = [0, 4, 7, 4, 2, 5, 7, 4, 0, 4, 8, 4, 2, 5, 1, 4];
    const bass = [0, 0, 3, 3, 4, 4, 2, 2];
    function schedule() {
      while (nextT < c.currentTime + 1.2) {
        const bar = Math.floor(step / 16); const i = step % 16;
        const dest = self.musGain;
        if (i % 2 === 0 || Math.random() < 0.35) { const f = scale[pattern[(i + bar * 3) % 16] % scale.length] * (bar % 4 === 3 ? 0.5 : 1); const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; const g = c.createGain(); g.gain.setValueAtTime(0.0001, nextT); g.gain.exponentialRampToValueAtTime(0.16, nextT + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, nextT + beat * 1.8); o.connect(g); g.connect(dest); o.start(nextT); o.stop(nextT + beat * 2); }
        if (i % 4 === 0) { const f = scale[bass[(Math.floor(step / 4)) % 8]] / 2; const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = c.createGain(); g.gain.setValueAtTime(0.0001, nextT); g.gain.exponentialRampToValueAtTime(0.22, nextT + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, nextT + beat * 3.5); o.connect(g); g.connect(dest); o.start(nextT); o.stop(nextT + beat * 4); }
        nextT += beat / 2; step++;
      }
    }
    this.musicTimer = setInterval(schedule, 300);
  }
};

// ===== 05_input.js =====
// ---------------------------------------------------------------------------
// Input: floating joystick (touch / mouse) + WASD/arrows. Also tap detection.
// ---------------------------------------------------------------------------
const Input = {
  x: 0, y: 0, mag: 0, active: false, keys: {}, pointerId: null, ox: 0, oy: 0, cx: 0, cy: 0, startT: 0, moved: false,
  tapHandlers: [], base: null, knob: null, radius: 58, lastTap: 0,
  init(surface, uiRoot) {
    this.base = document.createElement('div'); this.base.id = 'joy'; this.base.innerHTML = '<div id="joyKnob"></div>'; uiRoot.appendChild(this.base); this.knob = this.base.firstChild;
    const down = (e) => {
      if (this.pointerId !== null) return;
      if (e.target.closest && e.target.closest('.panel, .btn, .modal, #hud button')) return;
      this.pointerId = e.pointerId; this.ox = this.cx = e.clientX; this.oy = this.cy = e.clientY; this.startT = performance.now(); this.moved = false;
      this.active = true; this.x = 0; this.y = 0; this.mag = 0; this.base.style.display = 'block'; this.base.style.left = this.ox + 'px'; this.base.style.top = this.oy + 'px'; this.knob.style.transform = 'translate(0px,0px)';
      Sound.unlock();
      try { surface.setPointerCapture(e.pointerId); } catch (_) { }
    };
    const move = (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.cx = e.clientX; this.cy = e.clientY;
      let dx = this.cx - this.ox, dy = this.cy - this.oy; const d = Math.hypot(dx, dy);
      if (d > 8) this.moved = true;
      if (d > this.radius) { // drag the base along (follow joystick)
        const f = this.radius / d; this.ox = this.cx - dx * f; this.oy = this.cy - dy * f; dx *= f; dy *= f; this.base.style.left = this.ox + 'px'; this.base.style.top = this.oy + 'px';
      }
      const m = Math.min(1, Math.hypot(dx, dy) / this.radius); const dead = 0.08;
      this.mag = m < dead ? 0 : (m - dead) / (1 - dead);
      const l = Math.hypot(dx, dy) || 1; this.x = dx / l * this.mag; this.y = dy / l * this.mag;
      this.knob.style.transform = `translate(${dx}px,${dy}px)`;
    };
    const up = (e) => {
      if (e.pointerId !== this.pointerId) return;
      const dt = performance.now() - this.startT;
      if (!this.moved && dt < 350) { const now = performance.now(); for (const h of this.tapHandlers) h(e.clientX, e.clientY, now - this.lastTap < 320); this.lastTap = now; }
      this.pointerId = null; this.active = false; this.x = 0; this.y = 0; this.mag = 0; this.base.style.display = 'none';
    };
    surface.addEventListener('pointerdown', down); surface.addEventListener('pointermove', move); surface.addEventListener('pointerup', up); surface.addEventListener('pointercancel', up); surface.addEventListener('lostpointercapture', up);
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); Sound.unlock(); });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    document.addEventListener('gesturestart', e => e.preventDefault()); document.addEventListener('gesturechange', e => e.preventDefault());
    document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', e => e.preventDefault());
    document.addEventListener('contextmenu', e => e.preventDefault());
  },
  onTap(fn) { this.tapHandlers.push(fn); },
  // ---- gamepad (Xbox / PlayStation layout): left stick or d-pad moves; A = nearest building / confirm, B = back, Y = camp, Start = settings
  padPrev: {}, padVec: [0, 0], padPressed: {},
  pollPad() {
    this.padVec[0] = 0; this.padVec[1] = 0; this.padPressed = {}; if (!navigator.getGamepads) return;
    let pads; try { pads = navigator.getGamepads(); } catch (e) { return; }
    for (const gp of pads) { if (!gp || !gp.connected) continue;
      let x = gp.axes[0] || 0, y = gp.axes[1] || 0; if (Math.hypot(x, y) < 0.18) { x = 0; y = 0; }
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      if (b(14)) x -= 1; if (b(15)) x += 1; if (b(12)) y -= 1; if (b(13)) y += 1; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      if (x || y) { this.padVec[0] = x; this.padVec[1] = y; this.padUsed = true; }
      for (const [i, name] of [[0, 'a'], [1, 'b'], [3, 'y'], [9, 'start'], [2, 'x']]) { const now = b(i); if (now && !this.padPrev[i]) this.padPressed[name] = true; this.padPrev[i] = now; }
      break; // first connected pad wins
    }
  },
  // returns [dx, dz] in world (screen up = -z)
  vector() {
    let x = this.x, y = this.y;
    if (!this.active) {
      const k = this.keys; x = 0; y = 0;
      if (k.KeyA || k.ArrowLeft) x -= 1; if (k.KeyD || k.ArrowRight) x += 1; if (k.KeyW || k.ArrowUp) y -= 1; if (k.KeyS || k.ArrowDown) y += 1;
      if (!x && !y && (this.padVec[0] || this.padVec[1])) { x = this.padVec[0]; y = this.padVec[1]; }
      const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    }
    return [x, y];
  }
};

// ===== 06_data.js =====
// ---------------------------------------------------------------------------
// Balance tables
// ---------------------------------------------------------------------------
const DATA = {
  version: 3,
  dayLength: 300, // seconds per full day
  nightStart: 0.72, duskStart: 0.62, // fraction of day
  player: { hp: 100, speed: 5.5, dmg: 10, atkRate: 1.8, cap: 8, chop: 1, reach: 1.7, atkReach: 2.0 },
  items: { wood: { name: 'Wood', price: 5, h: 0.29 }, meat: { name: 'Meat', price: 14, h: 0.15 }, stone: { name: 'Stone', price: 12, h: 0.36 }, gold: { name: 'Gold', price: 80, h: 0.14 } },
  upgrades: {
    cap: { name: 'Backpack', icon: 'bag', desc: '+4 carry capacity', base: 60, mult: 1.5, max: 20, per: 4 },
    dmg: { name: 'Sharp Edge', icon: 'axe', desc: '+7 attack damage', base: 110, mult: 1.55, max: 30, per: 7 },
    atk: { name: 'Swing Speed', icon: 'speed', desc: '+8% attack speed', base: 150, mult: 1.8, max: 10, per: 0.08 },
    speed: { name: 'Snow Boots', icon: 'boots', desc: '+8% move speed', base: 50, mult: 1.45, max: 15, per: 0.08, gear: true },
    hp: { name: 'Vitality', icon: 'heart', desc: '+30 max HP', base: 100, mult: 1.55, max: 25, per: 30 },
    chop: { name: 'Chop Power', icon: 'log', desc: '+1 log per hit', base: 600, mult: 2.8, max: 4, per: 1 }
  },
  bears: {
    snow: { name: 'Snow Bear', hp: 30, dmg: 8, speed: 3.3, meat: 3, scale: 1.0, aggro: 5.5, body: 0xF6F5F0, bodyD: 0xE2DFD6 },
    frost: { name: 'Frost Bear', hp: 120, dmg: 16, speed: 3.5, meat: 5, scale: 1.15, aggro: 6, body: 0xC8D9E8, bodyD: 0xA9C0D3 },
    black: { name: 'Black Bear', hp: 420, dmg: 32, speed: 3.7, meat: 8, scale: 1.25, aggro: 6.5, body: 0x4B4040, bodyD: 0x352C2C },
    armor: { name: 'Armored Bear', hp: 1500, dmg: 60, speed: 3.6, meat: 12, scale: 1.4, aggro: 7, body: 0xE0DCD4, bodyD: 0xC6C1B8, armor: true },
    king: { name: 'Bear King', hp: 12000, dmg: 130, speed: 3.4, meat: 60, gold: 40, scale: 2.4, aggro: 12, body: 0xEFE9DE, bodyD: 0xD8CFC0, king: true, boss: true }
  },
  zones: [
    { name: 'Home Clearing', cost: 0, mult: 1, bear: 'snow', bears: 7, trees: 75, tree: 0, rocks: {}, bounds: [-36, 36, -30, 36], gate: null, mounds: 30 },
    { name: 'Frozen Forest', cost: 800, mult: 2.2, bear: 'frost', bears: 10, trees: 95, tree: 2, rocks: { stone: 14 }, bounds: [-36, 36, -90, -34], gate: [0, -32], gateDir: 'n', mounds: 30 },
    { name: 'Stone Ridge', cost: 6000, mult: 5, bear: 'black', bears: 12, trees: 55, tree: 3, rocks: { stone: 16, gold: 8 }, bounds: [40, 110, -30, 38], gate: [38, 1], gateDir: 'e', mounds: 10, boulders: 14 },
    { name: 'Glacier', cost: 40000, mult: 12, bear: 'armor', bears: 14, trees: 45, tree: 4, rocks: { stone: 10, gold: 14 }, bounds: [-110, -40, -30, 38], gate: [-38, 1], gateDir: 'w', mounds: 20, crystals: 26, deadTrees: 14 },
    { name: "Bear King's Den", cost: 250000, mult: 30, bear: 'armor', bears: 6, trees: 22, tree: 4, rocks: { gold: 6 }, bounds: [-36, 36, -158, -94], gate: [0, -92], gateDir: 'n', boss: true, mounds: 10, bones: 16, crystals: 10 }
  ],
  base: { x0: -15, x1: 15, z0: -11, z1: 13, gates: { n: [0, -11], e: [15, 1], w: [-15, 1] } },
  buildings: {
    post: { name: 'Trading Post', icon: 'shop', cost: 0, x: -9, z: -6, rot: 0, up: 250, mult: 1.8, max: 12, desc: 'Sells wood & meat. Stores stone & gold in the vault.', effect: l => `Sell prices +${(l - 1) * 8}%` , w: 4, d: 3 },
    fire: { name: 'Campfire', icon: 'fire', cost: 0, x: 0, z: -1, rot: 0, up: 120, mult: 1.8, max: 10, desc: 'Heals you when you stand near it.', effect: l => `Heals ${8 + (l - 1) * 6} HP/s, max HP +${(l - 1) * 4}%`, w: 3, d: 3 },
    lumber: { name: 'Lumber Camp', icon: 'tent', cost: 150, x: 9, z: -6, rot: 0, up: 220, mult: 1.75, max: 10, desc: 'Hires lumberjacks who chop trees and haul logs.', effect: l => l === 0 ? 'No lumberjacks — hire one!' : `${l} lumberjack${l === 1 ? '' : 's'}, range zone ${Math.min(3, Math.floor((l + 1) / 2))}`, w: 4, d: 3, worker: 'lumber' },
    armory: { name: 'Armory', icon: 'anvil', cost: 250, x: 9, z: 0, rot: 0, up: 500, mult: 2.2, max: 5, desc: 'Buy personal upgrades: damage, speed, capacity, health.', effect: l => `Upgrade cap: ${l * 6} levels each`, w: 4, d: 3, gold: l => l >= 4 ? (l === 4 ? 60 : 250) : 0 },
    sawmill: { name: 'Sawmill', icon: 'saw', cost: 400, x: -9, z: 0, rot: 0, up: 350, mult: 1.7, max: 12, desc: 'Turns hauled wood into cash automatically. Collect the pile!', effect: l => `Wood value +${15 * l}%, ${(1 + 0.3 * (l - 1)).toFixed(1)} logs/s`, w: 4, d: 3, unlockAfter: 'lumber' },
    wall: { name: 'Palisade', icon: 'wall', cost: 300, x: 0, z: -9.3, rot: 0, up: 400, mult: 1.8, max: 12, desc: 'Walls and gates around camp. Bears must break through.', effect: l => `Wall HP ${fmtNum(Math.round(1200 * l * (1 + 0.12 * (l - 1))))}, repairs ${6 * l} HP/s`, w: 4, d: 2, unlockAfter: 'armory', stone: l => l >= 3 ? 12 * (l - 2) * (l - 2) : 0 },
    tower: { name: 'Watchtower', icon: 'tower', cost: 500, x: -13, z: -9, rot: 0, up: 300, mult: 1.7, max: 12, desc: 'Archers shoot bears near camp.', effect: l => `Dmg ${10 + 8 * (l - 1)}, range ${11 + l}`, w: 2, d: 2, unlockAfter: 'sawmill', stone: l => l >= 5 ? 8 * (l - 4) * (l - 4) : 0, multi: [[-13, -9], [13, -9], [-13, 11], [13, 11]] },
    lodge: { name: 'Hunting Lodge', icon: 'antler', cost: 900, x: 9, z: 6, rot: 0, up: 500, mult: 1.75, max: 10, desc: 'Hires hunters who hunt bears and haul meat.', effect: l => l === 0 ? 'No hunters — hire one!' : `${l} hunter${l === 1 ? '' : 's'}, dmg ${8 + 8 * (l - 1)}, range zone ${Math.min(3, Math.floor((l + 1) / 2))}`, w: 4, d: 3, unlockAfter: 'sawmill', worker: 'hunter' },
    butcher: { name: 'Smokehouse', icon: 'meat', cost: 700, x: -9, z: 6, rot: 0, up: 450, mult: 1.7, max: 12, desc: 'Turns hauled meat into cash automatically.', effect: l => `Meat value +${15 * l}%, ${(1 + 0.3 * (l - 1)).toFixed(1)} meat/s`, w: 4, d: 3, unlockAfter: 'lodge' },
    warehouse: { name: 'Warehouse', icon: 'crate', cost: 1500, x: -9, z: 11.2, rot: 0, up: 900, mult: 1.8, max: 10, desc: 'Bigger hauls, bigger cash piles, longer offline earnings.', effect: l => `Worker carry +${3 * l}, storage x${1 + l}, offline ${2 + l}h`, w: 4, d: 3, unlockAfter: 'wall' },
    barracks: { name: 'Barracks', icon: 'shield', cost: 3000, x: 9, z: 11.2, rot: 0, up: 1200, mult: 1.8, max: 8, desc: 'Trains guards that defend the camp at night.', effect: l => l === 0 ? 'No guards — hire one!' : `${l} guard${l === 1 ? '' : 's'}, dmg ${15 + 8 * (l - 1)}`, w: 4, d: 3, unlockAfter: 'warehouse', worker: 'guard' },
    hall: { name: 'Great Hall', icon: 'hall', cost: 5000, x: 0, z: 7.5, rot: 0, up: 4000, mult: 2.0, max: 10, desc: 'Boosts all income. Lv3 auto-collects cash. Lv10 unlocks New Expedition.', effect: l => `All income +${10 * l}%${l >= 3 ? ', auto-collect' : ''}`, w: 5, d: 4, unlockAfter: 'warehouse', gold: l => 8 * l * l },
    quarry: { name: 'Quarry', icon: 'pick', cost: 2500, x: -8, z: -40, rot: 0, up: 1000, mult: 1.75, max: 8, desc: 'Miners dig stone from rocks and bring it to the vault.', effect: l => l === 0 ? 'No miners — hire one!' : `${l} miner${l === 1 ? '' : 's'}`, w: 4, d: 3, zone: 1, worker: 'miner' },
    mine: { name: 'Gold Mine', icon: 'gold', cost: 12000, x: 48, z: 8, rot: 0, up: 5000, mult: 1.8, max: 8, desc: 'Prospectors mine gold ore for the vault.', effect: l => l === 0 ? 'No prospectors — hire one!' : `${l} prospector${l === 1 ? '' : 's'}`, w: 4, d: 3, zone: 2, worker: 'goldminer' }
  },
  workers: {
    lumber: { name: 'Lumberjack', speed: 3.6, cap: 5, hp: 60, parka: 0x59A6E8, tool: 'axe' },
    hunter: { name: 'Hunter', speed: 4.0, cap: 6, hp: 80, parka: 0x8B5A3C, tool: 'spear' },
    guard: { name: 'Guard', speed: 4.4, cap: 0, hp: 160, parka: 0xC0392B, tool: 'spear', helmet: true },
    miner: { name: 'Miner', speed: 3.4, cap: 4, hp: 60, parka: 0x7F8C8D, tool: 'pickaxe' },
    goldminer: { name: 'Prospector', speed: 3.4, cap: 3, hp: 60, parka: 0xD4A017, tool: 'pickaxe' }
  },
  achievements: [
    { id: 'wood100', name: 'Timber!', desc: 'Chop 100 logs', stat: 'wood', n: 100, reward: 200 }, { id: 'wood1k', name: 'Lumber Baron', desc: 'Chop 1,000 logs', stat: 'wood', n: 1000, reward: 2000 }, { id: 'wood10k', name: 'Deforester', desc: 'Chop 10,000 logs', stat: 'wood', n: 10000, reward: 25000 },
    { id: 'bear10', name: 'Bear Hunter', desc: 'Slay 10 bears', stat: 'kills', n: 10, reward: 300 }, { id: 'bear100', name: 'Bear Slayer', desc: 'Slay 100 bears', stat: 'kills', n: 100, reward: 5000 }, { id: 'bear1k', name: 'Apex Predator', desc: 'Slay 1,000 bears', stat: 'kills', n: 1000, reward: 100000 },
    { id: 'night5', name: 'Night Watch', desc: 'Survive 5 nights', stat: 'nights', n: 5, reward: 1000 }, { id: 'night25', name: 'Long Winter', desc: 'Survive 25 nights', stat: 'nights', n: 25, reward: 20000 }, { id: 'night100', name: 'Eternal Frost', desc: 'Survive 100 nights', stat: 'nights', n: 100, reward: 500000 },
    { id: 'earn10k', name: 'First Fortune', desc: 'Earn $10K total', stat: 'earned', n: 10000, reward: 1000 }, { id: 'earn1m', name: 'Millionaire', desc: 'Earn $1M total', stat: 'earned', n: 1e6, reward: 50000 }, { id: 'earn100m', name: 'Frost Tycoon', desc: 'Earn $100M total', stat: 'earned', n: 1e8, reward: 5e6 },
    { id: 'stone100', name: 'Rock Solid', desc: 'Gather 100 stone', stat: 'stone', n: 100, reward: 1500 }, { id: 'gold100', name: 'Gold Rush', desc: 'Gather 100 gold', stat: 'gold', n: 100, reward: 15000 },
    { id: 'king1', name: 'Regicide', desc: 'Defeat the Bear King', stat: 'king', n: 1, reward: 250000 }, { id: 'king5', name: 'Kingslayer', desc: 'Defeat the Bear King 5 times', stat: 'king', n: 5, reward: 2e6 },
    { id: 'prestige1', name: 'New Horizons', desc: 'Begin a New Expedition', stat: 'prestige', n: 1, reward: 50000 }
  ]
};
// quest chain: {id, text, check(G) -> [cur, need], target(G) -> [x,z] or null, reward}
const QUESTS = [
  { id: 'chop', text: 'Chop 5 logs', check: G => [G.stats.wood, 5], target: G => G.nearestTreePos(), reward: 25 },
  { id: 'sell', text: 'Sell wood at the Trading Post', check: G => [G.stats.sold, 1], target: G => G.bpos('post'), reward: 40 },
  { id: 'boots', text: 'Buy Snow Boots at the Trading Post', check: G => [G.upgrades.speed, 1], target: G => G.bpos('post'), reward: 40 },
  { id: 'lumber', text: 'Build the Lumber Camp', check: G => [G.built('lumber') ? 1 : 0, 1], target: G => G.bpos('lumber'), reward: 60 },
  { id: 'bears', text: 'Slay 3 Snow Bears', check: G => [G.stats.kills, 3], target: G => G.nearestBearPos(), reward: 80 },
  { id: 'armory', text: 'Build the Armory', check: G => [G.built('armory') ? 1 : 0, 1], target: G => G.bpos('armory'), reward: 80 },
  { id: 'upgrade', text: 'Buy an upgrade at the Armory', check: G => [G.stats.upgrades, 1], target: G => G.bpos('armory'), reward: 100 },
  { id: 'sawmill', text: 'Build the Sawmill', check: G => [G.built('sawmill') ? 1 : 0, 1], target: G => G.bpos('sawmill'), reward: 150 },
  { id: 'wall', text: 'Build the Palisade', check: G => [G.built('wall') ? 1 : 0, 1], target: G => G.bpos('wall'), reward: 200 },
  { id: 'night', text: 'Survive your first night', check: G => [G.stats.nights, 1], target: G => null, reward: 250 },
  { id: 'tower', text: 'Build a Watchtower', check: G => [G.built('tower') ? 1 : 0, 1], target: G => G.bpos('tower'), reward: 250 },
  { id: 'lumber3', text: 'Upgrade the Lumber Camp to Lv3', check: G => [G.level('lumber'), 3], target: G => G.bpos('lumber'), reward: 300 },
  { id: 'lodge', text: 'Build the Hunting Lodge', check: G => [G.built('lodge') ? 1 : 0, 1], target: G => G.bpos('lodge'), reward: 400 },
  { id: 'butcher', text: 'Build the Smokehouse', check: G => [G.built('butcher') ? 1 : 0, 1], target: G => G.bpos('butcher'), reward: 400 },
  { id: 'zone1', text: 'Unlock the Frozen Forest', check: G => [G.zoneOpen(1) ? 1 : 0, 1], target: G => G.gatePos(1), reward: 500 },
  { id: 'kills25', text: 'Slay 25 bears', check: G => [G.stats.kills, 25], target: G => G.nearestBearPos(), reward: 600 },
  { id: 'quarry', text: 'Build the Quarry in the Frozen Forest', check: G => [G.built('quarry') ? 1 : 0, 1], target: G => G.bpos('quarry'), reward: 800 },
  { id: 'warehouse', text: 'Build the Warehouse', check: G => [G.built('warehouse') ? 1 : 0, 1], target: G => G.bpos('warehouse'), reward: 800 },
  { id: 'wall3', text: 'Upgrade the Palisade to Lv3', check: G => [G.level('wall'), 3], target: G => G.bpos('wall'), reward: 1000 },
  { id: 'hall', text: 'Build the Great Hall', check: G => [G.built('hall') ? 1 : 0, 1], target: G => G.bpos('hall'), reward: 1500 },
  { id: 'nights5', text: 'Survive 5 nights', check: G => [G.stats.nights, 5], target: G => null, reward: 1500 },
  { id: 'barracks', text: 'Build the Barracks', check: G => [G.built('barracks') ? 1 : 0, 1], target: G => G.bpos('barracks'), reward: 2000 },
  { id: 'zone2', text: 'Unlock Stone Ridge', check: G => [G.zoneOpen(2) ? 1 : 0, 1], target: G => G.gatePos(2), reward: 3000 },
  { id: 'mine', text: 'Build the Gold Mine on Stone Ridge', check: G => [G.built('mine') ? 1 : 0, 1], target: G => G.bpos('mine'), reward: 5000 },
  { id: 'towers4', text: 'Build all 4 Watchtowers', check: G => [G.count('tower'), 4], target: G => G.bpos('tower'), reward: 5000 },
  { id: 'hall3', text: 'Upgrade the Great Hall to Lv3', check: G => [G.level('hall'), 3], target: G => G.bpos('hall'), reward: 8000 },
  { id: 'kills150', text: 'Slay 150 bears', check: G => [G.stats.kills, 150], target: G => G.nearestBearPos(), reward: 10000 },
  { id: 'nights12', text: 'Survive 12 nights', check: G => [G.stats.nights, 12], target: G => null, reward: 12000 },
  { id: 'zone3', text: 'Unlock the Glacier', check: G => [G.zoneOpen(3) ? 1 : 0, 1], target: G => G.gatePos(3), reward: 25000 },
  { id: 'armor20', text: 'Slay 20 Armored Bears', check: G => [G.stats.armorKills, 20], target: G => G.nearestBearPos(), reward: 40000 },
  { id: 'hall6', text: 'Upgrade the Great Hall to Lv6', check: G => [G.level('hall'), 6], target: G => G.bpos('hall'), reward: 60000 },
  { id: 'zone4', text: "Unlock the Bear King's Den", check: G => [G.zoneOpen(4) ? 1 : 0, 1], target: G => G.gatePos(4), reward: 100000 },
  { id: 'king', text: 'Defeat the Bear King', check: G => [G.stats.king, 1], target: G => G.bossPos(), reward: 500000 },
  { id: 'hall10', text: 'Upgrade the Great Hall to Lv10', check: G => [G.level('hall'), 10], target: G => G.bpos('hall'), reward: 1000000 },
  { id: 'prestige', text: 'Begin a New Expedition (Great Hall)', check: G => [G.stats.prestige, Math.max(1, G.stats.prestige + (G.stats.prestige >= 1 ? 1 : 0))], target: G => G.bpos('hall'), reward: 0 }
];

// ===== 07_state.js =====
// ---------------------------------------------------------------------------
// Game state, save/load, economy helpers
// ---------------------------------------------------------------------------
const SAVE_KEY = 'bearfall_save_v3';
const G = {
  R: null, canvas: null, time: 0, dt: 0, frame: 0, running: false, paused: false, speedMult: 1,
  money: 0, vault: { stone: 0, gold: 0 },
  stats: { wood: 0, meat: 0, stone: 0, gold: 0, kills: 0, armorKills: 0, king: 0, nights: 0, earned: 0, sold: 0, upgrades: 0, prestige: 0, deaths: 0, trees: 0, builds: 0, playTime: 0 },
  day: 1, dayT: 0.15, // fraction of day (0.15 = early morning)
  zones: [true, false, false, false, false],
  b: {}, // buildings by id
  upgrades: { cap: 0, dmg: 0, atk: 0, speed: 0, hp: 0, chop: 0 },
  questIdx: 0, questPrestigeBase: 0, questCycle: 0, ach: {}, legacy: 0, prestigeCount: 0,
  settings: { sfx: true, music: true, zoom: 1, quality: 2, autoQ: true, saver: false },
  tutorial: {}, offlineRate: 0, incomeLog: [], lastSave: 0, saveDirty: false,
  bears: [], workers: [], loot: [], trees: [], rocks: [], particles: [], projectiles: [], floaters: [], fx: [],
  player: null, boss: null, night: { active: false, raiders: [], wave: 0, warned: false }, walls: { hp: {}, broken: {} },

  // ---- economy helpers
  hallMult() { const h = this.b.hall; return 1 + (h && h.built ? 0.10 * h.level : 0); },
  legacyMult() { return 1 + this.legacy * 0.05; },
  incomeMult() { return this.hallMult() * this.legacyMult(); },
  sellPrice(type, zoneMult = 1) { const p = this.b.post; const postMult = 1 + (p ? (p.level - 1) * 0.08 : 0); return DATA.items[type].price * zoneMult * postMult * this.incomeMult() * this.eventPriceMult(type); },
  addMoney(n, track = true) { n = Math.floor(n); this.money += n; if (track) { this.stats.earned += n; } this.saveDirty = true; },
  spend(n) { if (this.money < n) return false; this.money -= n; this.saveDirty = true; return true; },
  logIncome(n) { const t = this.time; this.incomeLog.push([t, n]); while (this.incomeLog.length && this.incomeLog[0][0] < t - 300) this.incomeLog.shift(); },
  passiveRate() { // $/s from worker deliveries over last 5 minutes
    if (this.incomeLog.length < 2) return 0; const span = Math.max(60, this.time - this.incomeLog[0][0]); let s = 0; for (const e of this.incomeLog) s += e[1]; return s / span;
  },
  playerStat(k) { const u = this.upgrades, d = DATA.player, U = DATA.upgrades; const fire = this.b.fire;
    switch (k) {
      case 'cap': return d.cap + u.cap * U.cap.per;
      case 'dmg': return (d.dmg + u.dmg * U.dmg.per) * (1 + this.legacy * 0.03);
      case 'atk': return d.atkRate * (1 + u.atk * U.atk.per);
      case 'speed': return d.speed * (1 + u.speed * U.speed.per + this.legacy * 0.02);
      case 'hp': return Math.round((d.hp + u.hp * U.hp.per) * (1 + (fire && fire.built ? (fire.level - 1) * 0.04 : 0)));
      case 'chop': return d.chop + u.chop * U.chop.per;
    }
  },
  upgradeCost(k) { const U = DATA.upgrades[k]; return Math.round(U.base * Math.pow(U.mult, this.upgrades[k])); },
  upgradeMax(k) { const U = DATA.upgrades[k]; if (U.gear) return U.max; const a = this.b.armory; const cap = a && a.built ? a.level * 6 : 0; return Math.min(U.max, cap); },
  buildingUpCost(bl) { const d = DATA.buildings[bl.type]; if (bl.level <= 0) return Math.round(d.up * 0.55); return Math.round(d.up * Math.pow(d.mult, bl.level - 1)); },
  built(type) { for (const id in this.b) if (this.b[id].type === type && this.b[id].built) return true; return false; },
  level(type) { let m = 0; for (const id in this.b) if (this.b[id].type === type && this.b[id].built) m = Math.max(m, this.b[id].level); return m; },
  count(type) { let n = 0; for (const id in this.b) if (this.b[id].type === type && this.b[id].built) n++; return n; },
  bpos(type) { let best = null; for (const id in this.b) { const b = this.b[id]; if (b.type === type && b.visible) { if (!b.built) return [b.x, b.z]; best = [b.x, b.z]; } } return best; },
  zoneOpen(i) { return !!this.zones[i]; },
  gatePos(i) { const z = DATA.zones[i]; return z.gate ? [z.gate[0], z.gate[1]] : null; },
  bossPos() { return this.boss && !this.boss.dead ? [this.boss.x, this.boss.z] : [0, -125]; },
  nearestTreePos() { const p = this.player; let best = null, bd = 1e9; for (const t of this.trees) { if (!t.alive || t.zone > 0) continue; const d = dist2(t.x, t.z, p.x, p.z); if (d < bd) { bd = d; best = [t.x, t.z]; } } return best; },
  nearestBearPos() { const p = this.player; let best = null, bd = 1e9; for (const b of this.bears) { if (b.dead || !this.zones[b.zone]) continue; const d = dist2(b.x, b.z, p.x, p.z); if (d < bd) { bd = d; best = [b.x, b.z]; } } return best; },

  // ---- save / load
  serialize() {
    const bl = {}; for (const id in this.b) { const b = this.b[id]; bl[id] = { level: b.level, built: b.built, funded: b.funded, cash: b.cash, queue: b.queue, hp: b.hp, visible: b.visible, mode: b.mode }; }
    return { v: DATA.version, qv: 2, t: Date.now(), money: this.money, vault: this.vault, stats: this.stats, day: this.day, dayT: this.dayT, zones: this.zones, zoneFund: this.zoneFund || {}, b: bl, upgrades: this.upgrades, questIdx: this.questIdx, questPrestigeBase: this.questPrestigeBase, questCycle: this.questCycle, qBase: this.qBase, event: this.event, eventT: this.eventT, nextEventT: this.nextEventT, ach: this.ach, legacy: this.legacy, prestigeCount: this.prestigeCount, settings: this.settings, tutorial: this.tutorial, offlineRate: this.passiveRate(), player: this.player ? { x: this.player.x, z: this.player.z, hp: this.player.hp, carry: this.player.carry.map(c => c.type) } : null, walls: this.walls,
      // the crew and the forest, so a reload carries on where it was instead of everyone walking out from home into a fresh forest
      workers: this.workers.filter(w => !w.dead).map(w => { const t = w.target && (w.target.kind === 'tree' || w.target.kind === 'rock') ? (w.target.kind === 'tree' ? this.trees.indexOf(w.target) : this.rocks.indexOf(w.target)) : -1; return { h: w.homeId, r: w.role, x: +w.x.toFixed(2), z: +w.z.toFixed(2), hp: Math.round(w.hp), s: w.state, c: w.carry.map(it => [it.type, it.mult]), hid: w.hidden ? 1 : 0, t, d: w.deliverTo ? w.deliverTo.id : '' }; }),
      nodes: this.trees.map((t, i) => (!t.alive || t.hp < t.maxHp) ? [i, t.alive ? t.hp : 0, +Math.max(0, t.regrow).toFixed(1)] : null).filter(Boolean),
      rocksState: this.rocks.map((r, i) => (!r.alive || r.hp < r.maxHp) ? [i, r.alive ? r.hp : 0, +Math.max(0, r.regrow).toFixed(1)] : null).filter(Boolean) };
  },
  save() {
    if (!this.running) return; const s = this.serialize(); this.lastSave = this.time; this.saveDirty = false;
    Store.put(s);
  },
  loadRaw() { return Store.readLocal() || Store.mem; },
  applySave(s) {
    if (!s || s.v !== DATA.version) return false;
    this.money = s.money || 0; this.vault = Object.assign({ stone: 0, gold: 0 }, s.vault); Object.assign(this.stats, s.stats); this.day = s.day || 1; this.dayT = s.dayT || 0.25; this.zones = s.zones || this.zones; this.zoneFund = s.zoneFund || {};
    this.upgrades = Object.assign({ cap: 0, dmg: 0, atk: 0, speed: 0, hp: 0, chop: 0 }, s.upgrades); this.questIdx = s.questIdx || 0; if (!s.qv && this.questIdx >= 2) this.questIdx++; this.qBase = s.qBase || null; this.event = s.event || null; this.eventT = s.eventT || 0; this.nextEventT = s.nextEventT || 420; this.questPrestigeBase = s.questPrestigeBase || 0; this.questCycle = s.questCycle || 0; this.ach = s.ach || {}; this.legacy = s.legacy || 0; this.prestigeCount = s.prestigeCount || 0;
    this.settings = Object.assign(this.settings, s.settings); this.tutorial = s.tutorial || {}; this.offlineRate = s.offlineRate || 0; this.savedPlayer = s.player; this.savedBuildings = s.b || {}; this.savedWalls = s.walls; this.savedAt = s.t || Date.now(); this.savedWorkers = s.workers || null; this.savedNodes = s.nodes || null; this.savedRocks = s.rocksState || null;
    return true;
  },
  exportCode() { const s = this.running ? this.serialize() : (Store.mem || Store.readLocal()); return s ? Store.encode(s) : Promise.resolve(''); },
  // returns '' when the code is good (and the save is stored + carried across the reload), else a reason
  async importCode(code) {
    let s; try { s = await Store.decode(code); } catch (e) { return 'That doesn\'t look like a Bearfall save code.'; }
    if (!s || typeof s !== 'object' || s.v === undefined || !s.b) return 'That doesn\'t look like a Bearfall save code.';
    if (s.v !== DATA.version) return 'This code is from a different version of Bearfall.';
    s.t = Date.now(); Store.put(s); Store.pending = s; try { await Store.flushCloud(true); } catch (e) { }
    try { location.hash = '#save=' + encodeURIComponent(await Store.encode(s)); } catch (e) { }
    return '';
  },
  wipe() { Store.clear(); }
};

// ===== 07b_store.js =====
// ---------------------------------------------------------------------------
// Save storage. Every backend that works on this device is used at the same time, and on boot the
// newest copy wins:
//  - memory                          — the last save object (always)
//  - localStorage / IndexedDB / cookie / Cache API — whichever this browser allows
//  - cloud (claude.ai artifact db)   — per-viewer private document, inside claude.ai
//  - URL hash                        — when nothing else works, the save rides in the page's own URL
//  - hot snapshot                    — the viewer hands the running state to a republished version
// A save can also ride across a reload in location.hash (#save=...), which is how Load-a-code works
// even where no storage is available at all.
// ---------------------------------------------------------------------------
const Store = {
  mem: null, hashSave: null, why: {}, ok: { local: false, cookie: false }, resume: false, // idb / cache stay undefined until probed
  cloud: 'off', // 'off' (not in a viewer) | 'wait' (connecting) | 'on' | 'err'
  doc: null, cloudDirty: false, cloudBusy: false, lastCloudWrite: 0, cloudNoticed: false, hashPersist: false,
  init() {
    try { localStorage.setItem('bf_t', '1'); if (localStorage.getItem('bf_t') !== '1') throw new Error('readback'); localStorage.removeItem('bf_t'); this.ok.local = true; } catch (e) { this.ok.local = false; this.why.local = (e && e.name) || 'error'; }
    try { document.cookie = 'bf_t=1; path=/; max-age=60; SameSite=None; Secure'; if (document.cookie.indexOf('bf_t=1') < 0) { document.cookie = 'bf_t=1; path=/; max-age=60'; } this.ok.cookie = document.cookie.indexOf('bf_t=1') >= 0; document.cookie = 'bf_t=; path=/; max-age=0'; if (!this.ok.cookie) this.why.cookie = 'blocked'; } catch (e) { this.ok.cookie = false; this.why.cookie = (e && e.name) || 'error'; }
    try {
      const h = location.hash || '';
      if (h === '#resume') { this.resume = true; this.dropHash(); }
      else if (h.indexOf('#save=') === 0) { this.hashCode = decodeURIComponent(h.slice(6)); this.dropHash(); }        // Load-a-code: start straight away
      else if (h.indexOf('#s=') === 0) { this.hashCode = decodeURIComponent(h.slice(3)); this.hashAuto = true; }        // auto-persisted in the URL: normal title screen
    } catch (e) { }
    try { const hot = window.claude && window.claude.hot; if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => this.mem); this.hot = hot || null; } catch (e) { }
    // the Claude app's artifact panel: an about:srcdoc frame with the old flat runtime. Its storage works while the game is open but is thrown away afterwards.
    try { this.ephemeral = location.protocol === 'about:' || (!!window.claude && typeof window.claude.use !== 'function' && window.top !== window); } catch (e) { this.ephemeral = false; }
    try { this.noSeed = localStorage.getItem('bf_noseed') || ''; } catch (e) { this.noSeed = ''; }
  },
  dropHash() { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { try { location.hash = ''; } catch (x) { } } },
  anyDevice() { return this.ok.local || this.ok.idb || this.ok.cookie || this.ok.cache; },
  status() {
    if (this.cloud === 'on') return { icon: '☁︎', text: 'Progress syncs to your Claude account — play on any device.', cls: 'good' };
    if (this.cloud === 'wait') return { icon: '…', text: 'Connecting to cloud save…', cls: '' };
    if (this.ephemeral) return { icon: '⚠', text: 'The Claude app forgets the game when you leave it. Copy a save code (Settings) before you go — or open Bearfall in Safari for automatic saving.', cls: 'warn' };
    if (this.anyDevice()) return { icon: '✓', text: 'Progress is saved on this device.', cls: '' };
    if (this.hashPersist) return { icon: '⚠', text: 'Saving into this page\'s address only — copy a save code (Settings) before you leave!', cls: 'warn' };
    return { icon: '⚠', text: 'This browser can\'t keep saves. Copy a save code (Settings) before you leave!', cls: 'warn' };
  },
  diagnostics() {
    const c = window.claude; const keys = c ? Object.keys(c).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(c) || {})).filter((k, i, a) => a.indexOf(k) === i && k !== 'constructor').join(',') : 'none';
    const line = (k) => this.ok[k] ? 'ok' : 'no' + (this.why[k] ? ' (' + this.why[k] + ')' : '');
    return [`v${DATA.version} · local ${line('local')} · idb ${line('idb')} · cookie ${line('cookie')} · cache ${line('cache')}${this.ephemeral ? ' · app panel (forgets on leave)' : ''}${typeof SEED_SAVE === 'string' && SEED_SAVE ? ' · seed' : ''} · loaded from ${this.src || 'nothing'}`, `cloud ${this.cloud}${this.why.cloud ? ' (' + this.why.cloud + ')' : ''} · runtime ${keys}${this.hot ? ' · hot' : ''}`, `framed ${window.top !== window ? 'yes' : 'no'} · ${location.protocol}//${location.host}${location.pathname.slice(0, 24)} · ${navigator.userAgent.replace(/Mozilla\/5\.0 /, '').slice(0, 90)}`];
  },
  // ---- localStorage
  readLocal() { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  writeLocal(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; } },
  clearLocal() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } },
  // ---- IndexedDB
  idbOpen() {
    if (this._idb) return this._idb;
    this._idb = new Promise((res, rej) => { try { const r = indexedDB.open('bearfall', 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || new Error('idb')); r.onblocked = () => rej(new Error('blocked')); } catch (e) { rej(e); } });
    return this._idb;
  },
  async readIdb() { try { const db = await this.idbOpen(); return await new Promise((res, rej) => { const tx = db.transaction('kv', 'readonly'); const r = tx.objectStore('kv').get(SAVE_KEY); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); } catch (e) { this.why.idb = (e && e.name) || 'error'; return null; } },
  async writeIdb(s) { try { const db = await this.idbOpen(); await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(s, SAVE_KEY); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); this.ok.idb = true; return true; } catch (e) { this.ok.idb = false; this.why.idb = (e && e.name) || 'error'; return false; } },
  async clearIdb() { try { const db = await this.idbOpen(); await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(SAVE_KEY); tx.oncomplete = () => res(); tx.onerror = () => res(); }); } catch (e) { } },
  // ---- cookie (the compressed code, split into 3 KB chunks)
  readCookie() { try { const m = {}; for (const part of document.cookie.split(';')) { const i = part.indexOf('='); if (i < 0) continue; m[part.slice(0, i).trim()] = part.slice(i + 1); } if (!m.bf_n) return null; let code = ''; for (let i = 0; i < +m.bf_n; i++) code += m['bf_s' + i] || ''; return code ? this.decodeSync(code) : null; } catch (e) { return null; } },
  writeCookie(s) { try { const code = this.encodeSync(s); const n = Math.ceil(code.length / 3000); if (n > 8) return false; const attrs = '; path=/; max-age=31536000'; const secure = location.protocol === 'https:' ? '; SameSite=None; Secure' : ''; for (let i = 0; i < n; i++) document.cookie = 'bf_s' + i + '=' + code.slice(i * 3000, (i + 1) * 3000) + attrs + secure; document.cookie = 'bf_n=' + n + attrs + secure; for (let i = n; i < 8; i++) document.cookie = 'bf_s' + i + '=; path=/; max-age=0'; return document.cookie.indexOf('bf_n=') >= 0; } catch (e) { return false; } },
  clearCookie() { try { for (let i = 0; i < 8; i++) document.cookie = 'bf_s' + i + '=; path=/; max-age=0'; document.cookie = 'bf_n=; path=/; max-age=0'; } catch (e) { } },
  // ---- Cache API
  async readCache() { try { const c = await caches.open('bearfall'); const r = await c.match('/bearfall-save'); if (!r) return null; return await r.json(); } catch (e) { this.why.cache = (e && e.name) || 'error'; return null; } },
  async writeCache(s) { try { const c = await caches.open('bearfall'); await c.put('/bearfall-save', new Response(JSON.stringify(s), { headers: { 'content-type': 'application/json' } })); this.ok.cache = true; return true; } catch (e) { this.ok.cache = false; this.why.cache = (e && e.name) || 'error'; return false; } },
  async clearCache() { try { const c = await caches.open('bearfall'); await c.delete('/bearfall-save'); } catch (e) { } },
  // ---- URL hash (last resort: the page's own address remembers the game, e.g. when a browser reloads the tab)
  writeHash(s) { try { const code = this.encodeSync(s); history.replaceState(null, '', location.pathname + location.search + '#s=' + encodeURIComponent(code)); this.hashPersist = true; return true; } catch (e) { return false; } },
  // ---- read everything this device has; resolves with the newest save (or null)
  async readDevice() {
    const cands = []; const push = (s, src) => { if (s && s.v !== undefined) { s._src = src; cands.push(s); } };
    push(this.readLocal(), 'local'); push(this.readCookie(), 'cookie'); if (this.ok.cookie === false && this.readCookie()) this.ok.cookie = true;
    if (this.hashCode) { try { push(await this.decode(this.hashCode), 'hash'); } catch (e) { } }
    if (typeof SEED_SAVE === 'string' && SEED_SAVE && this.noSeed !== SEED_SAVE.slice(-24)) { try { const sd = await this.decode(SEED_SAVE); if (sd) { sd.seed = true; push(sd, 'seed'); } } catch (e) { } }
    const wait = (p) => Promise.race([p, new Promise(r => setTimeout(() => r(null), 2500))]);
    const [i, c] = await Promise.all([wait(this.readIdb()), wait(this.readCache())]); push(i, 'idb'); push(c, 'cache');
    // probe the async backends so status() and the diagnostics know about them
    if (!this.ok.idb) { try { const d = await wait(this.idbOpen()); this.ok.idb = !!d; if (!d) this.why.idb = 'timeout'; } catch (e) { this.ok.idb = false; this.why.idb = (e && e.name) || 'error'; } }
    if (!this.ok.cache) { try { if (typeof caches === 'undefined') throw new Error('unsupported'); const c = await wait(caches.open('bearfall')); this.ok.cache = !!c; if (!c) this.why.cache = 'timeout'; } catch (e) { this.ok.cache = false; this.why.cache = (e && e.name) || e.message || 'error'; } }
    cands.sort((a, b) => (b.t || 0) - (a.t || 0)); const best = cands[0] || null; if (best) { this.src = best._src; delete best._src; } for (const s of cands) delete s._src;
    return best;
  },
  // ---- cloud (claude.ai artifact runtime). Resolves with the cloud save (or null) within ~12 s.
  async connectCloud() {
    const claude = window.claude; if (!claude || typeof claude.use !== 'function') { this.cloud = 'off'; this.why.cloud = claude ? 'runtime has no use()' : 'no runtime'; return null; }
    this.cloud = 'wait';
    const attempt = (async () => {
      const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
      if (!db) return { none: true, why: 'db not available here' }; if (!user) return { none: true, why: 'user not available here' };
      const uid = await user.id(); if (!uid) return { none: true, why: 'no viewer identity (signed out?)' };
      const doc = db.doc('data/users/' + uid + '/save'); const snap = await doc.get();
      return { doc, save: snap.exists ? snap.data() : null };
    })();
    const timeout = new Promise(r => setTimeout(() => r('timeout'), 12000));
    let r; try { r = await Promise.race([attempt, timeout]); } catch (e) { r = { err: e }; }
    if (r === 'timeout') { // keep listening: if the cloud answers late (e.g. a permission prompt), the game decides what to do with its save
      attempt.then(x => { if (x && x.doc) { this.doc = x.doc; this.cloud = 'on'; this.why.cloud = ''; if (this.onLateCloud) this.onLateCloud(x.save && x.save.v ? x.save : null); else this.cloudDirty = true; } else { this.cloud = 'off'; this.why.cloud = (x && x.why) || 'unavailable'; } }, (e) => { this.cloud = 'err'; this.why.cloud = (e && (e.code || e.name)) || 'error'; });
      this.cloud = 'off'; this.why.cloud = 'no answer yet'; return null;
    }
    if (!r || r.none) { this.cloud = 'off'; this.why.cloud = (r && r.why) || 'unavailable'; return null; }
    if (r.err) { this.cloud = 'err'; this.why.cloud = (r.err && (r.err.code || r.err.name || r.err.message)) || 'error'; return null; }
    this.doc = r.doc; this.cloud = 'on'; this.why.cloud = ''; return r.save && r.save.v ? r.save : null;
  },
  // write to the cloud now (one write at a time; errors disable the cloud for this session, except transient ones)
  async flushCloud(force) {
    if (this.cloud !== 'on' || !this.doc || !this.mem || this.cloudBusy) return; if (!this.cloudDirty && !force) return;
    const now = Date.now(); if (!force && now - this.lastCloudWrite < 20000) return;
    this.cloudBusy = true; const s = this.mem; this.cloudDirty = false;
    try { await this.doc.set(JSON.parse(JSON.stringify(s))); this.lastCloudWrite = Date.now(); }
    catch (e) { const code = e && e.code; if (code === 'unavailable' || code === 'resource_exhausted') { this.cloudDirty = true; this.lastCloudWrite = Date.now(); } else { this.cloud = 'err'; this.why.cloud = 'write: ' + (code || (e && e.message) || 'error'); if (!this.cloudNoticed) { this.cloudNoticed = true; try { UI.toast('Cloud save unavailable — progress is kept on this device.', 'warn'); } catch (x) { } } } }
    finally { this.cloudBusy = false; }
  },
  async clearCloud() { if (this.cloud !== 'on' || !this.doc) return; try { await this.doc.delete(); } catch (e) { } },
  // ---- the save itself: write to every backend that works
  put(s) {
    this.mem = s; this.cloudDirty = true; this.n = (this.n || 0) + 1;
    if (this.ok.local) this.ok.local = this.writeLocal(s);
    if (this.ok.cookie) this.ok.cookie = this.writeCookie(s);
    if (this.ok.idb || this.ok.idb === undefined) this.writeIdb(s);
    if (this.ok.cache || this.ok.cache === undefined) this.writeCache(s);
    if (!this.anyDevice() && this.cloud !== 'on') this.writeHash(s);
  },
  clear() { this.mem = null; this.clearLocal(); this.clearCookie(); this.clearIdb(); this.clearCache(); this.clearCloud(); if (this.hashPersist) this.dropHash(); try { if (typeof SEED_SAVE === 'string' && SEED_SAVE) { this.noSeed = SEED_SAVE.slice(-24); localStorage.setItem('bf_noseed', this.noSeed); } } catch (e) { } },
  // ---- save codes: "BF2." + base64(deflate(JSON)) when the browser can compress, else plain base64(JSON) (v1 codes)
  encodeSync(s) { return btoa(unescape(encodeURIComponent(JSON.stringify(s)))); },
  decodeSync(code) { return JSON.parse(decodeURIComponent(escape(atob(code)))); },
  async encode(s) {
    const json = JSON.stringify(s); const plain = btoa(unescape(encodeURIComponent(json)));
    try { if (typeof CompressionStream === 'function') { const cs = new CompressionStream('deflate-raw'); const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(json)); w.close(); const buf = await new Response(cs.readable).arrayBuffer(); const bytes = new Uint8Array(buf); let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); const z = 'BF2.' + btoa(bin); if (z.length < plain.length) return z; } } catch (e) { }
    return plain;
  },
  async decode(code) {
    code = (code || '').replace(/\s+/g, ''); if (!code) return null;
    if (code.indexOf('BF2.') === 0) { if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot read compressed codes'); const bin = atob(code.slice(4)); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(bytes); w.close(); const json = await new Response(ds.readable).text(); return JSON.parse(json); }
    return this.decodeSync(code);
  }
};

// ===== 07c_seed.js =====
// Seed save: baked-in save code, used when no newer save exists (see README). Set with: python3 seed.py "<code>"
const SEED_SAVE = '';

// ===== 08_world.js =====
// ---------------------------------------------------------------------------
// World: ground, zones, fences, trees, rocks, decor, collision & routing
// ---------------------------------------------------------------------------
const WORLD = { x0: -116, x1: 116, z0: -164, z1: 46 };
Object.assign(G, {
  blockers: [], decor: [], grid: new Map(), gridSize: 4, gates: [], fenceInst: [], mounds: [],
  buildWorld() {
    const R = this.R; const rng = mulberry(1337);
    // ---- ground
    const g = new Geo(); g.jitter = 0.035;
    const zoneOfXZ = (x, z) => this.zoneOf(x, z);
    const tint = [C.snow, [0.93, 0.96, 1.0], [0.95, 0.95, 0.94], [0.9, 0.96, 1.0], [0.94, 0.93, 0.95]];
    for (let x = WORLD.x0; x < WORLD.x1; x += 4) for (let z = WORLD.z0; z < WORLD.z1; z += 4) { const zi = zoneOfXZ(x + 2, z + 2); g.ground(4, 4, tint[zi < 0 ? 0 : zi], x + 2, 0, z + 2); }
    this.groundMesh = R.createMesh(g.pack(), true); this.groundMesh.castShadow = false; R.draw(this.groundMesh, M4.create());
    const B = DATA.base; const d = new Geo(); d.jitter = 0.03;
    for (let x = B.x0; x < B.x1; x += 2) for (let z = B.z0; z < B.z1; z += 2) d.ground(2, 2, C.dirt, x + 1, 0.012, z + 1);
    // paths from gates
    for (let z = B.z0 - 20; z < B.z0; z += 2) d.ground(3, 2, C.path, 0, 0.011, z + 1); for (let x = B.x1; x < B.x1 + 22; x += 2) d.ground(2, 3, C.path, x + 1, 0.011, 1); for (let x = B.x0 - 22; x < B.x0; x += 2) d.ground(2, 3, C.path, x + 1, 0.011, 1);
    for (let z = -92; z < -32; z += 2) d.ground(3, 2, C.path, 0, 0.011, z + 1);
    // dirt patches for zone buildings
    for (const k of ['quarry', 'mine']) { const bd = DATA.buildings[k]; for (let x = -4; x < 4; x += 2) for (let z = -3; z < 3; z += 2) d.ground(2, 2, C.dirt, bd.x + x + 1, 0.012, bd.z + z + 1); }
    this.dirtMesh = R.createMesh(d.pack(), true); this.dirtMesh.castShadow = false; R.draw(this.dirtMesh, M4.create());
    // ---- fences between zones (+ gates)
    const fences = [];
    const addFence = (x0, z0, x1, z1) => fences.push([x0, z0, x1, z1]);
    // zone 0 outer: north z=-32 (gap at x in [-2.5,2.5]), east x=38 (gap z in [-1.5,3.5]), west x=-38
    addFence(-38, -32, -2.5, -32); addFence(2.5, -32, 38, -32); addFence(38, -32, 38, -1.5); addFence(38, 3.5, 38, 38); addFence(-38, -32, -38, -1.5); addFence(-38, 3.5, -38, 38);
    // zone 1: sides x=±40 from -92..-32 ; north z=-92 with gap
    addFence(-38, -92, -38, -32); addFence(38, -92, 38, -32); addFence(-38, -92, -2.5, -92); addFence(2.5, -92, 38, -92);
    // zone 2/3 north edges z=-32 continuing to world edge
    addFence(38, -32, 112, -32); addFence(-112, -32, -38, -32);
    for (const f of fences) this.addFenceLine(f[0], f[1], f[2], f[3]);
    // zone gates
    for (let i = 1; i < DATA.zones.length; i++) { const z = DATA.zones[i]; const horiz = z.gateDir === 'n'; const gx = z.gate[0], gz = z.gate[1];
      const gate = { zone: i, x: gx, z: gz, horiz, open: 0, rect: horiz ? { x0: gx - 2.5, x1: gx + 2.5, z0: gz - 0.4, z1: gz + 0.4, kind: 'zonegate', zone: i } : { x0: gx - 0.4, x1: gx + 0.4, z0: gz - 2.5, z1: gz + 2.5, kind: 'zonegate', zone: i } };
      this.gates.push(gate); this.blockers.push(gate.rect);
    }
    // world bounds
    this.blockers.push({ x0: WORLD.x0 - 5, x1: WORLD.x0, z0: WORLD.z0 - 5, z1: WORLD.z1 + 5, kind: 'bound' }, { x0: WORLD.x1, x1: WORLD.x1 + 5, z0: WORLD.z0 - 5, z1: WORLD.z1 + 5, kind: 'bound' }, { x0: WORLD.x0 - 5, x1: WORLD.x1 + 5, z0: WORLD.z0 - 5, z1: WORLD.z0, kind: 'bound' }, { x0: WORLD.x0 - 5, x1: WORLD.x1 + 5, z0: WORLD.z1, z1: WORLD.z1 + 5, kind: 'bound' });
    // ---- trees, rocks, decor per zone
    DATA.zones.forEach((zd, zi) => {
      const [x0, x1, z0, z1] = zd.bounds; const inBase = (x, z) => x > B.x0 - 3 && x < B.x1 + 3 && z > B.z0 - 3 && z < B.z1 + 3;
      const onPath = (x, z) => (Math.abs(x) < 3.5 && z < B.z0 && z > -100) || (Math.abs(z - 1) < 3.5 && (x > B.x1 || x < B.x0) && Math.abs(x) < 60);
      const nearBld = (x, z) => { for (const k in DATA.buildings) { const bd = DATA.buildings[k]; if (bd.zone === zi && dist2(x, z, bd.x, bd.z) < 36) return true; } return false; };
      const nearGate = (x, z) => this.gates.some(gt => dist2(x, z, gt.x, gt.z) < 40) || dist2(x, z, 0, -11) < 30 || dist2(x, z, 15, 1) < 30 || dist2(x, z, -15, 1) < 30;
      const free = (x, z, r) => { if (inBase(x, z) || onPath(x, z) || nearBld(x, z) || nearGate(x, z)) return false; if (zi === 4 && dist2(x, z, 0, -128) < 14 * 14) return false; for (const t of this.gridNear(x, z, r + 2)) if (dist2(x, z, t.x, t.z) < (r + t.r) * (r + t.r)) return false; return true; };
      const place = (n, r, fn) => { let tries = 0; for (let i = 0; i < n && tries < n * 40; tries++) { const x = x0 + 2 + rng() * (x1 - x0 - 4), z = z0 + 2 + rng() * (z1 - z0 - 4); if (!free(x, z, r)) continue; fn(x, z); i++; } };
      place(zd.trees, 1.0, (x, z) => { const t = { kind: 'tree', x, z, r: 0.5, v: zd.tree === 0 ? (rng() < 0.3 ? 1 : 0) : zd.tree, zone: zi, hp: 3, maxHp: 3, alive: true, regrow: 0, shake: 0, fall: 0, rot: rng() * TAU, s: 0.85 + rng() * 0.35, mult: zd.mult }; this.trees.push(t); this.gridAdd(t); });
      for (const kind in zd.rocks) place(zd.rocks[kind], 1.6, (x, z) => { const rk = { kind: 'rock', x, z, r: 1.3, type: kind, zone: zi, hp: 8, maxHp: 8, alive: true, regrow: 0, shake: 0, rot: rng() * TAU, s: 0.9 + rng() * 0.3, mult: zd.mult }; this.rocks.push(rk); this.gridAdd(rk); });
      const dec = (n, r, mesh, sy) => place(n, r, (x, z) => { const dd = { kind: 'decor', x, z, r, mesh, rot: rng() * TAU, s: 0.7 + rng() * 0.6, sy: sy || 1 }; this.decor.push(dd); if (r > 0.6) this.gridAdd(dd); });
      dec(zd.mounds || 0, 0.0, 'mound', 1); dec(zd.boulders || 0, 1.4, 'boulder', 1); dec(zd.crystals || 0, 0.7, 'crystal', 1); dec(zd.deadTrees || 0, 0.5, 'deadTree', 1); dec(zd.bones || 0, 0.0, 'bones', 1);
    });
    // dense tree border along world edges (decorative, not choppable)
    for (let x = WORLD.x0; x < WORLD.x1; x += 3.2) for (const zz of [WORLD.z0 + 2, WORLD.z1 - 2]) this.decor.push({ kind: 'decor', x: x + rng() * 2, z: zz + rng() * 2 - 1, r: 0, mesh: 'tree', v: 0, rot: rng() * TAU, s: 0.9 + rng() * 0.4 });
    for (let z = WORLD.z0; z < WORLD.z1; z += 3.2) for (const xx of [WORLD.x0 + 2, WORLD.x1 - 2]) this.decor.push({ kind: 'decor', x: xx + rng() * 2 - 1, z: z + rng() * 2, r: 0, mesh: 'tree', v: 0, rot: rng() * TAU, s: 0.9 + rng() * 0.4 });
    // snowflakes
    this.flakes = []; for (let i = 0; i < 160; i++) this.flakes.push({ x: rand(-20, 20), y: rand(0, 18), z: rand(-20, 20), vx: rand(-0.4, 0.4), vy: rand(-2.2, -1.2), ph: rand(0, TAU) });
  },
  addFenceLine(x0, z0, x1, z1) {
    const horiz = Math.abs(z1 - z0) < 0.01; const len = horiz ? x1 - x0 : z1 - z0; const n = Math.round(len / 2);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; this.fenceInst.push({ x: x0 + (horiz ? len * t : 0), z: z0 + (horiz ? 0 : len * t), rot: horiz ? 0 : HPI }); }
    this.blockers.push(horiz ? { x0, x1, z0: z0 - 0.35, z1: z0 + 0.35, kind: 'fence' } : { x0: x0 - 0.35, x1: x0 + 0.35, z0, z1, kind: 'fence' });
  },
  // zones are separated by the fence lines: z=-32 (north of camp), x=±38 (east/west), z=-92 (den)
  zoneOf(x, z) { if (Math.abs(x) <= 38) { if (z < -92) return 4; if (z < -32) return 1; return 0; } return x > 38 ? 2 : 3; },
  inBase(x, z, pad = 0) { const B = DATA.base; return x > B.x0 - pad && x < B.x1 + pad && z > B.z0 - pad && z < B.z1 + pad; },
  gridKey(x, z) { return ((x + 200) / this.gridSize | 0) * 1000 + ((z + 200) / this.gridSize | 0); },
  gridAdd(o) { const k = this.gridKey(o.x, o.z); let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); } a.push(o); },
  gridNear(x, z, r) { const out = []; const s = this.gridSize; const c0 = ((x - r + 200) / s | 0), c1 = ((x + r + 200) / s | 0), r0 = ((z - r + 200) / s | 0), r1 = ((z + r + 200) / s | 0); for (let cx = c0; cx <= c1; cx++) for (let cz = r0; cz <= r1; cz++) { const a = this.grid.get(cx * 1000 + cz); if (a) for (const o of a) out.push(o); } return out; },
  // circle vs static world. ent: {x,z}. returns true if blocked by a wall/gate (for raiders)
  collide(ent, r, opts = {}) {
    let hitWall = null;
    // trees / rocks / decor (circles)
    for (const o of this.gridNear(ent.x, ent.z, r + 1.5)) {
      if (o.kind === 'tree' && (!o.alive || o.fall > 0)) continue; if (o.kind === 'rock' && !o.alive) continue; if (!o.r) continue;
      const dx = ent.x - o.x, dz = ent.z - o.z; const rr = r + o.r; const d2 = dx * dx + dz * dz; if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); ent.x = o.x + dx / d * rr; ent.z = o.z + dz / d * rr; }
    }
    // rects
    for (const b of this.blockers) {
      if (b.kind === 'zonegate' && this.zones[b.zone]) continue;
      if (b.kind === 'gate' && (!opts.bear || b.broken)) continue;
      if (b.kind === 'wall' && b.broken) continue;
      if (b.kind === 'building' && opts.ignoreBuildings) continue;
      if (b.kind === 'bound' && opts.ignoreBounds) continue;
      const cx = clamp(ent.x, b.x0, b.x1), cz = clamp(ent.z, b.z0, b.z1); const dx = ent.x - cx, dz = ent.z - cz; const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-6) { const d = Math.sqrt(d2); ent.x = cx + dx / d * r; ent.z = cz + dz / d * r; }
        else { // inside: push out along the smallest axis
          const l = ent.x - b.x0, rr = b.x1 - ent.x, t = ent.z - b.z0, bo = b.z1 - ent.z; const m = Math.min(l, rr, t, bo);
          if (m === l) ent.x = b.x0 - r; else if (m === rr) ent.x = b.x1 + r; else if (m === t) ent.z = b.z0 - r; else ent.z = b.z1 + r;
        }
        if (b.kind === 'wall' || b.kind === 'gate') hitWall = b;
      }
    }
    return hitWall;
  },
  // routing through gates: returns [x,z] next waypoint toward target
  routeTo(ent, tx, tz) {
    const B = DATA.base; const inB = this.inBase(ent.x, ent.z), tIn = this.inBase(tx, tz); const za = this.zoneOf(ent.x, ent.z), zb = this.zoneOf(tx, tz);
    const baseGate = () => {
      let best = null, bk = null, bd = 1e9; const costs = {}; for (const k in B.gates) { const gp = B.gates[k]; const d = Math.sqrt(dist2(ent.x, ent.z, gp[0], gp[1])) + Math.sqrt(dist2(gp[0], gp[1], tx, tz)); costs[k] = d; if (d < bd) { bd = d; best = gp; bk = k; } }
      // hysteresis: keep the previously chosen gate unless another is clearly shorter
      if (ent.gateKey && costs[ent.gateKey] !== undefined && costs[ent.gateKey] <= bd + 8) { bk = ent.gateKey; best = B.gates[bk]; } ent.gateKey = bk;
      const inOff = bk === 'n' ? [0, 2.5] : bk === 'e' ? [-2.5, 0] : [2.5, 0];
      const aligned = bk === 'n' ? Math.abs(ent.x - best[0]) < 1.6 : Math.abs(ent.z - best[1]) < 1.4;
      const nearSide = inB ? [best[0] + inOff[0], best[1] + inOff[1]] : [best[0] - inOff[0], best[1] - inOff[1]];
      const farSide = inB ? [best[0] - inOff[0], best[1] - inOff[1]] : [best[0] + inOff[0], best[1] + inOff[1]];
      return aligned ? farSide : nearSide;
    };
    if (inB && !tIn && this.built('wall')) return baseGate();
    if (za === zb && !inB && tIn && this.built('wall')) { const g = baseGate(); if (this.inBase(g[0], g[1])) return g; const around = this.routeAroundBase(ent, g[0], g[1]); return around || g; }
    let wp = [tx, tz];
    if (za !== zb) { // zone graph: 0-1, 0-2, 0-3, 1-4 ; each gate belongs to the child zone
      const parent = { 1: 0, 2: 0, 3: 0, 4: 1 }; const pathUp = (z) => { const p = [z]; while (z !== 0) { z = parent[z]; p.push(z); } return p; };
      const pa = pathUp(za), pb = pathUp(zb); let gzone, down;
      if (pb.includes(za)) { gzone = pb[pb.indexOf(za) - 1]; down = true; } else { gzone = za; down = false; }
      const gz = DATA.zones[gzone]; const gp = gz.gate; const dir = gz.gateDir; const childOff = dir === 'n' ? [0, -3] : dir === 'e' ? [3, 0] : [-3, 0];
      const cside = [gp[0] + childOff[0], gp[1] + childOff[1]], pside = [gp[0] - childOff[0], gp[1] - childOff[1]];
      const aligned = dir === 'n' ? Math.abs(ent.x - gp[0]) < 1.6 : Math.abs(ent.z - gp[1]) < 1.6;
      const nearSide = down ? pside : cside, farSide = down ? cside : pside;
      wp = aligned ? farSide : nearSide;
    }
    // never cut through the walled camp: route around its corners
    if (!inB && !this.inBase(wp[0], wp[1]) && this.built('wall')) { const around = this.routeAroundBase(ent, wp[0], wp[1]); if (around) return around; }
    return wp;
  },
  // Liang-Barsky segment vs axis-aligned rect
  segHitsRect(x0, z0, x1, z1, r) {
    let t0 = 0, t1 = 1; const dx = x1 - x0, dz = z1 - z0;
    const clip = (p, q) => { if (p === 0) return q >= 0; const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
    return clip(-dx, x0 - r.x0) && clip(dx, r.x1 - x0) && clip(-dz, z0 - r.z0) && clip(dz, r.z1 - z0);
  },
  // waypoint around the camp rectangle (for entities outside it), or null when the straight line is clear
  routeAroundBase(ent, tx, tz) {
    const B = DATA.base; const m = 1.6, mc = 2.6;
    const R = { x0: B.x0 - m, x1: B.x1 + m, z0: B.z0 - m, z1: B.z1 + m };
    if (!this.segHitsRect(ent.x, ent.z, tx, tz, R)) return null;
    const corners = [[B.x0 - mc, B.z0 - mc], [B.x1 + mc, B.z0 - mc], [B.x0 - mc, B.z1 + mc], [B.x1 + mc, B.z1 + mc]];
    // keep the corner chosen last time while it is still valid (prevents ping-pong between two corners)
    const valid = (i) => { const c = corners[i]; return dist2(ent.x, ent.z, c[0], c[1]) > 2.0 * 2.0 && !this.segHitsRect(ent.x, ent.z, c[0], c[1], R); };
    if (ent.cornerIdx !== undefined && ent.cornerTx === tx && ent.cornerTz === tz && valid(ent.cornerIdx)) return corners[ent.cornerIdx];
    let best = -1, bd = 1e9;
    for (let i = 0; i < 4; i++) { const c = corners[i]; if (!valid(i)) continue; const d = Math.sqrt(dist2(ent.x, ent.z, c[0], c[1])) + Math.sqrt(dist2(c[0], c[1], tx, tz)); if (d < bd) { bd = d; best = i; } }
    if (best < 0) { let nd = 1e9; for (let i = 0; i < 4; i++) { const c = corners[i]; const d = dist2(ent.x, ent.z, c[0], c[1]); if (d > 2.0 * 2.0 && d < nd) { nd = d; best = i; } } }
    if (best < 0) return null;
    ent.cornerIdx = best; ent.cornerTx = tx; ent.cornerTz = tz; return corners[best];
  },
  // local steering: if the next step runs into a building/fence rect, slide along it toward the target side
  steerAround(ent, mx, mz, tx, tz, r) {
    const px = ent.x + mx * 1.2, pz = ent.z + mz * 1.2; const e = r + 0.3;
    for (const b of this.blockers) {
      if (b.kind === 'gate' || b.kind === 'bound') continue; if (b.kind === 'zonegate' && this.zones[b.zone]) continue; if (b.kind === 'wall' && b.broken) continue;
      if (px > b.x0 - e && px < b.x1 + e && pz > b.z0 - e && pz < b.z1 + e) {
        const p1 = [-mz, mx], p2 = [mz, -mx];
        if (!(ent.steerT > 0)) { const s1 = dist2(ent.x + p1[0] * 4, ent.z + p1[1] * 4, tx, tz), s2 = dist2(ent.x + p2[0] * 4, ent.z + p2[1] * 4, tx, tz); ent.steerSide = s1 <= s2 ? 1 : -1; ent.steerT = 0.8; }
        const p = ent.steerSide === 1 ? p1 : p2; let nx = p[0] * 0.92 + mx * 0.2, nz = p[1] * 0.92 + mz * 0.2; const l = Math.hypot(nx, nz) || 1; return [nx / l, nz / l];
      }
    }
    return null;
  },
  // restore chopped / regrowing trees and rocks from a save (indices are stable: the world is generated from a fixed seed)
  applyNodeStates() {
    const apply = (list, saved) => { if (!saved) return; for (const e of saved) { const n = list[e[0]]; if (!n) continue; if (e[1] <= 0) { n.alive = false; n.hp = 0; n.fall = 0; n.regrow = e[2] > 0 ? e[2] : 5; } else { n.alive = true; n.hp = Math.min(n.maxHp, e[1]); } } };
    apply(this.trees, this.savedNodes); apply(this.rocks, this.savedRocks); this.savedNodes = null; this.savedRocks = null; this.navInvalidate(); if (NAV.trees) this.navBuildTrees();
  },
  // ---- per-frame world updates: trees regrow, gates animate, flakes
  updateWorld(dt) {
    for (const t of this.trees) { if (!t.alive) { t.regrow -= dt; if (t.regrow <= 0) { t.alive = true; t.hp = t.maxHp; t.pop = 1; this.navMarkCircle(t.x, t.z, t.r + 0.45, 1); } } if (t.shake > 0) t.shake -= dt * 4; if (t.fall > 0) { t.fall += dt * 1.4; if (t.fall > 2.2) { t.fall = 0; } } if (t.pop > 0) t.pop -= dt * 2; }
    for (const rk of this.rocks) { if (!rk.alive) { rk.regrow -= dt; if (rk.regrow <= 0) { rk.alive = true; rk.hp = rk.maxHp; rk.pop = 1; this.navMarkCircle(rk.x, rk.z, rk.r + 0.45, 1); } } if (rk.shake > 0) rk.shake -= dt * 4; if (rk.pop > 0) rk.pop -= dt * 2; }
    for (const gt of this.gates) { const want = this.zones[gt.zone] ? 1 : 0; gt.open += (want - gt.open) * Math.min(1, dt * 3); }
    const c = this.R.camTarget; const wind = this.event === 'blizzard' ? 4 : 0; for (const f of this.flakes) { f.x += (f.vx + wind) * dt + Math.sin(this.time * 1.3 + f.ph) * dt * 0.6; f.y += f.vy * (1 + wind * 0.3) * dt; f.z += 0.2 * dt; if (f.y < 0) { f.y = 18; f.x = c[0] + rand(-20, 20); f.z = c[2] + rand(-22, 14); } if (Math.abs(f.x - c[0]) > 24 || Math.abs(f.z - c[2]) > 24) { f.x = c[0] + rand(-20, 20); f.z = c[2] + rand(-22, 14); } }
  },
  drawWorld() {
    const R = this.R; const m = M4.create(); const c = R.camTarget; const cull = 62 * 62;
    const treeMeshes = [Models.tree(0), Models.tree(1), Models.tree(2), Models.tree(3), Models.tree(4)]; const stump = Models.stump();
    for (const t of this.trees) {
      if (dist2(t.x, t.z, c[0], c[2]) > cull) continue;
      if (t.alive) { const sh = t.shake > 0 ? Math.sin(this.time * 40) * 0.05 * t.shake : 0; const pop = t.pop > 0 ? 1 - easeOut(t.pop) * 0.9 : 1; const sq = 1 + (t.shake > 0 ? t.shake * 0.05 : 0); R.draw(treeMeshes[t.v], M4.trs(m, t.x, 0, t.z, sh, t.rot, sh * 0.7, t.s * pop * sq, t.s * pop / sq, t.s * pop * sq)); }
      else { R.draw(stump, M4.trs(m, t.x, 0, t.z, 0, t.rot, 0, t.s, t.s, t.s)); if (t.fall > 0) { const f = Math.min(1, t.fall); const ang = easeIn(f) * 1.5; const sink = t.fall > 1 ? (t.fall - 1) * 1.5 : 0; R.draw(treeMeshes[t.v], M4.trs(m, t.x, -sink, t.z, ang, t.fallRot || 0, 0, t.s, t.s, t.s)); } }
    }
    for (const rk of this.rocks) { if (dist2(rk.x, rk.z, c[0], c[2]) > cull) continue; if (!rk.alive) continue; const sh = rk.shake > 0 ? Math.sin(this.time * 40) * 0.04 * rk.shake : 0; const hpf = 0.55 + 0.45 * rk.hp / rk.maxHp; const pop = rk.pop > 0 ? 1 - easeOut(rk.pop) * 0.9 : 1; R.draw(Models.rock(rk.type), M4.trs(m, rk.x + sh, 0, rk.z, 0, rk.rot, sh, rk.s * hpf * pop, rk.s * hpf * pop, rk.s * hpf * pop)); }
    for (const d of this.decor) { if (dist2(d.x, d.z, c[0], c[2]) > cull) continue; const mesh = d.mesh === 'mound' ? Models.mound() : d.mesh === 'boulder' ? Models.rock('plain') : d.mesh === 'crystal' ? Models.crystal() : d.mesh === 'deadTree' ? Models.deadTree() : d.mesh === 'bones' ? Models.bones() : Models.tree(d.v || 0); R.draw(mesh, M4.trs(m, d.x, 0, d.z, 0, d.rot, 0, d.s * (d.mesh === 'mound' ? 2.2 : 1), d.s * d.sy, d.s * (d.mesh === 'mound' ? 2.2 : 1))); }
    const fs = Models.fenceSeg(); for (const f of this.fenceInst) { if (dist2(f.x, f.z, c[0], c[2]) > cull) continue; R.draw(fs, M4.trs(m, f.x, 0, f.z, 0, f.rot, 0, 1, 1, 1)); }
    // zone gates: posts + doors
    const gp = Models.gatePost(), gd = Models.gateDoor();
    for (const gt of this.gates) {
      if (dist2(gt.x, gt.z, c[0], c[2]) > cull) continue; const ry = gt.horiz ? 0 : HPI; const ang = gt.open * 1.9;
      const px = gt.horiz ? [gt.x - 2.5, gt.x + 2.5] : [gt.x, gt.x], pz = gt.horiz ? [gt.z, gt.z] : [gt.z - 2.5, gt.z + 2.5];
      R.draw(gp, M4.trs(m, px[0], 0, pz[0], 0, 0, 0, 1, 1, 1)); R.draw(gp, M4.trs(m, px[1], 0, pz[1], 0, 0, 0, 1, 1, 1));
      // left door hinged at post 0 opens outward (+z local), right door mirrored
      R.draw(gd, M4.trs(m, px[0], 0, pz[0], 0, ry - ang, 0, 1, 1, 1)); R.draw(gd, M4.trs(m, px[1], 0, pz[1], 0, ry + Math.PI + ang, 0, 1, 1, 1));
    }
    const fl = Models.snowflake(); const bl = this.event === 'blizzard'; for (const f of this.flakes) { R.draw(fl, M4.trs(m, f.x, f.y, f.z, f.ph, f.ph * 2, 0, 1, 1, 1)); if (bl) { R.draw(fl, M4.trs(m, f.x + 1.3, f.y * 0.7 + 2, f.z - 0.8, f.ph * 2, f.ph, 0, 1.3, 1.3, 1.3)); R.draw(fl, M4.trs(m, f.x - 2.1, f.y * 0.5 + 5, f.z + 1.5, f.ph, f.ph * 3, 0, 1.1, 1.1, 1.1)); } }
  }
});

// ===== 08b_nav.js =====
// ---------------------------------------------------------------------------
// Navigation grid + A* (used by workers). Cells of 1.0 units over the world.
// Blocked by rect blockers (buildings, fences, walls, locked zone gates, bounds), padded by the agent radius.
// Trees, rocks and solid decor live in a separate count layer that is updated as trees fall and regrow.
// ---------------------------------------------------------------------------
const NAV = { cell: 1.0, x0: WORLD.x0, z0: WORLD.z0, w: 0, h: 0, blocked: null, trees: null, dirty: true, version: 0 };
Object.assign(G, {
  navInvalidate() { NAV.dirty = true; },
  navBuild() {
    const c = NAV.cell; NAV.w = Math.ceil((WORLD.x1 - WORLD.x0) / c); NAV.h = Math.ceil((WORLD.z1 - WORLD.z0) / c);
    const n = NAV.w * NAV.h; if (!NAV.blocked || NAV.blocked.length !== n) NAV.blocked = new Uint8Array(n); else NAV.blocked.fill(0);
    const pad = 0.75; // agent radius margin; a cell is blocked when its CENTER lies inside the padded rect
    for (const b of this.blockers) {
      if (b.kind === 'gate') continue; // camp gates are open to workers
      if (b.kind === 'zonegate' && this.zones[b.zone]) continue;
      const x0 = Math.max(0, Math.floor((b.x0 - pad - NAV.x0) / c)), x1 = Math.min(NAV.w - 1, Math.floor((b.x1 + pad - NAV.x0) / c));
      const z0 = Math.max(0, Math.floor((b.z0 - pad - NAV.z0) / c)), z1 = Math.min(NAV.h - 1, Math.floor((b.z1 + pad - NAV.z0) / c));
      for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) { const cx = NAV.x0 + (gx + 0.5) * c, cz = NAV.z0 + (gz + 0.5) * c; if (cx > b.x0 - pad && cx < b.x1 + pad && cz > b.z0 - pad && cz < b.z1 + pad) NAV.blocked[gz * NAV.w + gx] = 1; }
    }
    NAV.dirty = false; NAV.version++;
    if (!NAV.trees || NAV.trees.length !== n) this.navBuildTrees();
  },
  // trees & rocks live in a separate count layer so they can be updated one at a time
  navBuildTrees() {
    if (!NAV.w) { const c = NAV.cell; NAV.w = Math.ceil((WORLD.x1 - WORLD.x0) / c); NAV.h = Math.ceil((WORLD.z1 - WORLD.z0) / c); }
    NAV.trees = new Uint8Array(NAV.w * NAV.h);
    for (const t of this.trees) if (t.alive) this.navMarkCircle(t.x, t.z, t.r + 0.45, 1);
    for (const r of this.rocks) if (r.alive) this.navMarkCircle(r.x, r.z, r.r + 0.45, 1);
    for (const d of this.decor) if (d.r > 0.6) this.navMarkCircle(d.x, d.z, d.r + 0.45, 1); // boulders / crystals collide too
  },
  navMarkCircle(x, z, r, delta) {
    if (!NAV.trees) return; const c = NAV.cell; const gx0 = Math.max(0, Math.floor((x - r - NAV.x0) / c)), gx1 = Math.min(NAV.w - 1, Math.floor((x + r - NAV.x0) / c)), gz0 = Math.max(0, Math.floor((z - r - NAV.z0) / c)), gz1 = Math.min(NAV.h - 1, Math.floor((z + r - NAV.z0) / c));
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) { const cx = NAV.x0 + (gx + 0.5) * c, cz = NAV.z0 + (gz + 0.5) * c; if (dist2(cx, cz, x, z) <= r * r) { const i = gz * NAV.w + gx; NAV.trees[i] = Math.max(0, NAV.trees[i] + delta); } }
  },
  navCell(x, z) { return [clamp(Math.floor((x - NAV.x0) / NAV.cell), 0, NAV.w - 1), clamp(Math.floor((z - NAV.z0) / NAV.cell), 0, NAV.h - 1)]; },
  navCenter(gx, gz) { return [NAV.x0 + (gx + 0.5) * NAV.cell, NAV.z0 + (gz + 0.5) * NAV.cell]; },
  navFree(gx, gz) { if (gx < 0 || gz < 0 || gx >= NAV.w || gz >= NAV.h) return false; const i = gz * NAV.w + gx; return !NAV.blocked[i] && !(NAV.trees && NAV.trees[i]); },
  // nearest free cell (spiral search)
  navNearestFree(gx, gz, maxR = 4) {
    if (this.navFree(gx, gz)) return [gx, gz];
    for (let r = 1; r <= maxR; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; if (this.navFree(gx + dx, gz + dz)) return [gx + dx, gz + dz]; }
    return null;
  },
  // line of sight between two cell centers: sample the segment densely (cells are already padded)
  navLos(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az; const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 3) + 1;
    for (let i = 0; i <= n; i++) { const t = i / n; const x = Math.round(ax + dx * t), z = Math.round(az + dz * t); if (!this.navFree(x, z)) return false; }
    return true;
  },
  // start cell for a path: the entity's own cell, or the nearest free cell that can actually be walked to in a straight line
  navStartCell(x, z, c0) {
    if (this.navFree(c0[0], c0[1])) return c0;
    let best = null, bd = 1e9;
    for (let r = 1; r <= 3; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const gx = c0[0] + dx, gz = c0[1] + dz; if (!this.navFree(gx, gz)) continue;
      const cc = this.navCenter(gx, gz); const d = dist2(x, z, cc[0], cc[1]); if (d >= bd) continue;
      let clear = true; for (const b of this.blockers) { if (b.kind === 'gate' || b.kind === 'bound') continue; if (b.kind === 'zonegate' && this.zones[b.zone]) continue; if (b.kind === 'wall' && b.broken) continue; if (this.segHitsRect(x, z, cc[0], cc[1], { x0: b.x0 - 0.3, x1: b.x1 + 0.3, z0: b.z0 - 0.3, z1: b.z1 + 0.3 })) { clear = false; break; } }
      if (clear) { bd = d; best = [gx, gz]; }
    }
    return best || this.navNearestFree(c0[0], c0[1], 3);
  },
  // world-space line of sight through free cells (samples every 0.5 units)
  navLosWorld(x0, z0, x1, z1) {
    if (NAV.dirty) this.navBuild(); const dx = x1 - x0, dz = z1 - z0; const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.5));
    for (let i = 0; i <= n; i++) { const t = i / n; const c = this.navCell(x0 + dx * t, z0 + dz * t); if (!this.navFree(c[0], c[1])) return false; }
    return true;
  },
  // A* from world (x0,z0) to (x1,z1). Returns array of [x,z] waypoints (smoothed), or null if unreachable.
  findPath(x0, z0, x1, z1, maxExpand = 9000) {
    if (NAV.dirty) this.navBuild();
    const s0 = this.navCell(x0, z0), g0 = this.navCell(x1, z1);
    const s = this.navStartCell(x0, z0, s0), g = this.navNearestFree(g0[0], g0[1], 4); if (!s || !g) return null;
    if (s[0] === g[0] && s[1] === g[1]) return [[x1, z1]];
    const W = NAV.w, H = NAV.h; const N = W * H;
    const gScore = this._navG || (this._navG = new Float32Array(N)); const came = this._navCame || (this._navCame = new Int32Array(N)); const closed = this._navClosed || (this._navClosed = new Uint8Array(N));
    // reset only touched cells (track list)
    const touched = []; const sIdx = s[1] * W + s[0], gIdx = g[1] * W + g[0];
    // binary heap of [f, idx]
    const heap = []; const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const pk = (k - 1) >> 1; if (heap[pk][0] <= heap[k][0]) break; [heap[pk], heap[k]] = [heap[k], heap[pk]]; k = pk; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; while (true) { let l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const hf = (i) => { const dx = Math.abs((i % W) - g[0]), dz = Math.abs(Math.floor(i / W) - g[1]); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    gScore[sIdx] = 0; came[sIdx] = -1; closed[sIdx] = 0; touched.push(sIdx); push(hf(sIdx), sIdx);
    const seen = this._navSeen || (this._navSeen = new Int32Array(N)); const stamp = ++NAV.version; // reuse version as a unique stamp
    seen[sIdx] = stamp;
    let found = false, expanded = 0;
    while (heap.length) {
      const [f, cur] = pop(); if (closed[cur]) continue; closed[cur] = 1; touched.push(cur); if (cur === gIdx) { found = true; break; }
      if (++expanded > maxExpand) break;
      const cx = cur % W, cz = Math.floor(cur / W);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue; const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue; const ni = nz * W + nx; if (NAV.blocked[ni] || NAV.trees[ni]) continue;
        if (dx && dz && (NAV.blocked[cz * W + nx] || NAV.trees[cz * W + nx] || NAV.blocked[nz * W + cx] || NAV.trees[nz * W + cx])) continue; // no corner cutting
        const ng = gScore[cur] + (dx && dz ? 1.4142 : 1);
        if (seen[ni] !== stamp || ng < gScore[ni]) { seen[ni] = stamp; gScore[ni] = ng; came[ni] = cur; closed[ni] = 0; touched.push(ni); push(ng + hf(ni), ni); }
      }
    }
    let path = null;
    if (found) {
      const cells = []; let i = gIdx; while (i !== -1 && cells.length < 4000) { cells.push(i); i = came[i]; } cells.reverse();
      // string-pull smoothing with LOS
      const cc = (i) => this.navCenter(i % W, Math.floor(i / W));
      const pts = []; let a = 0; while (a < cells.length - 1) { let b = cells.length - 1; while (b > a + 1) { const A = cc(cells[a]), Bc = cc(cells[b]); if (this.navLosWorld(A[0], A[1], Bc[0], Bc[1])) break; b--; } pts.push(cells[b]); a = b; }
      path = pts.map(ci => this.navCenter(ci % W, Math.floor(ci / W))); if (path.length) path[path.length - 1] = [x1, z1]; else path = [[x1, z1]];
    }
    for (const i of touched) closed[i] = 0;
    return path;
  }
});

// ===== 09_entities.js =====
// ---------------------------------------------------------------------------
// Shared entity helpers: character drawing/animation, loot, particles, arrows
// ---------------------------------------------------------------------------
const _m = M4.create(), _m2 = M4.create(), _root = M4.create(), _arm = M4.create();
Object.assign(G, {
  // ---- animation state helpers (ent fields: phase, moveAmt, action, actionT, hurtT, flash, squash, rot)
  animateMover(ent, dt, moving, speedFrac) {
    ent.moveAmt = ent.moveAmt === undefined ? 0 : ent.moveAmt; ent.phase = ent.phase || 0;
    const target = moving ? 1 : 0; ent.moveAmt += (target - ent.moveAmt) * Math.min(1, dt * 12);
    if (moving) ent.phase += dt * 11 * (0.6 + speedFrac * 0.6);
    if (ent.hurtT > 0) ent.hurtT -= dt; if (ent.flash > 0) ent.flash -= dt * 6; if (ent.squash === undefined) ent.squash = 0; ent.squash += (0 - ent.squash) * Math.min(1, dt * 9);
  },
  // draw a human rig. ent: {x,z,rot,phase,moveAmt,action,actionT,carry,flash,squash,dead,deadT,s}
  drawHuman(rig, ent, tool, opts = {}) {
    const R = this.R; const s = ent.s || 1; const p = ent.phase || 0, ma = ent.moveAmt || 0; const fl = Math.max(0, ent.flash || 0);
    let y = Math.abs(Math.sin(p)) * 0.07 * ma; let rx = 0.12 * ma, rz = 0;
    let armL = Math.sin(p) * 0.9 * ma, armR = -Math.sin(p) * 0.9 * ma, legL = -Math.sin(p) * 0.9 * ma, legR = Math.sin(p) * 0.9 * ma; let armRz = 0, armLz = 0;
    if (!ma) { armL = Math.sin(this.time * 2 + (ent.id || 0)) * 0.05; armR = -armL; }
    const act = ent.action;
    if (act === 'chop' || act === 'attack' || act === 'mine') {
      const t = ent.actionT || 0; // 0..1
      const up = -2.5, hit = -0.35; let a; if (t < 0.45) a = lerp(0, up, easeOut(t / 0.45)); else if (t < 0.6) a = lerp(up, hit, easeIn((t - 0.45) / 0.15)); else a = lerp(hit, 0, smooth((t - 0.6) / 0.4));
      armR = a; rx = t > 0.45 && t < 0.8 ? 0.35 : 0.15; armL = t < 0.45 ? -0.6 : 0.3;
    }
    if (ent.carry && ent.carry.length) { armL = -1.9; armLz = -0.35; }
    if (act === 'stand' && ent.role === 'archer') { armR = -1.5; armL = -1.5; armLz = -0.4; }
    const sq = 1 + (ent.squash || 0); let ry = ent.rot;
    if (ent.dead) { const t = Math.min(1, ent.deadT || 0); rz = easeOut(t) * HPI; y = 0.3 * easeOut(t) - (ent.deadT > 1.2 ? (ent.deadT - 1.2) * 1.2 : 0); }
    M4.trs(_root, ent.x, y + (ent.y || 0), ent.z, rx, ry, rz, s * sq, s / sq, s * sq);
    R.draw(rig.torso, M4.mul(_m, _root, M4.trs(_m2, 0, 0.62, 0, 0, 0, 0, 1, 1, 1)), 1, 1, 1, fl);
    const headN = ent.headRot || 0; R.draw(rig.head, M4.mul(_m, _root, M4.trs(_m2, 0, 1.5, 0, -0.05 * ma, headN, 0, 1, 1, 1)), 1, 1, 1, fl);
    R.draw(rig.arm, M4.mul(_m, _root, M4.trs(_m2, -0.4, 1.2, 0, armL, 0, armLz, 1, 1, 1)), 1, 1, 1, fl);
    M4.mul(_arm, _root, M4.trs(_m2, 0.4, 1.2, 0, armR, 0, armRz, 1, 1, 1)); R.draw(rig.arm, _arm, 1, 1, 1, fl); if (tool) R.draw(tool, _arm, 1, 1, 1, fl);
    R.draw(rig.leg, M4.mul(_m, _root, M4.trs(_m2, -0.15, 0.62, 0, legL, 0, 0, 1, 1, 1)), 1, 1, 1, fl);
    R.draw(rig.leg, M4.mul(_m, _root, M4.trs(_m2, 0.15, 0.62, 0, legR, 0, 0, 1, 1, 1)), 1, 1, 1, fl);
    if (ent.carry && ent.carry.length) this.drawCarry(ent, _root);
  },
  drawCarry(ent, root) {
    const R = this.R; let y = 1.0; const sx = ent.swayX || 0, sz = ent.swayZ || 0; const n = ent.carry.length;
    for (let i = 0; i < n; i++) { const it = ent.carry[i]; const h = DATA.items[it.type].h; const k = i / Math.max(1, n); const wob = it.pop > 0 ? easeOut(it.pop) : 0;
      const ry = it.type === 'wood' ? (i % 2) * 0.15 : ((i * 0.7) % 0.4) - 0.2;
      R.draw(Models.item(it.type), M4.mul(_m, root, M4.trs(_m2, sx * k * 0.5, y + wob * 0.6, -0.45 - sz * k * 0.6 - k * 0.02, -sz * k * 0.5, ry, sx * k * 0.6, 1, 1, 1)));
      y += h; if (it.pop > 0) it.pop -= this.dt * 4; }
  },
  // bear rig drawing. ent: {x,z,rot,phase,moveAmt,attackT,dead,deadT,flash,squash,type}
  drawBear(rig, ent) {
    const R = this.R; const s = (ent.s || 1) * rig.scale; const p = ent.phase || 0, ma = ent.moveAmt || 0; const fl = Math.max(0, ent.flash || 0);
    let y = Math.abs(Math.sin(p)) * 0.06 * ma, rx = 0, rz = 0, headRx = 0;
    if (ent.attackT > 0) { const t = ent.attackT; if (t < 0.5) rx = -lerp(0, 0.7, easeOut(t / 0.5)); else rx = lerp(-0.7, 0.15, easeIn((t - 0.5) / 0.5)); if (t > 0.5) y += (1 - t) * 0.2; headRx = rx * 0.5; }
    if (ent.dead) { const t = Math.min(1, ent.deadT || 0); rz = easeOut(t) * 1.45; y = 0.35 * easeOut(t) - (ent.deadT > 1.5 ? (ent.deadT - 1.5) * 1.0 : 0); }
    const sq = 1 + (ent.squash || 0);
    M4.trs(_root, ent.x, y + (ent.y || 0), ent.z, rx, ent.rot, rz, s * sq, s / sq, s * sq);
    R.draw(rig.body, _root, 1, 1, 1, fl);
    R.draw(rig.head, M4.mul(_m, _root, M4.trs(_m2, 0, 1.0 + Math.sin(p * 0.5) * 0.02, 0.85, headRx + (ent.growl ? -0.3 : 0), Math.sin(this.time * 1.7 + ent.id) * 0.08, 0, 1, 1, 1)), 1, 1, 1, fl);
    const legs = [[-0.28, 0.45, 0], [0.28, 0.45, Math.PI], [-0.28, -0.45, Math.PI], [0.28, -0.45, 0]];
    for (const [lx, lz, ph] of legs) R.draw(rig.leg, M4.mul(_m, _root, M4.trs(_m2, lx, 0.5, lz, Math.sin(p + ph) * 0.7 * ma, 0, 0, 1, 1, 1)), 1, 1, 1, fl);
  },
  // ---- loot
  dropLoot(type, x, z, n = 1, mult = 1) { while (this.loot.length > 240) this.loot.shift(); for (let i = 0; i < n; i++) { const a = rand(0, TAU), sp = rand(1.5, 3.5); this.loot.push({ type, x, y: 0.6, z, vx: Math.cos(a) * sp, vy: rand(4, 7), vz: Math.sin(a) * sp, t: 0, state: 'fly', rot: rand(0, TAU), mult, life: 90 }); } },
  updateLoot(dt) {
    const p = this.player; const cap = this.playerStat('cap');
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const L = this.loot[i]; L.t += dt;
      if (L.state === 'fly') { L.vy -= 22 * dt; L.x += L.vx * dt; L.y += L.vy * dt; L.z += L.vz * dt; if (L.y <= 0) { L.y = 0; if (L.vy < -3) { L.vy *= -0.35; L.vx *= 0.5; L.vz *= 0.5; } else { L.state = 'ground'; L.vx = L.vz = L.vy = 0; } } }
      else if (L.state === 'ground') {
        L.life -= dt; if (L.life <= 0) { this.loot.splice(i, 1); continue; }
        if (!p.dead && L.t > 0.25 && p.carry.length < cap && dist2(L.x, L.z, p.x, p.z) < 3.2 * 3.2) { L.state = 'magnet'; L.who = p; L.mt = 0; }
        else { for (const w of this.workers) { if (w.role !== 'hunter' || w.dead || w.hidden || w.carry.length >= w.cap || L.type !== 'meat') continue; if (dist2(L.x, L.z, w.x, w.z) < 2.5 * 2.5) { L.state = 'magnet'; L.who = w; L.mt = 0; break; } } }
      }
      else if (L.state === 'magnet') {
        L.mt += dt * 4; const w = L.who; const t = Math.min(1, L.mt); const k = easeIn(t); L.x = lerp(L.x, w.x, k * 0.6 + dt * 6); L.z = lerp(L.z, w.z, k * 0.6 + dt * 6); L.y = lerp(L.y, 1.2 + w.carry.length * 0.15, k * 0.6 + dt * 6);
        if (t >= 1 || dist2(L.x, L.z, w.x, w.z) < 0.15) { const capW = w === p ? cap : w.cap; if (w.carry.length < capW && !w.dead) { w.carry.push({ type: L.type, mult: L.mult, pop: 1 }); if (w === p) { Sound.play('pickup', 0.6); if (L.type === 'meat') this.stats.meat += 1; } } else { L.state = 'ground'; L.t = 0; continue; } this.loot.splice(i, 1); }
      }
    }
  },
  drawLoot() { const R = this.R; for (const L of this.loot) { const bob = L.state === 'ground' ? Math.sin(this.time * 3 + L.rot) * 0.05 + 0.05 : 0; R.draw(Models.item(L.type), M4.trs(_m, L.x, L.y + bob, L.z, 0, L.rot + (L.state === 'fly' ? L.t * 6 : this.time * 0.8), L.state === 'fly' ? L.t * 4 : 0, 1, 1, 1)); } },
  // ---- particles (small cubes)
  burst(x, y, z, n, color, opts = {}) { for (let i = 0; i < n; i++) { const a = rand(0, TAU), sp = rand(1, opts.speed || 4); this.particles.push({ x, y, z, vx: Math.cos(a) * sp, vy: rand(2, opts.up || 6), vz: Math.sin(a) * sp, life: rand(0.4, opts.life || 0.9), t: 0, c: color, s: opts.size || 1, g: opts.gravity === undefined ? 18 : opts.gravity, rot: rand(0, TAU) }); } },
  puff(x, y, z, n, color) { for (let i = 0; i < n; i++) this.particles.push({ x: x + rand(-0.3, 0.3), y, z: z + rand(-0.3, 0.3), vx: rand(-0.3, 0.3), vy: rand(0.6, 1.4), vz: rand(-0.3, 0.3), life: rand(0.8, 1.6), t: 0, c: color, s: rand(1.5, 3), g: -0.5, rot: 0, smoke: true }); },
  updateParticles(dt) { for (let i = this.particles.length - 1; i >= 0; i--) { const q = this.particles[i]; q.t += dt; if (q.t >= q.life) { this.particles.splice(i, 1); continue; } q.vy -= q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; if (q.y < 0 && !q.smoke) { q.y = 0; q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; } } },
  drawParticles() { const R = this.R; const chip = Models.chip(), smoke = Models.smoke(); for (const q of this.particles) { const k = 1 - q.t / q.life; const s = q.smoke ? q.s * (0.5 + (1 - k)) * 0.5 : q.s * (0.4 + k * 0.6); R.draw(q.smoke ? smoke : chip, M4.trs(_m, q.x, q.y, q.z, q.rot + q.t * 5, q.rot, 0, s, s, s), q.c[0], q.c[1], q.c[2], 0); } },
  // ---- arrows
  shootArrow(x, y, z, target, dmg) { const dx = target.x - x, dz = target.z - z, d = Math.hypot(dx, dz); const T = 0.12 + d / 30; this.projectiles.push({ x, y, z, tx: target.x, tz: target.z, target, dmg, t: 0, T, sx: x, sy: y, sz: z }); Sound.play('arrow', 0.5); },
  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) { const a = this.projectiles[i]; a.t += dt; const k = Math.min(1, a.t / a.T); if (!a.target.dead) { a.tx = a.target.x; a.tz = a.target.z; }
      a.x = lerp(a.sx, a.tx, k); a.z = lerp(a.sz, a.tz, k); a.y = lerp(a.sy, 0.8, k) + Math.sin(k * Math.PI) * 2.0;
      if (k >= 1) { this.projectiles.splice(i, 1); if (!a.target.dead) this.hurtBear(a.target, a.dmg, a.x, a.z, 0.3); } }
  },
  drawProjectiles() { const R = this.R; const mesh = Models.arrow(); for (const a of this.projectiles) { const k = Math.min(1, a.t / a.T); const dx = a.tx - a.sx, dz = a.tz - a.sz; const ry = Math.atan2(dx, dz); const pitch = -Math.cos(k * Math.PI) * 0.8; R.draw(mesh, M4.trs(_m, a.x, a.y, a.z, pitch, ry, 0, 1, 1, 1)); } },
  // ---- floating text (world anchored)
  floatText(x, y, z, text, cls = '') { this.floaters.push({ x, y, z, text, cls, t: 0, el: null }); if (this.floaters.length > 40) { const f = this.floaters.shift(); if (f.el) f.el.remove(); } }
});

// ===== 10_player.js =====
// ---------------------------------------------------------------------------
// Player: movement, chopping, fighting, selling, funding pads, camera
// ---------------------------------------------------------------------------
Object.assign(G, {
  camPos: [0, 25, 17], camTgt: [0, 0, 0], shake: 0, hitStop: 0, fullWarnT: 0, sellT: 0, padT: 0, padFlies: [],
  initPlayer() {
    const sp = this.savedPlayer; const hp = this.playerStat('hp');
    this.player = { id: 999, x: sp ? sp.x : 0, z: sp ? sp.z : 4, rot: 0, hp: sp && sp.hp > 0 ? Math.min(sp.hp, hp) : hp, maxHp: hp, carry: [], phase: 0, moveAmt: 0, action: 'idle', actionT: 0, swingT: 0, flash: 0, squash: 0, dead: false, deadT: 0, vx: 0, vz: 0, swayX: 0, swayZ: 0, s: 1, role: 'player', cap: 8 };
    if (sp && sp.carry) for (const t of sp.carry) if (DATA.items[t]) this.player.carry.push({ type: t, mult: 1, pop: 0 });
    this.rigPlayer = Models.human({ id: 'player', parka: C.blue, parkaD: C.blueD, beard: C.brown, belt: true });
    this.rigPlayer5 = Models.human({ id: 'player5', parka: C.blue, parkaD: C.blueD, beard: C.brown, belt: true, boots: hex(0x2C6BB0), bootTrim: C.fur });
    this.rigPlayer10 = Models.human({ id: 'player10', parka: C.blue, parkaD: C.blueD, beard: C.brown, belt: true, boots: C.gold, bootTrim: C.fur });
    this.camTgt = [this.player.x, 0, this.player.z]; this.camPos = [this.player.x, 25, this.player.z + 17];
  },
  updatePlayer(dt) {
    const p = this.player; p.maxHp = this.playerStat('hp'); p.cap = this.playerStat('cap');
    if (p.dead) { p.deadT += dt; this.animateMover(p, dt, false, 0); if (p.deadT > 3.0) { p.dead = false; p.hp = p.maxHp; const f = this.b.fire; p.x = f.x + 2.5; p.z = f.z + 1.5; p.carry = p.carry.slice(0, Math.floor(p.carry.length * 0.5)); p.flash = 0; this.floatText(p.x, 2, p.z, 'Back on your feet', 'good'); } return; }
    // ---- movement
    const v = Input.vector(); const mag = Math.hypot(v[0], v[1]); let dx = v[0], dz = v[1];
    let chopping = false; let target = null, targetKind = null;
    // targets
    const reach = DATA.player.reach, aReach = DATA.player.atkReach;
    let bestD = 1e9;
    for (const b of this.bears) { if (b.dead) continue; const rr = aReach + b.s * 0.6; const d = dist2(b.x, b.z, p.x, p.z); if (d < rr * rr && d < bestD) { bestD = d; target = b; targetKind = 'bear'; } }
    if (!target) {
      for (const o of this.gridNear(p.x, p.z, reach + 1.5)) { if (o.kind === 'tree' && (!o.alive || o.fall > 0)) continue; if (o.kind === 'rock' && !o.alive) continue; if (o.kind === 'decor') continue; const rr = reach + o.r; const d = dist2(o.x, o.z, p.x, p.z); if (d < rr * rr && d < bestD) {
        // chop when standing still, or when pushing into the tree (not when walking past)
        if (mag >= 0.55) { const ox = o.x - p.x, oz = o.z - p.z, ol = Math.hypot(ox, oz) || 1; if ((dx * ox + dz * oz) / (ol * mag) < 0.75) continue; }
        bestD = d; target = o; targetKind = o.kind; } }
    }
    if (target && targetKind !== 'bear' && p.carry.length >= p.cap) { if (this.fullWarnT <= 0) { this.floatText(p.x, 2.2, p.z, 'FULL! Go sell', 'warn'); Sound.play('full'); this.fullWarnT = 2.5; } target = null; }
    this.fullWarnT -= dt;
    const carryPenalty = 1 - 0.22 * (p.carry.length / Math.max(1, p.cap));
    let speed = this.playerStat('speed') * carryPenalty; if (target) speed *= targetKind === 'bear' ? 0.75 : 0.3;
    if (mag > 0) { p.x += dx * speed * dt; p.z += dz * speed * dt; const ang = Math.atan2(dx, dz); p.rot = angleLerp(p.rot, ang, Math.min(1, dt * 14)); }
    // face target
    if (target) { const ang = Math.atan2(target.x - p.x, target.z - p.z); p.rot = angleLerp(p.rot, ang, Math.min(1, dt * 10)); }
    // knockback
    if (p.kx || p.kz) { p.x += p.kx * dt; p.z += p.kz * dt; p.kx *= Math.max(0, 1 - dt * 8); p.kz *= Math.max(0, 1 - dt * 8); if (Math.abs(p.kx) < 0.05) p.kx = 0; if (Math.abs(p.kz) < 0.05) p.kz = 0; }
    this.collide(p, 0.45);
    for (const b of this.bears) { if (b.dead) continue; const rr = 0.45 + 0.6 * b.s; const d2 = dist2(p.x, p.z, b.x, b.z); if (d2 < rr * rr && d2 > 0.001) { const d = Math.sqrt(d2); const push = (rr - d) * 0.5; p.x += (p.x - b.x) / d * push; p.z += (p.z - b.z) / d * push; } }
    // velocity & sway
    const nvx = (p.x - (p.px === undefined ? p.x : p.px)) / Math.max(dt, 1e-4), nvz = (p.z - (p.pz === undefined ? p.z : p.pz)) / Math.max(dt, 1e-4); p.px = p.x; p.pz = p.z;
    p.vx += (nvx - p.vx) * Math.min(1, dt * 8); p.vz += (nvz - p.vz) * Math.min(1, dt * 8);
    const lx = Math.cos(p.rot) * p.vx - Math.sin(p.rot) * p.vz, lz = Math.sin(p.rot) * p.vx + Math.cos(p.rot) * p.vz; // velocity in local space
    p.swayX += (-lx * 0.12 - p.swayX) * Math.min(1, dt * 6); p.swayZ += (lz * 0.12 - p.swayZ) * Math.min(1, dt * 6);
    this.animateMover(p, dt, mag > 0.05, Math.min(1, speed / 6));
    // ---- actions
    if (target) {
      p.action = targetKind === 'bear' ? 'attack' : targetKind === 'rock' ? 'mine' : 'chop';
      const rate = targetKind === 'bear' ? this.playerStat('atk') : this.playerStat('atk') * 0.9;
      if (p.swingT === 0) p.swingT = 0.3;
      p.swingT += dt * rate; p.actionT = Math.min(1, p.swingT);
      if (p.swingT >= 0.6 && !p.hitDone) { p.hitDone = true; this.playerHit(target, targetKind); }
      if (p.swingT >= 1) { p.swingT -= 1; p.hitDone = false; }
    } else { p.action = mag > 0.05 ? 'run' : 'idle'; p.swingT = 0; p.hitDone = false; p.actionT = 0; }
    // ---- natural regen out of combat
    p.sinceHit = (p.sinceHit || 0) + dt; if (p.sinceHit > 5 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.01 * dt);
    // ---- interactions with buildings
    this.updatePlayerBuildings(dt);
    // ---- item pops
    for (const it of p.carry) if (it.pop > 0) it.pop -= dt * 4;
  },
  playerHit(t, kind) {
    const p = this.player;
    if (kind === 'bear') {
      const dmg = this.playerStat('dmg'); this.hurtBear(t, dmg, p.x, p.z, 1.6); this.hitStop = 0.04; this.shake = Math.max(this.shake, 0.12); Sound.play('hit');
      return;
    }
    if (kind === 'tree') {
      t.hp -= 1; t.shake = 1; Sound.play('chop'); this.burst(t.x, 1.2, t.z, 6, C.woodL, { speed: 3, up: 4, size: 0.9 });
      const n = this.playerStat('chop'); this.giveItems(p, 'wood', n, t.mult); this.stats.wood += n;
      if (t.hp <= 0) { this.fellTree(t, p.rot); }
      return;
    }
    if (kind === 'rock') {
      t.hp -= 1; t.shake = 1; Sound.play('stone'); this.burst(t.x, 1.0, t.z, 5, t.type === 'gold' ? C.gold : C.stone, { speed: 3, up: 4, size: 0.8 });
      this.giveItems(p, t.type, 1, t.mult); this.stats[t.type] += 1;
      if (t.hp <= 0) { t.alive = false; this.navMarkCircle(t.x, t.z, t.r + 0.45, -1); t.regrow = 30 + rand(0, 15); this.burst(t.x, 0.5, t.z, 12, C.stoneD, { speed: 4, up: 5 }); }
      return;
    }
  },
  fellTree(t, fromRot) { t.alive = false; this.navMarkCircle(t.x, t.z, t.r + 0.45, -1); t.fall = 0.01; t.fallRot = fromRot; t.regrow = 22 + rand(0, 10) + t.zone * 3; Sound.play('treefall', 0.7); this.stats.trees++; this.shake = Math.max(this.shake, 0.08); },
  giveItems(who, type, n, mult) {
    const cap = who === this.player ? this.playerStat('cap') : who.cap;
    for (let i = 0; i < n; i++) { if (who.carry.length < cap) { who.carry.push({ type, mult, pop: 1 }); } else { this.dropLoot(type, who.x, who.z, 1, mult); } }
    if (who === this.player && who.carry.length >= cap && n > 0) { /* full */ }
  },
  hurtPlayer(dmg, fromX, fromZ) {
    const p = this.player; if (p.dead) return; p.hp -= dmg; p.flash = 1; p.sinceHit = 0; p.squash = 0.2; p.hurtT = 0.3; Sound.play('hurt'); this.shake = Math.max(this.shake, 0.25);
    const dx = p.x - fromX, dz = p.z - fromZ, d = Math.hypot(dx, dz) || 1; p.kx = dx / d * 6; p.kz = dz / d * 6;
    this.floatText(p.x, 2.0, p.z, '-' + Math.round(dmg), 'dmg');
    if (p.hp <= 0) { p.hp = 0; p.dead = true; p.deadT = 0; this.stats.deaths++; Sound.play('die'); this.floatText(p.x, 2.2, p.z, 'Knocked out!', 'warn'); const drop = Math.ceil(p.carry.length * 0.5); for (let i = 0; i < drop; i++) { const it = p.carry.pop(); if (it) this.dropLoot(it.type, p.x, p.z, 1, it.mult); } }
  },
  updatePlayerBuildings(dt) {
    const p = this.player; const cap = p.cap;
    // sell at post
    const post = this.b.post; const sellPt = [post.x, post.z + 2.6];
    this.sellT -= dt;
    if (p.carry.length && dist2(p.x, p.z, sellPt[0], sellPt[1]) < 2.6 * 2.6 && this.sellT <= 0) {
      this.sellT = 0.06; const it = p.carry.pop(); this.sellItem(it, p.x, p.z);
    }
    // cash piles
    for (const id in this.b) { const b = this.b[id]; if (!b.built || b.cash < 1) continue; const cp = this.cashPilePos(b); if (dist2(p.x, p.z, cp[0], cp[1]) < 3.0 * 3.0) this.collectCash(b); }
    // campfire heal
    const fire = this.b.fire; if (fire.built && p.hp < p.maxHp && dist2(p.x, p.z, fire.x, fire.z) < 4 * 4) { p.hp = Math.min(p.maxHp, p.hp + (8 + (fire.level - 1) * 6) * dt); }
    // pads
    this.padT -= dt;
    for (const id in this.b) { const b = this.b[id]; if (b.built || !b.visible) continue; const d = DATA.buildings[b.type]; const rr = Math.max(d.w, d.d) * 0.5 + 0.3;
      if (dist2(p.x, p.z, b.x, b.z) < rr * rr) { this.fundPad(b, dt); } }
    for (let i = 1; i < DATA.zones.length; i++) { if (this.zones[i]) continue; const gp = this.zoneGateMarker(i); if (dist2(p.x, p.z, gp[0], gp[1]) >= 2.4 * 2.4) continue;
      if (this.zoneOpenable(i)) this.fundZone(i, dt); else if (this.padT <= 0) { this.padT = 2.5; const need = i === 4 ? 1 : i - 1; this.floatText(gp[0], 2.5, gp[1], 'Locked — unlock the ' + DATA.zones[need].name + ' first', 'warn'); } }
    // repair wrecked buildings / walls
    for (const id in this.b) { const b = this.b[id]; if (!b.built || b.hp >= b.maxHp) continue; if (dist2(p.x, p.z, b.x, b.z) < 4.5 * 4.5) { b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.25 * dt); if (b.hp >= b.maxHp * 0.3) b.wrecked = false; } }
    // pad flies animation
    for (let i = this.padFlies.length - 1; i >= 0; i--) { const f = this.padFlies[i]; f.t += dt * 2.6; if (f.t >= 1) { this.padFlies.splice(i, 1); continue; } }
  },
  sellItem(it, x, z) {
    const p = this.player;
    if (it.type === 'stone' || it.type === 'gold') { this.vault[it.type] += 1; this.stats.sold++; this.floatText(x, 2.2, z, '+1 ' + DATA.items[it.type].name, it.type === 'gold' ? 'gold' : 'stone'); Sound.play('pickup', 0.5); UI.bump(it.type); return; }
    const price = Math.round(this.sellPrice(it.type, it.mult)); this.addMoney(price); this.stats.sold++; this.cashFly(x, 1.5, z, price); Sound.play('coin', 0.6);
  },
  cashFly(x, y, z, amount) { const sp = this.R.project(x, y, z); UI.cashFly(sp[0], sp[1], amount); },
  cashPilePos(b) { const d = DATA.buildings[b.type]; return [b.x + d.w / 2 + 0.9, b.z + 0.8]; },
  collectCash(b) { const n = Math.floor(b.cash); if (n < 1) return; b.cash -= n; this.addMoney(n, false); const cp = this.cashPilePos(b); this.cashFly(cp[0], 0.6, cp[1], n); this.floatText(cp[0], 1.4, cp[1], '+' + fmtMoney(n), 'cash'); Sound.play('cash'); },
  fundPad(b, dt) {
    const d = DATA.buildings[b.type]; const cost = this.padCost(b); const need = cost - b.funded; if (need <= 0) return;
    const rate = Math.max(cost / 2.2, 40); let amt = Math.min(need, rate * dt, this.money); if (amt <= 0) { if (this.padT <= 0 && this.money < 1) { this.padT = 2; this.floatText(b.x, 2.5, b.z, 'Need ' + fmtMoney(need) + ' more', 'warn'); Sound.play('error', 0.4); } return; }
    this.money -= amt; b.funded += amt; b.padDirty = true; if (this.padT <= 0) { this.padT = 0.07; this.padFlies.push({ x: this.player.x, z: this.player.z, tx: b.x, tz: b.z, t: 0 }); Sound.play('coin', 0.3); }
    if (b.funded >= cost - 0.01) { b.funded = cost; this.buildBuilding(b); }
  },
  padCost(b) { const d = DATA.buildings[b.type]; if (b.type === 'tower') { const idx = parseInt(b.id.replace('tower', '')) || 0; return Math.round(d.cost * Math.pow(1.8, idx)); } return d.cost; },
  // zones open in order: Frozen Forest → Stone Ridge → Glacier; the Den only needs the Frozen Forest
  zoneOpenable(i) { if (this.zones[i]) return false; return i === 4 ? !!this.zones[1] : !!this.zones[i - 1]; },
  zoneGateMarker(i) { const zd = DATA.zones[i]; const g = zd.gate; return zd.gateDir === 'n' ? [g[0], g[1] + 3.2] : zd.gateDir === 'e' ? [g[0] - 3.2, g[1]] : [g[0] + 3.2, g[1]]; },
  fundZone(i, dt) {
    const zd = DATA.zones[i]; this.zoneFund = this.zoneFund || {}; const f = this.zoneFund[i] || 0; const need = zd.cost - f; if (need <= 0) return;
    const rate = Math.max(zd.cost / 2.5, 40); const amt = Math.min(need, rate * dt, this.money);
    if (amt <= 0) { if (this.padT <= 0 && this.money < 1) { this.padT = 2; const gp = this.zoneGateMarker(i); this.floatText(gp[0], 2.5, gp[1], 'Need ' + fmtMoney(need) + ' more', 'warn'); Sound.play('error', 0.4); } return; }
    this.money -= amt; this.zoneFund[i] = f + amt; this.zonePadDirty = i;
    if (this.padT <= 0) { this.padT = 0.07; const gp = this.zoneGateMarker(i); this.padFlies.push({ x: this.player.x, z: this.player.z, tx: gp[0], tz: gp[1], t: 0 }); Sound.play('coin', 0.3); }
    if (this.zoneFund[i] >= zd.cost - 0.01) this.unlockZone(i);
  },
  unlockZone(i) {
    this.zones[i] = true; const zd = DATA.zones[i]; Sound.play('unlock'); UI.toast(`${zd.name} unlocked!`, 'good'); this.shake = 0.2; const gp = this.zoneGateMarker(i); this.burst(gp[0], 1, gp[1], 30, C.gold, { speed: 6, up: 8, life: 1.2 });
    // make zone buildings visible
    for (const id in this.b) { const b = this.b[id]; if (DATA.buildings[b.type].zone === i) b.visible = true; }
    this.refreshPads(); this.saveDirty = true; this.navInvalidate(); if (this.zoneDecals && this.zoneDecals[i]) this.zoneDecals[i].visible = false;
  },
  updateCamera(dt) {
    const p = this.player; const R = this.R; const zoom = this.settings.zoom || 1;
    const lead = 0.5; const tx = p.x + clamp(p.vx, -7, 7) * lead, tz = p.z + clamp(p.vz, -7, 7) * lead;
    const k = Math.min(1, dt * 5); this.camTgt[0] += (tx - this.camTgt[0]) * k; this.camTgt[2] += (tz - this.camTgt[2]) * k;
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight; const portrait = aspect < 1;
    const dist = (portrait ? 38 : 32) * zoom; const pitch = 0.98; // radians from horizontal
    const cy = Math.sin(pitch) * dist, cz = Math.cos(pitch) * dist;
    this.shake = Math.max(0, this.shake - dt * 1.4); const sh = this.shake * this.shake * 0.9; const sx = (Math.random() - 0.5) * sh, sz = (Math.random() - 0.5) * sh;
    R.setCamera(portrait ? 50 : 38, aspect, 2, 260);
    R.lookAt(this.camTgt[0] + sx, cy, this.camTgt[2] + cz + sz, this.camTgt[0] + sx, 0.5, this.camTgt[2] + sz);
  },
  drawPlayer() {
    const p = this.player; const lv = this.upgrades.speed; this.drawHuman(lv >= 10 ? this.rigPlayer10 : lv >= 5 ? this.rigPlayer5 : this.rigPlayer, p, Models.axe());
    const m = M4.create(); for (const f of this.padFlies) { const t = f.t; const x = lerp(f.x, f.tx, t), z = lerp(f.z, f.tz, t), y = 1 + Math.sin(t * Math.PI) * 2.5; this.R.draw(Models.item('cash'), M4.trs(m, x, y, z, t * 6, t * 3, 0, 1, 1, 1)); }
  }
});

// ===== 11_bears.js =====
// ---------------------------------------------------------------------------
// Bears: spawning, AI (wander / chase / attack / raid / boss), damage
// ---------------------------------------------------------------------------
Object.assign(G, {
  bearId: 1, respawnQueue: [], bearRigs: {},
  bearRig(type) { if (!this.bearRigs[type]) { const d = DATA.bears[type]; this.bearRigs[type] = Models.bear({ id: type, body: hex(d.body), bodyD: hex(d.bodyD), scale: d.scale, armor: d.armor, king: d.king }); } return this.bearRigs[type]; },
  spawnBears() {
    const rng = mulberry(777);
    DATA.zones.forEach((zd, zi) => {
      const [x0, x1, z0, z1] = zd.bounds;
      for (let i = 0; i < zd.bears; i++) { let x, z, tries = 0; do { x = x0 + 4 + rng() * (x1 - x0 - 8); z = z0 + 4 + rng() * (z1 - z0 - 8); tries++; } while (tries < 50 && (this.inBase(x, z, 8) || this.gridNear(x, z, 2).length || (zi === 4 && dist2(x, z, 0, -128) < 400) || this.gates.some(g => dist2(x, z, g.x, g.z) < 100)));
        this.makeBear(zd.bear, x, z, zi, false); }
      if (zd.boss) { this.boss = this.makeBear('king', 0, -128, zi, false); this.boss.boss = true; this.boss.slamCd = 5; }
    });
  },
  makeBear(type, x, z, zone, raider, scaleHp = 1, scaleDmg = 1) {
    const d = DATA.bears[type]; const mult = DATA.zones[zone].mult;
    const b = { id: this.bearId++, type, def: d, zone, x, z, rot: rand(0, TAU), hp: Math.round(d.hp * scaleHp), maxHp: Math.round(d.hp * scaleHp), dmg: d.dmg * scaleDmg, state: 'idle', target: null, atkT: 0, atkCd: rand(0, 1), hurtT: 0, flash: 0, squash: 0, dead: false, deadT: 0, home: { x, z }, wanderT: rand(0, 3), wx: x, wz: z, kx: 0, kz: 0, raider, s: d.scale, mult, phase: rand(0, 6), moveAmt: 0, y: 0, growl: false, wallT: 0, stuckT: 0, lastX: x, lastZ: z, sleep: !raider && zone > 0 };
    this.bears.push(b); return b;
  },
  hurtBear(b, dmg, fromX, fromZ, knock = 1) {
    if (b.dead) return; b.hp -= dmg; b.flash = 1; b.squash = 0.22; b.hurtT = 0.25; b.sleep = false;
    const dx = b.x - fromX, dz = b.z - fromZ, d = Math.hypot(dx, dz) || 1; const kf = (b.boss ? 0.2 : 1) * knock * 5 / b.s; b.kx += dx / d * kf; b.kz += dz / d * kf;
    this.floatText(b.x, 1.6 * b.s, b.z, '-' + Math.round(dmg), 'dmg');
    this.burst(b.x, 1.0 * b.s, b.z, 4, C.meat, { speed: 3, up: 4, size: 0.7, life: 0.5 });
    // aggro: chase nearest attacker (player or worker)
    if (!b.raider || b.state !== 'attackWall') { let best = null, bd = 1e9; for (const w of [this.player, ...this.workers]) { if (w.dead || w.hidden) continue; const dd = dist2(w.x, w.z, fromX, fromZ); if (dd < bd) { bd = dd; best = w; } } if (best) { b.target = best; if (!b.raider) b.state = 'chase'; } }
    if (b.hp <= 0) this.killBear(b);
  },
  killBear(b) {
    b.dead = true; b.deadT = 0; b.hp = 0; b.state = 'dead'; this.stats.kills++; this.registerKill(b); if (b.type === 'armor') this.stats.armorKills++; if (b.boss) { this.stats.king++; this.bossKilled(); }
    Sound.play('bearDie', 0.8); this.burst(b.x, 0.8 * b.s, b.z, 10, C.snow2, { speed: 4, up: 5 });
    const meat = b.def.meat; this.dropLoot('meat', b.x, b.z, meat, b.mult); if (b.def.gold) this.dropLoot('gold', b.x, b.z, b.def.gold, 1);
    if (b.raider) { const i = this.night.raiders.indexOf(b); if (i >= 0) this.night.raiders.splice(i, 1); }
    else this.respawnQueue.push({ type: b.type, x: b.home.x, z: b.home.z, zone: b.zone, t: b.boss ? 600 : 28 + rand(0, 20), boss: b.boss });
    this.shake = Math.max(this.shake, b.boss ? 0.6 : 0.18);
  },
  bossKilled() { Sound.play('victory'); UI.toast('The Bear King has fallen!', 'gold'); this.unlockPrestigeHint = true; this.saveDirty = true; if (!this.tutorial.kingDone) { this.tutorial.kingDone = true; setTimeout(() => UI.showVictory(), 1200); } },
  updateBears(dt) {
    const p = this.player; const night = this.night.active;
    // respawns
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) { const r = this.respawnQueue[i]; r.t -= dt; if (r.t <= 0) { this.respawnQueue.splice(i, 1); if (dist2(r.x, r.z, p.x, p.z) < 12 * 12) { r.t = 8; this.respawnQueue.push(r); continue; } const nb = this.makeBear(r.type, r.x, r.z, r.zone, false); nb.pop = 1; if (r.boss) { this.boss = nb; nb.boss = true; nb.slamCd = 5; } } }
    for (let i = this.bears.length - 1; i >= 0; i--) {
      const b = this.bears[i];
      if (b.dead) { b.deadT += dt; if (b.deadT > 3.2) this.bears.splice(i, 1); continue; }
      if (b.pop > 0) b.pop -= dt * 2;
      if (!this.zones[b.zone] && !b.raider) { continue; } // sleeping in locked zone
      const distP2 = dist2(b.x, b.z, p.x, p.z);
      if (distP2 > 75 * 75 && !b.raider) { b.phase += dt; continue; } // far away: skip AI
      const spd = b.def.speed * this.bearSpeedMult();
      let moving = false; let mvx = 0, mvz = 0;
      if (b.atkCd > 0) b.atkCd -= dt;
      if (b.atkT > 0) { b.atkT += dt / 0.8; if (b.atkT >= 0.55 && !b.atkDone) { b.atkDone = true; this.bearStrike(b); } if (b.atkT >= 1) { b.atkT = 0; b.atkDone = false; } }
      // ---- target selection
      if (b.raider) {
        if (b.target && (b.target.dead || b.target.hidden || (b.target.hp !== undefined && b.target.hp <= 0))) b.target = null;
        if (!b.target || this.frame % 20 === b.id % 20) { let best = null, bd = 9 * 9; for (const w of [p, ...this.workers]) { if (w.dead || w.hidden) continue; const d = dist2(w.x, w.z, b.x, b.z); if (d < bd) { bd = d; best = w; } } if (best) { b.target = best; b.state = 'chase'; } else if (b.state !== 'attackWall') { b.state = 'raid'; b.target = null; } }
      } else {
        if (b.target && (b.target.dead || b.target.hidden || (b.target.hp !== undefined && b.target.hp <= 0))) { b.target = null; b.state = 'return'; }
        if (!b.target && !b.sleep) { const ag = b.def.aggro * (night ? 1.5 : 1); if (distP2 < ag * ag && !p.dead) { b.target = p; b.state = 'chase'; if (!b.growled) { b.growled = true; Sound.play('growl', 0.6); } } }
        if (b.sleep && distP2 < (b.def.aggro * 1.2) * (b.def.aggro * 1.2)) { b.sleep = false; b.target = p; b.state = 'chase'; Sound.play('growl', 0.7); }
        if (b.state === 'chase' && b.target) { const leash = b.boss ? 42 : 16; if (dist2(b.x, b.z, b.home.x, b.home.z) > leash * leash || dist2(b.target.x, b.target.z, b.x, b.z) > 20 * 20) { b.target = null; b.state = 'return'; } }
      }
      // ---- state behaviour
      if (b.state === 'chase' && b.target) {
        const t = b.target; const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz); const range = 1.3 + b.s * 0.7 + (t === p ? 0.3 : 0.2);
        if (d > range) { mvx = dx / d; mvz = dz / d; moving = true; }
        else if (b.atkCd <= 0 && b.atkT === 0) { b.atkT = 0.001; b.atkCd = b.boss ? 1.6 : 1.25; }
        b.rot = angleLerp(b.rot, Math.atan2(dx, dz), Math.min(1, dt * 8));
        if (b.boss) this.bossAI(b, dt, d);
      } else if (b.state === 'return') {
        const wpR = this.built('wall') ? this.routeAroundBase(b, b.home.x, b.home.z) : null; const gx = wpR ? wpR[0] : b.home.x, gz = wpR ? wpR[1] : b.home.z;
        const dx = gx - b.x, dz = gz - b.z, d = Math.hypot(dx, dz); if (d > 1.5) { mvx = dx / d; mvz = dz / d; moving = true; b.rot = angleLerp(b.rot, Math.atan2(dx, dz), Math.min(1, dt * 6)); } else { b.state = 'idle'; if (!b.boss) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.5); b.growled = false; }
      } else if (b.state === 'raid') {
        const wp = this.raidWaypoint(b); const dx = wp[0] - b.x, dz = wp[1] - b.z, d = Math.hypot(dx, dz); if (d > 1) { mvx = dx / d; mvz = dz / d; moving = true; b.rot = angleLerp(b.rot, Math.atan2(dx, dz), Math.min(1, dt * 6)); }
        // attack buildings if inside base and no human target
        if (this.inBase(b.x, b.z, 1)) { let best = null, bd = 6 * 6; for (const id in this.b) { const bl = this.b[id]; if (!bl.built || bl.wrecked || bl.type === 'fire' || bl.type === 'wall') continue; const dd = dist2(bl.x, bl.z, b.x, b.z); if (dd < bd) { bd = dd; best = bl; } } if (best) { b.state = 'attackBuilding'; b.bTarget = best; } }
      } else if (b.state === 'attackBuilding') {
        const bl = b.bTarget; if (!bl || bl.wrecked) { b.state = 'raid'; b.bTarget = null; } else { const dx = bl.x - b.x, dz = bl.z - b.z, d = Math.hypot(dx, dz); const dd = DATA.buildings[bl.type]; const range = Math.max(dd.w, dd.d) * 0.5 + 0.8 * b.s; if (d > range) { mvx = dx / d; mvz = dz / d; moving = true; } else if (b.atkCd <= 0 && b.atkT === 0) { b.atkT = 0.001; b.atkCd = 1.4; } b.rot = angleLerp(b.rot, Math.atan2(dx, dz), Math.min(1, dt * 6)); }
      } else if (b.state === 'attackWall') {
        const w = b.wallTarget; if (!w || w.broken) { b.state = 'raid'; b.wallTarget = null; } else { const cx = clamp(b.x, w.x0, w.x1), cz = clamp(b.z, w.z0, w.z1); const dx = cx - b.x, dz = cz - b.z, d = Math.hypot(dx, dz); if (d > 0.9 * b.s + 0.6) { mvx = dx / d; mvz = dz / d; moving = true; } else if (b.atkCd <= 0 && b.atkT === 0) { b.atkT = 0.001; b.atkCd = 1.3; } b.rot = angleLerp(b.rot, Math.atan2(dx, dz), Math.min(1, dt * 6)); }
      } else { // idle / wander
        b.wanderT -= dt; if (b.wanderT <= 0) { b.wanderT = rand(2, 6); if (Math.random() < 0.6) { const a = rand(0, TAU), r = rand(2, 9); b.wx = b.home.x + Math.cos(a) * r; b.wz = b.home.z + Math.sin(a) * r; b.state = 'wander'; } else b.state = 'idle'; }
        if (b.state === 'wander') { const dx = b.wx - b.x, dz = b.wz - b.z, d = Math.hypot(dx, dz); if (d > 0.8) { mvx = dx / d * 0.4; mvz = dz / d * 0.4; moving = true; b.rot = angleLerp(b.rot, Math.atan2(dx, dz), Math.min(1, dt * 4)); } else b.state = 'idle'; }
      }
      // ---- movement (with unstick for raiders / chasers)
      const slow = b.atkT > 0 ? 0.2 : 1;
      if (moving && b.unstickT > 0) { b.unstickT -= dt; const ux = -mvz * b.unstickSide, uz = mvx * b.unstickSide; mvx = (mvx + ux * 1.2); mvz = (mvz + uz * 1.2); const l = Math.hypot(mvx, mvz) || 1; mvx /= l; mvz /= l; }
      if (moving) { b.x += mvx * spd * slow * dt; b.z += mvz * spd * slow * dt; }
      if (moving && b.atkT === 0) { const prog = Math.hypot(b.x - b.lastX, b.z - b.lastZ); if (prog < spd * dt * 0.25) { b.stuckT += dt; if (b.stuckT > 1.2 && !(b.unstickT > 0)) { b.unstickT = 1.5; b.unstickSide = Math.random() < 0.5 ? 1 : -1; b.stuckT = 0; } } else b.stuckT = Math.max(0, b.stuckT - dt); } b.lastX = b.x; b.lastZ = b.z;
      if (b.kx || b.kz) { b.x += b.kx * dt; b.z += b.kz * dt; b.kx *= Math.max(0, 1 - dt * 7); b.kz *= Math.max(0, 1 - dt * 7); }
      // separation from other bears
      for (let j = 0; j < this.bears.length; j++) { const o = this.bears[j]; if (o === b || o.dead) continue; const rr = 0.7 * (b.s + o.s); const d2 = dist2(b.x, b.z, o.x, o.z); if (d2 < rr * rr && d2 > 1e-4) { const d = Math.sqrt(d2); const push = (rr - d) * 0.3; b.x += (b.x - o.x) / d * push; b.z += (b.z - o.z) / d * push; } }
      const wallHit = this.collide(b, 0.55 * b.s, { bear: true, ignoreBuildings: false });
      if (wallHit && b.raider && b.state !== 'attackWall' && b.state !== 'attackBuilding' && (b.state === 'raid' || (b.state === 'chase' && b.target && this.inBase(b.target.x, b.target.z) !== this.inBase(b.x, b.z)))) { b.state = 'attackWall'; b.wallTarget = wallHit; }
      // keep bears inside their zone bounds unless raider
      if (!b.raider) { const bb = DATA.zones[b.zone].bounds; if (b.zone > 0) { b.x = clamp(b.x, bb[0] + 1, bb[1] - 1); b.z = clamp(b.z, bb[2] + 1, bb[3] - 1); } else { b.x = clamp(b.x, bb[0], bb[1]); b.z = clamp(b.z, bb[2], bb[3]); if (this.inBase(b.x, b.z) && !b.target) { const dx = b.x, dz = b.z - 1; const d = Math.hypot(dx, dz) || 1; b.x += dx / d * dt * 4; b.z += dz / d * dt * 4; } } }
      this.animateMover(b, dt, moving, Math.min(1, spd / 4)); if (b.hurtT > 0) b.hurtT -= dt;
    }
  },
  raidWaypoint(b) { // straight toward base center (walls handle blocking); once inside, roam center
    const B = DATA.base; const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2; return [cx + Math.sin(b.id) * 4, cz + Math.cos(b.id * 1.3) * 4];
  },
  bearStrike(b) {
    const p = this.player;
    if (b.state === 'attackWall' && b.wallTarget) { this.damageWall(b.wallTarget, b.dmg * 1.5); this.burst(b.x + Math.sin(b.rot) * b.s, 0.9, b.z + Math.cos(b.rot) * b.s, 5, C.fence, { speed: 3, up: 4 }); Sound.play('chop', 0.5); return; }
    if (b.state === 'attackBuilding' && b.bTarget) { const bl = b.bTarget; bl.hp -= b.dmg * 2; this.burst(bl.x, 1.5, bl.z, 5, C.woodD, { speed: 3, up: 4 }); Sound.play('chop', 0.5); if (bl.hp <= 0) { bl.hp = 0; bl.wrecked = true; UI.toast(`${DATA.buildings[bl.type].name} was wrecked! Stand near it to repair.`, 'warn'); Sound.play('error'); } return; }
    const t = b.target; if (!t || t.dead) return;
    const range = 1.3 + b.s * 0.7 + 1.0; if (dist2(t.x, t.z, b.x, b.z) > range * range) return;
    if (t === p) this.hurtPlayer(b.dmg, b.x, b.z); else this.hurtWorker(t, b.dmg, b.x, b.z);
  },
  bossAI(b, dt, d) {
    b.slamCd -= dt;
    if (b.slamCd <= 0 && d < 9 && b.atkT === 0) { b.slamCd = 7; b.slam = 0.001; }
    if (b.slam > 0) { b.slam += dt / 1.1; b.y = Math.sin(Math.min(1, b.slam) * Math.PI) * 3.5; if (b.slam >= 1) { b.slam = 0; b.y = 0; Sound.play('slam'); this.shake = 0.7; this.burst(b.x, 0.3, b.z, 40, C.snow, { speed: 9, up: 4, life: 1.0, size: 1.4 }); this.fx.push({ type: 'ring', x: b.x, z: b.z, t: 0 }); const R2 = 6.5; for (const w of [this.player, ...this.workers]) { if (w.dead || w.hidden) continue; if (dist2(w.x, w.z, b.x, b.z) < R2 * R2) { if (w === this.player) this.hurtPlayer(b.dmg, b.x, b.z); else this.hurtWorker(w, b.dmg, b.x, b.z); } } } }
    if (b.hp < b.maxHp * 0.5 && !b.summoned) { b.summoned = true; UI.toast('The Bear King calls his guard!', 'warn'); Sound.play('horn', 0.6); for (let i = 0; i < 2; i++) { const nb = this.makeBear('armor', b.x + (i ? 4 : -4), b.z + 3, b.zone, false); nb.target = this.player; nb.state = 'chase'; nb.home = { x: nb.x, z: nb.z }; } }
  },
  drawBears() {
    const R = this.R; const c = R.camTarget;
    for (const b of this.bears) { if (dist2(b.x, b.z, c[0], c[2]) > 60 * 60) continue; if (b.pop > 0) { b.s = b.def.scale * (1 - easeOut(b.pop) * 0.9); } else b.s = b.def.scale; this.drawBear(this.bearRig(b.type), b); }
  }
});

// ===== 12_buildings.js =====
// ---------------------------------------------------------------------------
// Buildings: pads, construction, upgrades, walls, towers, processing, drawing
// ---------------------------------------------------------------------------
const ICONS = {
  shop: (c, s) => { c.fillRect(-s * .5, -s * .05, s, s * .5); c.beginPath(); c.moveTo(-s * .6, -s * .05); c.lineTo(0, -s * .5); c.lineTo(s * .6, -s * .05); c.closePath(); c.fill(); c.fillStyle = '#3E8FE0'; c.fillRect(-s * .12, s * .12, s * .24, s * .33); },
  fire: (c, s) => { c.beginPath(); c.moveTo(0, -s * .55); c.quadraticCurveTo(s * .55, -s * .1, s * .3, s * .4); c.quadraticCurveTo(s * .1, s * .55, 0, s * .5); c.quadraticCurveTo(-s * .5, s * .5, -s * .35, s * .1); c.quadraticCurveTo(-s * .25, s * .3, -s * .1, s * .1); c.quadraticCurveTo(-s * .2, -s * .2, 0, -s * .55); c.fill(); },
  tent: (c, s) => { c.beginPath(); c.moveTo(0, -s * .5); c.lineTo(s * .6, s * .45); c.lineTo(-s * .6, s * .45); c.closePath(); c.fill(); c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.moveTo(0, -s * .1); c.lineTo(s * .22, s * .45); c.lineTo(-s * .22, s * .45); c.closePath(); c.fill(); },
  anvil: (c, s) => { c.fillRect(-s * .55, -s * .3, s * 1.1, s * .25); c.fillRect(-s * .25, -s * .05, s * .5, s * .3); c.fillRect(-s * .4, s * .25, s * .8, s * .2); c.beginPath(); c.moveTo(s * .55, -s * .3); c.lineTo(s * .75, -s * .2); c.lineTo(s * .55, -s * .05); c.fill(); },
  saw: (c, s) => { c.beginPath(); c.arc(0, 0, s * .42, 0, TAU); c.fill(); for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; c.beginPath(); c.moveTo(Math.cos(a) * s * .38, Math.sin(a) * s * .38); c.lineTo(Math.cos(a + .2) * s * .58, Math.sin(a + .2) * s * .58); c.lineTo(Math.cos(a + .45) * s * .38, Math.sin(a + .45) * s * .38); c.fill(); } c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.arc(0, 0, s * .1, 0, TAU); c.fill(); },
  wall: (c, s) => { for (let i = 0; i < 4; i++) { const x = -s * .55 + i * s * .37; c.fillRect(x, -s * .2 + (i % 2) * s * .1, s * .27, s * .7); c.beginPath(); c.moveTo(x, -s * .2 + (i % 2) * s * .1); c.lineTo(x + s * .135, -s * .5 + (i % 2) * s * .1); c.lineTo(x + s * .27, -s * .2 + (i % 2) * s * .1); c.fill(); } },
  tower: (c, s) => { c.fillRect(-s * .22, -s * .1, s * .44, s * .65); c.fillRect(-s * .4, -s * .25, s * .8, s * .18); c.beginPath(); c.moveTo(-s * .45, -s * .25); c.lineTo(0, -s * .6); c.lineTo(s * .45, -s * .25); c.fill(); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(-s * .08, s * .2, s * .16, s * .3); },
  antler: (c, s) => { c.lineWidth = s * .12; c.strokeStyle = c.fillStyle; c.lineCap = 'round'; for (const m of [-1, 1]) { c.beginPath(); c.moveTo(m * s * .1, s * .5); c.quadraticCurveTo(m * s * .45, s * .1, m * s * .35, -s * .5); c.moveTo(m * s * .3, s * .05); c.lineTo(m * s * .55, -s * .15); c.moveTo(m * s * .35, -s * .25); c.lineTo(m * s * .6, -s * .4); c.stroke(); } },
  meat: (c, s) => { c.beginPath(); c.ellipse(0, 0, s * .55, s * .38, -0.4, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,255,255,.7)'; c.beginPath(); c.ellipse(s * .1, -s * .05, s * .2, s * .12, -0.4, 0, TAU); c.fill(); },
  crate: (c, s) => { c.fillRect(-s * .5, -s * .5, s, s); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(-s * .5, -s * .08, s, s * .16); c.fillRect(-s * .08, -s * .5, s * .16, s); },
  shield: (c, s) => { c.beginPath(); c.moveTo(0, -s * .55); c.lineTo(s * .5, -s * .35); c.quadraticCurveTo(s * .5, s * .3, 0, s * .6); c.quadraticCurveTo(-s * .5, s * .3, -s * .5, -s * .35); c.closePath(); c.fill(); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(-s * .06, -s * .35, s * .12, s * .7); c.fillRect(-s * .3, -s * .12, s * .6, s * .12); },
  hall: (c, s) => { c.fillRect(-s * .55, -s * .05, s * 1.1, s * .55); c.beginPath(); c.moveTo(-s * .65, -s * .05); c.lineTo(0, -s * .55); c.lineTo(s * .65, -s * .05); c.fill(); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(-s * .12, s * .15, s * .24, s * .35); c.fillStyle = '#F2C14E'; c.fillRect(-s * .04, -s * .9, s * .08, s * .4); c.fillRect(0, -s * .9, s * .3, s * .18); },
  pick: (c, s) => { c.lineWidth = s * .12; c.strokeStyle = c.fillStyle; c.lineCap = 'round'; c.beginPath(); c.moveTo(-s * .4, s * .5); c.lineTo(s * .3, -s * .2); c.stroke(); c.lineWidth = s * .16; c.beginPath(); c.moveTo(-s * .15, -s * .45); c.quadraticCurveTo(s * .3, -s * .45, s * .6, -s * .05); c.stroke(); },
  gold: (c, s) => { c.beginPath(); c.moveTo(-s * .4, -s * .2); c.lineTo(s * .4, -s * .2); c.lineTo(s * .55, s * .25); c.lineTo(-s * .55, s * .25); c.closePath(); c.fill(); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(-s * .55, s * .1, s * 1.1, s * .15); },
  gate: (c, s) => { c.fillRect(-s * .55, -s * .5, s * .15, s); c.fillRect(s * .4, -s * .5, s * .15, s); c.fillRect(-s * .55, -s * .5, s * 1.1, s * .15); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(-s * .35, -s * .3, s * .7, s * .8); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -s * .2); c.lineTo(s * .22, s * .1); c.lineTo(s * .08, s * .1); c.lineTo(s * .08, s * .4); c.lineTo(-s * .08, s * .4); c.lineTo(-s * .08, s * .1); c.lineTo(-s * .22, s * .1); c.closePath(); c.fill(); },
  bag: (c, s) => { c.beginPath(); c.roundRect(-s * .4, -s * .3, s * .8, s * .8, s * .15); c.fill(); c.fillRect(-s * .15, -s * .55, s * .3, s * .3); },
  axe: (c, s) => { c.lineWidth = s * .12; c.strokeStyle = c.fillStyle; c.lineCap = 'round'; c.beginPath(); c.moveTo(-s * .45, s * .5); c.lineTo(s * .3, -s * .25); c.stroke(); c.beginPath(); c.moveTo(s * .1, -s * .55); c.quadraticCurveTo(s * .6, -s * .45, s * .55, s * .05); c.lineTo(s * .3, -s * .25); c.closePath(); c.fill(); },
  speed: (c, s) => { for (let i = 0; i < 3; i++) { c.fillRect(-s * .55, -s * .3 + i * s * .3, s * (.5 + i * .2), s * .16); } },
  boots: (c, s) => { c.fillRect(-s * .3, -s * .5, s * .35, s * .7); c.fillRect(-s * .3, s * .1, s * .8, s * .3); },
  heart: (c, s) => { c.beginPath(); c.moveTo(0, s * .5); c.bezierCurveTo(-s * .8, -s * .1, -s * .3, -s * .7, 0, -s * .3); c.bezierCurveTo(s * .3, -s * .7, s * .8, -s * .1, 0, s * .5); c.fill(); },
  log: (c, s) => { c.fillRect(-s * .55, -s * .2, s * 1.1, s * .4); c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(s * .5, 0, s * .12, s * .2, 0, 0, TAU); c.fill(); }
};
const decalCache = {};
Object.assign(G, {
  padDecals: {}, zoneDecals: {}, wallSegs: [], baseGates: [], wallBlockers: [],
  initBuildings() {
    const sb = this.savedBuildings || {};
    for (const type in DATA.buildings) {
      const d = DATA.buildings[type];
      const positions = d.multi || [[d.x, d.z]];
      positions.forEach((pos, i) => {
        const id = d.multi ? type + i : type;
        const b = { id, type, level: 1, built: false, funded: 0, visible: false, x: pos[0], z: pos[1], rot: d.rot || 0, cash: 0, queue: 0, queueVal: 0, hp: 300, maxHp: 300, wrecked: false, pop: 0, cd: 0, acc: 0, smokeT: 0 };
        if (type === 'post' || type === 'fire') { b.built = true; b.visible = true; }
        if (type === 'lumber' || type === 'armory') b.visible = true;
        const s = sb[id]; if (s) { b.level = s.level === undefined ? 1 : s.level; b.built = !!s.built; b.funded = s.funded || 0; b.cash = s.cash || 0; b.queue = s.queue || 0; b.queueVal = (s.queue || 0) * 5; b.mode = s.mode === 'value' ? 'value' : 'near'; b.visible = !!s.visible || b.visible; b.hp = s.hp === undefined ? b.maxHp : s.hp; }
        b.maxHp = 500 + 250 * Math.max(1, b.level); if (!s || s.hp === undefined || b.hp > b.maxHp) b.hp = b.maxHp; b.wrecked = b.hp <= 0;
        this.b[id] = b;
      });
    }
    this.refreshVisibility(); this.initWalls(); this.refreshPads(); for (const id in this.b) if (this.b[id].built) this.addBuildingBlocker(this.b[id]);
    if (this.savedWalls && this.savedWalls.hp) { for (const s in this.savedWalls.hp) if (this.walls.hp[s] !== undefined) this.walls.hp[s] = this.savedWalls.hp[s]; }
    this.rigArcher = Models.human({ id: 'archer', parka: hex(0x2E8B57), pants: C.brownD, hat: hex(0x2E6B47) });
    this.rigMerchant = Models.merchant();
  },
  refreshVisibility() {
    for (const id in this.b) { const b = this.b[id]; const d = DATA.buildings[b.type]; if (b.built) { b.visible = true; continue; }
      if (d.zone !== undefined) { b.visible = !!this.zones[d.zone]; continue; }
      if (d.multi) { const idx = parseInt(id.replace(b.type, '')); const prevBuilt = idx === 0 ? this.built(d.unlockAfter) : (this.b[b.type + (idx - 1)] && this.b[b.type + (idx - 1)].built); b.visible = !!prevBuilt; continue; }
      if (d.unlockAfter) b.visible = this.built(d.unlockAfter); }
  },
  padTexture(icon, label, sub) {
    const key = icon + '|' + label + '|' + (sub || ''); if (decalCache[key]) return decalCache[key];
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const c = cv.getContext('2d');
    c.clearRect(0, 0, 256, 256);
    c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 7; c.setLineDash([20, 13]); c.lineCap = 'round'; c.beginPath(); c.roundRect(14, 14, 228, 228, 26); c.stroke(); c.setLineDash([]);
    c.fillStyle = 'rgba(255,255,255,0.14)'; c.beginPath(); c.roundRect(14, 14, 228, 228, 26); c.fill();
    c.save(); c.translate(128, sub ? 92 : 100); c.fillStyle = '#ffffff'; c.shadowColor = 'rgba(0,0,0,0.25)'; c.shadowBlur = 6; (ICONS[icon] || ICONS.crate)(c, 70); c.restore();
    c.fillStyle = '#ffffff'; c.font = 'bold 44px -apple-system, Helvetica, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 6; c.fillText(label, 128, sub ? 168 : 190);
    if (sub) { c.font = 'bold 26px -apple-system, Helvetica, Arial, sans-serif'; c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillText(sub, 128, 214); }
    const tex = this.R.createTexture(cv); decalCache[key] = tex; this._decalKeys = this._decalKeys || []; this._decalKeys.push(key);
    if (this._decalKeys.length > 60) { // evict oldest textures not in use
      const inUse = new Set(this.R.decals.map(d => d.tex)); for (let i = 0; i < this._decalKeys.length - 40; i++) { const k = this._decalKeys[i]; const t = decalCache[k]; if (t && !inUse.has(t)) { this.R.gl.deleteTexture(t); delete decalCache[k]; this._decalKeys.splice(i, 1); i--; } } }
    return tex;
  },
  refreshPads() {
    const R = this.R;
    for (const id in this.b) {
      const b = this.b[id]; const d = DATA.buildings[b.type]; let dec = this.padDecals[id];
      const show = b.visible && !b.built;
      if (!show) { if (dec) dec.visible = false; continue; }
      const cost = this.padCost(b); const step = Math.max(1, Math.round(cost / 25)); const rem = Math.ceil(Math.max(0, cost - b.funded) / step) * step; const tex = this.padTexture(d.icon, fmtMoney(rem), d.name);
      if (!dec) { dec = R.addDecal(tex, b.x, b.z, Math.max(d.w, 3.2), Math.max(d.d, 3.2)); this.padDecals[id] = dec; } dec.tex = tex; dec.visible = true; b.padDirty = false;
    }
    for (let i = 1; i < DATA.zones.length; i++) {
      const zd = DATA.zones[i]; let dec = this.zoneDecals[i]; if (this.zones[i]) { if (dec) dec.visible = false; continue; }
      if (!this.zoneOpenable(i)) { if (dec) dec.visible = false; continue; }
      const f = (this.zoneFund && this.zoneFund[i]) || 0; const zstep = Math.max(1, Math.round(zd.cost / 25)); const tex = this.padTexture('gate', fmtMoney(Math.ceil(Math.max(0, zd.cost - f) / zstep) * zstep), zd.name);
      const gp = this.zoneGateMarker(i); if (!dec) { dec = R.addDecal(tex, gp[0], gp[1], 3.6, 3.6); this.zoneDecals[i] = dec; } dec.tex = tex; dec.visible = true;
    }
    // collect markers under cash piles
    if (!this.pileTex) { const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128; const c = cv.getContext('2d'); c.strokeStyle = 'rgba(80,220,120,0.9)'; c.lineWidth = 6; c.setLineDash([12, 9]); c.beginPath(); c.arc(64, 64, 54, 0, TAU); c.stroke(); c.fillStyle = 'rgba(80,220,120,0.14)'; c.beginPath(); c.arc(64, 64, 54, 0, TAU); c.fill(); c.fillStyle = '#fff'; c.font = 'bold 44px -apple-system, Helvetica, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = 'rgba(0,0,0,.3)'; c.shadowBlur = 4; c.fillText('$', 64, 66); this.pileTex = R.createTexture(cv); }
    this.pileDecals = this.pileDecals || {};
    for (const id in this.b) { const b = this.b[id]; const wants = b.built && (b.type === 'sawmill' || b.type === 'butcher' || b.type === 'post'); let dec = this.pileDecals[id]; if (!wants) { if (dec) dec.visible = false; continue; } const cp = this.cashPilePos(b); if (!dec) { dec = R.addDecal(this.pileTex, cp[0], cp[1], 3.4, 3.4); this.pileDecals[id] = dec; } dec.visible = true; }
    // sell zone at post
    if (!this.sellDecal) { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const c = cv.getContext('2d'); c.strokeStyle = 'rgba(80,220,120,0.95)'; c.lineWidth = 10; c.setLineDash([22, 14]); c.beginPath(); c.arc(128, 128, 112, 0, TAU); c.stroke(); c.fillStyle = 'rgba(80,220,120,0.18)'; c.beginPath(); c.arc(128, 128, 112, 0, TAU); c.fill(); c.fillStyle = '#fff'; c.font = 'bold 54px -apple-system, Helvetica, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = 'rgba(0,0,0,.3)'; c.shadowBlur = 6; c.fillText('SELL', 128, 128); const post = this.b.post; this.sellDecal = R.addDecal(R.createTexture(cv), post.x, post.z + 2.6, 4.6, 4.6); }
  },
  updatePadDecals() { let any = false; for (const id in this.b) if (this.b[id].padDirty) any = true; if (any || this.zonePadDirty !== undefined) { this.refreshPads(); this.zonePadDirty = undefined; } },
  buildBuilding(b) {
    b.built = true; b.level = 1; b.pop = 1; b.maxHp = 750; b.hp = 750; b.wrecked = false; this.stats.builds++; Sound.play('build'); this.shake = Math.max(this.shake, 0.15);
    this.burst(b.x, 1, b.z, 26, C.woodL, { speed: 6, up: 8, life: 1.1 }); this.burst(b.x, 1, b.z, 16, C.gold, { speed: 5, up: 7, life: 1.0 });
    UI.toast(`${DATA.buildings[b.type].name} built!`, 'good');
    if (b.type === 'wall') this.initWalls();
    this.refreshVisibility(); this.refreshPads(); this.syncWorkers(); this.addBuildingBlocker(b); this.saveDirty = true;
    if (b.type === 'armory') UI.hint('Tap the Armory (or the button below) to buy upgrades.');
  },
  addBuildingBlocker(b) { const d = DATA.buildings[b.type]; if (b.blocker) return; this.navInvalidate(); b.blocker = { x0: b.x - d.w / 2 + 0.3, x1: b.x + d.w / 2 - 0.3, z0: b.z - d.d / 2 + 0.3, z1: b.z + d.d / 2 - 0.5, kind: 'building', id: b.id }; if (b.type !== 'wall' && b.type !== 'fire') this.blockers.push(b.blocker); },
  canUpgrade(b) { const d = DATA.buildings[b.type]; if (b.level >= d.max) return { ok: false, why: 'MAX' }; const cost = this.buildingUpCost(b); const stone = d.stone ? d.stone(b.level + 1) : 0, gold = d.gold ? d.gold(b.level + 1) : 0; return { ok: this.money >= cost && this.vault.stone >= stone && this.vault.gold >= gold, cost, stone, gold }; },
  upgradeBuilding(b) {
    const c = this.canUpgrade(b); if (!c.ok) { Sound.play('error'); return false; }
    this.money -= c.cost; this.vault.stone -= c.stone; this.vault.gold -= c.gold; b.level++; b.pop = 0.6; b.maxHp = 500 + 250 * b.level; b.hp = b.maxHp; b.wrecked = false; Sound.play(DATA.buildings[b.type].worker ? 'build' : 'upgrade');
    this.burst(b.x, 1.5, b.z, 14, C.gold, { speed: 4, up: 6 }); this.floatText(b.x, 3, b.z, 'Level ' + b.level + '!', 'good');
    if (b.type === 'wall') { this.walls.max = this.wallMaxHp(b.level); for (const s in this.walls.hp) this.walls.hp[s] = this.walls.max; for (const r of this.wallBlockers) r.broken = false; }
    this.syncWorkers(); this.saveDirty = true; return true;
  },
  buyUpgrade(k) {
    const cost = this.upgradeCost(k); if (this.upgrades[k] >= this.upgradeMax(k)) { Sound.play('error'); return false; } if (!this.spend(cost)) { Sound.play('error'); return false; }
    this.upgrades[k]++; this.stats.upgrades++; Sound.play('upgrade'); const p = this.player; this.burst(p.x, 1.5, p.z, 12, C.gold, { speed: 3, up: 5 }); this.floatText(p.x, 2.4, p.z, DATA.upgrades[k].name + ' ' + this.upgrades[k], 'good');
    if (k === 'hp') p.hp = Math.min(this.playerStat('hp'), p.hp + 30); this.saveDirty = true; return true;
  },
  // ---- walls
  initWalls() {
    this.navInvalidate(); const B = DATA.base; this.wallSegs = []; for (const r of this.wallBlockers) { const i = this.blockers.indexOf(r); if (i >= 0) this.blockers.splice(i, 1); } this.wallBlockers = []; this.baseGates = [];
    if (!this.built('wall')) return; const lvl = this.level('wall'); this.walls.max = this.wallMaxHp(lvl); if (!this.walls.hp.n) this.walls.hp = { n: this.walls.max, s: this.walls.max, e: this.walls.max, w: this.walls.max };
    const seg = (x, z, rot, side) => this.wallSegs.push({ x, z, rot, side });
    for (let x = B.x0 + 1; x < B.x1; x += 2) { if (Math.abs(x) > 2.5) seg(x, B.z0, 0, 'n'); seg(x, B.z1, 0, 's'); }
    for (let z = B.z0 + 1; z < B.z1; z += 2) { if (Math.abs(z - 1) > 2.5) { seg(B.x1, z, HPI, 'e'); seg(B.x0, z, HPI, 'w'); } }
    const add = (r) => { this.wallBlockers.push(r); this.blockers.push(r); };
    add({ x0: B.x0 - 0.4, x1: -3, z0: B.z0 - 0.4, z1: B.z0 + 0.4, kind: 'wall', side: 'n' }); add({ x0: 3, x1: B.x1 + 0.4, z0: B.z0 - 0.4, z1: B.z0 + 0.4, kind: 'wall', side: 'n' }); add({ x0: -3, x1: 3, z0: B.z0 - 0.4, z1: B.z0 + 0.4, kind: 'gate', side: 'n' });
    add({ x0: B.x0 - 0.4, x1: B.x1 + 0.4, z0: B.z1 - 0.4, z1: B.z1 + 0.4, kind: 'wall', side: 's' });
    add({ x0: B.x1 - 0.4, x1: B.x1 + 0.4, z0: B.z0 - 0.4, z1: -1, kind: 'wall', side: 'e' }); add({ x0: B.x1 - 0.4, x1: B.x1 + 0.4, z0: 3, z1: B.z1 + 0.4, kind: 'wall', side: 'e' }); add({ x0: B.x1 - 0.4, x1: B.x1 + 0.4, z0: -1, z1: 3, kind: 'gate', side: 'e' });
    add({ x0: B.x0 - 0.4, x1: B.x0 + 0.4, z0: B.z0 - 0.4, z1: -1, kind: 'wall', side: 'w' }); add({ x0: B.x0 - 0.4, x1: B.x0 + 0.4, z0: 3, z1: B.z1 + 0.4, kind: 'wall', side: 'w' }); add({ x0: B.x0 - 0.4, x1: B.x0 + 0.4, z0: -1, z1: 3, kind: 'gate', side: 'w' });
    this.baseGates = [{ x: 0, z: B.z0, horiz: true, open: 0, side: 'n' }, { x: B.x1, z: 1, horiz: false, open: 0, side: 'e' }, { x: B.x0, z: 1, horiz: false, open: 0, side: 'w' }];
    for (const r of this.wallBlockers) r.broken = this.walls.hp[r.side] <= 0; this.navInvalidate();
  },
  wallMaxHp(lvl) { return Math.round(1200 * lvl * (1 + 0.12 * (lvl - 1))); },
  damageWall(rect, dmg) { const s = rect.side; if (this.walls.hp[s] === undefined) return; this.walls.hp[s] -= dmg; if (this.walls.hp[s] <= 0) { this.walls.hp[s] = 0; for (const r of this.wallBlockers) if (r.side === s) r.broken = true; UI.toast({ n: 'North', s: 'South', e: 'East', w: 'West' }[s] + ' wall breached!', 'warn'); Sound.play('error'); this.shake = Math.max(this.shake, 0.3); } },
  updateWalls(dt) {
    if (!this.built('wall')) return; const lvl = this.level('wall'); const regen = this.night.active ? 0 : 6 * lvl; const p = this.player;
    for (const s in this.walls.hp) { const h = this.walls.hp[s]; if (h < this.walls.max) { let r = regen; // player repairing nearby
        const B = DATA.base; const near = s === 'n' ? Math.abs(p.z - B.z0) < 3 : s === 's' ? Math.abs(p.z - B.z1) < 3 : s === 'e' ? Math.abs(p.x - B.x1) < 3 : Math.abs(p.x - B.x0) < 3; if (near && !this.night.active) r += this.walls.max * 0.15;
        this.walls.hp[s] = Math.min(this.walls.max, h + r * dt); if (this.walls.hp[s] > this.walls.max * 0.25) for (const rr of this.wallBlockers) if (rr.side === s && rr.broken) { rr.broken = false; } } }
    for (const g of this.baseGates) { let want = 0; for (const w of [p, ...this.workers]) { if (!w.dead && !w.hidden && dist2(w.x, w.z, g.x, g.z) < 4.5 * 4.5) { want = 1; break; } } g.open += (want - g.open) * Math.min(1, dt * 4); }
  },
  // ---- per frame building logic
  updateBuildings(dt) {
    const wh = this.level('warehouse'); const mult = this.incomeMult();
    for (const id in this.b) {
      const b = this.b[id]; if (!b.built) continue; const d = DATA.buildings[b.type]; if (b.pop > 0) b.pop -= dt * 1.8;
      if (b.wrecked) { b.smokeT -= dt; if (b.smokeT <= 0) { b.smokeT = 0.25; this.puff(b.x + rand(-1, 1), 1.5, b.z + rand(-1, 1), 1, hex(0x555555)); } continue; }
      if (b.type === 'sawmill' || b.type === 'butcher') {
        const cap = this.cashCap(b); if (b.queue > 0 && b.cash < cap) { const rate = 1 + 0.3 * (b.level - 1); b.acc += rate * dt; const n = Math.min(b.queue, Math.floor(b.acc)); if (n > 0) { b.acc -= n; const per = b.queueVal / b.queue; b.queue -= n; b.queueVal -= per * n; b.cash += per * n; if (b.type === 'sawmill') { b.sawSpin = (b.sawSpin || 0) + 1; this.burst(b.x, 1.0, b.z + 0.6, 2, C.woodL, { speed: 2, up: 3, size: 0.6, life: 0.5 }); } else { b.smokeT -= dt; if (b.smokeT <= 0) { b.smokeT = 0.4; this.puff(b.x + 0.9, 3.2, b.z - 0.5, 1, hex(0xBFC4CC)); } } } }
      }
      if (b.type === 'butcher') { b.smokeT -= dt; if (b.smokeT <= 0) { b.smokeT = 0.6; this.puff(b.x + 0.9, 3.2, b.z - 0.5, 1, hex(0xC9CDD3)); } }
      if (b.type === 'tower') this.updateTower(b, dt);
      if (b.type === 'fire') { b.smokeT -= dt; if (b.smokeT <= 0) { b.smokeT = 0.5; this.puff(b.x, 1.4, b.z, 1, hex(0xD0D4DA)); } }
    }
    // hall auto-collect
    const hall = this.b.hall; if (hall.built && hall.level >= 3) { this.autoT = (this.autoT || 0) - dt; if (this.autoT <= 0) { this.autoT = 2.5; for (const id in this.b) { const b = this.b[id]; if (b.built && b.cash >= 1) { const n = Math.floor(b.cash); b.cash -= n; this.addMoney(n, false); const cp = this.cashPilePos(b); this.cashFly(cp[0], 0.5, cp[1], n); } } } }
    this.updateWalls(dt); this.updatePadDecals();
  },
  cashCap(b) { const wh = this.level('warehouse'); return (b.type === 'post' ? 600 : 800) * b.level * (1 + wh) * this.legacyMult(); },
  queueCap(b) { const wh = this.level('warehouse'); return 40 * b.level + 20 * wh; },
  deliver(worker, b) { // worker unloads carried items into building b. returns true if all unloaded
    while (worker.carry.length) {
      const it = worker.carry[worker.carry.length - 1];
      if (it.type === 'stone' || it.type === 'gold') { this.vault[it.type] += 1; this.stats[it.type] += 1; worker.carry.pop(); UI.bump(it.type); continue; }
      const price = this.sellPrice(it.type, it.mult);
      if (b.type === 'post') { const cap = this.cashCap(b); if (b.cash >= cap) return false; b.cash += price; this.logIncome(price); this.stats.earned += price; worker.carry.pop(); this.stats.sold++; continue; }
      if ((b.type === 'sawmill' && it.type === 'wood') || (b.type === 'butcher' && it.type === 'meat')) { if (b.queue >= this.queueCap(b)) return false; b.queue += 1; const v = price * (1 + 0.15 * b.level); b.queueVal += v; this.logIncome(v); this.stats.earned += v; worker.carry.pop(); continue; }
      // wrong building type: sell at post value
      const cap = this.cashCap(this.b.post); if (this.b.post.cash >= cap) return false; this.b.post.cash += price; this.logIncome(price); this.stats.earned += price; worker.carry.pop();
    }
    return true;
  },
  updateTower(b, dt) {
    b.cd -= dt; if (b.cd > 0) return; const range = 11 + b.level; let best = null, bd = range * range;
    for (const e of this.bears) { if (e.dead || e.sleep) continue; if (!e.raider && e.state !== 'chase') continue; const d = dist2(e.x, e.z, b.x, b.z); if (d < bd) { bd = d; best = e; } }
    if (!best) { b.cd = 0.2; return; }
    b.cd = 1 / (0.8 + 0.12 * b.level); const H = 3.2 + Math.min(b.level, 4) * 0.3; this.shootArrow(b.x, H + 1.3, b.z, best, 10 + 8 * (b.level - 1)); b.aim = Math.atan2(best.x - b.x, best.z - b.z);
  },
  drawBuildings() {
    const R = this.R; const m = M4.create(); const c = R.camTarget; const cull = 62 * 62; const t = this.time;
    for (const id in this.b) {
      const b = this.b[id]; if (!b.built) continue; if (dist2(b.x, b.z, c[0], c[2]) > cull) continue; const d = DATA.buildings[b.type];
      let s = 1; if (b.pop > 0) { const k = 1 - b.pop; s = k < 0.6 ? easeOut(k / 0.6) * 1.12 : lerp(1.12, 1, (k - 0.6) / 0.4); }
      const tint = b.wrecked ? 0.45 : 1;
      if (b.type !== 'wall') R.draw(Models.building(b.type, b.level), M4.trs(m, b.x, 0, b.z, 0, b.rot, 0, s, s, s), tint, tint, tint, 0);
      if (b.type === 'fire') { const f = 1 + Math.sin(t * 14) * 0.12 + Math.sin(t * 23) * 0.06; const glow = this.night.active ? 0.5 : 0.25; R.draw(Models.flame(), M4.trs(m, b.x, 0.15, b.z, 0, t * 2, 0, f, f * 1.15, f), 1, 1, 1, glow); R.draw(Models.flame(), M4.trs(m, b.x + 0.15, 0.1, b.z - 0.1, 0, -t * 3, 0, f * 0.7, f * 0.8, f * 0.7), 1, 1, 1, glow); if (b.level >= 3) R.draw(Models.flame(), M4.trs(m, b.x + 1.3, 1.85, b.z - 1.3, 0, t * 4, 0, 0.5, 0.6, 0.5), 1, 1, 1, glow); }
      if (b.type === 'post') { this.drawHuman(this.rigMerchant, { x: b.x + 0.2, z: b.z - 0.2, rot: 0, phase: 0, moveAmt: 0, action: 'idle', id: 7, s: 1 }, null); }
      if (b.type === 'tower') { const H = 3.2 + Math.min(b.level, 4) * 0.3; const rotA = b.aim !== undefined ? b.aim : Math.PI; this.drawHuman(this.rigArcher, { x: b.x, z: b.z, y: H + 0.08, rot: rotA, phase: 0, moveAmt: 0, action: 'stand', role: 'archer', id: 11 + b.x, s: 0.9 }, Models.bow()); }
      if (b.type === 'sawmill' && b.queue > 0 && !b.wrecked) { R.draw(Models.item('wood'), M4.trs(m, b.x - 0.4, 0.75, b.z + 0.5, 0, 0, 0, 1, 1, 1)); }
      // queue pile (wood/meat)
      if ((b.type === 'sawmill' || b.type === 'butcher') && b.queue > 0) { const n = Math.min(12, b.queue); const it = b.type === 'sawmill' ? 'wood' : 'meat'; const h = DATA.items[it].h; for (let i = 0; i < n; i++) R.draw(Models.item(it), M4.trs(m, b.x - d.w / 2 - 0.9 + (i % 2) * 0.5, Math.floor(i / 2) * h, b.z + 1.0 - (i % 2) * 0.1, 0, (i % 2) * 0.2, 0, 1, 1, 1)); }
      // cash pile
      if (b.cash >= 1) { const cp = this.cashPilePos(b); const cap = this.cashCap(b); const n = Math.min(30, Math.ceil(b.cash / Math.max(20, cap / 30))); for (let i = 0; i < n; i++) { const col = i % 3, row = Math.floor(i / 3) % 2, lay = Math.floor(i / 6); R.draw(Models.item('cash'), M4.trs(m, cp[0] - 0.55 + col * 0.55, lay * 0.12, cp[1] - 0.2 + row * 0.36, 0, (i * 0.37) % 0.3 - 0.15, 0, 1, 1, 1)); } }
    }
    // walls
    if (this.built('wall')) {
      const lvl = this.level('wall'); const ws = Models.wallSeg(lvl); const B = DATA.base;
      for (const sgm of this.wallSegs) { if (dist2(sgm.x, sgm.z, c[0], c[2]) > cull) continue; const broken = this.walls.hp[sgm.side] <= 0; const dmgf = this.walls.hp[sgm.side] / this.walls.max; const tilt = broken ? 1.35 : (1 - dmgf) * 0.18 * Math.sin(sgm.x * 3 + sgm.z * 2); R.draw(ws, M4.trs(m, sgm.x, broken ? -0.3 : 0, sgm.z, tilt, sgm.rot, 0, 1, 1, 1), broken ? 0.7 : 1, broken ? 0.7 : 1, broken ? 0.7 : 1, 0); }
      const gp = Models.gatePost(), gd = Models.gateDoor();
      for (const g of this.baseGates) { if (dist2(g.x, g.z, c[0], c[2]) > cull) continue; const ry = g.horiz ? 0 : HPI; const broken = this.walls.hp[g.side] <= 0; const ang = broken ? 1.9 : g.open * 1.9 * (g.side === 'n' ? -1 : 1);
        const hw = g.horiz ? 3 : 2; const px = g.horiz ? [g.x - hw, g.x + hw] : [g.x, g.x], pz = g.horiz ? [g.z, g.z] : [g.z - hw, g.z + hw]; const sc = g.horiz ? 2.3 : 1.55;
        R.draw(gp, M4.trs(m, px[0], 0, pz[0], 0, 0, 0, 1.1, 1.1, 1.1)); R.draw(gp, M4.trs(m, px[1], 0, pz[1], 0, 0, 0, 1.1, 1.1, 1.1));
        R.draw(gd, M4.trs(m, px[0], broken ? -0.5 : 0, pz[0], broken ? 1.3 : 0, ry - ang, 0, sc, 1.1, 1)); R.draw(gd, M4.trs(m, px[1], broken ? -0.5 : 0, pz[1], broken ? 1.3 : 0, ry + Math.PI + ang, 0, sc, 1.1, 1));
        if (this.nightFactor > 0.05) { const f = 0.45 + Math.sin(t * 15 + g.x) * 0.06; const glow = 0.35 + this.nightFactor * 0.3; R.draw(Models.flame(), M4.trs(m, px[0], 2.3, pz[0], 0, t * 3, 0, f, f * 1.2, f), 1, 1, 1, glow); R.draw(Models.flame(), M4.trs(m, px[1], 2.3, pz[1], 0, -t * 3, 0, f, f * 1.2, f), 1, 1, 1, glow); } }
    }
    // fx rings (boss slam)
    for (let i = this.fx.length - 1; i >= 0; i--) { const f = this.fx[i]; f.t += this.dt * 1.5; if (f.t >= 1) { this.fx.splice(i, 1); continue; } const r = 1 + f.t * 6; R.draw(Models.ring(), M4.trs(m, f.x, 0.05, f.z, 0, 0, 0, r, 1, r), 1, 1, 1, 1 - f.t); }
  }
});

// ===== 13_workers.js =====
// ---------------------------------------------------------------------------
// Workers: lumberjacks, hunters, guards, miners, prospectors
//  - A* path following over the nav grid (+ local sliding around trees)
//  - go home and sleep at dusk (gatherers & hunters), guards stay on duty
//  - death is permanent: the building loses a level so the worker can be re-hired
//  - safety net: a worker that makes no progress for 10 s walks home and resets
// ---------------------------------------------------------------------------
Object.assign(G, {
  workerId: 1, workerRigs: {},
  workerRig(role) { if (!this.workerRigs[role]) { const d = DATA.workers[role]; this.workerRigs[role] = Models.human({ id: 'w_' + role, parka: hex(d.parka), pants: C.navy, helmet: d.helmet, mitt: C.brownD }); } return this.workerRigs[role]; },
  workerTool(role) { const t = DATA.workers[role].tool; return t === 'axe' ? Models.axe() : t === 'spear' ? Models.spear() : Models.pickaxe(); },
  syncWorkers() {
    // a save carries the crew's positions and jobs: put them back first, then fill any gaps from home
    if (this.savedWorkers) { for (const sw of this.savedWorkers) { const b = this.b[sw.h]; const d = b && DATA.buildings[b.type]; if (!b || !b.built || !d || d.worker !== sw.r) continue; if (this.workers.filter(w => w.homeId === sw.h && !w.dead).length >= b.level) continue; this.restoreWorker(sw, b); } this.savedWorkers = null; }
    for (const id in this.b) {
      const b = this.b[id]; const d = DATA.buildings[b.type]; if (!d.worker) continue; const want = b.built ? b.level : 0;
      const have = this.workers.filter(w => w.role === d.worker && w.homeId === id && !w.dead);
      for (let i = have.length; i < want; i++) this.makeWorker(d.worker, b);
      for (const w of have) this.applyWorkerStats(w, b);
    }
  },
  restoreWorker(sw, b) {
    const w = this.makeWorker(sw.r, b); w.pop = 0; w.x = sw.x; w.z = sw.z; w.hp = Math.max(1, Math.min(w.maxHp, sw.hp || w.maxHp)); w.hidden = !!sw.hid;
    w.carry = (sw.c || []).slice(0, w.cap).map(c => ({ type: c[0], mult: c[1] || 1, pop: 0 }));
    const keep = ['seek', 'idle', 'go', 'work', 'deliver', 'waitfull', 'gohome', 'patrol']; w.state = keep.includes(sw.s) ? sw.s : 'seek'; // fights and pickups restart from a fresh look around
    if ((w.state === 'go' || w.state === 'work') && sw.t >= 0) { const list = w.role === 'lumber' ? this.trees : this.rocks; const n = list[sw.t]; if (n && n.alive) { w.target = n; n.claimed = w.id; n.claimedT = this.time; } else w.state = 'seek'; }
    if (w.state === 'deliver' && sw.d && this.b[sw.d] && this.b[sw.d].built) w.deliverTo = this.b[sw.d];
    if (w.hidden) { w.state = 'gohome'; }
    return w;
  },
  applyWorkerStats(w, b) { const d = DATA.workers[w.role]; const wh = this.level('warehouse'); w.cap = d.cap + 3 * wh; w.speed = d.speed * (1 + 0.04 * (b.level - 1)) * (1 + this.legacy * 0.02); w.maxHp = d.hp + 20 * (b.level - 1); if (w.role === 'hunter') { w.dmg = 8 + 8 * (b.level - 1); w.maxHp = 80 + 30 * (b.level - 1); } if (w.role === 'guard') w.dmg = 15 + 8 * (b.level - 1); w.rangeZone = Math.max(DATA.buildings[b.type].zone || 0, Math.min(this.stats.king > 0 ? 4 : 3, Math.floor((b.level + 1) / 2))); },
  homeSpot(b) { const d = DATA.buildings[b.type]; const x = b.x - d.w / 2 + 1.2, z = b.z + d.d / 2 + 1.2; if (!d.zone && !this.inBase(x, z, -0.6)) return [x, b.z - d.d / 2 - 1.2]; /* backs onto the wall (Barracks): door on the north side */ return [x, z]; },
  makeWorker(role, b) {
    const hs = this.homeSpot(b);
    const w = { id: this.workerId++, role, homeId: b.id, x: hs[0] + rand(-0.6, 0.6), z: hs[1] + rand(-0.4, 0.4), rot: 0, hp: 60, maxHp: 60, carry: [], cap: 5, speed: 3.5, state: 'seek', target: null, wait: 0, phase: rand(0, 6), moveAmt: 0, action: 'idle', actionT: 0, swingT: 0, dead: false, deadT: 0, flash: 0, squash: 0, s: 0.95, stuck: 0, patrolT: 0, dmg: 8, rangeZone: 1, hitDone: false, kx: 0, kz: 0, hidden: false, path: null, pathI: 0, pathT: 0, progT: 0, bestD: 1e9 };
    this.applyWorkerStats(w, b); w.hp = w.maxHp; w.pop = 1; this.workers.push(w); return w;
  },
  isNight() { return this.night.active || this.dayT < 0.06; },
  isDusk() { return this.dayT >= DATA.duskStart || this.dayT < 0.06; },
  hurtWorker(w, dmg, fromX, fromZ) {
    if (w.dead || w.hidden) return; w.hp -= dmg; w.flash = 1; w.squash = 0.2; w.hurtT = 0.3; const dx = w.x - fromX, dz = w.z - fromZ, d = Math.hypot(dx, dz) || 1; w.kx = dx / d * 3; w.kz = dz / d * 3;
    if (w.hp <= 0) this.killWorker(w);
  },
  killWorker(w) {
    w.hp = 0; w.dead = true; w.deadT = 0; for (const it of w.carry) this.dropLoot(it.type, w.x, w.z, 1, it.mult); w.carry = []; Sound.play('die', 0.5);
    const home = this.b[w.homeId]; const d = DATA.buildings[home.type]; const name = DATA.workers[w.role].name;
    if (home.level > 0) home.level--; this.floatText(w.x, 2.2, w.z, name + ' lost!', 'warn');
    UI.toast(`A ${name.toLowerCase()} was killed! ${d.name} is now Lv${home.level} — hire again for less.`, 'warn'); this.saveDirty = true;
  },
  // ---- movement: A* path following with local sliding; returns true when within stopDist of (tx,tz)
  moveWorker(w, tx, tz, dt, stopDist = 1.0) {
    const dTot2 = dist2(w.x, w.z, tx, tz); if (dTot2 < stopDist * stopDist) { w.path = null; return true; }
    // (re)plan when the goal moved, the path is stale, or we have none
    w.pathT -= dt;
    if (!w.path || w.pathT <= 0 || dist2(tx, tz, w.pathTx, w.pathTz) > 2.5 * 2.5) {
      const p = this.findPath(w.x, w.z, tx, tz); w.path = p || [[tx, tz]]; w.pathI = 0; w.pathTx = tx; w.pathTz = tz; w.pathT = p ? 4 + Math.random() : 1.5; if (!p) w.pathFail = (w.pathFail || 0) + 1; else w.pathFail = 0;
    }
    // advance along the path
    // advance to the next waypoint when we can see it straight ahead (never skip a corner blindly)
    while (w.pathI < w.path.length - 1 && (dist2(w.x, w.z, w.path[w.pathI][0], w.path[w.pathI][1]) < 0.35 * 0.35 || this.navLosWorld(w.x, w.z, w.path[w.pathI + 1][0], w.path[w.pathI + 1][1]))) w.pathI++;
    const wp = w.path[Math.min(w.pathI, w.path.length - 1)]; const dx = wp[0] - w.x, dz = wp[1] - w.z, d = Math.hypot(dx, dz);
    if (d > 0.05) {
      let mx = dx / d, mz = dz / d;
      // trees/rocks are round: the collision push-out slides us around them. If we still make no headway, nudge sideways for a moment.
      const before = w.x * mx + w.z * mz; w.headway = w.headway === undefined ? 0 : w.headway;
      if (w.nudgeCd > 0) w.nudgeCd -= dt;
      if (w.stuck > 0.6 && !(w.nudgeT > 0) && !(w.nudgeCd > 0)) { w.nudgeT = 0.8; w.nudgeSide = Math.random() < 0.5 ? 1 : -1; w.stuck = 0; w.pathT = 0; }
      if (w.nudgeT > 0) { w.nudgeT -= dt; if (w.nudgeT <= 0) w.nudgeCd = 1.5; const nx = -mz * w.nudgeSide, nz = mx * w.nudgeSide; mx = mx * 0.5 + nx; mz = mz * 0.5 + nz; const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l; }
      w.x += mx * w.speed * dt; w.z += mz * w.speed * dt; w.rot = angleLerp(w.rot, Math.atan2(mx, mz), Math.min(1, dt * 10));
      w.moveDirX = mx; w.moveDirZ = mz;
    }
    return false;
  },
  updateWorkers(dt) {
    const p = this.player; const dusk = this.isDusk(), night = this.isNight();
    for (let i = this.workers.length - 1; i >= 0; i--) {
      const w = this.workers[i]; const home = this.b[w.homeId];
      if (!home || !home.built) { this.workers.splice(i, 1); continue; }
      if (!w.dead && this.workers.filter(x => x.homeId === w.homeId && !x.dead).indexOf(w) >= home.level) { this.workers.splice(i, 1); continue; }
      if (w.pop > 0) w.pop -= dt * 2;
      if (w.dead) { w.deadT += dt; if (w.deadT > 3.5) this.workers.splice(i, 1); else this.animateMover(w, dt, false, 0); continue; }
      if (w.kx || w.kz) { w.x += w.kx * dt; w.z += w.kz * dt; w.kx *= Math.max(0, 1 - dt * 8); w.kz *= Math.max(0, 1 - dt * 8); if (Math.abs(w.kx) < 0.05) w.kx = 0; if (Math.abs(w.kz) < 0.05) w.kz = 0; }
      const px = w.x, pz = w.z; let moving = false; w.action = 'idle';
      // ---- shelter at night (everyone except guards)
      if (w.role !== 'guard') {
        if (w.hidden) { if (!dusk) { w.hidden = false; w.state = 'seek'; w.hp = w.maxHp; w.pop = 1; } else { continue; } }
        else if (dusk && w.state !== 'gohome') { w.state = 'gohome'; w.target = null; w.path = null; }
        if (w.state === 'gohome') { const hs = this.homeSpot(home); if (this.moveWorker(w, hs[0], hs[1], dt, 1.6)) { if (dusk) { w.hidden = true; w.carry.length && this.deliverAll(w); } else w.state = 'seek'; } else moving = true; }
      }
      if (w.state !== 'gohome') {
        if (w.role === 'lumber' || w.role === 'miner' || w.role === 'goldminer') moving = this.gathererAI(w, home, dt);
        else if (w.role === 'hunter') moving = this.hunterAI(w, home, dt);
        else if (w.role === 'guard') moving = this.guardAI(w, home, dt);
      }
      this.collide(w, 0.4);
      // short-term stuck: no headway along the intended direction
      if (moving && w.moveDirX !== undefined && !(w.nudgeT > 0) && !w.kx && !w.kz) { const hw = (w.x - px) * w.moveDirX + (w.z - pz) * w.moveDirZ; if (hw < w.speed * dt * 0.3) w.stuck += dt; else w.stuck = Math.max(0, w.stuck - dt * 2); } else if (!moving) w.stuck = 0;
      // ---- safety net: no progress toward the goal for 10 s -> reset (walk home)
      if (moving) { const goal = w.path ? w.path[w.path.length - 1] : null; const gd = goal ? Math.sqrt(dist2(w.x, w.z, goal[0], goal[1])) : 0;
        if (!goal || !w.progGoal || dist2(goal[0], goal[1], w.progGoal[0], w.progGoal[1]) > 0.25) { w.progGoal = goal ? [goal[0], goal[1]] : null; w.bestD = 1e9; w.progT = 0; }
        if (gd < w.bestD - 0.8) { w.bestD = gd; w.progT = 0; } else { w.progT += dt; } if (w.progT > 10) { w.resetFrom = [w.x.toFixed(1), w.z.toFixed(1), w.state, goal ? goal[0].toFixed(1) + ',' + goal[1].toFixed(1) : '-']; w.progT = 0; w.bestD = 1e9; w.path = null; w.target = null; if (w.state === 'gohome') { const hs = this.homeSpot(home); w.x = hs[0]; w.z = hs[1]; } else w.state = 'seek'; w.resets = (w.resets || 0) + 1; } }
      else { w.progT = 0; w.bestD = 1e9; }
      // sway / animation
      const vx = (w.x - px) / Math.max(dt, 1e-4), vz = (w.z - pz) / Math.max(dt, 1e-4); const lx = Math.cos(w.rot) * vx - Math.sin(w.rot) * vz, lz = Math.sin(w.rot) * vx + Math.cos(w.rot) * vz; w.swayX = (w.swayX || 0) + (-lx * 0.1 - (w.swayX || 0)) * Math.min(1, dt * 6); w.swayZ = (w.swayZ || 0) + (lz * 0.1 - (w.swayZ || 0)) * Math.min(1, dt * 6);
      this.animateMover(w, dt, moving, Math.min(1, w.speed / 5));
      for (const it of w.carry) if (it.pop > 0) it.pop -= dt * 4;
    }
  },
  // walking distance estimate between two points: straight line, plus the detour through zone gates when they are in different zones
  gateChain(z) { return z === 4 ? [DATA.zones[1].gate, DATA.zones[4].gate] : z > 0 ? [DATA.zones[z].gate] : []; },
  walkDist(ax, az, bx, bz) {
    const za = this.zoneOf(ax, az), zb = this.zoneOf(bx, bz); if (za === zb) return Math.hypot(bx - ax, bz - az);
    const pts = [[ax, az]]; const ca = this.gateChain(za), cb = this.gateChain(zb);
    // leave zone a through its gates (innermost last), enter zone b through its gates (outermost first); shared gates cancel out
    let i = 0; while (i < ca.length && i < cb.length && ca[i] === cb[i]) i++;
    for (let k = ca.length - 1; k >= i; k--) pts.push(ca[k]); for (let k = i; k < cb.length; k++) pts.push(cb[k]); pts.push([bx, bz]);
    let d = 0; for (let k = 1; k < pts.length; k++) d += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); return d;
  },
  // how the crew of a building chooses work: 'near' (default) = closest first, working outward from home;
  // 'value' = best pay per minute of walking + working + hauling (richer far zones when they are worth the trip)
  gatherMode(w) { const h = this.b[w.homeId]; return h && h.mode === 'value' ? 'value' : 'near'; },
  pickNode(w, kinds) {
    let best = null, bs = -1e9; const list = kinds.includes('tree') ? this.trees : this.rocks; const mode = this.gatherMode(w);
    const drop = this.dropPoint(this.deliveryTarget(w)); const room = Math.max(1, w.cap - w.carry.length); const perHit = 0.9; // items per second while working
    for (const n of list) { if (!n.alive || (n.fall && n.fall > 0)) continue; if (!this.zones[n.zone] || n.zone > w.rangeZone) continue; if (n.kind === 'rock' && !kinds.includes(n.type)) continue; if (n.claimed && n.claimed !== w.id && n.claimedT > this.time - 8) continue;
      if (w.avoid && w.avoid === n && w.avoidT > this.time) continue;
      const mult = n.kind === 'rock' ? 1 : n.mult; // stone and gold are worth the same wherever they come from
      const out = this.walkDist(w.x, w.z, n.x, n.z); let score;
      if (mode === 'value') { const items = Math.min(room, Math.max(1, n.hp)); const back = this.walkDist(n.x, n.z, drop[0], drop[1]); const time = out / w.speed + items / perHit + (back / w.speed) * (items / room) + 1.5; score = mult * items / time; }
      else score = -out + (mult - 1) * 1.5 + Math.min(n.hp, 3) * 0.4; // closest first; a fuller or richer node breaks near-ties
      if (score > bs) { bs = score; best = n; } }
    if (best) { best.claimed = w.id; best.claimedT = this.time; }
    return best;
  },
  deliveryTarget(w) { if (w.role === 'lumber') { const s = this.b.sawmill; return s.built && !s.wrecked ? s : this.b.post; } if (w.role === 'hunter') { const s = this.b.butcher; return s.built && !s.wrecked ? s : this.b.post; } return this.b.post; },
  dropPoint(b) { const d = DATA.buildings[b.type]; return [b.x - d.w / 2 + 0.7, b.z + d.d / 2 + 1.1]; },
  // is there room for this worker's load at building b?
  hasRoom(w, b) { if (b.type === 'post') return b.cash < this.cashCap(b) - 1; return b.queue < this.queueCap(b); },
  // walk to the delivery building and unload. A full sawmill/smokehouse is not worth waiting at: sell at the Trading Post instead.
  deliverStep(w, dt) {
    let b = w.deliverTo && w.deliverTo.built && !w.deliverTo.wrecked ? w.deliverTo : null;
    if (!b) { b = this.deliveryTarget(w); if (!this.hasRoom(w, b) && b.type !== 'post' && this.hasRoom(w, this.b.post)) b = this.b.post; w.deliverTo = b; }
    const dp = this.dropPoint(b);
    if (!this.moveWorker(w, dp[0], dp[1], dt, 1.3)) return true;
    w.unloadT = (w.unloadT || 0) - dt;
    if (w.unloadT <= 0) { w.unloadT = 0.12; const ok = this.deliverOne(w, b);
      if (!ok) { if (b.type !== 'post' && this.hasRoom(w, this.b.post)) { w.deliverTo = this.b.post; this.fullWarn(b); } else { w.wait = 1.5; w.state = 'waitfull'; w.deliverTo = null; this.fullWarn(b); } }
      else if (!w.carry.length) { w.state = 'seek'; w.deliverTo = null; } }
    w.rot = angleLerp(w.rot, Math.atan2(b.x - w.x, b.z - w.z), Math.min(1, dt * 8)); return false;
  },
  deliverAll(w) { const b = this.deliveryTarget(w); let guard = 0; while (w.carry.length && guard++ < 100) { if (!this.deliverOne(w, b)) break; } },
  gathererAI(w, home, dt) {
    const kinds = w.role === 'lumber' ? ['tree'] : w.role === 'miner' ? ['stone'] : ['gold'];
    if (w.state === 'seek') { w.target = this.pickNode(w, kinds); if (w.target) w.state = 'go'; else { w.wait = 1; w.state = 'idle'; } return false; }
    if (w.state === 'idle') { w.wait -= dt; if (w.wait <= 0) w.state = w.carry.length ? 'deliver' : 'seek'; return false; }
    if (w.state === 'go') { const t = w.target; if (!t || !t.alive) { w.state = 'seek'; return false; } t.claimed = w.id; t.claimedT = this.time; if (this.moveWorker(w, t.x, t.z, dt, 1.4 + t.r)) { w.state = 'work'; w.swingT = 0.4; } return true; }
    if (w.state === 'work') {
      const t = w.target; if (!t || !t.alive || w.carry.length >= w.cap) { w.state = w.carry.length >= w.cap ? 'deliver' : 'seek'; return false; }
      if (dist2(w.x, w.z, t.x, t.z) > (2.2 + t.r) * (2.2 + t.r)) { w.state = 'go'; return false; } // got pushed away: walk back
      t.claimed = w.id; t.claimedT = this.time; w.rot = angleLerp(w.rot, Math.atan2(t.x - w.x, t.z - w.z), Math.min(1, dt * 8)); w.action = w.role === 'lumber' ? 'chop' : 'mine';
      w.swingT += dt * 1.1; w.actionT = Math.min(1, w.swingT);
      if (w.swingT >= 0.6 && !w.hitDone) { w.hitDone = true; t.hp -= 1; t.shake = 1; if (t.kind === 'tree') { Sound.play('chop', 0.25); this.burst(t.x, 1.2, t.z, 3, C.woodL, { speed: 2, up: 3, size: 0.7 }); w.carry.push({ type: 'wood', mult: t.mult, pop: 1 }); this.stats.wood++; if (t.hp <= 0) this.fellTree(t, w.rot); } else { Sound.play('stone', 0.25); w.carry.push({ type: t.type, mult: t.mult, pop: 1 }); if (t.hp <= 0) { t.alive = false; this.navMarkCircle(t.x, t.z, t.r + 0.45, -1); t.regrow = 30 + rand(0, 15); } } }
      if (w.swingT >= 1) { w.swingT -= 1; w.hitDone = false; }
      return false;
    }
    if (w.state === 'deliver') return this.deliverStep(w, dt);
    if (w.state === 'waitfull') { w.wait -= dt; if (w.wait <= 0) w.state = 'deliver'; return false; }
    w.state = 'seek'; return false;
  },
  fullWarn(b) { if ((b.fullWarnT || 0) > this.time) return; b.fullWarnT = this.time + 6; const cp = this.cashPilePos(b); this.floatText(cp[0], 1.8, cp[1], b.cash >= this.cashCap(b) - 1 ? 'Pile full — collect cash!' : 'Storage full — upgrade!', 'warn'); },
  deliverOne(w, b) { // unload one item; returns false if building full
    const it = w.carry[w.carry.length - 1]; if (!it) return true;
    const tmp = { carry: [it] }; const ok = this.deliver(tmp, b); if (ok) { w.carry.pop(); if ((it.type === 'wood' || it.type === 'meat') && Math.random() < 0.3) this.burst(b.x - DATA.buildings[b.type].w / 2, 1.2, b.z + 1.2, 2, it.type === 'wood' ? C.woodL : C.meat, { speed: 1.5, up: 2.5, size: 0.5, life: 0.4 }); return true; }
    return false;
  },
  // can a pack of hunters take this bear? (pack DPS vs bear HP, hunter HP vs bear DPS)
  hunterCanFight(w, b) {
    const pack = this.workers.filter(x => x.role === 'hunter' && !x.dead && !x.hidden).length; const dps = w.dmg * 1.3 * Math.min(pack, 4) * 0.8; const ttk = b.maxHp / Math.max(1, dps);
    const bearDps = b.dmg / 1.25; const ttd = w.maxHp / Math.max(1, bearDps);
    return ttk < ttd * 1.1 + 4;
  },
  // nearest meat on the ground (or still flying) that nobody is already picking up
  nearestMeat(w, radius) { let best = null, bd = radius * radius; for (const L of this.loot) { if (L.type !== 'meat' || L.state === 'magnet' || L.noHunter) continue; const d = dist2(L.x, L.z, w.x, w.z); if (d < bd) { bd = d; best = L; } } return best; },
  hunterAI(w, home, dt) {
    if (w.state === 'flee') { const hs = this.homeSpot(home); if (this.moveWorker(w, hs[0], hs[1], dt, 2.0)) { w.hp = Math.min(w.maxHp, w.hp + w.maxHp * 0.25 * dt); if (w.hp >= w.maxHp * 0.95) w.state = 'seek'; return false; } return true; }
    if (w.hp < w.maxHp * 0.35 && w.state !== 'deliver' && w.state !== 'flee') { w.state = 'flee'; w.target = null; w.path = null; return true; }
    if (w.state === 'deliver') return this.deliverStep(w, dt);
    if (w.state === 'waitfull') { w.wait -= dt; if (w.wait <= 0) w.state = 'deliver'; return false; }
    if (w.state === 'collect') { // pick up the meat from a kill (and any lying nearby) before hunting on
      if (w.carry.length >= w.cap) { w.state = 'deliver'; return false; }
      const L = this.nearestMeat(w, 16); if (!L) { w.collectT = (w.collectT || 0) + dt; if (w.collectT > 1.2) { w.state = w.carry.length >= w.cap - 1 ? 'deliver' : 'seek'; } return false; } // a moment for flying meat to land
      if (w.carry.length !== w.collectCarry) { w.collectCarry = w.carry.length; w.collectT2 = 0; } w.collectT2 = (w.collectT2 || 0) + dt; if (w.collectT2 > 12) { L.noHunter = true; w.collectT2 = 0; return false; } // can't get to it: leave it for the player
      w.collectT = 0; if (dist2(L.x, L.z, w.x, w.z) < 1.3 * 1.3) { w.rot = angleLerp(w.rot, Math.atan2(L.x - w.x, L.z - w.z), Math.min(1, dt * 8)); return false; } // standing on it: the pickup takes it once it lands
      this.moveWorker(w, L.x, L.z, dt, 1.0); return true;
    }
    if (w.carry.length >= w.cap - 1) { w.state = 'deliver'; return false; }
    if (w.state === 'seek' || w.state === 'idle') {
      if (this.nearestMeat(w, 15)) { w.state = 'collect'; w.collectT = 0; return false; } // meat lying around: grab it first
      // 'near': the closest bear the pack can take (joining a fight already on); 'value': best meat per minute of walking + killing
      w.wait -= dt; let best = null, bs = -1e9; const mode = this.gatherMode(w); const pack = Math.max(1, Math.min(4, this.workers.filter(x => x.role === 'hunter' && !x.dead && !x.hidden).length));
      for (const b of this.bears) { if (b.dead || b.boss) continue; if (!this.zones[b.zone] || b.zone > w.rangeZone) continue; if (!this.hunterCanFight(w, b)) continue; if (b.raider && !this.inBase(b.x, b.z, 6)) continue;
        const hunted = b.target && b.target.role === 'hunter'; const walkD = this.walkDist(w.x, w.z, b.x, b.z); let score;
        if (mode === 'value') { const fighters = hunted ? pack : 1; const ttk = b.hp / Math.max(1, w.dmg * 1.3 * fighters * 0.8); const value = b.def.meat * b.mult * Math.min(1, (w.cap - w.carry.length) / b.def.meat + 0.2); score = value / (walkD / w.speed + ttk + 3); }
        else score = -walkD + (hunted ? 10 : 0);
        if (score > bs) { bs = score; best = b; } }
      if (best) { w.target = best; w.state = 'hunt'; } else { w.state = 'idle'; if (w.carry.length) w.state = 'deliver'; return false; }
    }
    if (w.state === 'hunt') {
      const b = w.target; if (!b || b.dead) { w.target = null; if (b && b.dead) { w.state = 'collect'; w.collectT = 0; } else w.state = 'seek'; return false; }
      const d = Math.sqrt(dist2(b.x, b.z, w.x, w.z)); const range = 1.6 + b.s * 0.6;
      if (d > range) { this.moveWorker(w, b.x, b.z, dt, range); return true; }
      w.rot = angleLerp(w.rot, Math.atan2(b.x - w.x, b.z - w.z), Math.min(1, dt * 10)); w.action = 'attack'; w.swingT += dt * 1.3; w.actionT = Math.min(1, w.swingT);
      if (w.swingT >= 0.6 && !w.hitDone) { w.hitDone = true; this.hurtBear(b, w.dmg, w.x, w.z, 0.6); if (b.state !== 'chase' || !b.target) { b.target = w; b.state = 'chase'; } }
      if (w.swingT >= 1) { w.swingT -= 1; w.hitDone = false; }
      return false;
    }
    w.state = 'seek'; return false;
  },
  guardAI(w, home, dt) {
    const B = DATA.base; const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
    // pick a target: bears already inside the walls first, then the nearest one at the walls
    if (w.state !== 'fight' || !w.target || w.target.dead) { let best = null, bd = 1e9; for (const b of this.bears) { if (b.dead) continue; if (!b.raider && b.state !== 'chase') continue; if (!this.inBase(b.x, b.z, 5)) continue; const d = dist2(b.x, b.z, w.x, w.z) - (this.inBase(b.x, b.z) ? 1e4 : 0); if (d < bd) { bd = d; best = b; } } if (best) { w.target = best; w.state = 'fight'; } else if (w.state === 'fight') { w.state = 'patrol'; w.target = null; } }
    if (w.state === 'fight') {
      // guards never leave the walls: a bear outside is fought from the nearest spot inside (spears reach over the palisade)
      const b = w.target; const d = Math.sqrt(dist2(b.x, b.z, w.x, w.z)); const outside = !this.inBase(b.x, b.z); const range = 1.6 + b.s * 0.6 + (outside && this.built('wall') ? 1.7 : 0);
      if (d > range) {
        let arrived; if (outside) { const m = 1.4; arrived = this.moveWorker(w, clamp(b.x, B.x0 + m, B.x1 - m), clamp(b.z, B.z0 + m, B.z1 - m), dt, 0.8); } else arrived = this.moveWorker(w, b.x, b.z, dt, range);
        if (!arrived) return true;
        w.rot = angleLerp(w.rot, Math.atan2(b.x - w.x, b.z - w.z), Math.min(1, dt * 10)); return false; // hold the line, face the threat
      }
      w.rot = angleLerp(w.rot, Math.atan2(b.x - w.x, b.z - w.z), Math.min(1, dt * 10)); w.action = 'attack'; w.swingT += dt * 1.4; w.actionT = Math.min(1, w.swingT);
      if (w.swingT >= 0.6 && !w.hitDone) { w.hitDone = true; this.hurtBear(b, w.dmg, w.x, w.z, 0.8); }
      if (w.swingT >= 1) { w.swingT -= 1; w.hitDone = false; }
      return false;
    }
    // patrol inside base; heal slowly while calm
    if (w.hp < w.maxHp) w.hp = Math.min(w.maxHp, w.hp + w.maxHp * 0.03 * dt);
    w.patrolT -= dt; if (!w.wp || w.patrolT <= 0) { w.patrolT = rand(4, 9); const a = rand(0, TAU); w.wp = [cx + Math.cos(a) * 11, cz + Math.sin(a) * 9]; }
    if (this.moveWorker(w, w.wp[0], w.wp[1], dt, 1.0)) { w.patrolT = Math.min(w.patrolT, 1.5); return false; }
    return true;
  },
  drawWorkers() { const c = this.R.camTarget; for (const w of this.workers) { if (w.hidden) continue; if (dist2(w.x, w.z, c[0], c[2]) > 60 * 60) continue; if (w.pop > 0) w.s = 0.95 * (1 - easeOut(w.pop) * 0.9); else w.s = 0.95; this.drawHuman(this.workerRig(w.role), w, this.workerTool(w.role)); } }
});

// ===== 14_night.js =====
// ---------------------------------------------------------------------------
// Day / night cycle, raids, lighting
// ---------------------------------------------------------------------------
Object.assign(G, {
  nightFactor: 0,
  updateDay(dt) {
    const prev = this.dayT; this.dayT += dt / DATA.dayLength;
    const N = this.night;
    // dusk warning
    if (prev < DATA.duskStart && this.dayT >= DATA.duskStart) { UI.toast('Dusk is falling. Bears will raid at night — get back to camp!', 'warn'); Sound.play('horn', 0.35); N.warned = true; }
    if (!N.active && this.dayT >= DATA.nightStart) this.startNight();
    if (this.dayT >= 1) { this.dayT -= 1; this.endNight(); this.day++; this.saveDirty = true; }
    // lighting
    const t = this.dayT; let nf = 0; if (t >= DATA.nightStart) nf = Math.min(1, (t - DATA.nightStart) / 0.06); else if (t >= DATA.duskStart) nf = 0.25 * (t - DATA.duskStart) / (DATA.nightStart - DATA.duskStart); if (t < 0.06) nf = Math.max(nf, 1 - t / 0.06);
    if (t > 0.94) nf = Math.max(nf, 1); // night persists to dawn at t=0..0.06
    this.nightFactor += (nf - this.nightFactor) * Math.min(1, dt * 2);
    const k = this.nightFactor; const env = this.R.env; const L = (a, b) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
    env.fog = L([0.82, 0.87, 0.93], [0.13, 0.16, 0.28]); env.sun = L([0.75, 0.72, 0.66], [0.3, 0.34, 0.5]); env.sky = L([0.62, 0.66, 0.74], [0.2, 0.24, 0.38]); env.ground = L([0.42, 0.38, 0.34], [0.12, 0.12, 0.2]); env.fogRange = [lerp(48, 30, k), lerp(115, 80, k)];
    // dusk warmth
    const dusk = t > DATA.duskStart && t < DATA.nightStart ? Math.sin((t - DATA.duskStart) / (DATA.nightStart - DATA.duskStart) * Math.PI) : 0; if (dusk > 0) { env.sun[0] += dusk * 0.2; env.sun[1] += dusk * 0.02; env.fog[0] += dusk * 0.08; env.fog[2] -= dusk * 0.06; }
    const ld = this.R.lightDir; const ang = lerp(0.45, -0.45, t); ld[0] = Math.sin(ang) * 0.7 + 0.2; ld[1] = 0.85; ld[2] = 0.35; const ll = Math.hypot(ld[0], ld[1], ld[2]); ld[0] /= ll; ld[1] /= ll; ld[2] /= ll;
    // raiders leaving at dawn
    if (N.active && t > 0.03 && t < 0.3) { /* handled in endNight */ }
  },
  startNight() {
    const N = this.night; N.active = true; N.wave = this.day; const day = this.day;
    Sound.play('horn'); UI.toast(`Night ${day} — the bears are coming!`, 'night'); this.shake = 0.2;
    const count = Math.min(34, 1 + Math.floor(day * 1.25 + this.prestigeCount * 2));
    let maxZone = 0; for (let i = 0; i < this.zones.length; i++) if (this.zones[i]) maxZone = i; if (maxZone === 4) maxZone = 3;
    const types = ['snow', 'frost', 'black', 'armor'];
    const hpS = 1 + 0.06 * day, dmgS = 1 + 0.03 * day;
    for (let i = 0; i < count; i++) {
      let zi = 0; const r = Math.random(); if (maxZone >= 1 && r < 0.5) zi = 1; if (maxZone >= 2 && r < 0.3) zi = 2; if (maxZone >= 3 && r < 0.15) zi = 3; if (day < 3) zi = 0;
      const a = rand(0, TAU); const R = rand(30, 36); const x = clamp(Math.cos(a) * R, -35, 35), z = clamp(1 + Math.sin(a) * R, -29, 35);
      const b = this.makeBear(types[zi], x, z, zi, true, hpS, dmgS); b.mult = DATA.zones[zi].mult; b.state = 'raid'; b.sleep = false; b.home = { x, z }; b.pop = 1; N.raiders.push(b);
    }
    if (!this.tutorial.night1) { this.tutorial.night1 = true; UI.hint('Bears attack at night! Fight near the campfire — it heals you. Build the Palisade and Watchtowers to defend.'); }
  },
  endNight() {
    const N = this.night; if (!N.active) return; N.active = false; const survived = true;
    for (const b of N.raiders) { if (!b.dead) { b.dead = true; b.deadT = 2.4; b.hp = 0; } } N.raiders = [];
    this.stats.nights++; const reward = Math.round((30 + 25 * this.day) * this.incomeMult() * (1 + this.prestigeCount * 0.5)); this.addMoney(reward);
    Sound.play('dawn'); UI.toast(`Dawn! Night ${this.day} survived. +${fmtMoney(reward)}`, 'good');
    // repairs
    for (const s in this.walls.hp) this.walls.hp[s] = this.walls.max; for (const r of this.wallBlockers) r.broken = false;
    for (const id in this.b) { const b = this.b[id]; if (b.built && b.wrecked) { b.hp = b.maxHp; b.wrecked = false; } }
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.4);
  }
});

// ===== 15_quests.js =====
// ---------------------------------------------------------------------------
// Quests, achievements, guide arrow
// ---------------------------------------------------------------------------
Object.assign(G, {
  questCheckT: 0, achT: 0, guideTarget: null,
  currentQuest() {
    if (this.questIdx < QUESTS.length) return QUESTS[this.questIdx];
    // endless repeatable quests
    const n = this.questIdx - QUESTS.length; const kind = n % 3; const tier = Math.floor(n / 3) + 1; const base = this.qBase || { kills: 0, nights: 0, earned: 0 };
    if (kind === 0) { const need = 150 * tier; return { id: 'r_kills' + n, text: `Slay ${need} more bears`, check: G => [G.stats.kills - base.kills, need], target: G => G.nearestBearPos(), reward: 60000 * tier * (1 + G.legacy * 0.2), repeat: true }; }
    if (kind === 1) { const need = 8 + 4 * tier; return { id: 'r_nights' + n, text: `Survive ${need} more nights`, check: G => [G.stats.nights - base.nights, need], target: G => null, reward: 100000 * tier * (1 + G.legacy * 0.2), repeat: true }; }
    const need = 1e6 * tier * tier; return { id: 'r_earn' + n, text: `Earn ${fmtMoney(need)} more`, check: G => [G.stats.earned - base.earned, need], target: G => G.bpos('post'), reward: 120000 * tier * (1 + G.legacy * 0.2), repeat: true };
  },
  updateQuests(dt) {
    this.questCheckT -= dt; if (this.questCheckT > 0) return; this.questCheckT = 0.25;
    const q = this.currentQuest(); if (!q) return;
    if (q.id === 'prestige') { const done = this.stats.prestige > this.questPrestigeBase; if (done) this.completeQuest(q); UI.setQuest(q, done ? 1 : 0, 1); return; }
    const [cur, need] = q.check(this); UI.setQuest(q, cur, need);
    if (cur >= need) this.completeQuest(q);
    this.achT -= dt; if (this.achT <= 0) { this.achT = 1.0; this.checkAchievements(); }
  },
  completeQuest(q) {
    if (q.reward) { this.addMoney(q.reward, false); this.floatText(this.player.x, 2.6, this.player.z, 'Quest +' + fmtMoney(q.reward), 'gold'); }
    Sound.play('quest'); UI.toast(`Quest complete: ${q.text}`, 'good'); this.questIdx++; this.saveDirty = true;
    this.qBase = { kills: this.stats.kills, nights: this.stats.nights, earned: this.stats.earned };
    const nq = this.currentQuest(); if (nq && nq.id === 'prestige') this.questPrestigeBase = this.stats.prestige;
    if (nq && nq.id === 'sell') UI.hint('Walk onto the green SELL circle at the Trading Post to sell your logs.');
    if (nq && nq.id === 'boots') UI.hint('Tap the Trading Post (or the button below it) to buy Snow Boots — every level makes you run faster.');
    if (nq && nq.id === 'lumber') UI.hint('Stand on a dashed pad to pour money into it. Build the Lumber Camp!');
    if (nq && nq.id === 'bears') UI.hint('Walk up to a bear and your axe swings automatically. Watch your health!');
  },
  checkAchievements() {
    for (const a of DATA.achievements) { if (this.ach[a.id]) continue; if ((this.stats[a.stat] || 0) >= a.n) { this.ach[a.id] = true; this.addMoney(a.reward, false); UI.toast(`Achievement: ${a.name} (+${fmtMoney(a.reward)})`, 'gold'); Sound.play('unlock', 0.6); this.saveDirty = true; } }
  },
  updateGuide() { const q = this.currentQuest(); this.guideTarget = q && q.target ? q.target(this) : null; },
  drawGuide() {
    const t = this.guideTarget; if (!t) return; const p = this.player; if (dist2(t[0], t[1], p.x, p.z) < 2.5 * 2.5 && this.currentQuest().id !== 'chop') return;
    const m = M4.create(); const bob = Math.sin(this.time * 4) * 0.25; this.R.draw(Models.arrowIndicator(), M4.trs(m, t[0], 2.6 + bob, t[1], 0, this.time * 2, 0, 0.8, 0.8, 0.8), 1, 1, 1, 0.15);
  },
  // ---- prestige
  prestigeGain() { return Math.max(1, Math.floor(Math.pow(Math.max(0, this.stats.earned) / 250000, 0.6))); },
  canPrestige() { const h = this.b.hall; return (h && h.built && h.level >= 10) || this.stats.king > 0; },
  doPrestige() {
    if (!this.canPrestige()) return; const gain = this.prestigeGain(); this.legacy += gain; this.prestigeCount++; this.stats.prestige++;
    const keepStats = this.stats; const keep = { legacy: this.legacy, prestigeCount: this.prestigeCount, ach: this.ach, settings: this.settings, tutorial: this.tutorial, stats: keepStats };
    // reset
    this.money = 0; this.vault = { stone: 0, gold: 0 }; this.day = 1; this.dayT = 0.25; this.zones = [true, false, false, false, false]; this.upgrades = { cap: 0, dmg: 0, atk: 0, speed: 0, hp: 0, chop: 0 }; this.questIdx = 0; this.zoneFund = {}; this.night = { active: false, raiders: [], wave: 0, warned: false }; this.walls = { hp: {}, broken: {} }; this.incomeLog = [];
    for (const id in this.b) { const b = this.b[id]; const d = DATA.buildings[b.type]; b.level = 1; b.built = b.type === 'post' || b.type === 'fire'; b.funded = 0; b.cash = 0; b.queue = 0; b.queueVal = 0; b.hp = 750; b.maxHp = 750; b.wrecked = false; b.visible = b.built || b.type === 'lumber' || b.type === 'armory'; if (b.blocker) { const i = this.blockers.indexOf(b.blocker); if (i >= 0) this.blockers.splice(i, 1); b.blocker = null; } }
    for (const id in this.b) if (this.b[id].built) this.addBuildingBlocker(this.b[id]);
    this.workers = []; this.loot = []; for (const b of this.bears) if (b.raider) { b.dead = true; b.deadT = 3; } this.initWalls(); this.refreshVisibility(); this.refreshPads(); this.navInvalidate();
    const p = this.player; p.x = 0; p.z = 4; p.carry = []; p.hp = this.playerStat('hp'); p.dead = false;
    Sound.play('victory'); UI.toast(`New Expedition! +${gain} Legacy (${this.legacy} total): +${(this.legacy * 5)}% income, +${this.legacy * 3}% damage`, 'gold'); this.save();
  }
});

// ===== 15b_events.js =====
// ---------------------------------------------------------------------------
// World events (Timber Boom, Hunting Season, Blizzard) + kill combos
// ---------------------------------------------------------------------------
const EVENTS = {
  timber: { name: 'Timber Boom', text: 'Timber Boom! Wood sells for 2x for 90 seconds.', dur: 90, type: 'good' },
  hunt: { name: 'Hunting Season', text: 'Hunting Season! Meat sells for 2x for 90 seconds.', dur: 90, type: 'good' },
  blizzard: { name: 'Blizzard', text: 'Blizzard! Bears are slowed for 75 seconds — hunt them down!', dur: 75, type: 'night' },
  goldrush: { name: 'Gold Rush', text: 'Gold Rush! Ore rocks regrow instantly for 60 seconds.', dur: 60, type: 'gold' }
};
Object.assign(G, {
  event: null, eventT: 0, nextEventT: 420, comboN: 0, comboT: 0,
  updateEvents(dt) {
    if (this.event) { this.eventT -= dt; if (this.eventT <= 0) { UI.toast(`${EVENTS[this.event].name} is over.`, ''); this.event = null; this.saveDirty = true; } }
    else { this.nextEventT -= dt; if (this.nextEventT <= 0 && !this.night.active && this.day >= 3) { const pool = ['timber', 'hunt', 'blizzard']; if (this.zones[2]) pool.push('goldrush'); this.startEvent(pick(pool)); } }
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.comboN = 0; }
    if (this.event === 'goldrush' && this.frame % 30 === 0) for (const r of this.rocks) if (!r.alive && r.type === 'gold') r.regrow = Math.min(r.regrow, 0.5);
  },
  startEvent(id) { this.event = id; this.eventT = EVENTS[id].dur; this.nextEventT = 360 + rand(0, 240); UI.toast(EVENTS[id].text, EVENTS[id].type); Sound.play('unlock', 0.7); this.saveDirty = true; },
  eventPriceMult(type) { if (this.event === 'timber' && type === 'wood') return 2; if (this.event === 'hunt' && type === 'meat') return 2; return 1; },
  bearSpeedMult() { return this.event === 'blizzard' ? 0.65 : 1; },
  registerKill(b) {
    this.comboN++; this.comboT = 4;
    if (this.comboN >= 3) { const bonus = Math.round(15 * this.comboN * b.mult * this.incomeMult()); this.addMoney(bonus, false); this.floatText(b.x, 2.2 * b.s, b.z, `COMBO x${this.comboN}  +${fmtMoney(bonus)}`, 'gold'); if (this.comboN === 3 || this.comboN % 5 === 0) Sound.play('quest', 0.5); }
  }
});

// ===== 16_ui.js =====
// ---------------------------------------------------------------------------
// UI: HUD, panels, toasts, health bars, floating text, title screen
// ---------------------------------------------------------------------------
const SVG = {
  cash: '<svg viewBox="0 0 32 20" width="26" height="16"><rect x="1" y="1" width="30" height="18" rx="3" fill="#3fbf5f" stroke="#1f7a3a" stroke-width="2"/><circle cx="16" cy="10" r="5" fill="#b4ebb0" stroke="#1f7a3a" stroke-width="1.5"/><text x="16" y="13.5" font-size="9" font-weight="700" text-anchor="middle" fill="#1f7a3a" font-family="Arial">$</text></svg>',
  stone: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 16 L8 7 L16 5 L21 12 L18 19 L7 20 Z" fill="#b7bec6" stroke="#6f7780" stroke-width="2" stroke-linejoin="round"/></svg>',
  gold: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 9 H18 L21 16 H3 Z" fill="#f2c14e" stroke="#a87d1a" stroke-width="2" stroke-linejoin="round"/><path d="M6 9 L9 13 H15 L18 9" fill="#ffe08a" stroke="none"/></svg>',
  heart: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 21 C4 14 2 10 4 6 C6 3 10 3 12 7 C14 3 18 3 20 6 C22 10 20 14 12 21Z" fill="#ff5b6e"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="5" fill="#ffd23f"/><g stroke="#ffd23f" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></g></svg>',
  moon: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M20 15 A9 9 0 1 1 9 4 A7 7 0 0 0 20 15Z" fill="#cfd9ff"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#fff" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3H9l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L9 21h6l.4-2.9a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/></svg>',
  camp: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#fff" d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 2 L22 20 L12 15 L2 20 Z" fill="#f2c14e" stroke="#7a5a12" stroke-width="1.5" stroke-linejoin="round"/></svg>'
};
const UI = {
  els: {}, shownCash: 0, hintQueue: [], hintShowing: false, barPool: [], floaterEls: [], ctxBuilding: null, questEl: null, openPanel: null,
  init(root) {
    this.root = root;
    root.innerHTML = `
      <div id="hud">
        <div id="topLeft"><div id="dayPill" class="pill">${SVG.sun}<span id="dayTxt">Day 1</span><div id="dayBar"><i></i></div></div>
          <div id="quest" class="card"><div class="qhead">QUEST</div><div class="qtext" id="qtext">…</div><div class="qbar"><i id="qfill"></i></div><div class="qmeta"><span id="qprog"></span><span id="qreward"></span></div></div><button id="saveWarn" class="btn warnpill hidden">⚠ Not saving here — tap for a save code</button><button id="updatePill" class="btn warnpill good hidden">⬆ New version ready — tap to update</button></div>
        <div id="topRight"><div id="cashPill" class="pill big">${SVG.cash}<span id="cashTxt">$0</span></div>
          <div id="stonePill" class="pill small hidden">${SVG.stone}<span id="stoneTxt">0</span></div><div id="goldPill" class="pill small hidden">${SVG.gold}<span id="goldTxt">0</span></div><div id="legacyPill" class="pill small hidden">★<span id="legacyTxt">0</span></div></div>
        <div id="toasts"></div>
        <div id="bars"></div><div id="floaters"></div>
        <div id="hpbar"><div id="hpfill"></div><span id="hptxt"></span></div>
        <div id="carryTag"></div>
        <div id="guide">${SVG.arrow}</div>
        <button id="ctxBtn" class="btn ctx hidden"></button>
        <div id="bottomRight"><button id="btnCamp" class="btn round" title="Camp">${SVG.camp}</button><button id="btnSettings" class="btn round" title="Settings">${SVG.gear}</button></div>
        <div id="hint" class="hidden"><div id="hintTxt"></div><div class="hintTap">tap to dismiss</div></div>
        <div id="nightVignette"></div>
      </div>
      <div id="modal" class="modal hidden"><div id="panel" class="panel"></div></div>
      <div id="title" class="title"><div class="tlogo"><div class="t1">BEAR</div><div class="t2">FALL</div></div><div class="tsub">Chop. Fight. Build. Survive the frost.</div><div id="titleBtns"></div><div class="tctrl">Drag anywhere to move · Walk into trees to chop · Walk into bears to fight<br>WASD on desktop · gamepad: stick to move, A open, B back, Y camp</div><div class="tver">v2.2 · <a id="homeLink" href="https://studio22.games/" target="_blank" rel="noopener">a Studio 22 game</a></div></div>`;
    if (typeof BUILD_FLAGS !== 'undefined' && BUILD_FLAGS.site === 'studio22') { const a = root.querySelector('#homeLink'); a.href = '/arcade.html'; a.target = '_self'; a.textContent = 'a Studio 22 game · back to the arcade'; }
    const E = (id) => document.getElementById(id); for (const id of ['dayTxt', 'dayBar', 'qtext', 'qfill', 'qprog', 'qreward', 'cashTxt', 'cashPill', 'stonePill', 'stoneTxt', 'goldPill', 'goldTxt', 'legacyPill', 'legacyTxt', 'toasts', 'bars', 'floaters', 'hpbar', 'hpfill', 'hptxt', 'carryTag', 'guide', 'ctxBtn', 'btnCamp', 'btnSettings', 'hint', 'hintTxt', 'modal', 'panel', 'title', 'titleBtns', 'dayPill', 'nightVignette', 'saveWarn', 'updatePill']) this.els[id] = E(id);
    this.els.saveWarn.addEventListener('click', () => { Sound.play('click'); this.openSettings(); });
    this.els.btnCamp.addEventListener('click', () => { Sound.play('click'); this.openCamp(); }); this.els.btnSettings.addEventListener('click', () => { Sound.play('click'); this.openSettings(); });
    this.els.ctxBtn.addEventListener('click', () => { if (this.ctxBuilding) { Sound.play('click'); this.openBuilding(this.ctxBuilding); } });
    this.els.hint.addEventListener('click', () => this.dismissHint()); this.els.modal.addEventListener('click', (e) => { if (e.target === this.els.modal) this.close(); });
    Input.onTap((x, y) => this.onTap(x, y));
  },
  // in-page confirmation (the artifact viewer never shows window.confirm)
  confirm(title, msg, onYes, yesLabel = 'Yes, do it') {
    const el = document.createElement('div'); el.className = 'modal confirmbox'; el.innerHTML = `<div class="panel small"><div class="ptitle">${title}</div><div class="pinfo">${msg}</div><div class="crow"><button class="btn ghost" id="cfNo">Cancel</button><button class="btn danger" id="cfYes">${yesLabel}</button></div></div>`;
    this.root.appendChild(el); el.querySelector('#cfNo').onclick = () => { Sound.play('click'); el.remove(); }; el.querySelector('#cfYes').onclick = () => { Sound.play('click'); el.remove(); onYes(); };
  },
  // ---- title
  showTitle(hasSave, onStart, loading) {
    const t = this.els.title; t.classList.remove('hidden'); const b = this.els.titleBtns; b.innerHTML = '';
    const st = Store.status(); let stEl = document.getElementById('tstat'); if (!stEl) { stEl = document.createElement('div'); stEl.id = 'tstat'; b.parentNode.insertBefore(stEl, b.nextSibling); }
    stEl.className = 'tstat ' + st.cls; stEl.textContent = loading ? 'Loading your camp…' : st.icon + ' ' + st.text;
    if (loading) { b.innerHTML = '<div class="tspin"></div>'; return; }
    if (hasSave) { const c = document.createElement('button'); c.className = 'btn primary wide'; c.textContent = 'Continue'; c.onclick = () => { Sound.unlock(); onStart(false); }; b.appendChild(c); }
    const n = document.createElement('button'); n.className = 'btn ' + (hasSave ? 'ghost' : 'primary') + ' wide'; n.textContent = hasSave ? 'New Game' : 'Start Expedition'; n.onclick = () => { Sound.unlock(); if (hasSave) this.confirm('Start over?', 'Your current camp, money and progress will be lost. Legacy is kept only through a New Expedition, not a new game.', () => onStart(true), 'Start over'); else onStart(true); }; b.appendChild(n);
  },
  hideTitle() { this.els.title.classList.add('hidden'); },
  // gamepad buttons: A = the highlighted button / nearest building, B = close, Y = camp menu, Start = settings
  onPad(p) {
    Sound.unlock(); const cf = this.root.querySelector('.confirmbox'); if (cf) { if (p.a) cf.querySelector('#cfYes').click(); if (p.b) cf.querySelector('#cfNo').click(); return; }
    if (!this.els.title.classList.contains('hidden')) { if (p.a || p.start) { const b = this.els.titleBtns.querySelector('button'); if (b) b.click(); } return; }
    if (this.openPanel) { if (p.b || p.start) this.close(); else if (p.a) { const b = this.els.panel.querySelector('.btn.primary:not([disabled])'); if (b) b.click(); } return; }
    if (this.hintShowing && p.b) { this.dismissHint(); return; }
    if (p.a && this.ctxBuilding) this.openBuilding(this.ctxBuilding); else if (p.y) this.openCamp(); else if (p.start) this.openSettings();
  },
  // a new build is cached and waiting: show a pill; tapping it swaps versions (progress is saved first)
  offerUpdate(apply) { const el = this.els.updatePill; el.classList.remove('hidden'); el.onclick = () => { Sound.play('click'); el.textContent = 'Updating…'; apply(); }; },
  // ---- per frame
  // DOM writes only when the value changed (every write costs style/layout work on a phone)
  txt(el, v) { if (el._t !== v) { el._t = v; el.textContent = v; } },
  sty(el, k, v) { if (el._s === undefined) el._s = {}; if (el._s[k] !== v) { el._s[k] = v; el.style[k] = v; } },
  update(dt) {
    const R = G.R, p = G.player;
    if (!this.warnAt || performance.now() - this.warnAt > 1000) { this.warnAt = performance.now(); const bad = !Store.anyDevice() && Store.cloud !== 'on' && Store.cloud !== 'wait'; const eph = Store.ephemeral && Store.cloud !== 'on' && G.time > 90 && Date.now() - (Store.lastCodeCopy || 0) > 10 * 60000; this.els.saveWarn.textContent = bad ? '⚠ Not saving here — tap for a save code' : '⚠ Copy a save code before you leave — tap here'; this.els.saveWarn.classList.toggle('hidden', !(bad || eph)); }
    // cash tween
    const target = G.money; const diff = target - this.shownCash; this.shownCash += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dt * 8); this.txt(this.els.cashTxt, fmtMoney(Math.round(this.shownCash)));
    if (G.vault.stone > 0 || G.stats.stone > 0) { if (!this.stoneShown) { this.stoneShown = true; this.els.stonePill.classList.remove('hidden'); } this.txt(this.els.stoneTxt, fmtNum(G.vault.stone)); }
    if (G.vault.gold > 0 || G.stats.gold > 0) { if (!this.goldShown) { this.goldShown = true; this.els.goldPill.classList.remove('hidden'); } this.txt(this.els.goldTxt, fmtNum(G.vault.gold)); }
    if (G.legacy > 0) { if (!this.legacyShown) { this.legacyShown = true; this.els.legacyPill.classList.remove('hidden'); } this.txt(this.els.legacyTxt, String(G.legacy)); }
    // day
    const night = G.night.active || G.dayT < 0.06; this.txt(this.els.dayTxt, (night ? 'Night ' : 'Day ') + G.day); if (this.nightIcon !== night) { this.nightIcon = night; this.els.dayPill.firstChild.outerHTML = night ? SVG.moon : SVG.sun; } this.sty(this.els.dayBar.firstChild, 'width', (G.dayT * 100).toFixed(1) + '%'); this.els.dayBar.firstChild.style.background = G.dayT > DATA.duskStart ? '#7f8cff' : '#ffd23f';
    this.sty(this.els.nightVignette, 'opacity', (G.nightFactor * 0.55).toFixed(2));
    // player hp bar & carry tag
    const sp = R.project(p.x, 2.3, p.z); const hp = this.els.hpbar; if (p.dead) this.sty(hp, 'opacity', 0); else { this.sty(hp, 'opacity', p.hp < p.maxHp ? 1 : 0.55); hp.style.transform = `translate(${sp[0] - 34}px, ${sp[1] - 12}px)`; this.sty(this.els.hpfill, 'width', (100 * p.hp / p.maxHp).toFixed(1) + '%'); this.sty(this.els.hpfill, 'background', p.hp / p.maxHp > 0.4 ? '#4ade80' : '#ff5b6e'); }
    const ct = this.els.carryTag; if (p.carry.length && !p.dead) { this.sty(ct, 'opacity', 1); ct.style.transform = `translate(${sp[0] + 40}px, ${sp[1] - 16}px)`; const tag = p.carry.length + '/' + p.cap; if (ct._t !== tag) { ct._t = tag; ct.innerHTML = '<span>' + tag + '</span>'; ct.className = p.carry.length >= p.cap ? 'full' : ''; } } else this.sty(ct, 'opacity', 0);
    // bear bars
    let bi = 0; const W = G.canvas.clientWidth, H = G.canvas.clientHeight;
    for (const b of G.bears) { if (b.dead || b.hp >= b.maxHp && !b.boss) continue; if (!G.zones[b.zone] && !b.raider) continue; const s = R.project(b.x, (b.boss ? 3.4 : 1.7) * b.s, b.z); if (s[0] < -50 || s[0] > W + 50 || s[1] < -50 || s[1] > H + 50) continue; const el = this.bar(bi++); el.style.transform = `translate(${s[0] - (b.boss ? 60 : 24)}px, ${s[1]}px)`; el.className = 'bar' + (b.boss ? ' boss' : ''); el.firstChild.style.width = (100 * b.hp / b.maxHp).toFixed(1) + '%'; if (b.boss) el.lastChild.textContent = 'BEAR KING'; else el.lastChild.textContent = ''; }
    for (const w of G.workers) { if (w.dead || w.hp >= w.maxHp) continue; const s = R.project(w.x, 2.1, w.z); if (s[0] < -50 || s[0] > W + 50 || s[1] < -50 || s[1] > H + 50) continue; const el = this.bar(bi++); el.style.transform = `translate(${s[0] - 24}px, ${s[1]}px)`; el.className = 'bar worker'; el.firstChild.style.width = (100 * w.hp / w.maxHp).toFixed(1) + '%'; el.lastChild.textContent = ''; }
    for (const s of ['n', 's', 'e', 'w']) { if (!G.built('wall')) break; const h = G.walls.hp[s]; if (h === undefined || h >= G.walls.max) continue; const B = DATA.base; const pos = s === 'n' ? [0, B.z0] : s === 's' ? [0, B.z1] : s === 'e' ? [B.x1, 1] : [B.x0, 1]; const sc = R.project(pos[0], 2.6, pos[1]); if (sc[0] < -50 || sc[0] > W + 50 || sc[1] < -50 || sc[1] > H + 50) continue; const el = this.bar(bi++); el.style.transform = `translate(${sc[0] - 30}px, ${sc[1]}px)`; el.className = 'bar wall'; el.firstChild.style.width = (100 * h / G.walls.max).toFixed(1) + '%'; el.lastChild.textContent = h <= 0 ? 'BREACHED' : ''; }
    for (const id in G.b) { const b = G.b[id]; if (!b.built || b.hp >= b.maxHp) continue; const sc = R.project(b.x, 3.5, b.z); if (sc[0] < -50 || sc[0] > W + 50 || sc[1] < -50 || sc[1] > H + 50) continue; const el = this.bar(bi++); el.style.transform = `translate(${sc[0] - 30}px, ${sc[1]}px)`; el.className = 'bar wall'; el.firstChild.style.width = (100 * b.hp / b.maxHp).toFixed(1) + '%'; el.lastChild.textContent = b.wrecked ? 'WRECKED' : ''; }
    for (let i = bi; i < this.barPool.length; i++) this.barPool[i].style.display = 'none';
    // floaters
    for (let i = G.floaters.length - 1; i >= 0; i--) { const f = G.floaters[i]; f.t += dt; if (f.t > 1.3) { if (f.el) f.el.remove(); G.floaters.splice(i, 1); continue; } if (!f.el) { f.el = document.createElement('div'); f.el.className = 'floater ' + f.cls; f.el.textContent = f.text; this.els.floaters.appendChild(f.el); } const s = R.project(f.x, f.y + f.t * 1.6, f.z); f.el.style.transform = `translate(-50%,-50%) translate(${s[0]}px, ${s[1]}px) scale(${f.t < 0.15 ? 0.6 + f.t / 0.15 * 0.5 : 1.1 - (f.t - 0.15) * 0.15})`; f.el.style.opacity = f.t > 0.9 ? (1 - (f.t - 0.9) / 0.4).toFixed(2) : 1; }
    // guide (off-screen indicator)
    const gt = G.guideTarget; const ge = this.els.guide; if (gt) { const s = R.project(gt[0], 1, gt[1]); const margin = 44; const off = s[0] < margin || s[0] > W - margin || s[1] < margin + 60 || s[1] > H - margin - 60; if (off) { const cx = W / 2, cy = H / 2; let dx = s[0] - cx, dy = s[1] - cy; if (s[0] === -9999) { const pv = R.project(p.x, 0, p.z); const ddx = gt[0] - p.x, ddz = gt[1] - p.z; dx = ddx; dy = ddz; } const ang = Math.atan2(dy, dx); const rx = W / 2 - margin, ry = H / 2 - margin - 60; const k = Math.min(rx / Math.abs(Math.cos(ang) || 1e-6), ry / Math.abs(Math.sin(ang) || 1e-6)); ge.style.display = 'block'; ge.style.transform = `translate(${cx + Math.cos(ang) * k - 14}px, ${cy + Math.sin(ang) * k - 14}px) rotate(${ang * 180 / Math.PI + 90}deg)`; } else ge.style.display = 'none'; } else ge.style.display = 'none';
    // contextual button
    let best = null, bd = 5.5 * 5.5; for (const id in G.b) { const b = G.b[id]; if (!b.built) continue; const d = dist2(b.x, b.z, p.x, p.z); if (d < bd) { bd = d; best = b; } }
    if (best !== this.ctxBuilding) { this.ctxBuilding = best; const btn = this.els.ctxBtn; if (best) { const d = DATA.buildings[best.type]; btn.classList.remove('hidden'); btn.innerHTML = `<b>${d.name}</b> <span>Lv${best.level}</span> · ${best.type === 'armory' ? 'Upgrades' : best.type === 'post' ? 'Gear & Vault' : best.type === 'hall' && G.canPrestige() ? 'New Expedition' : d.worker ? 'Hire' : 'Upgrade'}`; } else btn.classList.add('hidden'); }
    if (this.openPanel === 'building' && this.panelBuilding) this.refreshBuildingPanel();
    if (this.openPanel === 'camp') { this.campRefreshT = (this.campRefreshT || 0) - dt; if (this.campRefreshT <= 0) { this.campRefreshT = 0.5; this.renderCamp(this.campTab); } }
  },
  bar(i) { let el = this.barPool[i]; if (!el) { el = document.createElement('div'); el.className = 'bar'; el.innerHTML = '<i></i><span></span>'; this.els.bars.appendChild(el); this.barPool[i] = el; } el.style.display = 'block'; return el; },
  bump(type) { if (this.silent) return; const el = this.els[type + 'Pill']; if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); },
  cashFly(sx, sy, amount) { if (this.silent) return;
    const n = Math.min(6, 1 + Math.floor(Math.log10(Math.max(1, amount)))); const tgt = this.els.cashPill.getBoundingClientRect(); const tx = tgt.left + tgt.width / 2, ty = tgt.top + tgt.height / 2;
    for (let i = 0; i < n; i++) { const el = document.createElement('div'); el.className = 'cashfly'; el.innerHTML = SVG.cash; el.style.left = (sx + rand(-14, 14)) + 'px'; el.style.top = (sy + rand(-10, 10)) + 'px'; this.root.appendChild(el); const delay = i * 40;
      setTimeout(() => { el.style.transition = 'transform .55s cubic-bezier(.3,.8,.4,1), opacity .5s'; el.style.transform = `translate(${tx - sx}px, ${ty - sy}px) scale(.6)`; el.style.opacity = '0.9'; setTimeout(() => { el.remove(); this.bump('cash'); }, 560); }, delay + 10); }
  },
  toast(msg, type = '') { if (this.silent) return; const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg; this.els.toasts.appendChild(el); requestAnimationFrame(() => el.classList.add('show')); setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3800); while (this.els.toasts.children.length > 4) this.els.toasts.firstChild.remove(); },
  hint(text) { if (this.silent) return; this.hintQueue.push(text); this.nextHint(); },
  nextHint() { if (this.hintShowing || !this.hintQueue.length) return; const t = this.hintQueue.shift(); this.hintShowing = true; this.els.hintTxt.textContent = t; this.els.hint.classList.remove('hidden'); },
  dismissHint() { this.els.hint.classList.add('hidden'); this.hintShowing = false; setTimeout(() => this.nextHint(), 400); },
  setQuest(q, cur, need) { if (this.silent) return; this.els.qtext.textContent = q.text; this.els.qfill.style.width = (100 * Math.min(1, cur / need)).toFixed(1) + '%'; this.els.qprog.textContent = need > 1 ? `${fmtNum(Math.min(cur, need))} / ${fmtNum(need)}` : (cur >= need ? 'Done' : ''); this.els.qreward.textContent = q.reward ? '+' + fmtMoney(q.reward) : ''; },
  onTap(x, y) {
    if (this.openPanel) return; if (this.hintShowing) { this.dismissHint(); return; }
    const w = G.R.unprojectGround(x, y); let best = null, bd = 3.2 * 3.2; for (const id in G.b) { const b = G.b[id]; if (!b.built) continue; const d = DATA.buildings[b.type]; const dx = Math.max(0, Math.abs(w[0] - b.x) - d.w / 2), dz = Math.max(0, Math.abs(w[2] - b.z) - d.d / 2); const dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = b; } }
    if (best && dist2(best.x, best.z, G.player.x, G.player.z) < 9 * 9) { Sound.play('click'); this.openBuilding(best); }
  },
  // ---- panels
  open(html, kind) { this.openPanel = kind; this.els.panel.innerHTML = html; this.els.modal.classList.remove('hidden'); G.paused = false; },
  close() { this.openPanel = null; this.panelBuilding = null; this.els.modal.classList.add('hidden'); },
  btn(label, cls, onclick, disabled) { const id = 'b' + Math.random().toString(36).slice(2, 8); setTimeout(() => { const el = document.getElementById(id); if (el) el.onclick = onclick; }, 0); return `<button id="${id}" class="btn ${cls}" ${disabled ? 'disabled' : ''}>${label}</button>`; },
  costHtml(cash, stone = 0, gold = 0) { let h = `<span class="cost ${G.money >= cash ? '' : 'no'}">${SVG.cash}${fmtMoney(cash)}</span>`; if (stone) h += `<span class="cost ${G.vault.stone >= stone ? '' : 'no'}">${SVG.stone}${stone}</span>`; if (gold) h += `<span class="cost ${G.vault.gold >= gold ? '' : 'no'}">${SVG.gold}${gold}</span>`; return h; },
  upgradeRow(k, refresh) { const U = DATA.upgrades[k]; const lv = G.upgrades[k]; const max = G.upgradeMax(k); const cost = G.upgradeCost(k); const maxed = lv >= max; const now = k === 'speed' ? `speed ${G.playerStat('speed').toFixed(1)}` : ''; return `<div class="urow"><div class="uinfo"><b>${U.name}</b> <span class="lv">Lv ${lv}${maxed ? (lv >= U.max ? ' MAX' : ' (cap)') : ''}</span><div class="udesc">${U.desc}${now ? ' · ' + now : ''}</div></div>${maxed ? '' : this.costHtml(cost)}${this.btn(maxed ? '—' : 'Buy', 'small primary', () => { if (G.buyUpgrade(k)) refresh(); }, maxed || G.money < cost)}</div>`; },
  openBuilding(b) { this.panelBuilding = b; this.open('', 'building'); this.refreshBuildingPanel(true); },
  refreshBuildingPanel(force) {
    const b = this.panelBuilding; const d = DATA.buildings[b.type]; const crewKey = d.worker ? G.workers.filter(w => w.homeId === b.id && !w.dead).map(w => w.state + (w.hidden ? 'h' : '') + w.carry.length).join() : ''; const key = [b.level, Math.floor(G.money / 10), G.vault.stone, G.vault.gold, JSON.stringify(G.upgrades), b.cash | 0, b.queue, crewKey, b.mode].join('|'); if (!force && key === this.panelKey) return; this.panelKey = key;
    const up = G.canUpgrade(b); let h = `<div class="phead"><div class="ptitle">${d.name} <span class="lv">Lv ${b.level}${b.level >= d.max ? ' MAX' : ''}</span></div>${this.btn('✕', 'x', () => this.close())}</div><div class="pdesc">${d.desc}</div>`;
    h += `<div class="prow"><div><div class="plabel">Now</div><div>${d.effect(b.level)}</div></div>${b.level < d.max ? `<div><div class="plabel">Next</div><div>${d.effect(b.level + 1)}</div></div>` : ''}</div>`;
    if ((b.type === 'sawmill' || b.type === 'butcher')) h += `<div class="pinfo">Queue: ${b.queue}/${G.queueCap(b)} · Cash pile: ${fmtMoney(b.cash)} / ${fmtMoney(G.cashCap(b))}</div>`;
    if (b.type === 'post') h += `<div class="pinfo">Cash pile: ${fmtMoney(b.cash)} / ${fmtMoney(G.cashCap(b))}</div><div class="vault"><div>Vault: ${SVG.stone} ${G.vault.stone} stone · ${SVG.gold} ${G.vault.gold} gold</div><div class="vbtns">${this.btn('Sell all stone (' + fmtMoney(G.vault.stone * G.sellPrice('stone')) + ')', 'small', () => { const n = G.vault.stone; if (!n) return; G.vault.stone = 0; G.addMoney(n * G.sellPrice('stone')); Sound.play('sell'); }, G.vault.stone === 0)} ${this.btn('Sell all gold (' + fmtMoney(G.vault.gold * G.sellPrice('gold')) + ')', 'small', () => { const n = G.vault.gold; if (!n) return; G.vault.gold = 0; G.addMoney(n * G.sellPrice('gold')); Sound.play('sell'); }, G.vault.gold === 0)}</div><div class="pnote">Stone upgrades the Palisade (Lv3+). Gold upgrades the Great Hall.</div></div><div class="psec">Gear</div>${this.upgradeRow('speed', () => this.refreshBuildingPanel(true))}<div class="pnote">Snow Boots make you run faster. Level 5 and 10 boots change your look.</div>`;
    if (b.level < d.max) h += `<div class="pbuy">${this.costHtml(up.cost, up.stone, up.gold)}${this.btn(d.worker ? 'Hire +1 ' + DATA.workers[d.worker].name.toLowerCase() : 'Upgrade', 'primary', () => { if (G.upgradeBuilding(b)) this.refreshBuildingPanel(true); }, !up.ok)}</div>`;
    if (d.worker) {
      const crew = G.workers.filter(w => w.homeId === b.id && !w.dead); const words = { seek: 'looking for work', go: 'walking out', work: b.type === 'lumber' ? 'chopping' : 'mining', deliver: 'hauling home', waitfull: 'waiting (storage full!)', idle: 'resting', gohome: 'heading home', hunt: 'hunting', collect: 'gathering meat', flee: 'retreating to heal', patrol: 'patrolling', fight: 'fighting!' };
      const lines = crew.map(w => w.hidden ? 'asleep inside' : (words[w.state] || w.state) + (w.carry.length ? ` (${w.carry.length} ${w.role === 'hunter' ? 'meat' : w.role === 'lumber' ? 'logs' : 'ore'})` : ''));
      h += `<div class="pinfo">Crew: ${lines.length ? lines.join(' · ') : 'nobody yet'}</div>`;
      if (d.worker !== 'guard') { const m = b.mode === 'value' ? 'value' : 'near'; h += `<div class="srow"><span>Crew works</span><span>${this.btn('Closest first', 'small ' + (m === 'near' ? 'primary' : ''), () => { b.mode = 'near'; G.saveDirty = true; this.refreshBuildingPanel(true); })} ${this.btn('Best value', 'small ' + (m === 'value' ? 'primary' : ''), () => { b.mode = 'value'; G.saveDirty = true; this.refreshBuildingPanel(true); })}</span></div><div class="pnote">${m === 'near' ? 'Closest first: they clear what is nearest and work outward.' : 'Best value: they weigh richer zones against the walk — expect long trips for ×5 logs.'}</div>`; }
      h += `<div class="pnote">Workers who die are gone for good — the ${d.name} drops a level so you can hire a replacement at the lower price. Everyone but guards sleeps inside at night.</div>`;
    }
    if (b.type === 'armory') {
      h += `<div class="psec">Personal upgrades <span class="pnote">(cap ${b.level * 6} each — upgrade the Armory to raise it)</span></div>`;
      for (const k in DATA.upgrades) h += this.upgradeRow(k, () => this.refreshBuildingPanel(true));
      h += `<div class="pnote">Your stats: ${Math.round(G.playerStat('dmg'))} dmg · ${G.playerStat('atk').toFixed(1)} swings/s · ${G.playerStat('speed').toFixed(1)} speed · ${G.playerStat('cap')} carry · ${G.playerStat('hp')} HP · ${G.playerStat('chop')} logs/hit</div>`;
    }
    if (b.type === 'hall') { h += `<div class="psec">Legacy</div><div class="pinfo">Legacy ★${G.legacy}: +${G.legacy * 5}% income, +${G.legacy * 3}% damage, +${G.legacy * 2}% speed. A New Expedition resets your camp, zones, money and upgrades — you keep Legacy, achievements and stats.<br>You would gain <b>★${G.prestigeGain()}</b> Legacy now (based on total earned).</div>${G.canPrestige() ? this.btn('Begin New Expedition ★+' + G.prestigeGain(), 'primary gold', () => { this.confirm('Begin a New Expedition?', 'Your camp, zones, money and upgrades reset. You keep Legacy ★, achievements and lifetime stats — and start faster than ever.', () => { this.close(); G.doPrestige(); }, 'Begin') }) : '<div class="pnote">Unlock by defeating the Bear King or reaching Great Hall Lv10.</div>'}`; }
    this.els.panel.innerHTML = h;
  },
  openCamp(tab = 'camp') { this.campTab = tab; this.open('', 'camp'); this.renderCamp(tab); },
  renderCamp(tab) {
    this.campTab = tab; let h = `<div class="phead"><div class="tabs">${['camp', 'achievements', 'stats'].map(t => `<span class="tab ${t === tab ? 'on' : ''}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</span>`).join('')}</div>${this.btn('✕', 'x', () => this.close())}</div>`;
    if (tab === 'camp') {
      h += `<div class="pinfo">Camp income (workers, last 5 min): <b>${fmtMoney(G.passiveRate() * 60)}/min</b> · Workers: ${G.workers.filter(w => !w.dead).length} · Day ${G.day}</div>`;
      h += `<div class="psec">Gear</div>` + this.upgradeRow('speed', () => this.renderCamp('camp')) + `<div class="psec">Buildings</div>`;
      for (const id in G.b) { const b = G.b[id]; const d = DATA.buildings[b.type]; if (!b.visible) continue; if (b.built) { const up = G.canUpgrade(b); h += `<div class="urow"><div class="uinfo"><b>${d.name}</b> <span class="lv">Lv ${b.level}</span><div class="udesc">${d.effect(b.level)}${b.cash >= 1 ? ` · pile ${fmtMoney(b.cash)}` : ''}${b.wrecked ? ' · <span class="warn">WRECKED</span>' : ''}</div></div>${b.level < d.max ? this.costHtml(up.cost, up.stone, up.gold) + this.btn(d.worker ? 'Hire' : 'Upgrade', 'small primary', () => { G.upgradeBuilding(b); this.renderCamp('camp'); }, !up.ok) : '<span class="lv">MAX</span>'}</div>`; }
        else h += `<div class="urow dim"><div class="uinfo"><b>${d.name}</b><div class="udesc">${d.desc}</div></div><span class="cost">${SVG.cash}${fmtMoney(G.padCost(b) - b.funded)}</span><span class="pnote">walk to pad</span></div>`; }
      const nz = G.zones.findIndex(z => !z); if (nz > 0) { const zd = DATA.zones[nz]; h += `<div class="urow dim"><div class="uinfo"><b>${zd.name}</b><div class="udesc">Zone ${nz}: wood & meat worth x${zd.mult}, ${DATA.bears[zd.bear].name}s${zd.boss ? ', the Bear King' : ''}</div></div><span class="cost">${SVG.cash}${fmtMoney(zd.cost - ((G.zoneFund && G.zoneFund[nz]) || 0))}</span><span class="pnote">walk to gate</span></div>`; }
    } else if (tab === 'achievements') {
      for (const a of DATA.achievements) { const done = !!G.ach[a.id]; const cur = Math.min(a.n, G.stats[a.stat] || 0); h += `<div class="urow ${done ? 'done' : ''}"><div class="uinfo"><b>${done ? '✓ ' : ''}${a.name}</b><div class="udesc">${a.desc} — ${fmtNum(cur)}/${fmtNum(a.n)}</div></div><span class="cost">${SVG.cash}${fmtMoney(a.reward)}</span></div>`; }
    } else {
      const s = G.stats; const rows = [['Total earned', fmtMoney(s.earned)], ['Logs chopped', fmtNum(s.wood)], ['Trees felled', fmtNum(s.trees)], ['Bears slain', fmtNum(s.kills)], ['Armored bears slain', fmtNum(s.armorKills)], ['Bear King defeated', s.king], ['Nights survived', s.nights], ['Stone gathered', fmtNum(s.stone)], ['Gold gathered', fmtNum(s.gold)], ['Buildings built', s.builds], ['Upgrades bought', s.upgrades], ['Times knocked out', s.deaths], ['Expeditions', s.prestige + 1], ['Legacy', '★' + G.legacy], ['Play time', Math.floor(s.playTime / 3600) + 'h ' + Math.floor(s.playTime % 3600 / 60) + 'm']];
      for (const r of rows) h += `<div class="srow"><span>${r[0]}</span><b>${r[1]}</b></div>`;
    }
    this.els.panel.innerHTML = h; this.els.panel.querySelectorAll('.tab').forEach(el => el.onclick = () => { Sound.play('click'); this.renderCamp(el.dataset.tab); });
  },
  openSettings() {
    this.open('', 'settings'); const S = G.settings;
    const render = () => { let h = `<div class="phead"><div class="ptitle">Settings</div>${this.btn('✕', 'x', () => this.close())}</div>`;
      h += `<div class="srow"><span>Sound effects</span>${this.btn(S.sfx ? 'On' : 'Off', 'small ' + (S.sfx ? 'primary' : ''), () => { S.sfx = !S.sfx; Sound.setSfx(S.sfx); render(); })}</div>`;
      h += `<div class="srow"><span>Music</span>${this.btn(S.music ? 'On' : 'Off', 'small ' + (S.music ? 'primary' : ''), () => { S.music = !S.music; Sound.setMusic(S.music); render(); })}</div>`;
      h += `<div class="srow"><span>Camera</span><span>${[['Near', 0.8], ['Normal', 1], ['Far', 1.25]].map(z => this.btn(z[0], 'small ' + (S.zoom === z[1] ? 'primary' : ''), () => { S.zoom = z[1]; render(); })).join(' ')}</span></div>`;
      h += `<div class="srow"><span>Battery saver</span><span>${this.btn(S.saver ? 'On · 30 fps' : 'Off', 'small ' + (S.saver ? 'primary' : ''), () => { S.saver = !S.saver; G.saveDirty = true; render(); })}</span></div>`;
      h += `<div class="srow"><span>Graphics</span><span>${[['Low', 0], ['Med', 1], ['High', 2]].map(z => this.btn(z[0], 'small ' + (S.quality === z[1] ? 'primary' : ''), () => { S.quality = z[1]; S.autoQ = false; G.R.setQuality(z[1]); render(); })).join(' ')}</span></div>`;
      const st = Store.status(); h += `<div class="srow"><span>Saving</span><span class="sstat ${st.cls}">${st.icon} ${st.text}</span></div>`;
      if (Store.ephemeral && Store.cloud !== 'on') h += `<div class="pnote warn">You're playing inside the Claude app's artifact panel, which throws the game away when you leave it. Two ways to keep your camp: <b>1)</b> tap <b>Copy</b> below before you leave and paste the code back with <b>Load</b> next time (or send it to Claude to bake into the game); <b>2)</b> open this link in Safari instead — there the game saves itself and syncs to your account.</div>`;
      const diag = Store.diagnostics(); h += `<div class="diag">${diag.map(l => `<div>${l.replace(/</g, '&lt;')}</div>`).join('')}${this.btn('Copy diagnostics', 'small', async () => { const t = diag.join('\n'); let ok = false; try { await navigator.clipboard.writeText(t); ok = true; } catch (e) { } this.toast(ok ? 'Diagnostics copied — paste them to Claude' : 'Screenshot this box and send it to Claude', ''); })}</div>`;
      // save codes: a backup you can move between devices / the standalone file
      const copyCode = async (code) => { Store.lastCodeCopy = Date.now(); const ta = document.getElementById('savecode'); if (ta) { ta.value = code; ta.focus(); try { ta.setSelectionRange(0, code.length); } catch (e) { } } let ok = false; try { await navigator.clipboard.writeText(code); ok = true; } catch (e) { try { ok = document.execCommand('copy'); } catch (x) { } } this.toast(ok ? 'Save code copied — paste it somewhere safe (Notes, a message to yourself…)' : 'Long-press the code below and choose Copy', ok ? 'good' : ''); };
      h += `<div class="srow"><span>Save code</span><span>${this.btn('Copy', 'small primary', async () => { const code = await G.exportCode(); if (!code) return this.toast('Nothing to export yet', 'warn'); copyCode(code); })} ${navigator.share ? this.btn('Share…', 'small', async () => { const code = await G.exportCode(); if (!code) return; try { await navigator.share({ title: 'Bearfall save code', text: code }); Store.lastCodeCopy = Date.now(); } catch (e) { if (e && e.name !== 'AbortError') copyCode(code); } }) : ''}</span></div>`;
      h += `<textarea id="savecode" placeholder="Paste a save code here, then tap Load"></textarea>`;
      h += `<div class="srow"><span>Load a code</span><span>${navigator.clipboard && navigator.clipboard.readText ? this.btn('Paste', 'small', async () => { try { const t = await navigator.clipboard.readText(); const ta = document.getElementById('savecode'); if (t && ta) { ta.value = t; this.toast('Pasted — now tap Load', ''); } else this.toast('Clipboard is empty', 'warn'); } catch (e) { this.toast('Tap the box, hold, and choose Paste', ''); } }) : ''} ${this.btn('Load', 'small primary', async () => { const ta = document.getElementById('savecode'); const code = ta ? ta.value : ''; if (!code.trim()) return this.toast('Paste a save code in the box first', 'warn'); const why = await G.importCode(code); if (why) this.toast(why, 'warn'); else { this.toast('Save loaded — starting your camp…', 'good'); G.running = false; setTimeout(() => location.reload(), 500); } })}</span></div>`;
      h += `<div class="pnote">A save code is a backup of your whole camp. Copy it to Notes or a message to yourself; load it here on another device or after a reset.</div>`;
      h += `<div class="srow"><span>Reset game</span>${this.btn('Reset', 'small danger', () => { this.confirm('Reset everything?', 'Deletes your camp, progress and Legacy. This cannot be undone.', () => { G.wipe(); G.running = false; location.reload(); }, 'Delete & reset') })}</div>`;
      h += `<div class="pnote">Bearfall v2.2 · A Studio 22 game. Progress saves automatically on this device — add to Home Screen for full-screen play and the safest saves. Made with ❤ and a lot of snow.</div>`;
      this.els.panel.innerHTML = h; };
    render();
  },
  showOffline(amount, seconds) { const hrs = Math.floor(seconds / 3600), mins = Math.floor(seconds % 3600 / 60); this.open(`<div class="phead"><div class="ptitle">Welcome back!</div></div><div class="pinfo">You were away for <b>${hrs ? hrs + 'h ' : ''}${mins}m</b>. Your workers kept the camp running.</div><div class="bigcash">${SVG.cash} ${fmtMoney(amount)}</div><div class="pnote">Offline earnings run at 50% for up to ${2 + G.level('warehouse')} hours. Build the Warehouse to extend it.</div>${this.btn('Collect', 'primary wide', () => { G.addMoney(amount, false); Sound.play('cash'); this.close(); })}`, 'offline'); },
  showVictory() { this.open(`<div class="phead"><div class="ptitle">The Bear King has fallen!</div></div><div class="pinfo">The frost bows to you. Your expedition is a legend.</div><div class="pinfo">You can keep building — the Bear King returns to his den in a few minutes for another fight. Or visit the <b>Great Hall</b> to begin a <b>New Expedition</b>: everything resets, but you keep <b>Legacy ★</b> bonuses forever (+5% income and +3% damage each).</div>${this.btn('Keep playing', 'primary wide', () => this.close())}`, 'victory'); }
};

// ===== 17_main.js =====
// ---------------------------------------------------------------------------
// Boot + main loop
// ---------------------------------------------------------------------------
(function () {
  const errBox = document.getElementById('err');
  window.addEventListener('error', (e) => { errBox.style.display = 'block'; errBox.textContent = 'Error: ' + e.message + ' (' + (e.filename || '').split('/').pop() + ':' + e.lineno + ')'; });
  if (!CanvasRenderingContext2D.prototype.roundRect) CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) { this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath(); };
  const canvas = document.getElementById('gl'); G.canvas = canvas;
  let R; try { R = new Renderer(canvas); } catch (e) { errBox.style.display = 'block'; errBox.textContent = 'This device does not support WebGL2. ' + e.message; return; }
  G.R = R; Models.R = R; { const bf = document.getElementById('boot-fallback'); if (bf) bf.remove(); } // the renderer is up: the boot notice has done its job
  const uiRoot = document.getElementById('ui'); UI.init(uiRoot); Input.init(canvas, uiRoot);
  let saved = null, hasSave = false;
  const ok = (s) => !!(s && s.v === DATA.version && s.b);
  async function boot() {
    Store.init(); UI.showTitle(false, start, true); // spinner while every backend is checked
    // 1. a save carried across a reload (Load code) wins over everything
    let imported = null; if (Store.hashCode && !Store.hashAuto) { try { imported = await Store.decode(Store.hashCode); } catch (e) { } Store.hashCode = null; if (!ok(imported)) imported = null; }
    // 2. this device: localStorage / IndexedDB / cookie / Cache API / URL — newest copy wins
    saved = imported || await Store.readDevice(); if (!ok(saved)) saved = null; hasSave = !!saved; if (saved) Store.mem = saved;
    // 2b. a running state handed over by the viewer when the page was republished while open
    const hot = Store.hot; const hotData = await new Promise(res => { try { if (hot && typeof hot.ready === 'function') { let done = false; hot.ready(d => { if (!done) { done = true; res(d || null); } }); setTimeout(() => { if (!done) { done = true; res(null); } }, 1500); } else res(hot && hot.data ? hot.data : null); } catch (e) { res(null); } });
    if (!imported && ok(hotData) && (!saved || (hotData.t || 0) >= (saved.t || 0))) { saved = hotData; hasSave = true; Store.mem = saved; Store.src = 'hot'; }
    // 3. cloud (inside claude.ai): wait briefly for the cloud copy and keep whichever is newer
    const inViewer = !!(window.claude && typeof window.claude.use === 'function');
    if (inViewer) {
      const cs = await Store.connectCloud();
      if (!imported && ok(cs) && (!hasSave || (cs.t || 0) > (saved.t || 0))) { saved = cs; hasSave = true; Store.mem = cs; }
    }
    if (hasSave) { Store.put(saved); Store.flushCloud(true); } // heal: the winning copy goes to every backend that works
    UI.showTitle(hasSave, start, false);
    if (imported || (Store.resume && hasSave)) start(false); // just loaded a code / came back for newer progress: jump straight in
  }
  // the cloud answered after the title screen moved on: never overwrite newer progress from another device without asking
  Store.onLateCloud = (cs) => {
    const mine = Store.mem || saved; const newer = ok(cs) && (!mine || (cs.t || 0) > (mine.t || 0)) && (!cs.stats || (cs.stats.playTime || 0) > (G.stats.playTime || 0));
    if (!newer) { Store.cloudDirty = true; return; }
    UI.confirm('Camp found in the cloud', `Day ${cs.day || 1} with ${fmtMoney(cs.money || 0)} was saved from another device. Load it now? (Cancel keeps this game and replaces the cloud copy.)`, () => { G.running = false; Store.writeLocal(cs); Store.mem = cs; try { location.hash = '#resume'; } catch (e) { } location.reload(); }, 'Load it');
    Store.cloudDirty = true;
  };
  function start(fresh) {
    if (!fresh && hasSave) G.applySave(saved); else { G.wipe(); G.savedPlayer = null; G.savedBuildings = {}; }
    Sound.setSfx(G.settings.sfx); Sound.setMusic(G.settings.music); R.setQuality(G.settings.quality === undefined ? 2 : G.settings.quality);
    G.buildWorld(); G.applyNodeStates(); G.initBuildings(); G.initPlayer(); G.spawnBears(); G.syncWorkers(); G.refreshPads(); G.running = true; UI.hideTitle();
    UI.shownCash = G.money;
    if (!fresh && hasSave) { const away = (Date.now() - G.savedAt) / 1000; const cap = (2 + G.level('warehouse')) * 3600; if (away > 90 && G.offlineRate > 0) { const amt = Math.floor(G.offlineRate * Math.min(away, cap) * 0.5); if (amt >= 1) setTimeout(() => UI.showOffline(amt, away), 600); } }
    else { setTimeout(() => UI.hint('Drag anywhere to move. Walk up to a tree and stop — your axe does the rest. Fill your backpack, then sell at the Trading Post.'), 800); }
    UI.setQuest(G.currentQuest(), 0, 1);
  }
  boot().catch(e => { console.error(e); UI.showTitle(hasSave, start, false); });
  // ---- loop
  let last = performance.now(); let acc = 0; let slowT = 0, frameAcc = 0, frameN = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (G.settings.saver && now - last < 29) return; // battery saver: 30 fps
    Input.pollPad(); if (Input.padPressed.a || Input.padPressed.b || Input.padPressed.y || Input.padPressed.start) UI.onPad(Input.padPressed);
    let dt = Math.min(0.05, (now - last) / 1000); const last0 = last; last = now; if (!G.running) { return; }
    R.resize();
    if (G.hitStop > 0) { G.hitStop -= dt; dt *= 0.15; }
    dt *= G.speedMult; G.dt = dt; G.time += dt; G.frame++; G.stats.playTime += dt;
    // ---- update
    const P = G.profile ? (k) => { const t = performance.now(); G.prof[k] = (G.prof[k] || 0) + (t - G._pt); G._pt = t; } : () => { }; if (G.profile) { G.prof = G.prof || {}; G._pt = performance.now(); }
    G.updateDay(dt); G.updateWorld(dt); if (G.bot) G.botUpdate(dt); P('world'); G.updatePlayer(dt); P('player'); G.updateBears(dt); P('bears'); G.updateWorkers(dt); P('workers'); G.updateBuildings(dt); P('buildings'); G.updateLoot(dt); G.updateParticles(dt); G.updateProjectiles(dt); G.updateQuests(dt); G.updateEvents(dt); G.updateGuide(); G.updateCamera(dt); P('misc');
    // ---- draw
    G.drawWorld(); P('drawWorld'); G.drawBuildings(); G.drawPlayer(); G.drawBears(); G.drawWorkers(); G.drawLoot(); G.drawParticles(); G.drawProjectiles(); G.drawGuide(); P('drawEnts');
    R.render([G.player.x, 0, G.player.z]); P('render');
    try { UI.update(dt); } catch (e) { if (!G._uiErr) { G._uiErr = true; console.error('UI error', e); errBox.style.display = 'block'; errBox.textContent = 'UI error: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n'); } } P('ui');
    // auto quality: if frames are consistently slow, step quality down
    frameAcc += (now - last0); frameN++; if (frameN >= 90) { const avg = frameAcc / frameN; frameAcc = 0; frameN = 0; if (G.settings.autoQ && avg > 28 && G.settings.quality > 0 && G.time > 8) { G.settings.quality--; R.setQuality(G.settings.quality); UI.toast('Graphics lowered for smoother play (change in Settings)', ''); } }
    // ---- autosave
    if (G.time - G.lastSave > 12 || (G.saveDirty && G.time - G.lastSave > 3)) G.save();
    Store.flushCloud(false);
  }
  requestAnimationFrame(frame);
  // leaving: save everywhere right away. Coming back after a while: if another device saved newer progress, load it.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { hiddenAt = Date.now(); G.save(); Store.flushCloud(true); return; }
    if (!G.running || Store.cloud !== 'on' || !Store.doc || Date.now() - hiddenAt < (Store.returnCheckMs || 45000)) return;
    try { const snap = await Store.doc.get(); const d = snap.exists ? snap.data() : null; if (ok(d) && (d.t || 0) > Math.max(Store.lastCloudWrite, G.savedAt || 0) + 30000 && (d.stats && d.stats.playTime > (G.stats.playTime || 0))) { Store.put(d); UI.toast('Loading newer progress from your other device…', 'good'); G.running = false; setTimeout(() => { try { location.hash = '#resume'; } catch (e) { } location.reload(); }, 900); } } catch (e) { }
  });
  window.addEventListener('pagehide', () => { G.save(); Store.flushCloud(true); }); window.addEventListener('beforeunload', () => G.save());
  window.addEventListener('resize', () => R.resize());
  // ---- installable web app: offline cache + "update ready" prompt (only when served over http(s) as a top-level page)
  G.buildId = '20260924022709';
  const wantSw = typeof BUILD_FLAGS === 'undefined' || BUILD_FLAGS.sw !== false;
  if (wantSw && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !Store.ephemeral) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      const offer = () => { if (!reg.waiting) return; UI.offerUpdate(() => { G.save(); G.updating = true; reg.waiting.postMessage('SKIP_WAITING'); setTimeout(() => location.reload(), 1500); }); };
      offer(); reg.addEventListener('updatefound', () => { const nw = reg.installing; if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) offer(); }); });
      setInterval(() => reg.update().catch(() => { }), 60 * 60 * 1000); document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => { }); });
    }).catch(() => { });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (G.updating) location.reload(); });
  }
  window.BF = G; // debug hook
  G.step = function (dt) { G.dt = dt; G.time += dt; G.frame++; G.stats.playTime += dt; G.updateDay(dt); G.updateWorld(dt); if (G.bot) G.botUpdate(dt); G.updatePlayer(dt); G.updateBears(dt); G.updateWorkers(dt); G.updateBuildings(dt); G.updateLoot(dt); G.updateParticles(dt); G.updateProjectiles(dt); G.updateQuests(dt); G.updateEvents(dt); G.updateGuide(); };
  G.simulate = function (seconds, stepDt = 0.05) { UI.silent = true; const wasRunning = G.running; G.running = false; const n = Math.floor(seconds / stepDt); for (let i = 0; i < n; i++) { G.step(stepDt); if (G.particles.length > 50) G.particles.length = 0; if (G.floaters.length > 5) G.floaters.length = 0; } G.running = wasRunning; UI.silent = false; return G.botLog; };
})();

// ===== 18_bot.js =====
// ---------------------------------------------------------------------------
// Debug auto-player (BF.bot = true or ?bot). Used for balance simulation.
// ---------------------------------------------------------------------------
Object.assign(G, {
  bot: false, botGoal: null, botT: 0, botLog: [], botLogT: 0, botZone: 0, botStuckT: 0,
  botUpdate(dt) {
    if (!this.bot || !this.player) return; const p = this.player; this.botT -= dt; this.botLogT -= dt;
    if (this.botLogT <= 0) { this.botLogT = this.botLogEvery || 60; this.botLog.push({ t: Math.round(this.time), day: this.day, money: Math.round(this.money), earned: Math.round(this.stats.earned), rate: Math.round(this.passiveRate() * 60), kills: this.stats.kills, zones: this.zones.filter(Boolean).length, b: Object.keys(this.b).filter(k => this.b[k].built).map(k => k + this.b[k].level).join(','), up: Object.values(this.upgrades).join('/'), workers: this.workers.length, legacy: this.legacy, deaths: this.stats.deaths }); }
    if (p.dead) { Input.botVec = [0, 0]; return; }
    if (this.botT <= 0) { this.botT = 0.4; this.botDecide(); }
    const g = this.botGoal; if (!g) { Input.botVec = [0, 0]; return; }
    const wp = this.routeTo(p, g.x, g.z); const dx = wp[0] - p.x, dz = wp[1] - p.z, d = Math.hypot(dx, dz);
    const stopD = g.stop || 0.8; const dTot = Math.hypot(g.x - p.x, g.z - p.z);
    if (dTot < stopD) { Input.botVec = [0, 0]; if (g.kind === 'tree' || g.kind === 'rock') { /* chopping happens automatically when idle */ } }
    else { const mag = g.kind === 'tree' && dTot < 3 ? 0.5 : 1; Input.botVec = [dx / d * mag, dz / d * mag]; }
    // stuck detection
    if (this.botLast && dist2(p.x, p.z, this.botLast[0], this.botLast[1]) < 0.01 && dTot > stopD) { this.botStuckT += dt; if (this.botStuckT > 2.5) { this.botStuckT = 0; this.botGoal = null; this.botT = 0; p.x += rand(-2, 2); p.z += rand(-2, 2); } } else this.botStuckT = 0;
    this.botLast = [p.x, p.z];
  },
  botDecide() {
    const p = this.player; const cap = this.playerStat('cap');
    // buy upgrades aggressively (cheapest first)
    let bought = true; let guard = 0;
    while (bought && guard++ < 20) {
      bought = false; const opts = [];
      for (const k in DATA.upgrades) if (this.upgrades[k] < this.upgradeMax(k)) opts.push({ cost: this.upgradeCost(k), fn: () => this.buyUpgrade(k), w: k === 'dmg' || k === 'cap' ? 0.8 : 1 });
      for (const id in this.b) { const b = this.b[id]; if (!b.built) continue; const c = this.canUpgrade(b); if (c.cost !== undefined && b.level < DATA.buildings[b.type].max) opts.push({ cost: c.cost, ok: c.ok, fn: () => this.upgradeBuilding(b), w: b.type === 'lumber' || b.type === 'sawmill' || b.type === 'hall' ? 0.7 : 1 }); }
      opts.sort((a, b) => a.cost * a.w - b.cost * b.w);
      for (const o of opts) { if ((o.ok === undefined ? this.money >= o.cost : o.ok) && o.cost < this.money * 0.6 + 1) { if (o.fn()) { bought = true; break; } } }
    }
    // threats
    let threat = null; for (const b of this.bears) { if (!b.dead && b.target === p && dist2(b.x, b.z, p.x, p.z) < 8 * 8) { threat = b; break; } }
    if (threat) { if (p.hp > p.maxHp * 0.35 || this.night.active) { this.botGoal = { x: threat.x, z: threat.z, kind: 'bear', stop: 1.6 }; return; } const f = this.b.fire; this.botGoal = { x: f.x + 1.5, z: f.z + 1.5, kind: 'fire', stop: 1 }; return; }
    if (this.night.active) { const f = this.b.fire; let near = null, nd = 14 * 14; for (const b of this.bears) { if (b.dead) continue; const d = dist2(b.x, b.z, f.x, f.z); if (d < nd) { nd = d; near = b; } } if (near && p.hp > p.maxHp * 0.3) { this.botGoal = { x: near.x, z: near.z, kind: 'bear', stop: 1.6 }; return; } this.botGoal = { x: f.x + 1.5, z: f.z + 1.5, kind: 'fire', stop: 1.2 }; return; }
    if (p.hp < p.maxHp * 0.4) { const f = this.b.fire; this.botGoal = { x: f.x + 1.5, z: f.z + 1.5, kind: 'fire', stop: 1.2 }; return; }
    // fund affordable pads / zones
    for (const id in this.b) { const b = this.b[id]; if (b.built || !b.visible) continue; const cost = this.padCost(b) - b.funded; if (this.money >= cost * 0.9 && (b.type !== 'tower' || this.money >= cost * 1.5)) { const d = DATA.buildings[b.type]; this.botGoal = { x: b.x, z: b.z, kind: 'pad', stop: Math.max(d.w, d.d) * 0.5 - 0.2 }; return; } }
    for (let i = 1; i < DATA.zones.length; i++) { if (this.zones[i]) continue; if (!this.zones[i - 1] && !(i === 4 && this.zones[1])) continue; const zd = DATA.zones[i]; const f = (this.zoneFund && this.zoneFund[i]) || 0; if (this.money >= (zd.cost - f) * 0.95 && this.playerStat('dmg') >= DATA.bears[zd.bear].hp / 12) { const gp = this.zoneGateMarker(i); this.botGoal = { x: gp[0], z: gp[1], kind: 'zone', stop: 1.2 }; return; } }
    // collect big piles
    for (const id in this.b) { const b = this.b[id]; if (b.built && b.cash > this.cashCap(b) * 0.5) { const cp = this.cashPilePos(b); this.botGoal = { x: cp[0], z: cp[1], kind: 'pile', stop: 2 }; return; } }
    // sell when full
    if (p.carry.length >= cap) { const post = this.b.post; this.botGoal = { x: post.x, z: post.z + 2.6, kind: 'sell', stop: 1.2 }; return; }
    // otherwise gather: prefer bears if strong, else trees in best zone
    let bz = 0; for (let i = 0; i < 5; i++) if (this.zones[i] && !DATA.zones[i].boss && this.playerStat('dmg') * 5 >= DATA.bears[DATA.zones[i].bear].hp / 3) bz = i; if (!this.zones[bz]) bz = 0;
    const dmg = this.playerStat('dmg'); const hunt = this.b.lodge.built || dmg >= 30;
    if (hunt && Math.random() < 0.5) { let best = null, bd = 1e9; for (const b of this.bears) { if (b.dead || b.boss || !this.zones[b.zone] || b.zone > bz) continue; const d = dist2(b.x, b.z, p.x, p.z); if (d < bd) { bd = d; best = b; } } if (best && bd < 40 * 40) { this.botGoal = { x: best.x, z: best.z, kind: 'bear', stop: 1.6 }; return; } }
    let best = null, bd = 1e9; for (const t of this.trees) { if (!t.alive || t.fall > 0 || !this.zones[t.zone] || t.zone !== bz) continue; const d = dist2(t.x, t.z, p.x, p.z) - t.mult * 200; if (d < bd) { bd = d; best = t; } }
    if (best) { this.botGoal = { x: best.x, z: best.z, kind: 'tree', stop: 1.3 }; return; }
    this.botGoal = null;
  }
});
// hook bot vector into Input
Input.botVec = null; const _vec = Input.vector.bind(Input); Input.vector = function () { if (G.bot && this.botVec) return this.botVec; return _vec(); };
if (location.search.includes('bot')) G.bot = true;

window.BF = G; window.G = G; window.UI = UI; window.Store = Store; window.DATA = DATA; window.Input = Input; window.Sound = Sound;
