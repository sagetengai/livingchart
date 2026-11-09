export const fullscreen = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const coastalWater = `
uniform sampler2D u_coast;
uniform vec4 u_coastBounds;
bool isWater(vec2 mercator, bool clipEdge) {
  vec2 uv = (mercator - u_coastBounds.xy) / (u_coastBounds.zw - u_coastBounds.xy);
  if (any(lessThan(uv,vec2(0.0))) || any(greaterThanEqual(uv,vec2(1.0)))) return false;
  // Be conservative for stroke pixels whose footprint touches a land texel.
  if (clipEdge) {
    ivec2 size = textureSize(u_coast,0);
    ivec2 cell = ivec2(floor(uv * vec2(size) - 0.5));
    ivec2 lo = clamp(cell,ivec2(0),size-1);
    ivec2 hi = clamp(cell+1,ivec2(0),size-1);
    return texelFetch(u_coast,lo,0).r < 0.5 &&
      texelFetch(u_coast,ivec2(hi.x,lo.y),0).r < 0.5 &&
      texelFetch(u_coast,ivec2(lo.x,hi.y),0).r < 0.5 &&
      texelFetch(u_coast,hi,0).r < 0.5;
  }
  return texture(u_coast,uv).r < 0.5;
}
`

export const simulation = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_state, u_wind, u_previousWind;
uniform vec2 u_rangeU, u_rangeV, u_previousU, u_previousV;
uniform vec4 u_viewport, u_visible;
${coastalWater}
uniform float u_dt, u_speed, u_lifetime, u_fade, u_blend;
uniform uint u_seed;
uniform bool u_rk2;
out vec4 nextState;

uint hash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; return x ^ (x >> 16); }
float random(uint x) { return float(hash(x)) / 4294967295.0; }
float lifetime(int id) { return u_lifetime * mix(0.72, 1.28, random(uint(id) + u_seed + 71u)); }

