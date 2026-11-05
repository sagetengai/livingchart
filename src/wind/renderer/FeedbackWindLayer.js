import ExifReader from 'exifreader';
import { buildMapLibreVertexShader, setProjectionUniforms } from './mapLibreGlGlobeHelper.js';

const RANGE_PATTERN =
    /^\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?);(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?);/;

const updateVertexShader = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_previous;
in float a_age;
in float a_max_age;
in vec2 a_seed;

out vec2 v_position;
out vec2 v_previous;
out float v_age;

uniform sampler2D u_velocity;
uniform sampler2D u_next_velocity;
uniform bool u_has_next;
uniform float u_time_blend;
uniform vec2 u_range_u;
uniform vec2 u_range_v;
uniform vec2 u_next_range_u;
uniform vec2 u_next_range_v;
uniform vec4 u_viewport;
uniform vec2 u_random_seed;
uniform float u_speed_factor;

float randomValue(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}

bool readWind(sampler2D source, vec2 rangesU, vec2 rangesV, ivec2 pixel, out vec2 wind) {
    ivec2 size = textureSize(source, 0);
    ivec2 bounded = clamp(pixel, ivec2(0), size - 1);
    vec4 encoded = texelFetch(source, bounded, 0);
    if (encoded.b < 0.5) return false;
    wind = vec2(mix(rangesU.x, rangesU.y, encoded.r), mix(rangesV.x, rangesV.y, encoded.g));
    return true;
}

bool sampleWind(vec2 position, out vec2 wind) {
    ivec2 size = textureSize(u_velocity, 0);
    vec2 grid = clamp(position, vec2(0.0), vec2(1.0)) * vec2(size) - 0.5;
    ivec2 base = ivec2(floor(grid));
    vec2 fraction = fract(grid);
    vec2 weights = vec2(1.0) - abs(fraction);
    vec2 total = vec2(0.0);
    float weightSum = 0.0;

    for (int y = 0; y <= 1; y++) {
        for (int x = 0; x <= 1; x++) {
            float weight = (x == 0 ? weights.x : fraction.x) * (y == 0 ? weights.y : fraction.y);
            if (weight <= 0.00001) continue;
            vec2 value;
            bool valid = readWind(u_velocity, u_range_u, u_range_v, base + ivec2(x, y), value);
            if (!valid) return false;
            total += value * weight;
            weightSum += weight;
        }
    }

    if (weightSum < 0.999) return false;
    wind = total / weightSum;

    if (u_has_next && u_time_blend > 0.0) {
        vec2 nextGrid = clamp(position, vec2(0.0), vec2(1.0)) * vec2(textureSize(u_next_velocity, 0)) - 0.5;
        ivec2 nextBase = ivec2(floor(nextGrid));
        vec2 nextFraction = fract(nextGrid);
        vec2 nextTotal = vec2(0.0);
        float nextWeightSum = 0.0;
        for (int y = 0; y <= 1; y++) {
            for (int x = 0; x <= 1; x++) {
                float weight = (x == 0 ? 1.0 - nextFraction.x : nextFraction.x)
                    * (y == 0 ? 1.0 - nextFraction.y : nextFraction.y);
                if (weight <= 0.00001) continue;
                vec2 value;
                bool valid = readWind(
                    u_next_velocity,
                    u_next_range_u,
                    u_next_range_v,
                    nextBase + ivec2(x, y),
                    value
                );
                if (!valid) {
                    nextWeightSum = 0.0;
                    break;
                }
                nextTotal += value * weight;
                nextWeightSum += weight;
            }
        }
        if (nextWeightSum > 0.999) {
            wind = mix(wind, nextTotal / nextWeightSum, u_time_blend);
        }
    }
    return true;
}

vec2 randomPosition(vec2 seed) {
    return vec2(
        mix(u_viewport.x, u_viewport.z, randomValue(seed + u_random_seed)),
        mix(u_viewport.y, u_viewport.w, randomValue(seed.yx + u_random_seed.yx))
    );
}

