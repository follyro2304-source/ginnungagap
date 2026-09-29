// ============================================================================
//  Renderer extensions for the spacetime page
// ============================================================================
Renderer.prototype.initSpace = function (cloudOct) {
  const gl = this.gl;
  const defs = `#define CLOUD_OCT ${Math.max(2, Math.min(6, cloudOct | 0))}`;
  if (defs !== this.spaceDefs) {
    const old = this.programs.space;
    this.programs.space = this._program(SH.fullscreenVS, SH.spaceFS(defs));
    if (old) gl.deleteProgram(old.p);
    this.spaceDefs = defs;
  }
  if (this.programs.line) return;
  this.programs.line = this._program(SH.lineVS, SH.lineFS);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corner = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corner);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.bufferData(gl.ARRAY_BUFFER, 4, gl.DYNAMIC_DRAW);
  for (let k = 0; k < 3; k++) {
    gl.enableVertexAttribArray(1 + k);
    gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, 48, k * 16);
    gl.vertexAttribDivisor(1 + k, 1);
  }
  gl.bindVertexArray(null);
  this.lineGL = { vao, inst, cap: 0 };
  // 1x1 placeholders until the real maps are decoded
  const px = (fmt, ifmt, data) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, 1, 1, 0, fmt, gl.UNSIGNED_BYTE, data);
    return t;
  };
  this.spaceTex = {
    earth: px(gl.RGBA, gl.RGBA8, new Uint8Array([20, 40, 80, 255])),
    lights: px(gl.RED, gl.R8, new Uint8Array([0])),
    moonAlb: px(gl.RED, gl.R8, new Uint8Array([160])),
    moonH: px(gl.RED, gl.R8, new Uint8Array([128])),
    ready: false,
  };
};

Renderer.prototype.loadSpaceTextures = function (src) {
  const gl = this.gl;
  const load = (url, ifmt, fmt) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, fmt, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      res(t);
    };
    img.onerror = () => rej(new Error('texture decode failed'));
    img.src = url;
  });
  return Promise.all([
    load(src.earth, gl.RGB8, gl.RGB), load(src.lights, gl.R8, gl.RED),
    load(src.moonAlb, gl.R8, gl.RED), load(src.moonH, gl.R8, gl.RED),
  ]).then(([earth, lights, moonAlb, moonH]) => {
    Object.assign(this.spaceTex, { earth, lights, moonAlb, moonH, ready: true });
  });
};

Renderer.prototype.renderSpace = function (v) {
  const gl = this.gl, T = this.targets;
  if (!this.skyReady || !this.programs.space) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.outW, this.outH);
    gl.clearColor(0.008, 0.012, 0.03, 1); gl.clear(gl.COLOR_BUFFER_BIT); return;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fb);
  gl.viewport(0, 0, T.scene.w, T.scene.h);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.ALWAYS); gl.depthMask(true);
  const P = this.programs.space, u = P.u;
  gl.useProgram(P.p);
  gl.uniform2f(u.uRes, T.scene.w, T.scene.h);
  gl.uniform2f(u.uCenter, v.center[0], v.center[1]);
  gl.uniform2f(u.uDepthK, v.depthK[0], v.depthK[1]);
  gl.uniform3fv(u.uRight, v.right); gl.uniform3fv(u.uUp, v.up); gl.uniform3fv(u.uFwd, v.fwd);
  gl.uniform1f(u.uTanHalf, v.tanHalf);
  gl.uniform1f(u.uPixAng, (2 * v.tanHalf) / Math.min(T.scene.w, T.scene.h));
  gl.uniform1f(u.uTime, v.time);
  gl.uniform1f(u.uSunI, v.sunI); gl.uniform1f(u.uSunRadiance, v.sunRadiance);
  gl.uniform1i(u.uN, v.n); gl.uniform1i(u.uEarth, v.earth); gl.uniform1i(u.uMoon, v.moon);
  gl.uniform4fv(u.uB, v.B); gl.uniform4fv(u.uBC0, v.BC0); gl.uniform4fv(u.uBC1, v.BC1);
  gl.uniform4fv(u.uBP, v.BP); gl.uniform4fv(u.uBP2, v.BP2);
  gl.uniformMatrix3fv(u.uBRot, false, v.BRot);
  gl.uniform3fv(u.uSunPos, v.sunPos); gl.uniform1f(u.uSunR, v.sunR);
  gl.uniform1f(u.uEarthPhase, v.earthPhase); gl.uniform1f(u.uClouds, v.clouds); gl.uniform1f(u.uLightsOn, v.lightsOn);
  gl.uniform1f(u.uSkyGain, v.skyGain * (this.hasFloat ? 1 : 0.7));
  gl.uniform1f(u.uTexReady, this.spaceTex.ready ? 1 : 0);
  gl.uniformMatrix3fv(u.uSkyMat, false, v.skyMat);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.sky.tex); gl.uniform1i(u.uSky, 0);
  const tx = this.spaceTex;
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tx.earth); gl.uniform1i(u.uEarthAlb, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tx.lights); gl.uniform1i(u.uLights, 2);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tx.moonAlb); gl.uniform1i(u.uMoonAlb, 3);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, tx.moonH); gl.uniform1i(u.uMoonH, 4);
  this._draw();

  // Lines: grids, trajectories and guides, depth-tested against the bodies.
  const L = v.lines;
  if (L && L.n > 0) {
    const G = this.lineGL, LP = this.programs.line, lu = LP.u;
    gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(LP.p);
    gl.uniform3fv(lu.uRight, v.right); gl.uniform3fv(lu.uUp, v.up); gl.uniform3fv(lu.uFwd, v.fwd);
    gl.uniform1f(lu.uTanHalf, v.tanHalf); gl.uniform1f(lu.uNear, v.depthK[1]);
    gl.uniform1f(lu.uWidthScale, v.lineScale);
    gl.uniform2f(lu.uRes, T.scene.w, T.scene.h);
    gl.uniform2f(lu.uCenter, v.center[0], v.center[1]);
    gl.uniform2f(lu.uDepthK, v.depthK[0], v.depthK[1]);
    gl.bindVertexArray(G.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, G.inst);
    const bytes = L.n * 48;
    if (bytes > G.cap) { G.cap = Math.max(bytes, G.cap * 2); gl.bufferData(gl.ARRAY_BUFFER, G.cap, gl.DYNAMIC_DRAW); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, L.data, 0, L.n * 12);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, L.n);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
  gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
  this._post(v);
};