// Pixel centers, longitude wrapping, and explicit validity-aware bilinear sampling.
bool field(sampler2D tex, vec2 ru, vec2 rv, vec2 position, out vec2 wind) {
  ivec2 size = textureSize(tex, 0);
  vec2 grid = vec2(fract(position.x), clamp(position.y, 0.0, 1.0)) * vec2(size) - 0.5;
  ivec2 base = ivec2(floor(grid)); vec2 f = fract(grid);
  wind = vec2(0.0); float total = 0.0;
  for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
    float weight = (x == 0 ? 1.0-f.x : f.x) * (y == 0 ? 1.0-f.y : f.y);
    ivec2 cell = base + ivec2(x,y);
    cell.x = (cell.x % size.x + size.x) % size.x; cell.y = clamp(cell.y, 0, size.y-1);
    vec4 encoded = texelFetch(tex, cell, 0);
    if (encoded.b < 0.5) continue;
    wind += vec2(mix(ru.x,ru.y,encoded.r),mix(rv.x,rv.y,encoded.g)) * weight;
    total += weight;
  }
  if (total < 0.9) return false;
  wind /= total; return true;
}
bool velocity(vec2 p, out vec2 v) {
  float lat = radians(90.0 - p.y * 180.0);
  vec2 mercator = vec2(fract(p.x), 0.5-log(tan(0.78539816339+lat*0.5))/6.28318530718);
  if (!isWater(mercator,false)) return false;
  vec2 now, old;
  bool valid = field(u_wind, u_rangeU, u_rangeV, p, now);
  if (!valid) { v = vec2(0.0); return false; }
  if (u_blend < 1.0 && field(u_previousWind, u_previousU, u_previousV, p, old)) now = mix(old, now, u_blend);
  // m/s -> degrees/s -> normalized geographic coordinates. Visual time acceleration only.
  v = now * vec2(1.0/(111320.0 * max(cos(lat),0.087) * 360.0), -1.0/(111320.0*180.0)) * u_speed;
  return length(now) > 0.15;
}
vec4 spawn(int id, float generation) {
  uint key = hash(uint(id) + u_seed) + uint(generation) * 1789u;
  vec2 r = vec2(random(key), random(key + 137u));
  // Jitter each stratum and rotate assignments on retries.
  int count = textureSize(u_state,0).x;
  int columns = int(ceil(sqrt(float(count)*1.2)));
  int rows = (count + columns - 1) / columns;
  int cell = (id + ((int(generation)-1) % count) * 137) % count;
  vec2 p = mix(u_visible.xy,u_visible.zw,(vec2(cell % columns,cell / columns)+r)/vec2(columns,rows));
  if (id % 10 == 0 && int(generation) % 2 == 1) {
    int side = int(key % 4u);
    if (side == 0) p = mix(u_viewport.xy,vec2(u_visible.x,u_viewport.w),r);
    if (side == 1) p = mix(vec2(u_visible.z,u_viewport.y),u_viewport.zw,r);
    if (side == 2) p = mix(u_viewport.xy,vec2(u_viewport.z,u_visible.y),r);
    if (side == 3) p = mix(vec2(u_viewport.x,u_visible.w),u_viewport.zw,r);
  }
  return vec4(p, 0.0, generation);
}
void main() {
  int id = int(gl_FragCoord.x);
  vec4 s = texelFetch(u_state, ivec2(id,0), 0);
  if (s.w < 0.5) { nextState = spawn(id,1.0); return; }
  if (s.z < 0.0) {
    s.z -= u_dt;
    nextState = -s.z >= u_fade ? spawn(id,s.w+1.0) : s; return;
  }
  if (s.z >= lifetime(id)) { nextState = spawn(id,s.w+1.0); return; }
  vec2 v = vec2(0.0);
  bool valid = velocity(s.xy, v);
  if (valid && u_rk2) {
    vec2 midpoint = s.xy + v*u_dt*0.5;
    valid = velocity(midpoint, v);
  }
  vec2 next = s.xy + v*u_dt;
  // Positions stay unwrapped, so history crossing ±180° has no discontinuity.
  float cameraX = s.x + floor((u_viewport.x+u_viewport.z)*0.5-s.x+0.5);
  bool outside = cameraX < u_viewport.x || cameraX > u_viewport.z || s.y < u_viewport.y || s.y > u_viewport.w;
  vec2 endpoint;
  valid = valid && next.y > 0.028 && next.y < 0.972 && velocity(next, endpoint);
  if (!valid || outside) {
    nextState = s.z <= u_dt ? spawn(id,s.w+1.0) : vec4(s.xy,-u_dt,s.w);
    return;
  }
  nextState = vec4(next,s.z+u_dt,s.w);
}`

export const ribbon = `
precision highp float;
precision highp int;
uniform sampler2D u_history, u_state;
uniform int u_historyLength, u_row;
uniform float u_phase, u_sampleDt, u_width, u_taper, u_opacity, u_lifetime, u_fade, u_centerX, u_dpr;
uniform vec2 u_resolution;
uniform uint u_seed;
out float v_edge, v_halfWidth, v_alpha;
uint hash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; return x ^ (x >> 16); }
float random(uint x) { return float(hash(x)) / 4294967295.0; }
vec4 recordAt(int id, int offset) {
  int row = (u_row - offset + u_historyLength * 2) % u_historyLength;
  return texelFetch(u_history,ivec2(id,row),0);
}
vec2 pathAt(int id, float t, float span, vec4 head, out float valid) {
  float offset = (1.0-t)*span-u_phase;
  vec4 a, b; float f;
  if (offset < 0.0) { a=recordAt(id,0); b=head; f=clamp(-offset/max(u_phase,0.0001),0.0,1.0); }
  else { int i=int(floor(offset)); a=recordAt(id,i); b=recordAt(id,i+1); f=fract(offset); }
  valid = (a.w == head.w && b.w == head.w) ? 1.0 : 0.0;
  return valid > 0.5 ? mix(a.xy,b.xy,f) : head.xy;
}
vec4 projectPosition(vec2 p, float shift) {
  float lat = radians(clamp(90.0-p.y*180.0,-85.0,85.0));
  vec2 mercator = vec2(p.x + shift,0.5-log(tan(0.78539816339+lat*0.5))/6.28318530718);
  {{PROJECTION}}
  return gl_Position;
}
void main() {
  int id=gl_InstanceID, point=gl_VertexID/2;
  float t=float(point)/float(u_historyLength-1), side=(gl_VertexID%2==0)?-1.0:1.0;
  vec4 head=texelFetch(u_state,ivec2(id,0),0);
  float noise=random(uint(id)+u_seed+71u);
  float life=u_lifetime*mix(0.72,1.28,noise);
  float span=float(u_historyLength-3)*mix(0.65,1.0,random(uint(id)+u_seed+39u));
  if(head.z>=0.0) span=min(span,max(0.0,head.z/u_sampleDt-1.1));
  float valid, previousValid, nextValid;
  vec2 p=pathAt(id,t,span,head,valid);
  float eps=1.0/float(u_historyLength-1);
  vec2 previous=pathAt(id,max(0.0,t-eps),span,head,previousValid);
  vec2 next=pathAt(id,min(1.0,t+eps),span,head,nextValid);
  float shift=floor(u_centerX-head.x+0.5);
  vec4 clip=projectPosition(p,shift), a=projectPosition(previous,shift), b=projectPosition(next,shift);
  vec2 tangent=(b.xy/b.w-a.xy/a.w)*u_resolution;
  vec2 normal=length(tangent)>0.0001 ? normalize(vec2(-tangent.y,tangent.x)) : vec2(0.0,1.0);
  float envelope=pow(max(sin(3.14159265359*t),0.0),u_taper);
  float variation=mix(0.78,1.15,noise)*(1.0+0.09*sin(t*9.42478+noise*6.28318));
  float halfWidth=0.5*u_width*u_dpr*envelope*variation;
  float edge=side*(halfWidth+0.8*u_dpr);
  clip.xy += normal*edge*2.0/u_resolution*clip.w;
  gl_Position=clip;
  float birth=smoothstep(0.0,u_fade,head.z);
  float death=1.0-smoothstep(life-u_fade,life,head.z);
  float fade=head.z<0.0 ? 1.0-smoothstep(0.0,u_fade,-head.z) : birth*death;
  v_alpha=u_opacity*fade*sqrt(max(sin(3.14159265359*t),0.0))*mix(0.65,1.0,t)*valid*previousValid*nextValid;
  v_halfWidth=halfWidth; v_edge=edge;
}`

export const ink = `#version 300 es
precision highp float;
uniform vec3 u_inkColor;
uniform float u_vesselLight;
uniform vec2 u_resolution;
uniform mat3 u_ground;
${coastalWater}
in float v_edge, v_halfWidth, v_alpha;
out vec4 color;
void main() {
  float aa=max(fwidth(v_edge),0.7);
  float coverage=1.0-smoothstep(max(0.0,v_halfWidth-aa*0.5),v_halfWidth+aa*0.5,abs(v_edge));
  float alpha=coverage*v_alpha;
  if (alpha <= 0.0) discard;
  vec3 ground = u_ground * vec3(gl_FragCoord.xy / u_resolution * 2.0 - 1.0, 1.0);
  if (!isWater(ground.xy / ground.z,true)) discard;
  // Screen distance keeps the pool of light round across viewport shapes and pixel ratios.
  float distanceToVessel = length(gl_FragCoord.xy - 0.5 * u_resolution) /
    min(u_resolution.x, u_resolution.y);
  float nearVessel = 1.0 - smoothstep(0.04, 0.64, distanceToVessel);
  vec3 ink = mix(u_inkColor, vec3(0.87, 0.98, 1.0), 0.48 * u_vesselLight * nearVessel);
  alpha = min(1.0, alpha * mix(1.0, mix(0.48, 1.9, nearVessel), u_vesselLight));
  color=vec4(ink*alpha,alpha);
}`
