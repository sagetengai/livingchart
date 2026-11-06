import { buildMapLibreVertexShader, setProjectionUniforms } from '../../src/wind/renderer/mapLibreGlGlobeHelper.js'
import { fullscreen, simulation, ribbon, ink } from './shaders.js'

export const PRESETS = {
  fine: { count: 330, history: 112, width: 0.95, taper: 0.8, opacity: 0.38, speed: 1700, lifetime: 26, fade: 3 },
  calligraphic: { count: 480, history: 96, width: 1.8, taper: 0.85, opacity: 0.46, speed: 1700, lifetime: 23, fade: 2.5 },
  atmospheric: { count: 560, history: 128, width: 1.5, taper: 0.65, opacity: 0.25, speed: 1400, lifetime: 30, fade: 4 },
}
export const STEP = 1 / 30
const SAMPLE_EVERY = 3

function program(gl, vertex, fragment) {
  const p = gl.createProgram()
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
    gl.attachShader(p, s); gl.deleteShader(s)
  }
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
  const uniforms = {}
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
    const { name } = gl.getActiveUniform(p, i); uniforms[name] = gl.getUniformLocation(p, name)
  }
  return { p, u: uniforms }
}

export default class HistoryWindLayer {
  constructor({ grid, preset = 'calligraphic', seed = 20261105, manual = false } = {}) {
    this.id = 'phase2-wind'; this.type = 'custom'; this.renderingMode = '2d'
    this.options = { ...PRESETS[preset] }; this.seed = seed >>> 0; this.manual = manual
    this.grid = grid; this.enabled = true; this.programs = new Map()
    this.stats = { draws: 0, updates: 0, frames: 0, droppedSeconds: 0, uploads: 0 }
    this.frameTimes = []; this.cpuTimes = []; this.gpuTimes = []; this.queries = []
    this.rk2 = true
  }
  onAdd(map, gl) {
    this.map = map; this.gl = gl
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Calligraphic wind requires WebGL2 EXT_color_buffer_float.')
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    this.renderer = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
    this.timerExtension = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    this.vao = gl.createVertexArray()
    this.simulation = program(gl, fullscreen, simulation)
    this.withState(() => { this.uploadGrid(this.grid); this.allocate() })
  }
  texture(width, height, data, floating = true) {
    const gl = this.gl, tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, floating ? gl.RGBA32F : gl.RGBA8, width, height, 0, gl.RGBA, floating ? gl.FLOAT : gl.UNSIGNED_BYTE, data)
    return tex
  }
  uploadGrid(grid) {
    if (!grid || grid.bounds.join(',') !== '-180,90,180,-90') throw new Error('This experiment expects the existing global GFS grid.')
    const gl = this.gl
    if (this.previousTexture && this.previousTexture !== this.windTexture) gl.deleteTexture(this.previousTexture)
    this.previousTexture = this.windTexture
    this.previousGrid = this.grid
    this.windTexture = this.texture(grid.width, grid.height, new Uint8Array(grid.pixels.buffer, grid.pixels.byteOffset, grid.pixels.byteLength), false)
    this.grid = grid; this.blendStart = this.steps || 0; this.stats.uploads++
    if (!this.previousTexture) { this.previousTexture = this.windTexture; this.previousGrid = grid }
  }
  setGrid(grid) { if (grid !== this.grid) this.withState(() => this.uploadGrid(grid)) }
  allocate() {
    const gl = this.gl, { count, history } = this.options
    if (Math.max(count, history) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('Requested particle history exceeds MAX_TEXTURE_SIZE.')
    for (const tex of this.stateTextures || []) gl.deleteTexture(tex)
    for (const fbo of this.stateFbos || []) gl.deleteFramebuffer(fbo)
    if (this.historyTexture) gl.deleteTexture(this.historyTexture)
    this.stateTextures = [0,1].map(() => this.texture(count,1,new Float32Array(count*4)))
    this.stateFbos = this.stateTextures.map(tex => {
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Particle-state framebuffer is incomplete.')
      return fbo
    })
    this.historyTexture = this.texture(count,history,new Float32Array(count*history*4))
    this.current = 0; this.row = history-1; this.steps = 0; this.accumulator = 0; this.lastTime = null
    this.pendingSteps = this.manual ? 0 : 420
    this.blendStart = -90
  }
  configure(changes) {
    const old = this.options
    this.options = { ...old, ...changes }
    this.options.count = Math.round(Math.max(50,Math.min(2000,this.options.count)))
    this.options.history = Math.round(Math.max(16,Math.min(192,this.options.history)))
    if (old.count !== this.options.count || old.history !== this.options.history) this.reset()
    this.map?.triggerRepaint()
  }
  reset() { if (this.gl) this.withState(() => this.allocate()) }
  advance(seconds) { this.pendingSteps += Math.round(seconds / STEP); this.map.triggerRepaint(); return this.steps + this.pendingSteps }
  viewport() {
    const b = this.map.getBounds(); let w=b.getWest(), e=b.getEast()
    if (e<w) e+=360
    const dx=Math.min(360,e-w)*0.22, dy=(b.getNorth()-b.getSouth())*0.22
    return [(w-dx+180)/360,(90-Math.min(85,b.getNorth()+dy))/180,(e+dx+180)/360,(90-Math.max(-85,b.getSouth()-dy))/180]
  }
  bind(unit, tex) { const gl=this.gl; gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,tex) }
  simulate(viewport) {
    const gl=this.gl, {p,u}=this.simulation, o=this.options, next=1-this.current
    gl.useProgram(p); gl.bindFramebuffer(gl.FRAMEBUFFER,this.stateFbos[next]); gl.viewport(0,0,o.count,1)
    this.bind(0,this.stateTextures[this.current]); this.bind(1,this.windTexture); this.bind(2,this.previousTexture)
    gl.uniform1i(u.u_state,0); gl.uniform1i(u.u_wind,1); gl.uniform1i(u.u_previousWind,2)
    gl.uniform2fv(u.u_rangeU,this.grid.ranges.u); gl.uniform2fv(u.u_rangeV,this.grid.ranges.v)
    gl.uniform2fv(u.u_previousU,this.previousGrid.ranges.u); gl.uniform2fv(u.u_previousV,this.previousGrid.ranges.v)
    gl.uniform4fv(u.u_viewport,viewport); gl.uniform1f(u.u_dt,STEP); gl.uniform1f(u.u_speed,o.speed)
    gl.uniform1f(u.u_lifetime,o.lifetime); gl.uniform1f(u.u_fade,o.fade); gl.uniform1ui(u.u_seed,this.seed)
    gl.uniform1i(u.u_rk2,this.rk2); gl.uniform1f(u.u_blend,Math.min(1,(this.steps-this.blendStart)*STEP/3))
    gl.drawArrays(gl.TRIANGLES,0,3)
    this.current=next; this.steps++; this.stats.updates++
    if (this.steps % SAMPLE_EVERY === 0) {
      this.row=(this.row+1)%o.history
      this.bind(3,this.historyTexture)
      // GPU-to-GPU row copy; the source FBO never has the history texture attached.
      gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,this.row,0,0,o.count,1)
    }
  }
  render(gl, args) {
    const now=performance.now()
    if (!this.enabled) { this.lastTime=null; return }
    if (this.lastTime != null && !this.manual && this.pendingSteps === 0) {
      const dt=(now-this.lastTime)/1000
      if (dt < 0.5) { this.accumulator+=dt; this.frameTimes.push(dt*1000) }
      else this.stats.droppedSeconds+=dt // A suspended tab resumes rather than jumping its particles.
    }
    this.lastTime=now; this.stats.frames++
    const start=performance.now()
    this.withState(saved => {
      gl.bindVertexArray(this.vao)
      for (const flag of [gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.RASTERIZER_DISCARD,gl.BLEND]) gl.disable(flag)
      gl.colorMask(true,true,true,true)
      let query
      if (this.timerExtension && this.stats.frames%60===0 && this.queries.length<4) {
        query=gl.createQuery(); gl.beginQuery(this.timerExtension.TIME_ELAPSED_EXT,query)
      }
      const viewport=this.viewport()
      let count=this.pendingSteps ? Math.min(this.pendingSteps,24) : Math.min(8,Math.floor(this.accumulator/STEP))
      if (this.pendingSteps) this.pendingSteps-=count
      else this.accumulator-=count*STEP
      for(let i=0;i<count;i++) this.simulate(viewport)
      if (!this.programs.has(args.shaderData.variantName)) this.programs.set(args.shaderData.variantName,program(gl,buildMapLibreVertexShader(args.shaderData,ribbon),ink))
      const {p,u}=this.programs.get(args.shaderData.variantName), o=this.options
      gl.bindFramebuffer(gl.FRAMEBUFFER,saved.framebuffer); gl.viewport(...saved.viewport)
      gl.useProgram(p); setProjectionUniforms(gl,p,args.defaultProjectionData)
      this.bind(0,this.historyTexture); this.bind(1,this.stateTextures[this.current])
      gl.uniform1i(u.u_history,0); gl.uniform1i(u.u_state,1); gl.uniform1i(u.u_historyLength,o.history); gl.uniform1i(u.u_row,this.row)
      gl.uniform1f(u.u_phase,(this.steps%SAMPLE_EVERY)/SAMPLE_EVERY); gl.uniform1f(u.u_sampleDt,STEP*SAMPLE_EVERY)
      for (const key of ['width','taper','opacity','lifetime','fade']) gl.uniform1f(u['u_'+key],o[key])
      gl.uniform1f(u.u_centerX,(this.map.getCenter().lng+180)/360)
      gl.uniform1f(u.u_dpr,gl.drawingBufferWidth/this.map.getCanvas().clientWidth)
      gl.uniform2f(u.u_resolution,gl.drawingBufferWidth,gl.drawingBufferHeight); gl.uniform1ui(u.u_seed,this.seed)
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,o.history*2,o.count); this.stats.draws++
      if(query) { gl.endQuery(this.timerExtension.TIME_ELAPSED_EXT); this.queries.push(query) }
    })
    this.cpuTimes.push(performance.now()-start)
    if (this.frameTimes.length>600) this.frameTimes.shift()
    if (this.cpuTimes.length>600) this.cpuTimes.shift()
    if(this.timerExtension) for(const q of [...this.queries]) {
      if(!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)) continue
      if(!gl.getParameter(this.timerExtension.GPU_DISJOINT_EXT)) this.gpuTimes.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6)
      if (this.gpuTimes.length > 600) this.gpuTimes.shift()
      gl.deleteQuery(q); this.queries.splice(this.queries.indexOf(q),1)
    }
    if (!this.manual || this.pendingSteps) this.map.triggerRepaint()
  }
  // MapLibre shares this context. Restore every state mutated by simulation/drawing.
  withState(fn) {
    const gl=this.gl
    const s={framebuffer:gl.getParameter(gl.FRAMEBUFFER_BINDING), readFramebuffer:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), viewport:gl.getParameter(gl.VIEWPORT),
      program:gl.getParameter(gl.CURRENT_PROGRAM), vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING), active:gl.getParameter(gl.ACTIVE_TEXTURE),
      colorMask:gl.getParameter(gl.COLOR_WRITEMASK), blend:[gl.BLEND_SRC_RGB,gl.BLEND_DST_RGB,gl.BLEND_SRC_ALPHA,gl.BLEND_DST_ALPHA,gl.BLEND_EQUATION_RGB,gl.BLEND_EQUATION_ALPHA].map(k=>gl.getParameter(k)),
      flags:[gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.RASTERIZER_DISCARD,gl.BLEND].map(k=>[k,gl.isEnabled(k)]),textures:[]}
    for(let i=0;i<4;i++){gl.activeTexture(gl.TEXTURE0+i);s.textures.push(gl.getParameter(gl.TEXTURE_BINDING_2D))}
    try{return fn(s)}finally{
      gl.bindFramebuffer(gl.FRAMEBUFFER,s.framebuffer);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,s.readFramebuffer);gl.viewport(...s.viewport)
      gl.useProgram(s.program);gl.bindVertexArray(s.vao);gl.colorMask(...s.colorMask)
      gl.blendFuncSeparate(...s.blend.slice(0,4));gl.blendEquationSeparate(...s.blend.slice(4))
      for(const [k,on] of s.flags)on?gl.enable(k):gl.disable(k)
      s.textures.forEach((t,i)=>this.bind(i,t));gl.activeTexture(s.active)
    }
  }
  readState() {
    return this.withState(()=>{
      const gl=this.gl, data=new Float32Array(this.options.count*4)
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.stateFbos[this.current]);gl.readPixels(0,0,this.options.count,1,gl.RGBA,gl.FLOAT,data)
      return Array.from(data)
    })
  }
  readHistory() {
    return this.withState(()=>{
      const gl=this.gl, fbo=gl.createFramebuffer(), data=new Float32Array(this.options.count*this.options.history*4)
      gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.historyTexture,0)
      gl.readPixels(0,0,this.options.count,this.options.history,gl.RGBA,gl.FLOAT,data);gl.deleteFramebuffer(fbo)
      return Array.from(data)
    })
  }
  diagnostics() {
    const summarize=values=>{
      if(!values.length)return null
      const sorted=[...values].sort((a,b)=>a-b), mean=values.reduce((a,b)=>a+b)/values.length
      return {samples:values.length,mean,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],stddev:Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length)}
    }
    const o=this.options, gl=this.gl
    return {...this.stats,steps:this.steps,elapsed:this.steps*STEP,pending:this.pendingSteps,options:o,seed:this.seed,
      frameMs:summarize(this.frameTimes),cpuSubmitMs:summarize(this.cpuTimes),gpuMs:summarize(this.gpuTimes),
      drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],historyTexture:[o.count,o.history],historyBytes:o.count*o.history*16,
      stateBytes:o.count*2*16,windTextureBytes:this.grid.width*this.grid.height*4*(this.previousTexture===this.windTexture?1:2),
      renderer:this.renderer}
  }
  onRemove() {
    const gl=this.gl
    for(const t of new Set([...this.stateTextures,this.historyTexture,this.windTexture,this.previousTexture])) gl.deleteTexture(t)
    for(const f of this.stateFbos)gl.deleteFramebuffer(f)
    for(const p of [this.simulation,...this.programs.values()])gl.deleteProgram(p.p)
    for(const q of this.queries)gl.deleteQuery(q)
    gl.deleteVertexArray(this.vao)
  }
}
