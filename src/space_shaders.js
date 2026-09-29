// ============================================================================
//  Spacetime page shaders
//  Positions are camera-relative, in kilometres. Depth is logarithmic so that
//  a 100 m spacecraft and a planet 5 AU away share one depth buffer.
// ============================================================================
const MAXB = 20;
SH.spaceFS = (defs) => `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
${defs}
#define MAXB ${MAXB}
uniform vec2 uRes, uCenter, uDepthK;
uniform vec3 uRight, uUp, uFwd;
uniform float uTanHalf, uPixAng, uTime, uSunI, uSunRadiance;
uniform int uN, uEarth, uMoon;
uniform vec4 uB[MAXB];      // xyz centre, w radius
uniform vec4 uBC0[MAXB];    // rgb colour, a = style
uniform vec4 uBC1[MAXB];    // rgb colour, a = seed
uniform vec4 uBP[MAXB];     // x ring inner (R), y ring outer (R), z point flux, w flags (1 caps, 2 bands scale*)
uniform vec4 uBP2[MAXB];    // x band strength
uniform mat3 uBRot[MAXB];   // world -> body frame
uniform vec3 uSunPos;
uniform float uSunR, uEarthPhase, uClouds, uLightsOn, uSkyGain, uTexReady;
uniform sampler2D uEarthAlb, uLights, uMoonAlb, uMoonH;
uniform samplerCube uSky;
uniform mat3 uSkyMat;
out vec4 o;
${SH.noise}

vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }

float sphereHit(vec3 c, float R, vec3 d){
  float tc = dot(c, d);
  vec3 pc = c - tc * d;
  float h2 = dot(pc, pc), R2 = R * R;
  if (h2 > R2 || tc <= 0.0) return -1.0;
  float t = tc - sqrt(R2 - h2);
  return t > 0.0 ? t : -1.0;
}

// Fraction of the solar disc hidden from point p by other bodies (disc-overlap approximation).
float sunBlock(vec3 p, int self, out float byEarth){
  vec3 toS = uSunPos - p; float ds = length(toS); vec3 sd = toS / ds;
  float as = uSunR / ds;
  float vis = 1.0; byEarth = 0.0;
  for (int j = 0; j < MAXB; j++){
    if (j >= uN) break;
    if (j == self || uBC0[j].a < 0.5 || uBC0[j].a > 7.5) continue;
    vec3 tb = uB[j].xyz - p; float db = length(tb);
    if (db >= ds || dot(tb, sd) <= 0.0) continue;
    float ao = uB[j].w / db;
    float th = 2.0 * asin(clamp(0.5 * length(tb / db - sd), 0.0, 1.0));
    float occ = 0.0;
    float full = min(1.0, (ao * ao) / (as * as));
    if (th < abs(as - ao)) occ = full;
    else if (th < as + ao) occ = full * smoothstep(0.0, 1.0, (as + ao - th) / (2.0 * min(as, ao)));
    vis *= 1.0 - occ;
    if (j == uEarth) byEarth = occ;
  }
  return vis;
}

float cloudField(vec3 q){
  float t = uTime / 86400.0;
  float lat = asin(clamp(q.z, -1.0, 1.0)) * 57.29578;
  float a = t * 0.08;
  q = vec3(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a), q.z);
  vec3 w = vec3(fbm(q * 1.7 + vec3(0.0, 0.0, t * 0.03), 3), fbm(q * 1.7 + vec3(5.2, 1.3, t * 0.03), 3), 0.0);
  float n = fbm(q * 3.2 + w * 1.4 + vec3(0.0, t * 0.05, 0.0), CLOUD_OCT) * 0.5 + 0.5;
  float cover = 0.34 + 0.2 * exp(-(lat - 5.0) * (lat - 5.0) / 70.0) - 0.20 * exp(-(abs(lat) - 23.0) * (abs(lat) - 23.0) / 60.0)
              + 0.22 * exp(-(abs(lat) - 55.0) * (abs(lat) - 55.0) / 160.0);
  return smoothstep(1.0 - cover - 0.02, 1.0 - cover + 0.3, n) * 0.92;
}

vec3 shadeEarth(int i, vec3 p, vec3 n, vec3 d, float t){
  float sI = uSunI * uBP2[i].y;
  vec3 nb = uBRot[i] * n;
  float lon = atan(nb.y, nb.x), lat = asin(clamp(nb.z, -1.0, 1.0));
  vec2 uv = vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.14159265);
  float mu = max(dot(n, -d), 0.0);
  float foot = t * uPixAng / max(mu, 0.2);
  float texel = 6.2831853 * uB[i].w / 2048.0;
  vec3 alb = vec3(0.02, 0.05, 0.12); float lights = 0.0;
  if (uTexReady > 0.5){
    vec3 s = textureLod(uEarthAlb, uv, max(0.0, log2(foot / texel))).rgb;
    alb = toLin(s);
    lights = textureLod(uLights, uv, max(0.0, log2(foot / (texel * 0.5)))).r;
  }
  float ocean = smoothstep(0.004, 0.02, alb.b - alb.r) * (1.0 - smoothstep(0.06, 0.15, alb.g));
  vec3 L = normalize(uSunPos - p);
  float mu0 = dot(n, L);
  float eocc; float vis = sunBlock(p, i, eocc);
  float cl = uClouds > 0.5 ? cloudField(nb) : 0.0;
  vec3 tint = mix(vec3(1.0, 0.55, 0.3), vec3(1.0), smoothstep(-0.02, 0.14, mu0));
  vec3 E = sI * tint * max(mu0, 0.0) * vis;
  vec3 col = alb * E;
  vec3 H = normalize(L - d);
  float nh = max(dot(n, H), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(H, -d), 0.0), 5.0);
  col += ocean * (pow(nh, 220.0) * 6.0 + pow(nh, 30.0) * 0.2) * F * sI * vis * step(0.0, mu0) * (1.0 - cl);
  col = mix(col, vec3(0.82, 0.84, 0.86) * E, cl);
  // Thin-shell Rayleigh scattering: bluish haze growing towards the limb, reddened at the terminator.
  float air = 1.0 / max(mu, 0.06);
  vec3 sky = vec3(0.16, 0.34, 0.85) * (1.0 - exp(-0.07 * air)) * sI * smoothstep(-0.18, 0.35, mu0) * vis;
  sky *= mix(vec3(1.0, 0.55, 0.35), vec3(1.0), smoothstep(-0.05, 0.3, mu0));
  col = col * exp(-0.012 * air) + sky * 0.45;
  // City lights where the Sun has set (dimmed under clouds).
  float night = 1.0 - smoothstep(-0.1, 0.08, mu0);
  col += vec3(1.0, 0.70, 0.40) * pow(lights, 1.3) * 1.1 * night * (1.0 - 0.8 * cl) * uLightsOn;
  return col;
}

vec3 shadeMoon(int i, vec3 p, vec3 n, vec3 d, float t){
  float sI = uSunI * uBP2[i].y;
  mat3 M = uBRot[i];
  vec3 nb = M * n;
  float lon = atan(nb.y, nb.x), lat = asin(clamp(nb.z, -1.0, 1.0));
  vec2 uv = vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.14159265);
  float R = uB[i].w;
  float mu = max(dot(n, -d), 0.0);
  float foot = t * uPixAng / max(mu, 0.2);
  float texel = 6.2831853 * R / 2048.0;
  float lod = max(0.0, log2(foot / texel));
  float alb = 0.12; vec3 np = n;
  if (uTexReady > 0.5){
    alb = pow(textureLod(uMoonAlb, uv, lod).r, 2.2) * 0.32;
    float e = exp2(lod) / 2048.0;
    float h0 = textureLod(uMoonH, uv, lod).r;
    float hx = textureLod(uMoonH, uv + vec2(e, 0.0), lod).r;
    float hy = textureLod(uMoonH, uv - vec2(0.0, e * 2.0), lod).r;
    float sx = (hx - h0) * 12.0 / (e * 6.2831853 * R * max(cos(lat), 0.08));
    float sy = (hy - h0) * 12.0 / (e * 2.0 * 3.14159265 * R);
    vec3 east = vec3(-sin(lon), cos(lon), 0.0);
    vec3 north = vec3(-sin(lat) * cos(lon), -sin(lat) * sin(lon), cos(lat));
    vec3 nbp = normalize(nb - 1.4 * (sx * east + sy * north));
    np = transpose(M) * nbp;
  }
  vec3 L = normalize(uSunPos - p);
  float mu0 = dot(np, L), mug = dot(n, L);
  float eocc; float vis = sunBlock(p, i, eocc);
  float mv = max(dot(np, -d), 0.02);
  // Lommel-Seeliger law with an opposition surge: why the full Moon looks flat, not ball-shaped.
  float g = acos(clamp(dot(L, -d), -1.0, 1.0));
  float surge = 1.0 + 0.35 * exp(-g / 0.1);
  float ls = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mv) : 0.0;
  ls *= smoothstep(-0.03, 0.03, mug);
  vec3 col = alb * vec3(1.0, 0.975, 0.94) * ls * sI * vis * surge * 1.45;
  // Earthshine: sunlight reflected by Earth onto the Moon's night side.
  if (uEarth >= 0){
    vec3 toE = normalize(uB[uEarth].xyz - p);
    col += alb * vec3(0.75, 0.85, 1.0) * uEarthPhase * 4e-4 * sI * max(dot(np, toE), 0.0);
  }
  // Inside Earth's umbra the Moon is lit only by sunlight refracted through Earth's atmosphere.
  col += alb * vec3(1.0, 0.30, 0.10) * eocc * 0.018 * sI * max(mug, 0.0);
  return col;
}

vec3 shadeGeneric(int i, vec3 p, vec3 n, vec3 d){
  float sI = uSunI * uBP2[i].y;
  vec3 nb = uBRot[i] * n;
  float style = uBC0[i].a, seed = uBC1[i].a;
  float lat = asin(clamp(nb.z, -1.0, 1.0));
  vec3 c0 = uBC0[i].rgb, c1 = uBC1[i].rgb;
  vec3 alb;
  vec3 q = nb + vec3(seed, seed * 0.37, seed * 0.71);
  if (style < 3.5) {                                   // rocky
    float f = fbm(q * 2.4, 5) * 0.5 + 0.5;
    float cr = pow(abs(snoise(q * 9.0)), 0.6);
    alb = mix(c1, c0, smoothstep(0.3, 0.75, f)) * (0.85 + 0.25 * cr);
    if (uBP[i].w > 0.5) alb = mix(alb, vec3(0.92), smoothstep(1.2, 1.32, abs(lat) + 0.06 * snoise(q * 6.0)));
  } else if (style < 4.5) {                            // banded giant
    float w = fbm(q * vec3(3.0, 3.0, 1.0), 4) * 0.25;
    float b = sin((lat + w * 0.35) * 18.0) * 0.5 + 0.5;
    b = mix(0.5, b, uBP2[i].x);
    alb = mix(c0, c1, b) * (0.92 + 0.12 * fbm(q * vec3(8.0, 8.0, 30.0), 3));
  } else if (style < 5.5) {                            // hazy
    alb = mix(c1, c0, 0.55 + 0.25 * fbm(q * vec3(1.5, 1.5, 4.0), 3));
  } else if (style < 6.5) {                            // icy with lineae
    float l = 1.0 - abs(snoise(q * 5.0)); l = pow(l, 14.0);
    alb = mix(c0, c1, l * 0.8 + 0.15 * (fbm(q * 3.0, 3) * 0.5 + 0.5));
  } else {                                             // volcanic (Io)
    float f = fbm(q * 3.0, 4) * 0.5 + 0.5;
    float spots = smoothstep(0.72, 0.82, abs(snoise(q * 11.0)));
    alb = mix(c0, c1, smoothstep(0.35, 0.8, f)) * (1.0 - 0.6 * spots);
  }
  vec3 L = normalize(uSunPos - p);
  float mu0 = dot(n, L), mv = max(dot(n, -d), 0.0);
  float eocc; float vis = sunBlock(p, i, eocc);
  float lit = style > 3.5 && style < 5.5 ? max(mu0, 0.0) * (0.7 + 0.3 * mv) : max(mu0, 0.0);
  return alb * lit * sI * vis;
}

vec3 shadeSun(vec3 n, vec3 d){
  float mu = max(dot(n, -d), 0.0);
  float ld = 1.0 - 0.6 * (1.0 - mu) - 0.2 * (1.0 - mu) * (1.0 - mu);  // limb darkening
  return vec3(1.0, 0.95, 0.88) * uSunRadiance * ld;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y) - uCenter;
  vec3 d = normalize(uFwd + (uv.x * uRight + uv.y * uUp) * (2.0 * uTanHalf));
  float tHit = 1e30; int hit = -1;
  for (int i = 0; i < MAXB; i++){
    if (i >= uN) break;
    if (uBC0[i].a > 7.5) continue;                    // spacecraft are drawn as points
    float t = sphereHit(uB[i].xyz, uB[i].w, d);
    if (t > 0.0 && t < tHit){ tHit = t; hit = i; }
  }
  vec3 col;
  float depth = 1.0;
  if (hit >= 0){
    vec3 p = d * tHit;
    vec3 n = normalize(p - uB[hit].xyz);
    float st = uBC0[hit].a;
    if (st < 0.5) col = shadeSun(n, d);
    else if (st < 1.5) col = shadeEarth(hit, p, n, d, tHit);
    else if (st < 2.5) col = shadeMoon(hit, p, n, d, tHit);
    else col = shadeGeneric(hit, p, n, d);
    depth = log2(max(tHit * dot(d, uFwd) / uDepthK.y, 1.0)) * uDepthK.x;
  } else {
    col = texture(uSky, uSkyMat * d).rgb * uSkyGain;
  }
  // Rings (Saturn): composited over whatever lies behind them.
  for (int i = 0; i < MAXB; i++){
    if (i >= uN) break;
    if (uBP[i].y <= 0.0) continue;
    mat3 M = uBRot[i];
    vec3 N = vec3(M[0][2], M[1][2], M[2][2]);
    float dn = dot(d, N);
    if (abs(dn) < 1e-6) continue;
    float t = dot(uB[i].xyz, N) / dn;
    if (t <= 0.0 || t > tHit) continue;
    vec3 rp = d * t - uB[i].xyz;
    float r = length(rp) / uB[i].w;
    if (r < uBP[i].x || r > uBP[i].y) continue;
    float x = (r - uBP[i].x) / (uBP[i].y - uBP[i].x);
    float dens = 0.35 + 0.55 * smoothstep(0.2, 0.35, x) * (1.0 - smoothstep(0.62, 0.66, x)) + 0.3 * (1.0 - smoothstep(0.72, 0.745, x)) * step(0.745, 1.0);
    dens *= 1.0 - 0.85 * (smoothstep(0.66, 0.675, x) - smoothstep(0.70, 0.715, x));   // Cassini division
    dens *= 0.85 + 0.3 * sin(r * 180.0) * sin(r * 71.0);
    float a = clamp(dens, 0.0, 1.0) * 0.85;
    vec3 L = normalize(uSunPos - d * t);
    float shadow = sphereHit(uB[i].xyz - d * t, uB[i].w, L) > 0.0 ? 0.08 : 1.0;
    vec3 rc = mix(uBC0[i].rgb, vec3(0.8, 0.72, 0.6), 0.4) * uSunI * uBP2[i].y * 0.55 * shadow * (0.4 + 0.6 * abs(dot(L, N)));
    col = mix(col, rc, a);
  }
  // Point-like bodies: planets too small to resolve and spacecraft.
  float sig = uPixAng * 0.85;
  for (int i = 0; i < MAXB; i++){
    if (i >= uN) break;
    float f = uBP[i].z;
    if (f <= 0.0) continue;
    vec3 c = uB[i].xyz; float dist = length(c);
    if (dist > tHit) continue;
    float ang = 2.0 * asin(clamp(0.5 * length(d - c / dist), 0.0, 1.0));
    col += uBC1[i].rgb * f * exp(-ang * ang / (2.0 * sig * sig));
  }
  // Earth's atmosphere seen edge-on against space.
  if (uEarth >= 0){
    vec3 c = uB[uEarth].xyz; float R = uB[uEarth].w;
    float tc = dot(c, d);
    if (tc > 0.0 && (hit != uEarth)){
      float h = length(c - tc * d) - R;
      if (h > 0.0 && h < 120.0 && tHit > tc){
        vec3 tp = normalize(tc * d - c);
        float sunlit = smoothstep(-0.25, 0.2, dot(tp, normalize(uSunPos - c)));
        col += vec3(0.25, 0.5, 1.0) * exp(-h / 22.0) * 0.5 * sunlit * uSunI;
      }
    }
  }
  gl_FragDepth = depth;
  o = vec4(col, 1.0);
}`;

