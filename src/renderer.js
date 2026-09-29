// ============================================================================
//  Renderer (raw WebGL 2)
// ============================================================================
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.hasFloat = !!gl.getExtension('EXT_color_buffer_float');
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = (dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || 'Unknown GPU';
    this.vao = gl.createVertexArray();
    this.programs = {};
    this.targets = { scene: null, mips: [] };
    this.sky = null;
    this.skyReady = false;
    this.bhDefs = '';
    this._initStatic();
  }

  // ---- helpers ----
  _compile(type, src) {
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
      throw new Error('Shader compile error: ' + log);
    }
    return s;
  }
  _program(vs, fs, attribs) {
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fs));
    if (attribs) attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  _fmt(kind) {
    const gl = this.gl;
    if (!this.hasFloat) return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    if (kind === 'scene') return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    return { internal: gl.R11F_G11F_B10F, format: gl.RGB, type: gl.HALF_FLOAT };
  }
  _target(w, h, kind) {
    const gl = this.gl, f = this._fmt(kind);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, f.internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok && this.hasFloat) { gl.deleteTexture(tex); gl.deleteFramebuffer(fb); this.hasFloat = false; return this._target(w, h, kind); }
    return { tex, fb, w, h };
  }
  _free(t) { if (!t) return; this.gl.deleteTexture(t.tex); this.gl.deleteFramebuffer(t.fb); }
  _draw() { const gl = this.gl; gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3); }

  _initStatic() {
    const gl = this.gl;
    this.programs.down = this._program(SH.fullscreenVS, SH.downFS);
    this.programs.up = this._program(SH.fullscreenVS, SH.upFS);
    this.programs.comp = this._program(SH.fullscreenVS, SH.compositeFS);
    this.programs.sky = this._program(SH.fullscreenVS, SH.skyFS);
    this.programs.star = this._program(SH.starVS, SH.starFS, ['aDir', 'aCol', 'aDepth']);
    // Blackbody table
    this.bbTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.bbTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, BB.N, 1, 0, gl.RGBA, gl.FLOAT, BB.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Title texture placeholder (1x1 transparent)
    this.textTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.textTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    // Galactic frame (world space). The Galactic Centre sits up and to the left of
    // the default view and the band crosses it diagonally, as in the reference photograph.
    const nrm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const gx = nrm([-0.325, -0.350, -0.960]);
    let band = [0.819, 0.568, -0.080];
    const d0 = dot(band, gx); band = nrm(band.map((v, i) => v - d0 * gx[i]));
    this.gal = { gx, gy: band, gz: cross(gx, band) };
  }

  setText(canvas2d) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.textTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas2d);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  }

  // ---- black hole program (recompiled when quality defines change) ----
  setQuality(q) {
    const defs = `#define MAX_STEPS ${q.maxSteps | 0}\n#define INTEGRATOR ${q.integrator === 'rk4' ? 1 : 0}\n#define DISK_OCT ${q.diskOct | 0}`;
    if (defs === this.bhDefs) return;
    const old = this.programs.bh;
    this.programs.bh = this._program(SH.fullscreenVS, SH.bhFS(defs));
    if (old) this.gl.deleteProgram(old.p);
    this.bhDefs = defs;
  }

  resize(outW, outH, sceneW, sceneH, bloomLevels) {
    this.outW = outW; this.outH = outH;
    const t = this.targets;
    if (!t.scene || t.scene.w !== sceneW || t.scene.h !== sceneH || t.levels !== bloomLevels) {
      this._free(t.scene); t.mips.forEach((m) => this._free(m));
      t.scene = this._target(sceneW, sceneH, 'scene');
      if (t.depth) this.gl.deleteRenderbuffer(t.depth);
      const gl = this.gl;
      t.depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, sceneW, sceneH);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.scene.fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.depth);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      t.mips = [];
      let w = sceneW, h = sceneH;
      for (let i = 0; i < bloomLevels; i++) {
        w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
        if (w < 4 || h < 4) break;
        t.mips.push(this._target(w, h, 'bloom'));
      }
      t.levels = bloomLevels;
    }
  }

  // ---- sky generation: returns a step function; call until it reports done ----
  beginSky(res, starCount) {
    const gl = this.gl;
    if (this.sky) gl.deleteTexture(this.sky.tex);
    const f = this._fmt('sky');
    const tex = gl.createTexture();
    const levels = Math.floor(Math.log2(res)) + 1;
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, levels, f.internal, res, res);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_CUBE_MAP, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    this.sky = { tex, res };
    this.skyReady = false;
    const fb = gl.createFramebuffer();
    const bands = 4, jobs = [];
    for (let face = 0; face < 6; face++) for (let b = 0; b < bands; b++) jobs.push({ face, b });
    const stars = this._makeStars(starCount);
    let i = 0;
    const total = jobs.length + 2;
    const step = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, res, res);
      if (i < jobs.length) {
        const { face, b } = jobs[i];
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, tex, 0);
        const h0 = Math.floor((b * res) / bands), h1 = Math.floor(((b + 1) * res) / bands);
        gl.enable(gl.SCISSOR_TEST); gl.scissor(0, h0, res, h1 - h0);
        const P = this.programs.sky; gl.useProgram(P.p);
        gl.uniform1i(P.u.uFace, face); gl.uniform1f(P.u.uRes, res);
        this._galUniforms(P);
        this._draw();
        gl.disable(gl.SCISSOR_TEST);
      } else if (i === jobs.length) {
        const P = this.programs.star; gl.useProgram(P.p);
        this._galUniforms(P);
        gl.uniform1f(P.u.uRes, res);
        gl.uniform1f(P.u.uSigma, Math.max(0.55, (0.62 * res) / 2048));
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(stars.vao);
        for (let face = 0; face < 6; face++) {
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, tex, 0);
          gl.uniform1i(P.u.uFace, face);
          gl.drawArrays(gl.POINTS, 0, stars.count);
        }
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
        gl.deleteBuffer(stars.buf); gl.deleteVertexArray(stars.vao);
      } else {
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
        gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fb);
        this.skyReady = true;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      i++;
      return { done: i >= total, progress: Math.min(1, i / total) };
    };
    return step;
  }
  _galUniforms(P) {
    const gl = this.gl;
    gl.uniform3fv(P.u.uGx, this.gal.gx); gl.uniform3fv(P.u.uGy, this.gal.gy); gl.uniform3fv(P.u.uGz, this.gal.gz);
  }
  // Star catalogue: half isotropic, half concentrated to the Galactic disk and bulge.
  // Counts grow as N(<m) ~ 10^(0.34 m); fewer stars trims only the faint end.
  _makeStars(count) {
    const gl = this.gl;
    let seed = 1234567;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; };
    const mMax = 9.4 + Math.log10(count / 100000) / 0.34;
    const wb = BB.chroma(5600);
    const tempPick = () => {
      const u = rnd();
      if (u < 0.22) return 3000 + rnd() * 1000;
      if (u < 0.55) return 4000 + rnd() * 2000;
      if (u < 0.85) return 6000 + rnd() * 4000;
      return 10000 + Math.pow(rnd(), 2) * 20000;
    };
    const { gx, gy, gz } = this.gal;
    const nReal = typeof BRIGHT_STARS !== 'undefined' ? BRIGHT_STARS.length : 0;
    const data = new Float32Array((count + nReal) * 8);
    for (let k = 0; k < nReal; k++) {
      const [, ra, dec, mag, temp] = BRIGHT_STARS[k];
      const a = (ra * 15 * Math.PI) / 180, dl = (dec * Math.PI) / 180;
      const e = [Math.cos(dl) * Math.cos(a), Math.cos(dl) * Math.sin(a), Math.sin(dl)];
      const g = EQ2GAL.map((row) => row[0] * e[0] + row[1] * e[1] + row[2] * e[2]);
      const d = [0, 1, 2].map((q) => g[0] * gx[q] + g[1] * gy[q] + g[2] * gz[q]);
      const ch = BB.chroma(temp);
      let cc = [ch[0] / wb[0], ch[1] / wb[1], ch[2] / wb[2]];
      const L = lumOf(cc); cc = cc.map((v) => v / L);
      const o = (count + k) * 8;
      data.set([d[0], d[1], d[2], cc[0], cc[1], cc[2], 9 * Math.pow(10, -0.27 * mag), rnd()], o);
    }
    count += nReal;
    for (let i = 0; i < count - nReal; i++) {
      let l, b;
      if (rnd() < 0.5) { const z = 2 * rnd() - 1; l = rnd() * 2 * Math.PI - Math.PI; b = Math.asin(z); }
      else {
        l = (rnd() < 0.5 ? -1 : 1) * -Math.log(1 - rnd() * 0.97) * 1.3;
        l = ((l + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        const hb = 0.05 + 0.10 * Math.exp(-Math.abs(l) * 1.2);
        b = (rnd() < 0.5 ? -1 : 1) * -Math.log(1 - rnd() * 0.999) * hb;
        b = Math.max(-1.5, Math.min(1.5, b));
      }
      const cg = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
      const d = [0, 1, 2].map((k) => cg[0] * gx[k] + cg[1] * gy[k] + cg[2] * gz[k]);
      const m = Math.max(2.4, mMax + Math.log10(rnd()) / 0.34);
      const flux = 9 * Math.pow(10, -0.27 * m);    // mild photographic stretch
      const ch = BB.chroma(tempPick());
      let cc = [ch[0] / wb[0], ch[1] / wb[1], ch[2] / wb[2]];
      const L = lumOf(cc); cc = cc.map((v) => v / L);
      const o = i * 8;
      data[o] = d[0]; data[o + 1] = d[1]; data[o + 2] = d[2];
      data[o + 3] = cc[0]; data[o + 4] = cc[1]; data[o + 5] = cc[2]; data[o + 6] = flux;
      data[o + 7] = rnd();
    }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
    gl.bindVertexArray(null);
    return { vao, buf, count };
  }

  // ---- frame ----
  render(v) {
    const gl = this.gl, T = this.targets;
    if (!this.skyReady || !this.programs.bh) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.outW, this.outH); gl.clearColor(0.008, 0.012, 0.03, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    // 1. Geodesic ray tracing into the HDR scene target
    const P = this.programs.bh, u = P.u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fb);
    gl.viewport(0, 0, T.scene.w, T.scene.h);
    gl.useProgram(P.p);
    gl.uniform2f(u.uRes, T.scene.w, T.scene.h);
    gl.uniform2f(u.uCenter, v.center[0], v.center[1]);
    gl.uniform3fv(u.uCamPos, v.pos); gl.uniform3fv(u.uCamRight, v.right); gl.uniform3fv(u.uCamUp, v.up); gl.uniform3fv(u.uCamFwd, v.fwd);
    gl.uniform1f(u.uTanHalf, v.tanHalf);
    gl.uniform1f(u.uTime, v.time);
    gl.uniform1f(u.uStepK, v.stepK);
    gl.uniform1f(u.uREsc, v.rEsc);
    gl.uniform1f(u.uDiskIn, 3.0); gl.uniform1f(u.uDiskOut, v.diskOut);
    gl.uniform1f(u.uTNorm, v.tNorm); gl.uniform1f(u.uDiskGain, v.diskGain);
    gl.uniform1f(u.uBeamPow, v.beam); gl.uniform1f(u.uOpacity, v.opacity);
    gl.uniform1f(u.uGridMax, v.diskOut + 6);
    gl.uniform1f(u.uLensing, v.lensing); gl.uniform1f(u.uDoppler, v.doppler); gl.uniform1f(u.uGrav, v.grav);
    gl.uniform1f(u.uDiskOn, v.disk); gl.uniform1f(u.uSkyOn, v.sky); gl.uniform1f(u.uPhGrid, v.phGrid); gl.uniform1f(u.uEqGrid, v.eqGrid);
    gl.uniform1f(u.uSkyGain, v.skyGain * (this.hasFloat ? 1 : 0.7));
    gl.uniform1f(u.uCubeRes, this.sky.res);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.sky.tex); gl.uniform1i(u.uSky, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bbTex); gl.uniform1i(u.uBB, 1);
    gl.uniform1i(u.uBBN, BB.N); gl.uniform2f(u.uBBRange, BB.lo, BB.hi);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.textTex); gl.uniform1i(u.uText, 2);
    gl.uniform1f(u.uTextOn, v.textOn ? 1 : 0);
    if (v.textOn) { gl.uniform1f(u.uTextDist, v.textDist); gl.uniform4fv(u.uTextRect, v.textRect); gl.uniform3fv(u.uTextColor, v.textColor); }
    this._draw();
    this._post(v);
  }

  // Bloom and tone mapping from the HDR scene target to the canvas (shared by all pages).
  _post(v) {
    const gl = this.gl, T = this.targets;
    // 2. Bloom
    const mips = T.mips;
    const bloomOn = v.bloom && mips.length > 0;
    if (bloomOn) {
      const D = this.programs.down;
      gl.useProgram(D.p);
      gl.uniform1i(D.u.uSrc, 0);
      gl.uniform1f(D.u.uThreshold, v.bloomThreshold); gl.uniform1f(D.u.uKnee, 0.5);
      let src = T.scene;
      for (let i = 0; i < mips.length; i++) {
        const dst = mips[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(D.u.uTexel, 1 / src.w, 1 / src.h); gl.uniform2f(D.u.uDstRes, dst.w, dst.h);
        gl.uniform1f(D.u.uPrefilter, i === 0 ? 1 : 0);
        this._draw();
        src = dst;
      }
      const U = this.programs.up;
      gl.useProgram(U.p); gl.uniform1i(U.u.uSrc, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = mips.length - 1; i > 0; i--) {
        const s = mips[i], d = mips[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb); gl.viewport(0, 0, d.w, d.h);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.tex);
        gl.uniform2f(U.u.uTexel, 1 / s.w, 1 / s.h); gl.uniform2f(U.u.uDstRes, d.w, d.h);
        this._draw();
      }
      gl.disable(gl.BLEND);
    }

    // 3. Tone map to the canvas
    const C = this.programs.comp;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.outW, this.outH);
    gl.useProgram(C.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.scene.tex); gl.uniform1i(C.u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomOn ? mips[0].tex : T.scene.tex); gl.uniform1i(C.u.uBloom, 1);
    gl.uniform2f(C.u.uOutRes, this.outW, this.outH);
    gl.uniform1f(C.u.uBloomOn, bloomOn ? 1 : 0);
    gl.uniform1f(C.u.uBloomStr, v.bloomStrength / Math.max(1, mips.length) * 1.6);
    gl.uniform1f(C.u.uExposure, v.exposure);
    gl.uniform1f(C.u.uTonemap, v.tonemap === 'aces' ? 1 : 0);
    gl.uniform1f(C.u.uSeed, (v.frame % 64) * 1.37);
    this._draw();
  }
}