void main() {
    vec2 wind;
    bool valid = sampleWind(a_position, wind);
    float speed = length(wind);
    float latitude = 90.0 - a_position.y * 180.0;
    float cosLatitude = max(cos(radians(latitude)), 0.01);
    vec2 displacement = vec2(
        wind.x * u_speed_factor / (111320.0 * cosLatitude * 360.0),
        -wind.y * u_speed_factor / (110574.0 * 180.0)
    );
    vec2 nextPosition = a_position + displacement;
    bool outside = nextPosition.x < u_viewport.x || nextPosition.x > u_viewport.z
        || nextPosition.y < u_viewport.y || nextPosition.y > u_viewport.w
        || nextPosition.x < 0.0 || nextPosition.x > 1.0
        || nextPosition.y < 0.0 || nextPosition.y > 1.0;
    float nextAge = a_age + 1.0;
    bool respawn = !valid || speed < 0.05 || outside || nextAge >= a_max_age;

    if (respawn) {
        nextPosition = randomPosition(a_seed);
        v_previous = nextPosition;
        v_age = 0.0;
    } else {
        v_previous = a_position;
        v_age = nextAge;
    }

    v_position = nextPosition;
}`;

const fullscreenVertexShader = `#version 300 es
precision mediump float;
out vec2 v_uv;
void main() {
    vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    v_uv = position;
    gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const fadeFragmentShader = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_trail;
uniform float u_fade_multiplier;
uniform float u_fade_subtract;
void main() {
    vec4 previous = texture(u_trail, v_uv);
    fragColor = max(previous * u_fade_multiplier - u_fade_subtract, vec4(0.0));
}`;

const presentFragmentShader = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_trail;
void main() {
    fragColor = texture(u_trail, v_uv);
}`;

const trailVertexShaderInner = `
precision highp float;

in vec2 a_current;
in vec2 a_previous;
in float a_age;
in float a_max_age;
in vec2 a_corner;

uniform vec4 u_bounds;
uniform vec2 u_viewport_px;
uniform float u_line_width;
uniform float u_line_length_by_wind;
uniform sampler2D u_velocity;
uniform vec2 u_range_u;
uniform vec2 u_range_v;

out vec2 v_position;
out float v_speed;
out float v_age_alpha;

vec2 positionToGeo(vec2 position) {
    return vec2(
        mix(u_bounds.x, u_bounds.z, position.x),
        mix(u_bounds.w, u_bounds.y, 1.0 - position.y)
    );
}

vec2 latLngToMercator(vec2 lnglat) {
    float x = (lnglat.x + 180.0) / 360.0;
    float latitude = clamp(lnglat.y, -85.05112878, 85.05112878);
    float y = 0.5 - log(tan(0.7853981633974483 + radians(latitude) * 0.5)) / 6.283185307179586;
    return vec2(x, y);
}

bool sampleWind(vec2 position, out vec2 wind) {
    ivec2 size = textureSize(u_velocity, 0);
    vec2 grid = clamp(position, vec2(0.0), vec2(1.0)) * vec2(size) - 0.5;
    ivec2 base = ivec2(floor(grid));
    vec2 fraction = fract(grid);
    vec2 total = vec2(0.0);
    float weightSum = 0.0;
    for (int y = 0; y <= 1; y++) {
        for (int x = 0; x <= 1; x++) {
            float weight = (x == 0 ? 1.0 - fraction.x : fraction.x)
                * (y == 0 ? 1.0 - fraction.y : fraction.y);
            if (weight <= 0.00001) continue;
            vec4 encoded = texelFetch(u_velocity, clamp(base + ivec2(x, y), ivec2(0), size - 1), 0);
            if (encoded.b < 0.5) return false;
            total += vec2(mix(u_range_u.x, u_range_u.y, encoded.r), mix(u_range_v.x, u_range_v.y, encoded.g)) * weight;
            weightSum += weight;
        }
    }
    if (weightSum < 0.999) return false;
    wind = total / weightSum;
    return true;
}

void main() {
    vec2 midpoint = (a_previous + a_current) * 0.5;
    vec2 wind = vec2(0.0);
    bool valid = sampleWind(midpoint, wind);
    v_speed = valid ? length(wind) : 0.0;
    float speedMix = clamp(v_speed / 18.0, 0.0, 1.0);

    vec4 clipFrom = projectTile(latLngToMercator(positionToGeo(a_previous)));
    vec4 clipTo = projectTile(latLngToMercator(positionToGeo(a_current)));
    vec2 ndcFrom = clipFrom.xy / clipFrom.w;
    vec2 ndcTo = clipTo.xy / clipTo.w;
    vec2 midpointNdc = (ndcFrom + ndcTo) * 0.5;
    float lengthScale = mix(0.35, u_line_length_by_wind, speedMix);
    ndcFrom = midpointNdc + (ndcFrom - midpointNdc) * lengthScale;
    ndcTo = midpointNdc + (ndcTo - midpointNdc) * lengthScale;
    vec2 delta = (ndcTo - ndcFrom) * u_viewport_px * 0.5;
    float pixelLength = max(length(delta), 0.001);
    vec2 normal = vec2(-delta.y, delta.x) / pixelLength;
    vec4 endpointClip = a_corner.x < 0.0 ? clipFrom : clipTo;
    vec2 endpoint = a_corner.x < 0.0 ? ndcFrom : ndcTo;
    vec2 expanded = endpoint + normal * a_corner.y * u_line_width / u_viewport_px;
    gl_Position = vec4(expanded * endpointClip.w, endpointClip.z, endpointClip.w);

    float normalizedAge = clamp(a_age / max(a_max_age, 1.0), 0.0, 1.0);
    float fadeIn = smoothstep(0.0, 0.15, normalizedAge);
    float fadeOut = 1.0 - smoothstep(0.78, 1.0, normalizedAge);
    v_age_alpha = fadeIn * fadeOut * mix(0.1, 0.92, speedMix) * (valid ? 1.0 : 0.0);
    v_position = midpoint;
}`;

const trailFragmentShader = `#version 300 es
precision mediump float;
in vec2 v_position;
in float v_speed;
in float v_age_alpha;
out vec4 fragColor;
uniform sampler2D u_velocity;
uniform vec2 u_range_u;
uniform vec2 u_range_v;
void main() {
    float speedMix = clamp(v_speed / 18.0, 0.0, 1.0);
    vec3 paleBlue = vec3(0.81, 0.90, 0.95);
    vec3 softWhite = vec3(0.94, 0.97, 0.98);
    vec3 color = mix(paleBlue, softWhite, speedMix);
    fragColor = vec4(color, v_age_alpha * mix(0.22, 0.78, speedMix));
}`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`FeedbackWindLayer shader compilation failed: ${message}`);
    }
    return shader;
}

