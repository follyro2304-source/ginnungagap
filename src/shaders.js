// ============================================================================
//  Shaders (GLSL ES 3.00)
// ============================================================================
const SH = {};

SH.fullscreenVS = `#version 300 es
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Stefan Gustavson / Ashima Arts 3D simplex noise (MIT licence) plus fBm.
SH.noise = `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    s += a * snoise(p); n += a;
    p = p * 2.03 + vec3(17.1, 3.7, 9.3);
    a *= 0.5;
  }
  return s / n;
}
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
`;

// Galactic model shared by the diffuse sky pass and the star pass.
SH.galaxy = `
uniform vec3 uGx, uGy, uGz;   // galactic basis in world space
vec3 toGal(vec3 d){ return vec3(dot(d, uGx), dot(d, uGy), dot(d, uGz)); }
// Optical depth of interstellar dust along direction d (visual band).
float dustTau(vec3 d, vec3 g){
  float l = atan(g.y, g.x);
  float b = asin(clamp(g.z, -1.0, 1.0));
  float al = abs(l);
  float warp = 0.016 * sin(l * 3.0 + 0.6) + 0.010 * sin(l * 7.3 + 2.0);
  float hb = 0.018 + 0.040 * exp(-al * 1.4);
  float band = exp(-pow(abs(b - warp) / hb, 1.25));
  float f = fbm(d * 6.5 + vec3(3.1, 0.7, 5.2), 5);
  float rdg = 1.0 - abs(snoise(d * 14.0 + vec3(1.3, 4.1, 2.2)));
  rdg *= rdg;
  float clump = clamp(0.45 + 1.2 * f, 0.0, 1.8);
  float tau = band * (clump * 1.8 + rdg * 0.9) * (0.35 + exp(-al / 1.2));
  tau += 0.22 * smoothstep(0.25, 0.85, fbm(d * 3.5 + vec3(8.1, 1.1, 4.4), 4)) * exp(-abs(b) / 0.3);
  return tau;
}
`;

// ---------------------------------------------------------------------------
// Diffuse Milky Way, rendered once into each face of a cube map.
// ---------------------------------------------------------------------------
SH.skyFS = `#version 300 es
precision highp float;
uniform int uFace;
uniform float uRes;
out vec4 o;
${SH.noise}
${SH.galaxy}
vec3 faceDir(vec2 st){
  float sc = 2.0 * st.x - 1.0, tc = 2.0 * st.y - 1.0;
  if (uFace == 0) return vec3(1.0, -tc, -sc);
  if (uFace == 1) return vec3(-1.0, -tc, sc);
  if (uFace == 2) return vec3(sc, 1.0, tc);
  if (uFace == 3) return vec3(sc, -1.0, -tc);
  if (uFace == 4) return vec3(sc, -tc, 1.0);
  return vec3(-sc, -tc, -1.0);
}
float blob(vec3 g, float lDeg, float bDeg, float sig){
  float l = radians(lDeg), b = radians(bDeg);
  vec3 c = vec3(cos(b) * cos(l), cos(b) * sin(l), sin(b));
  float t = acos(clamp(dot(g, c), -1.0, 1.0));
  return exp(-t * t / (2.0 * sig * sig));
}
void main(){
  vec3 d = normalize(faceDir(gl_FragCoord.xy / uRes));
  vec3 g = toGal(d);
  float l = atan(g.y, g.x), b = asin(clamp(g.z, -1.0, 1.0)), al = abs(l);
  // Unresolved starlight of the thin disk and the boxy bulge.
  float hb = 0.06 + 0.10 * exp(-al * 1.3);
  float disk = exp(-abs(b) / hb) * (0.14 + 0.86 * exp(-al / 0.95));
  float bul = exp(-pow(pow(al / 0.17, 2.0) + pow(abs(b) / 0.12, 2.0), 0.8));
  float n1 = fbm(d * 4.5 + vec3(2.0, 5.0, 1.0), 5);
  float n2 = fbm(d * 19.0 + vec3(7.0, 1.0, 3.0), 3);
  float clouds = disk * (0.40 + 0.80 * max(n1 + 0.3, 0.0)) * (0.72 + 0.5 * n2);
  vec3 star = vec3(1.0, 0.94, 0.86) * clouds * 0.42 + vec3(1.0, 0.84, 0.62) * bul * 0.95;
  // Dust: wavelength-dependent extinction (A_R : A_V : A_B ~ 0.72 : 1 : 1.38).
  float tau = dustTau(d, g);
  vec3 col = star * exp(-tau * vec3(0.72, 1.0, 1.38));
  float lum = dot(star, vec3(0.30, 0.55, 0.15));
  col += vec3(0.60, 0.34, 0.17) * lum * (1.0 - exp(-tau)) * exp(-0.7 * tau) * 0.55;
  // H II regions.
  float neb = smoothstep(0.32, 0.78, fbm(d * 15.0 + vec3(4.2, 9.1, 0.3), 4)) * exp(-abs(b) / 0.05) * exp(-al / 1.3);
  col += vec3(1.0, 0.30, 0.40) * neb * 0.16 * exp(-0.5 * tau);
  // Magellanic Clouds and Andromeda at their galactic coordinates.
  float tex = 0.65 + 0.5 * fbm(d * 40.0, 3);
  col += vec3(0.80, 0.84, 1.0) * (blob(g, 280.5, -32.9, 0.055) * 0.16 + blob(g, 302.8, -44.3, 0.03) * 0.10) * tex;
  col += vec3(1.0, 0.90, 0.78) * blob(g, 121.2, -21.6, 0.012) * 0.10;
  // Grain of barely resolved stars.
  float gr = hash13(floor(d * uRes * 0.9) + float(uFace) * 7.0);
  col *= 0.88 + 0.24 * gr;
  col += vec3(0.0009, 0.0012, 0.0021);
  o = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------
// Point stars, drawn additively into each cube face with an analytic PSF.
// ---------------------------------------------------------------------------
SH.starVS = `#version 300 es
precision highp float;
in vec3 aDir;
in vec4 aCol;     // rgb chromaticity (unit luminance), a = flux
in float aDepth;  // fraction of the dust column in front of the star
uniform int uFace;
uniform float uRes, uSigma;
out vec3 vCol; out vec2 vCenter; out float vSig;
${SH.noise}
${SH.galaxy}
void main(){
  vec3 d = aDir; vec3 f;
  if (uFace == 0) f = vec3(-d.z, -d.y, d.x);
  else if (uFace == 1) f = vec3(d.z, -d.y, -d.x);
  else if (uFace == 2) f = vec3(d.x, d.z, d.y);
  else if (uFace == 3) f = vec3(d.x, -d.z, -d.y);
  else if (uFace == 4) f = vec3(d.x, -d.y, d.z);
  else f = vec3(-d.x, -d.y, -d.z);
  vCol = vec3(0.0); vCenter = vec2(0.0); vSig = 1.0;
  if (f.z <= 1e-4 || abs(f.x) > f.z * 1.02 || abs(f.y) > f.z * 1.02){
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; return;
  }
  vec2 ndc = f.xy / f.z;
  gl_Position = vec4(ndc, 0.0, 1.0);
  vCenter = (ndc * 0.5 + 0.5) * uRes;
  float flux = aCol.a;
  float sig = uSigma * (1.0 + 0.8 * sqrt(clamp(flux / 25.0, 0.0, 1.0)));
  vSig = sig;
  gl_PointSize = ceil(sig * 7.0) + 2.0;
  float tau = dustTau(d, toGal(d)) * aDepth;
  vCol = aCol.rgb * flux * exp(-tau * vec3(0.72, 1.0, 1.38));
}`;

SH.starFS = `#version 300 es
precision highp float;
in vec3 vCol; in vec2 vCenter; in float vSig;
out vec4 o;
void main(){
  vec2 p = gl_FragCoord.xy - vCenter;
  float s2 = vSig * vSig;
  float psf = exp(-dot(p, p) / (2.0 * s2)) / (6.2831853 * s2);
  o = vec4(vCol * psf, 1.0);
}`;

// ---------------------------------------------------------------------------
// The black hole. Units: r_s = 2GM/c^2 = 1, time in r_s/c.
//
// Photon orbits in Schwarzschild spacetime obey the Binet equation
//     d^2u/dphi^2 + u = (3/2) r_s u^2,   u = 1/r.
// Written in pseudo-Cartesian coordinates this is exactly the central force
//     d^2x/dl^2 = -(3/2) r_s h^2 x / r^5,  h = |x cross dx/dl| (conserved),
// which we integrate per pixel (RK4 or velocity Verlet, step ~ r).
// ---------------------------------------------------------------------------
SH.bhFS = (defs) => `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
${defs}
uniform vec2 uRes, uCenter;
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd;
uniform float uTanHalf, uTime, uStepK, uREsc;
uniform float uDiskIn, uDiskOut, uTNorm, uDiskGain, uBeamPow, uOpacity, uGridMax;
uniform float uLensing, uDoppler, uGrav, uDiskOn, uSkyOn, uPhGrid, uEqGrid;
uniform float uSkyGain, uCubeRes;
uniform samplerCube uSky;
uniform sampler2D uBB;
uniform int uBBN;
uniform vec2 uBBRange;         // log10 T range of the blackbody table
uniform sampler2D uText;
uniform float uTextOn, uTextDist;
uniform vec4 uTextRect;
uniform vec3 uTextColor;
out vec4 frag;
${SH.noise}

// Blackbody radiance seen through CIE 1931 -> linear sRGB, tabulated on the CPU.
vec3 blackbody(float T){
  float x = (log2(max(T, 1.0)) * 0.30103 - uBBRange.x) / (uBBRange.y - uBBRange.x);
  x = clamp(x, 0.0, 1.0) * float(uBBN - 1);
  int i = int(floor(x)); float f = x - float(i);
  vec4 a = texelFetch(uBB, ivec2(i, 0), 0);
  vec4 c = texelFetch(uBB, ivec2(min(i + 1, uBBN - 1), 0), 0);
  vec4 m = mix(a, c, f);
  return m.rgb * exp2(min(m.a, 30.0) * 3.3219281);
}

// Page-Thorne (1974) radiated flux of a thin disk around a Schwarzschild hole,
// in units where M = 1: F(x) ~ Q(x)/x^3 with x = r/M = 2 r/r_s. Zero at the ISCO.
float ptShape(float r){
  float x = 2.0 * r;
  if (x <= 6.0001) return 0.0;
  float sx = sqrt(x);
  const float s3 = 1.7320508, s6 = 2.4494897;
  float I = sx - s6 + 0.8660254 * log(((sx + s3) * (s6 - s3)) / ((sx - s3) * (s6 + s3)));
  return (sx * I / (x - 3.0)) / (x * x * x);
}

float diskLayer(float lr, float a, float seed){
  vec3 p = vec3(cos(a) * 2.1, sin(a) * 2.1, lr * 8.5) + vec3(seed * 5.3, seed * 2.9, seed * 1.7);
  float n = fbm(p, DISK_OCT);
  float s = snoise(vec3(cos(a) * 0.8, sin(a) * 0.8, lr * 42.0) + vec3(seed * 1.9, 3.0, 0.0));
  return n * 0.9 + s * 0.28;
}
// Keplerian shear with a two-layer flow-map cross-fade so structure winds up
// into trailing spirals but never shears into noise.
float diskNoise(float rc, float phi){
  float lr = log(rc);
  float om = 0.70710678 * pow(rc, -1.5);   // coordinate angular velocity sqrt(GM/r^3)
  const float P = 44.0;
  float tp = uTime / P;
  float f1 = fract(tp), f2 = fract(tp + 0.5);
  float c1 = floor(tp), c2 = floor(tp + 0.5);
  float w1 = 1.0 - abs(2.0 * f1 - 1.0), w2 = 1.0 - w1;
  float n1 = diskLayer(lr, phi - om * (f1 - 0.5) * P, mod(c1 * 2.0, 64.0));
  float n2 = diskLayer(lr, phi - om * (f2 - 0.5) * P, mod(c2 * 2.0 + 1.0, 64.0));
  return (n1 * w1 + n2 * w2) * inversesqrt(w1 * w1 + w2 * w2);
}

// Emission from the disk plane crossing at hp (radius rc).
// lam = L_z/E of the photon; gObs = blueshift into the static observer's frame.
vec4 diskSample(vec3 hp, float rc, float cosI, float lam, float gObs){
  float phi = atan(-hp.z, hp.x);
  float n = diskNoise(rc, phi);
  float env = smoothstep(uDiskIn, uDiskIn + 0.3, rc) * (1.0 - smoothstep(uDiskOut * 0.62, uDiskOut, rc));
  float dens = clamp(0.62 + 0.58 * n, 0.0, 1.6) * env;
  float a = 1.0 - exp(-uOpacity * dens / max(cosI, 0.03));
  float Tem = uTNorm * pow(ptShape(rc), 0.25) * (0.93 + 0.12 * n);
  // Redshift of a circular geodesic emitter: g = sqrt(1 - 3M/r) / (1 - Omega * lambda).
  float om = 0.70710678 * pow(rc, -1.5);
  float gFull = sqrt(max(1.0 - 1.5 / rc, 1e-5)) / max(1.0 - om * lam, 1e-3);
  float gG = sqrt(1.0 - 1.0 / rc);            // static emitter -> infinity
  float g = 1.0;
  if (uGrav > 0.5) g *= gG * gObs;
  if (uDoppler > 0.5) g *= pow(gFull / gG, uBeamPow);
  // I_nu / nu^3 is invariant, so a blackbody at T is seen as a blackbody at gT.
  vec3 I = blackbody(Tem * g) * uDiskGain;
  return vec4(I * a, a);
}

vec3 eqGrid(vec3 hp, float rc){
  float phi = atan(hp.z, hp.x);
  float w = 0.032 * sqrt(rc);
  float ring = 1.0 - smoothstep(w * 0.35, w, abs(fract(rc + 0.5) - 0.5));
  const float S = 0.5235988;
  float sp = abs(fract(phi / S + 0.5) - 0.5) * S * rc;
  float spoke = 1.0 - smoothstep(w * 0.35, w, sp);
  float fade = 1.0 - smoothstep(uGridMax * 0.7, uGridMax, rc);
  vec3 c = vec3(0.50, 0.64, 1.0) * max(ring, spoke) * 0.30 * fade;
  c += vec3(1.0, 0.62, 0.30) * (1.0 - smoothstep(0.012, 0.04, abs(rc - 3.0))) * 0.9;
  c += vec3(0.62, 0.80, 1.0) * (1.0 - smoothstep(0.010, 0.03, abs(rc - 1.5))) * 0.9;
  return c;
}

vec3 photonGrid(vec3 hp){
  float r = length(hp);
  float th = acos(clamp(hp.y / r, -1.0, 1.0));
  float ph = atan(hp.z, hp.x);
  const float S = 0.2617994;   // 15 degrees
  float dth = abs(fract(th / S + 0.5) - 0.5) * S;
  float dph = abs(fract(ph / S + 0.5) - 0.5) * S * sin(th);
  float line = max(1.0 - smoothstep(0.012, 0.04, dth), 1.0 - smoothstep(0.012, 0.04, dph));
  return vec3(0.42, 0.66, 1.0) * (0.035 + 0.42 * line);
}

vec3 accel(vec3 p, float k){
  float r2 = dot(p, p);
  return -k * p / (r2 * r2 * sqrt(r2));
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y) - uCenter;
  vec3 dl = normalize(uCamFwd + (uv.x * uCamRight + uv.y * uCamUp) * (2.0 * uTanHalf));
  vec3 P = uCamPos;
  float D = length(P);
  vec3 rh = P / D;
  float cr = dot(dl, rh);
  vec3 perp = dl - cr * rh;
  float sa = length(perp);
  vec3 v = dl;
  float b = D * sa;
  if (uLensing > 0.5){
    // Exact static observer: sin(alpha) = b sqrt(1 - r_s/r) / r. Map the local
    // direction to the pseudo-Cartesian one with the same impact parameter.
    b = D * sa / sqrt(1.0 - 1.0 / D);
    float hh = b / sqrt(1.0 + b * b / (D * D * D));
    float s2 = min(hh / D, 1.0);
    float c2 = sqrt(max(1.0 - s2 * s2, 0.0)) * (cr < 0.0 ? -1.0 : 1.0);
    if (sa > 1e-7) v = perp / sa * s2 + rh * c2;
  }
  vec3 hv = cross(P, v);
  float h2 = dot(hv, hv);
  // Physical photon travels towards the camera, i.e. opposite to the traced ray.
  float lam = h2 > 1e-14 ? -b * hv.y * inversesqrt(h2) : 0.0;
  float kc = uLensing > 0.5 ? 1.5 * h2 : 0.0;
  float gObs = uGrav > 0.5 ? inversesqrt(1.0 - 1.0 / D) : 1.0;

  vec3 pos = P, vel = v;
  vec3 col = vec3(0.0);
  float T = 1.0;
  int state = 0;       // 0 running, 1 captured, 2 escaped, 3 absorbed by the disk
  float r = D;
#if INTEGRATOR == 0
  vec3 acc = accel(pos, kc);
#endif
  for (int i = 0; i < MAX_STEPS; i++){
    if (!(r > 1.0)) { state = 1; break; }
    if (r > uREsc && dot(pos, vel) > 0.0) { state = 2; break; }
    float dt = uStepK * r;
    vec3 p0 = pos; float r0 = r;
#if INTEGRATOR == 1
    vec3 k1v = accel(pos, kc),               k1p = vel;
    vec3 k2v = accel(pos + 0.5*dt*k1p, kc),  k2p = vel + 0.5*dt*k1v;
    vec3 k3v = accel(pos + 0.5*dt*k2p, kc),  k3p = vel + 0.5*dt*k2v;
    vec3 k4v = accel(pos + dt*k3p, kc),      k4p = vel + dt*k3v;
    pos += dt / 6.0 * (k1p + 2.0*k2p + 2.0*k3p + k4p);
    vel += dt / 6.0 * (k1v + 2.0*k2v + 2.0*k3v + k4v);
#else
    pos += vel * dt + 0.5 * acc * dt * dt;
    vec3 a1 = accel(pos, kc);
    vel += 0.5 * (acc + a1) * dt;
    acc = a1;
#endif
    r = length(pos);
    if (p0.y * pos.y < 0.0){
      float s = p0.y / (p0.y - pos.y);
      vec3 hp = mix(p0, pos, s);
      float rc = length(hp);
      if (uEqGrid > 0.5 && rc > 1.0 && rc < uGridMax) col += T * eqGrid(hp, rc);
      if (uDiskOn > 0.5 && rc > uDiskIn && rc < uDiskOut){
        vec3 vd = normalize(vel);
        vec4 e = diskSample(hp, rc, abs(vd.y), lam, gObs);
        col += T * e.rgb;
        T *= 1.0 - e.a;
        if (T < 0.004) { state = 3; break; }
      }
    }
    if (uPhGrid > 0.5 && (r0 - 1.5) * (r - 1.5) < 0.0){
      vec3 hp = mix(p0, pos, (r0 - 1.5) / (r0 - r));
      col += T * photonGrid(hp);
    }
  }

  vec3 dir = normalize(vel);
  float esc = (state == 2 || (state == 0 && r > 2.5)) ? 1.0 : 0.0;
  vec3 dx = dFdx(dir), dy = dFdy(dir);
  float edge = abs(dFdx(esc)) + abs(dFdy(esc));
  float gmax = max(length(dx), length(dy));
  float lim = edge > 0.0 ? 0.0 : 1.0;
  float sc = min(1.0, 0.06 / max(gmax, 1e-6));   // cap the footprint on caustics
  vec3 bg = textureGrad(uSky, dir, dx * sc * lim, dy * sc * lim).rgb * uSkyGain * uSkyOn;
  if (uTextOn > 0.5){
    float den = dot(dir, uCamFwd);
    float s = (uTextDist - dot(pos - uCamPos, uCamFwd)) / max(den, 1e-3);
    vec3 X = pos + dir * s - uCamPos;
    vec2 q = vec2(dot(X, uCamRight), dot(X, uCamUp)) / (uTextDist * 2.0 * uTanHalf);
    vec2 tuv = (q - uTextRect.xy) / uTextRect.zw;
    vec2 tdx = dFdx(tuv) * lim, tdy = dFdy(tuv) * lim;
    float inb = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0) * step(0.05, den);
    float ta = textureGrad(uText, clamp(tuv, 0.0, 1.0), tdx, tdy).a * inb;
    bg = bg * (1.0 - 0.7 * ta) + uTextColor * ta;
  }
  col += T * esc * bg;
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  frag = vec4(min(col, vec3(6.0e4)), 1.0);
}`;

// ---------------------------------------------------------------------------
// Bloom (13-tap downsample with soft threshold, 9-tap tent upsample)
// ---------------------------------------------------------------------------
SH.downFS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel, uDstRes;
uniform float uPrefilter, uThreshold, uKnee;
out vec4 o;
vec3 t(vec2 uv){ return texture(uSrc, uv).rgb; }
void main(){
  vec2 uv = gl_FragCoord.xy / uDstRes;
  vec2 k = uTexel;
  vec3 a = t(uv + k*vec2(-2, 2)), b = t(uv + k*vec2(0, 2)), c = t(uv + k*vec2(2, 2));
  vec3 d = t(uv + k*vec2(-2, 0)), e = t(uv),                f = t(uv + k*vec2(2, 0));
  vec3 g = t(uv + k*vec2(-2,-2)), h = t(uv + k*vec2(0,-2)), i = t(uv + k*vec2(2,-2));
  vec3 j = t(uv + k*vec2(-1, 1)), l = t(uv + k*vec2(1, 1));
  vec3 m = t(uv + k*vec2(-1,-1)), n = t(uv + k*vec2(1,-1));
  vec3 s = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+l+m+n)*0.125;
  if (uPrefilter > 0.5){
    s = min(s, vec3(200.0));
    float br = max(s.r, max(s.g, s.b));
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-5);
    s *= max(soft, br - uThreshold) / max(br, 1e-5);
  }
  o = vec4(s, 1.0);
}`;

SH.upFS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel, uDstRes;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uDstRes;
  vec2 k = uTexel;
  vec3 s = texture(uSrc, uv + vec2(-k.x, k.y)).rgb + 2.0*texture(uSrc, uv + vec2(0.0, k.y)).rgb + texture(uSrc, uv + k).rgb
         + 2.0*texture(uSrc, uv + vec2(-k.x, 0.0)).rgb + 4.0*texture(uSrc, uv).rgb + 2.0*texture(uSrc, uv + vec2(k.x, 0.0)).rgb
         + texture(uSrc, uv - k).rgb + 2.0*texture(uSrc, uv + vec2(0.0, -k.y)).rgb + texture(uSrc, uv + vec2(k.x, -k.y)).rgb;
  o = vec4(s / 16.0, 1.0);
}`;

SH.compositeFS = `#version 300 es
precision highp float;
uniform sampler2D uScene, uBloom;
uniform vec2 uOutRes;
uniform float uBloomStr, uExposure, uTonemap, uSeed, uBloomOn;
out vec4 o;
const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 rrtOdt(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){ return clamp(ACESOut * rrtOdt(ACESIn * c), 0.0, 1.0); }
vec3 reinhard(vec3 c){ float L = dot(c, vec3(0.2126, 0.7152, 0.0722)); return c / (1.0 + L); }
vec3 srgb(vec3 c){ return mix(12.92 * c, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 uv = gl_FragCoord.xy / uOutRes;
  vec3 c = texture(uScene, uv).rgb;
  if (uBloomOn > 0.5) c += texture(uBloom, uv).rgb * uBloomStr;
  c *= uExposure;
  c = uTonemap > 0.5 ? aces(c) : clamp(reinhard(c), 0.0, 1.0);
  c = srgb(c);
  c += (hash12(gl_FragCoord.xy + uSeed) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;