SH.lineVS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aA;
layout(location = 2) in vec4 aB;
layout(location = 3) in vec4 aCol;
uniform vec3 uRight, uUp, uFwd;
uniform float uTanHalf, uNear, uWidthScale;
uniform vec2 uRes, uCenter;
out float vSide; out float vHalfW; out float vAlpha; out vec3 vCol; out float vDepth;
vec3 toView(vec3 p){ return vec3(dot(p, uRight), dot(p, uUp), dot(p, uFwd)); }
void main(){
  vec3 a = toView(aA.xyz), b = toView(aB.xyz);
  float aa = aA.w, ba = aB.w;
  vSide = 0.0; vHalfW = 0.0; vAlpha = 0.0; vCol = vec3(0.0); vDepth = 1.0;
  if (a.z < uNear && b.z < uNear){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (a.z < uNear){ float k = (uNear - a.z) / (b.z - a.z); a = mix(a, b, k); aa = mix(aa, ba, k); }
  if (b.z < uNear){ float k = (uNear - b.z) / (a.z - b.z); b = mix(b, a, k); ba = mix(ba, aa, k); }
  float md = min(uRes.x, uRes.y);
  vec2 sa = (a.xy / a.z / (2.0 * uTanHalf) + uCenter) * md;
  vec2 sb = (b.xy / b.z / (2.0 * uTanHalf) + uCenter) * md;
  vec2 dir = sb - sa; float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = aCol.w * uWidthScale;
  float hw = w * 0.5 + 1.0;
  bool end = aCorner.x > 0.5;
  vec2 s = (end ? sb : sa) + nrm * aCorner.y * hw + dir * (end ? 0.5 : -0.5);
  float z = end ? b.z : a.z;
  gl_Position = vec4(s / (0.5 * uRes) * z, 0.0, z);
  vSide = aCorner.y * hw; vHalfW = w * 0.5; vAlpha = end ? ba : aa; vCol = aCol.rgb; vDepth = z;
}`;

SH.lineFS = `#version 300 es
precision highp float;
in float vSide; in float vHalfW; in float vAlpha; in vec3 vCol; in float vDepth;
uniform vec2 uDepthK;
out vec4 o;
void main(){
  float cov = clamp(vHalfW + 0.5 - abs(vSide), 0.0, 1.0) * min(1.0, vHalfW * 2.0 + 0.35);
  float a = vAlpha * cov;
  if (a < 0.002) discard;
  gl_FragDepth = log2(max(vDepth / uDepthK.y, 1.0)) * uDepthK.x;
  o = vec4(vCol * a, a);
}`;