function createProgram(gl, vertexSource, fragmentSource, varyings = null) {
    const program = gl.createProgram();
    const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    if (varyings) gl.transformFeedbackVaryings(program, varyings, gl.SEPARATE_ATTRIBS);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`FeedbackWindLayer program link failed: ${message}`);
    }
    const result = { program };
    for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES); index += 1) {
        const attribute = gl.getActiveAttrib(program, index);
        result[attribute.name] = gl.getAttribLocation(program, attribute.name);
    }
    for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index += 1) {
        const uniform = gl.getActiveUniform(program, index);
        result[uniform.name] = gl.getUniformLocation(program, uniform.name);
    }
    gl.detachShader(program, vertex);
    gl.detachShader(program, fragment);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return result;
}

function createBuffer(gl, data, usage = gl.STATIC_DRAW) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    return buffer;
}

function parseRanges(description, fallback) {
    const match = RANGE_PATTERN.exec(description ?? '');
    if (!match) {
        if (fallback?.length === 2) return { u: fallback, v: fallback };
        throw new Error('Wind image is missing valid U/V component ranges.');
    }
    const values = match.slice(1, 5).map(Number);
    if (!values.every(Number.isFinite) || values[1] <= values[0] || values[3] <= values[2]) {
        throw new Error('Wind image has invalid U/V component ranges.');
    }
    return { u: values.slice(0, 2), v: values.slice(2, 4) };
}

function projectBounds(map, bounds) {
    const view = map.getBounds();
    const [west, north, east, south] = bounds;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    return [
        clamp((view.getWest() - west) / (east - west), 0, 1),
        clamp((north - view.getNorth()) / (north - south), 0, 1),
        clamp((view.getEast() - west) / (east - west), 0, 1),
        clamp((north - view.getSouth()) / (north - south), 0, 1),
    ];
}

export default class FeedbackWindLayer {
    constructor({
        id,
        source,
        bounds,
        velocityRange = [-12, 12],
        particleCount = 3640,
        fadeMultiplier = 0.98,
        fadeSubtract = 0.002,
        lineWidth = 1.25,
        speedFactor = 45,
        maxAge = 1800,
        trailScale = 0.5,
        lineLengthByWind = 1.8,
        timeBlendEnabled = false,
        timeBlend = 0,
        paused = false,
    }) {
        this.id = id;
        this.type = 'custom';
        this.renderingMode = '2d';
        this.source = source;
        this.bounds = bounds;
        this.velocityRange = velocityRange;
        this.particleCount = particleCount;
        this.fadeMultiplier = fadeMultiplier;
        this.fadeSubtract = fadeSubtract;
        this.lineWidth = lineWidth;
        this.speedFactor = speedFactor;
        this.maxAge = maxAge;
        this.trailScale = Math.min(1, Math.max(0.25, trailScale));
        this.lineLengthByWind = lineLengthByWind;
        this.timeBlendEnabled = timeBlendEnabled;
        this.timeBlend = Math.min(1, Math.max(0, timeBlend));
        this.paused = paused;

        this.state = [];
        this.currentState = 0;
        this.buffers = {};
        this.framebuffers = [];
        this.trailTextures = [];
        this.trailSize = [0, 0];
        this.rangeU = [...velocityRange];
        this.rangeV = [...velocityRange];
        this.nextRangeU = [...velocityRange];
        this.nextRangeV = [...velocityRange];
        this.nextSourceTexture = null;
        this.nextSourceLoaded = false;
        this.lastUpdate = 0;
        this.randomSeed = [Math.random(), Math.random()];
        this.shaderMap = new Map();
        this.onMoveEnd = () => {
            this.reseedParticles();
            this.clearTrail();
        };
        this.clearTrail = this.clearTrail.bind(this);
        this.render = this.render.bind(this);
    }

    onAdd(map, gl) {
        this.map = map;
        this.gl = gl;
        this.programs = {
            update: createProgram(gl, updateVertexShader, '#version 300 es\nprecision mediump float; out vec4 color; void main(){color=vec4(0.0);}', [
                'v_position',
                'v_previous',
                'v_age',
            ]),
            fade: createProgram(gl, fullscreenVertexShader, fadeFragmentShader),
            present: createProgram(gl, fullscreenVertexShader, presentFragmentShader),
        };
        this.fullscreenVao = gl.createVertexArray();
        this.stateVao = gl.createVertexArray();
        this.drawVao = gl.createVertexArray();
        this.transformFeedback = gl.createTransformFeedback();
        this.createParticleBuffers();
        this.ensureTrailBuffers();
        map.on('movestart', this.clearTrail);
        map.on('zoomstart', this.clearTrail);
        map.on('moveend', this.onMoveEnd);
        map.on('zoomend', this.onMoveEnd);
        this.loadSource(this.source);
        map.triggerRepaint();
    }

    createParticleBuffers() {
        const gl = this.gl;
        const positions = new Float32Array(this.particleCount * 2);
        const ages = new Float32Array(this.particleCount);
        const lifetimes = new Float32Array(this.particleCount);
        const seeds = new Float32Array(this.particleCount * 2);
        for (let index = 0; index < this.particleCount; index += 1) {
            lifetimes[index] = this.maxAge * (0.65 + Math.random() * 0.7);
            seeds[index * 2] = Math.random();
            seeds[index * 2 + 1] = Math.random();
        }
        this.maxAgeBuffer = createBuffer(gl, lifetimes);
        this.seedBuffer = createBuffer(gl, seeds);
        this.state = Array.from({ length: 2 }, () => ({
            position: createBuffer(gl, positions, gl.DYNAMIC_COPY),
            previous: createBuffer(gl, positions, gl.DYNAMIC_COPY),
            age: createBuffer(gl, ages, gl.DYNAMIC_COPY),
        }));
        this.reseedParticles();
    }

    reseedParticles() {
        if (!this.gl || this.state.length < 2) return;
        const gl = this.gl;
        const viewport = projectBounds(this.map, this.bounds);
        const positions = new Float32Array(this.particleCount * 2);
        const ages = new Float32Array(this.particleCount);
        for (let index = 0; index < this.particleCount; index += 1) {
            positions[index * 2] = viewport[0] + Math.random() * Math.max(0.0001, viewport[2] - viewport[0]);
            positions[index * 2 + 1] = viewport[1] + Math.random() * Math.max(0.0001, viewport[3] - viewport[1]);
            ages[index] = Math.random() * this.maxAge * 0.1;
        }
        for (const state of this.state) {
            gl.bindBuffer(gl.ARRAY_BUFFER, state.position);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
            gl.bindBuffer(gl.ARRAY_BUFFER, state.previous);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
            gl.bindBuffer(gl.ARRAY_BUFFER, state.age);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, ages);
        }
        this.currentState = 0;
        this.randomSeed = [Math.random(), Math.random()];
        this.lastUpdate = 0;
    }

    async loadSource(source) {
        const generation = (this.sourceGeneration || 0) + 1;
        this.sourceGeneration = generation;
        this.source = source;
        this.clearTrail();
        try {
            const response = await fetch(source);
            if (!response.ok) throw new Error(`Wind image HTTP ${response.status}`);
            const buffer = await response.arrayBuffer();
            const tags = await ExifReader.load(buffer);
            const ranges = parseRanges(tags.ImageDescription?.description, this.velocityRange);
            const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/jpeg' }));
            if (generation !== this.sourceGeneration || !this.gl) {
                bitmap.close();
                return;
            }
            const gl = this.gl;
            if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
            this.sourceTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
            this.sourceSize = [bitmap.width, bitmap.height];
            this.rangeU = ranges.u;
            this.rangeV = ranges.v;
            this.sourceLoaded = true;
            bitmap.close();
            this.reseedParticles();
            this.clearTrail();
            this.map.triggerRepaint();
        } catch (error) {
            console.error('FeedbackWindLayer could not load forecast source:', error);
        }
    }

    async setTemporalSource(source, fraction) {
        this.timeBlend = this.timeBlendEnabled ? Math.min(1, Math.max(0, fraction)) : 0;
        if (!this.timeBlendEnabled || !source || !this.gl) {
            this.nextSourceLoaded = false;
            if (this.nextSourceTexture) this.gl.deleteTexture(this.nextSourceTexture);
            this.nextSourceTexture = null;
            this.clearTrail();
            return;
        }
        const response = await fetch(source);
        if (!response.ok) throw new Error(`Temporal wind image HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const tags = await ExifReader.load(buffer);
        const ranges = parseRanges(tags.ImageDescription?.description, this.velocityRange);
        const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/jpeg' }));
        const gl = this.gl;
        if (this.nextSourceTexture) gl.deleteTexture(this.nextSourceTexture);
        this.nextSourceTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.nextSourceTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        this.nextRangeU = ranges.u;
        this.nextRangeV = ranges.v;
        this.nextSourceLoaded = true;
        bitmap.close();
        this.clearTrail();
        this.map.triggerRepaint();
    }

    setSource(source) {
        if (source !== this.source) this.loadSource(source);
        else this.clearTrail();
    }

    setTimeBlend(fraction) {
        this.timeBlend = this.timeBlendEnabled
            ? Math.min(1, Math.max(0, fraction))
            : 0;
        this.clearTrail();
        if (this.map) this.map.triggerRepaint();
    }

    setPaused(paused) {
        this.paused = Boolean(paused);
        if (this.map) this.map.triggerRepaint();
    }

    clearTrail() {
        if (!this.gl || this.framebuffers.length !== 2) return;
        const gl = this.gl;
        const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const previousClearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE);
        const scissorWasEnabled = gl.isEnabled(gl.SCISSOR_TEST);
        gl.disable(gl.SCISSOR_TEST);
        for (const framebuffer of this.framebuffers) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
        gl.clearColor(...previousClearColor);
        if (scissorWasEnabled) gl.enable(gl.SCISSOR_TEST);
        else gl.disable(gl.SCISSOR_TEST);
        this.trailWrite = 0;
        this.randomSeed = [Math.random(), Math.random()];
    }

    ensureTrailBuffers() {
        const gl = this.gl;
        const width = Math.max(1, Math.round(gl.canvas.width * this.trailScale));
        const height = Math.max(1, Math.round(gl.canvas.height * this.trailScale));
        if (width === this.trailSize[0] && height === this.trailSize[1]) return;

        const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        this.deleteTrailBuffers();
        this.trailSize = [width, height];
        for (let index = 0; index < 2; index += 1) {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            const framebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error('FeedbackWindLayer trail framebuffer is incomplete.');
            }
            this.trailTextures.push(texture);
            this.framebuffers.push(framebuffer);
        }
        this.trailWrite = 0;
        this.clearTrail();
        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
    }

    deleteTrailBuffers() {
        if (!this.gl) return;
        for (const texture of this.trailTextures) this.gl.deleteTexture(texture);
        for (const framebuffer of this.framebuffers) this.gl.deleteFramebuffer(framebuffer);
        this.trailTextures = [];
        this.framebuffers = [];
    }

    updateParticles() {
        const now = performance.now();
        if (now - this.lastUpdate < 50) return;
        this.lastUpdate = now;
        const gl = this.gl;
        const source = this.state[this.currentState];
        const targetIndex = 1 - this.currentState;
        const target = this.state[targetIndex];
        const viewport = projectBounds(this.map, this.bounds);
        const program = this.programs.update;
        gl.useProgram(program.program);
        gl.bindVertexArray(this.stateVao);
        this.bindAttribute(program.a_position, source.position, 2);
        this.bindAttribute(program.a_previous, source.previous, 2);
        this.bindAttribute(program.a_age, source.age, 1);
        this.bindAttribute(program.a_max_age, this.maxAgeBuffer, 1);
        this.bindAttribute(program.a_seed, this.seedBuffer, 2);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        gl.uniform1i(program.u_velocity, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.nextSourceLoaded ? this.nextSourceTexture : this.sourceTexture);
        gl.uniform1i(program.u_next_velocity, 1);
        gl.uniform1i(program.u_has_next, this.nextSourceLoaded && this.timeBlendEnabled ? 1 : 0);
        gl.uniform1f(program.u_time_blend, this.timeBlend);
        gl.uniform2fv(program.u_range_u, this.rangeU);
        gl.uniform2fv(program.u_range_v, this.rangeV);
        gl.uniform2fv(program.u_next_range_u, this.nextRangeU);
        gl.uniform2fv(program.u_next_range_v, this.nextRangeV);
        gl.uniform4fv(program.u_viewport, viewport);
        gl.uniform2f(program.u_random_seed, Math.random(), Math.random());
        gl.uniform1f(program.u_speed_factor, this.speedFactor);

        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.transformFeedback);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, target.position);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, target.previous);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 2, target.age);
        gl.enable(gl.RASTERIZER_DISCARD);
        gl.beginTransformFeedback(gl.POINTS);
        gl.drawArrays(gl.POINTS, 0, this.particleCount);
        gl.endTransformFeedback();
        gl.disable(gl.RASTERIZER_DISCARD);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, null);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 2, null);
        this.currentState = targetIndex;
    }

    bindAttribute(location, buffer, size, divisor = 0) {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(location, divisor);
    }

    getTrailProgram(shaderData) {
        const key = shaderData.variantName;
        if (this.shaderMap.has(key)) return this.shaderMap.get(key);
        const source = buildMapLibreVertexShader(shaderData, trailVertexShaderInner);
        const program = createProgram(this.gl, source, trailFragmentShader);
        this.shaderMap.set(key, program);
        return program;
    }

    fadePreviousTrail() {
        const gl = this.gl;
        const previous = 1 - this.trailWrite;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[this.trailWrite]);
        gl.viewport(0, 0, this.trailSize[0], this.trailSize[1]);
        gl.disable(gl.BLEND);
        gl.useProgram(this.programs.fade.program);
        gl.bindVertexArray(this.fullscreenVao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.trailTextures[previous]);
        gl.uniform1i(this.programs.fade.u_trail, 0);
        gl.uniform1f(this.programs.fade.u_fade_multiplier, this.fadeMultiplier);
        gl.uniform1f(this.programs.fade.u_fade_subtract, this.fadeSubtract);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    drawSegments(shaderData, defaultProjectionData) {
        if (!this.sourceLoaded) return;
        const gl = this.gl;
        const program = this.getTrailProgram(shaderData);
        const state = this.state[this.currentState];
        const dpr = gl.canvas.width / Math.max(this.map.getCanvas().clientWidth, 1);
        const glWidth = this.lineWidth * dpr * this.trailScale;

        gl.useProgram(program.program);
        gl.bindVertexArray(this.drawVao);
        this.bindAttribute(program.a_current, state.position, 2, 1);
        this.bindAttribute(program.a_previous, state.previous, 2, 1);
        this.bindAttribute(program.a_age, state.age, 1, 1);
        this.bindAttribute(program.a_max_age, this.maxAgeBuffer, 1, 1);
        this.bindAttribute(program.a_corner, this.cornerBuffer, 2, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        gl.uniform1i(program.u_velocity, 0);
        gl.uniform2fv(program.u_range_u, this.rangeU);
        gl.uniform2fv(program.u_range_v, this.rangeV);
        gl.uniform4fv(program.u_bounds, this.bounds);
        gl.uniform2f(program.u_viewport_px, this.trailSize[0], this.trailSize[1]);
        gl.uniform1f(program.u_line_width, glWidth);
        gl.uniform1f(program.u_line_length_by_wind, this.lineLengthByWind);
        setProjectionUniforms(gl, program.program, defaultProjectionData);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(
            gl.SRC_ALPHA,
            gl.ONE_MINUS_SRC_ALPHA,
            gl.ONE,
            gl.ONE_MINUS_SRC_ALPHA
        );
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.particleCount);
        gl.disable(gl.BLEND);
    }

    presentTrail(framebuffer, texture) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.programs.present.program);
        gl.bindVertexArray(this.fullscreenVao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(this.programs.present.u_trail, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disable(gl.BLEND);
    }

    render(gl, args) {
        if (!this.sourceLoaded) return;
        const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const previousViewport = gl.getParameter(gl.VIEWPORT);
        const blendWasEnabled = gl.isEnabled(gl.BLEND);
        const depthWasEnabled = gl.isEnabled(gl.DEPTH_TEST);
        const scissorWasEnabled = gl.isEnabled(gl.SCISSOR_TEST);
        const discardWasEnabled = gl.isEnabled(gl.RASTERIZER_DISCARD);
        const previousBlendState = [
            gl.getParameter(gl.BLEND_SRC_RGB),
            gl.getParameter(gl.BLEND_DST_RGB),
            gl.getParameter(gl.BLEND_SRC_ALPHA),
            gl.getParameter(gl.BLEND_DST_ALPHA),
            gl.getParameter(gl.BLEND_EQUATION_RGB),
            gl.getParameter(gl.BLEND_EQUATION_ALPHA),
        ];
        const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM);
        const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
        const previousArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
        const previousTextures = [];
        for (let unit = 0; unit < 2; unit += 1) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            previousTextures.push(gl.getParameter(gl.TEXTURE_BINDING_2D));
        }
        gl.activeTexture(previousActiveTexture);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.DEPTH_TEST);
        this.ensureTrailBuffers();
        gl.blendEquationSeparate(previousBlendState[4], previousBlendState[5]);
        if (!this.cornerBuffer) {
            this.cornerBuffer = createBuffer(gl, new Float32Array([
                -1, -1,
                 1, -1,
                -1,  1,
                 1,  1,
            ]));
        }
        if (!this.paused) {
            this.updateParticles();
            this.fadePreviousTrail();
            this.drawSegments(args.shaderData, args.defaultProjectionData);
            this.presentTrail(
                this.framebuffers[this.trailWrite],
                this.trailTextures[this.trailWrite],
            );
            this.trailWrite = 1 - this.trailWrite;
        } else {
            const currentTrail = 1 - this.trailWrite;
            this.presentTrail(
                this.framebuffers[currentTrail],
                this.trailTextures[currentTrail],
            );
        }
        gl.viewport(...previousViewport);
        if (blendWasEnabled) gl.enable(gl.BLEND);
        else gl.disable(gl.BLEND);
        gl.blendFuncSeparate(...previousBlendState.slice(0, 4));
        gl.blendEquationSeparate(previousBlendState[4], previousBlendState[5]);
        if (depthWasEnabled) gl.enable(gl.DEPTH_TEST);
        else gl.disable(gl.DEPTH_TEST);
        if (scissorWasEnabled) gl.enable(gl.SCISSOR_TEST);
        else gl.disable(gl.SCISSOR_TEST);
        if (discardWasEnabled) gl.enable(gl.RASTERIZER_DISCARD);
        else gl.disable(gl.RASTERIZER_DISCARD);
        gl.bindVertexArray(previousVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, previousArrayBuffer);
        gl.useProgram(previousProgram);
        for (let unit = 0; unit < 2; unit += 1) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, previousTextures[unit]);
        }
        gl.activeTexture(previousActiveTexture);
        if (!this.paused) this.map.triggerRepaint();
    }

    onRemove(map, gl) {
        map.off('movestart', this.clearTrail);
        map.off('zoomstart', this.clearTrail);
        map.off('moveend', this.onMoveEnd);
        map.off('zoomend', this.onMoveEnd);
        this.deleteTrailBuffers();
        for (const state of this.state) {
            gl.deleteBuffer(state.position);
            gl.deleteBuffer(state.previous);
            gl.deleteBuffer(state.age);
        }
        for (const buffer of [this.maxAgeBuffer, this.seedBuffer, this.cornerBuffer]) {
            if (buffer) gl.deleteBuffer(buffer);
        }
        if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
        if (this.nextSourceTexture) gl.deleteTexture(this.nextSourceTexture);
        if (this.transformFeedback) gl.deleteTransformFeedback(this.transformFeedback);
        for (const vao of [this.fullscreenVao, this.stateVao, this.drawVao]) {
            if (vao) gl.deleteVertexArray(vao);
        }
        for (const program of [...Object.values(this.programs), ...this.shaderMap.values()]) {
            gl.deleteProgram(program.program);
        }
        this.shaderMap.clear();
        this.sourceLoaded = false;
        this.gl = null;
        this.map = null;
    }
}
