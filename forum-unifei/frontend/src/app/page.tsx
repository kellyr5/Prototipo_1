'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';

// ============================================
// WEBGL FLUID SIMULATION - FORMATO VARIÁVEL
// ============================================

class FluidSimulation {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  programs: any = {};
  framebuffers: any = {};
  pointers: any[] = [];
  config: any;
  lastTime: number = 0;
  
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL not supported');
    this.gl = gl;
    
    this.config = {
      SIM_RESOLUTION: 128,
      DYE_RESOLUTION: 512,
      DENSITY_DISSIPATION: 0.95,
      VELOCITY_DISSIPATION: 0.97,
      PRESSURE_DISSIPATION: 0.8,
      PRESSURE_ITERATIONS: 20,
      CURL: 35,
      SPLAT_RADIUS: 0.15,
      SPLAT_FORCE: 6000,
    };
    
    this.pointers = [{ 
      id: -1, x: 0, y: 0, dx: 0, dy: 0, 
      prevX: 0, prevY: 0,
      down: false, moved: false, 
      color: { r: 0.3, g: 0.5, b: 1.0 },
      speed: 0,
      angle: 0
    }];
    
    this.initWebGL();
  }
  
  initWebGL() {
    const gl = this.gl;
    
    gl.getExtension('OES_texture_half_float');
    gl.getExtension('OES_texture_half_float_linear');
    
    const baseVertexShader = this.compileShader(gl.VERTEX_SHADER, `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform vec2 texelSize;
      void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `);
    
    const clearShader = this.compileShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D uTexture;
      uniform float value;
      varying vec2 vUv;
      void main () {
        gl_FragColor = value * texture2D(uTexture, vUv);
      }
    `);
    
    // Display shader com mais contraste e brilho
    const displayShader = this.compileShader(gl.FRAGMENT_SHADER, `
      precision highp float;
      uniform sampler2D uTexture;
      varying vec2 vUv;
      void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        // Aumentar contraste e brilho
        c = pow(c * 1.5, vec3(0.9));
        float a = max(c.r, max(c.g, c.b));
        // Intensificar alpha
        a = pow(a, 0.7) * 1.3;
        gl_FragColor = vec4(c, a);
      }
    `);
    
    // Splat shader com forma irregular baseada em noise
    const splatShader = this.compileShader(gl.FRAGMENT_SHADER, `
      precision highp float;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;
      uniform float angle;
      uniform float irregularity;
      uniform float time;
      varying vec2 vUv;
      
      // Simplex noise function
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
      
      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m; m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }
      
      void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        
        // Rotacionar baseado na direção do movimento
        float c = cos(angle);
        float s = sin(angle);
        p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
        
        // Deformar com noise para forma irregular
        float noise1 = snoise(p * 15.0 + time) * irregularity;
        float noise2 = snoise(p * 8.0 - time * 0.5) * irregularity * 0.5;
        float noise3 = snoise(p * 25.0 + time * 2.0) * irregularity * 0.3;
        
        // Alongar na direção do movimento
        float stretch = 1.0 + irregularity * 0.8;
        p.x *= stretch;
        p.y /= (1.0 + irregularity * 0.3);
        
        // Distância com perturbação
        float dist = length(p);
        dist += noise1 + noise2 + noise3;
        
        // Criar forma orgânica
        float splat = exp(-dist * dist / radius) * (1.0 + noise1 * 0.5);
        splat = max(splat, 0.0);
        
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat * color, 1.0);
      }
    `);
    
    const advectionShader = this.compileShader(gl.FRAGMENT_SHADER, `
      precision highp float;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform float dt;
      uniform float dissipation;
      varying vec2 vUv;
      void main () {
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        gl_FragColor = dissipation * texture2D(uSource, coord);
        gl_FragColor.a = 1.0;
      }
    `);
    
    const divergenceShader = this.compileShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D uVelocity;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `);
    
    const curlShader = this.compileShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D uVelocity;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
      }
    `);
    
    const vorticityShader = this.compileShader(gl.FRAGMENT_SHADER, `
      precision highp float;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float curl;
      uniform float dt;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;
        vec2 vel = texture2D(uVelocity, vUv).xy;
        gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
      }
    `);
    
    const pressureShader = this.compileShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `);
    
    const gradientSubtractShader = this.compileShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `);
    
    this.programs.clear = this.createProgram(baseVertexShader, clearShader);
    this.programs.display = this.createProgram(baseVertexShader, displayShader);
    this.programs.splat = this.createProgram(baseVertexShader, splatShader);
    this.programs.advection = this.createProgram(baseVertexShader, advectionShader);
    this.programs.divergence = this.createProgram(baseVertexShader, divergenceShader);
    this.programs.curl = this.createProgram(baseVertexShader, curlShader);
    this.programs.vorticity = this.createProgram(baseVertexShader, vorticityShader);
    this.programs.pressure = this.createProgram(baseVertexShader, pressureShader);
    this.programs.gradientSubtract = this.createProgram(baseVertexShader, gradientSubtractShader);
    
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    
    this.initFramebuffers();
  }
  
  compileShader(type: number, source: string) {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }
  
  createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader) {
    const gl = this.gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    const uniforms: any = {};
    const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < uniformCount; i++) {
      const info = gl.getActiveUniform(program, i)!;
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    
    return { program, uniforms };
  }
  
  initFramebuffers() {
    const gl = this.gl;
    const simRes = this.getResolution(this.config.SIM_RESOLUTION);
    const dyeRes = this.getResolution(this.config.DYE_RESOLUTION);
    
    this.framebuffers.velocity = this.createDoubleFBO(simRes.width, simRes.height, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.framebuffers.pressure = this.createDoubleFBO(simRes.width, simRes.height, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.framebuffers.divergence = this.createFBO(simRes.width, simRes.height, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.framebuffers.curl = this.createFBO(simRes.width, simRes.height, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    this.framebuffers.dye = this.createDoubleFBO(dyeRes.width, dyeRes.height, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
  }
  
  getResolution(resolution: number) {
    let aspectRatio = this.gl.canvas.width / this.gl.canvas.height;
    if (aspectRatio < 1) aspectRatio = 1 / aspectRatio;
    const max = Math.round(resolution * aspectRatio);
    const min = Math.round(resolution);
    if (this.gl.canvas.width > this.gl.canvas.height) {
      return { width: max, height: min };
    }
    return { width: min, height: max };
  }
  
  createFBO(w: number, h: number, internalFormat: number, type: number, filter: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, type, null);
    
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    return { texture, fbo, width: w, height: h, attach: (id: number) => { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; } };
  }
  
  createDoubleFBO(w: number, h: number, internalFormat: number, type: number, filter: number) {
    let fbo1 = this.createFBO(w, h, internalFormat, type, filter);
    let fbo2 = this.createFBO(w, h, internalFormat, type, filter);
    return {
      width: w, height: h,
      get read() { return fbo1; },
      set read(v) { fbo1 = v; },
      get write() { return fbo2; },
      set write(v) { fbo2 = v; },
      swap() { const temp = fbo1; fbo1 = fbo2; fbo2 = temp; }
    };
  }
  
  blit(target: any) {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }
  
  // Splat com forma variável baseada na velocidade e direção
  splat(x: number, y: number, dx: number, dy: number, color: { r: number, g: number, b: number }, speed: number, angle: number, time: number) {
    const gl = this.gl;
    
    // Irregularidade baseada na velocidade
    const irregularity = Math.min(speed * 0.15, 0.8);
    
    // Raio menor e variável
    const baseRadius = this.config.SPLAT_RADIUS / 100;
    const radiusVariation = baseRadius * (0.5 + Math.random() * 0.5);
    
    gl.useProgram(this.programs.splat.program);
    gl.uniform1i(this.programs.splat.uniforms.uTarget, this.framebuffers.velocity.read.attach(0));
    gl.uniform1f(this.programs.splat.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
    gl.uniform2f(this.programs.splat.uniforms.point, x, y);
    gl.uniform3f(this.programs.splat.uniforms.color, dx, dy, 0);
    gl.uniform1f(this.programs.splat.uniforms.radius, radiusVariation);
    gl.uniform1f(this.programs.splat.uniforms.angle, angle);
    gl.uniform1f(this.programs.splat.uniforms.irregularity, irregularity);
    gl.uniform1f(this.programs.splat.uniforms.time, time);
    this.blit(this.framebuffers.velocity.write);
    this.framebuffers.velocity.swap();
    
    // Cor mais intensa
    const intensityBoost = 1.5 + speed * 0.3;
    gl.uniform1i(this.programs.splat.uniforms.uTarget, this.framebuffers.dye.read.attach(0));
    gl.uniform3f(this.programs.splat.uniforms.color, color.r * intensityBoost, color.g * intensityBoost, color.b * intensityBoost);
    gl.uniform1f(this.programs.splat.uniforms.radius, radiusVariation * 1.2);
    this.blit(this.framebuffers.dye.write);
    this.framebuffers.dye.swap();
  }
  
  // Criar múltiplos splats para forma mais orgânica
  multiSplat(x: number, y: number, dx: number, dy: number, color: { r: number, g: number, b: number }, speed: number, angle: number, time: number) {
    // Splat principal
    this.splat(x, y, dx, dy, color, speed, angle, time);
    
    // Splats secundários menores e deslocados (cria forma irregular)
    const numSecondary = Math.floor(2 + speed * 2);
    for (let i = 0; i < numSecondary; i++) {
      const offsetAngle = angle + (Math.random() - 0.5) * Math.PI * 0.5;
      const offsetDist = 0.01 + Math.random() * 0.02;
      const ox = x + Math.cos(offsetAngle) * offsetDist;
      const oy = y + Math.sin(offsetAngle) * offsetDist;
      const scale = 0.3 + Math.random() * 0.4;
      
      this.splat(ox, oy, dx * scale, dy * scale, {
        r: color.r * (0.7 + Math.random() * 0.3),
        g: color.g * (0.7 + Math.random() * 0.3),
        b: color.b * (0.7 + Math.random() * 0.3)
      }, speed * scale, offsetAngle, time + i);
    }
  }
  
  step(dt: number) {
    const gl = this.gl;
    
    gl.useProgram(this.programs.curl.program);
    gl.uniform2f(this.programs.curl.uniforms.texelSize, this.framebuffers.velocity.width, this.framebuffers.velocity.height);
    gl.uniform1i(this.programs.curl.uniforms.uVelocity, this.framebuffers.velocity.read.attach(0));
    this.blit(this.framebuffers.curl);
    
    gl.useProgram(this.programs.vorticity.program);
    gl.uniform2f(this.programs.vorticity.uniforms.texelSize, this.framebuffers.velocity.width, this.framebuffers.velocity.height);
    gl.uniform1i(this.programs.vorticity.uniforms.uVelocity, this.framebuffers.velocity.read.attach(0));
    gl.uniform1i(this.programs.vorticity.uniforms.uCurl, this.framebuffers.curl.attach(1));
    gl.uniform1f(this.programs.vorticity.uniforms.curl, this.config.CURL);
    gl.uniform1f(this.programs.vorticity.uniforms.dt, dt);
    this.blit(this.framebuffers.velocity.write);
    this.framebuffers.velocity.swap();
    
    gl.useProgram(this.programs.divergence.program);
    gl.uniform2f(this.programs.divergence.uniforms.texelSize, this.framebuffers.velocity.width, this.framebuffers.velocity.height);
    gl.uniform1i(this.programs.divergence.uniforms.uVelocity, this.framebuffers.velocity.read.attach(0));
    this.blit(this.framebuffers.divergence);
    
    gl.useProgram(this.programs.clear.program);
    gl.uniform1i(this.programs.clear.uniforms.uTexture, this.framebuffers.pressure.read.attach(0));
    gl.uniform1f(this.programs.clear.uniforms.value, this.config.PRESSURE_DISSIPATION);
    this.blit(this.framebuffers.pressure.write);
    this.framebuffers.pressure.swap();
    
    gl.useProgram(this.programs.pressure.program);
    gl.uniform2f(this.programs.pressure.uniforms.texelSize, this.framebuffers.velocity.width, this.framebuffers.velocity.height);
    gl.uniform1i(this.programs.pressure.uniforms.uDivergence, this.framebuffers.divergence.attach(0));
    for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(this.programs.pressure.uniforms.uPressure, this.framebuffers.pressure.read.attach(1));
      this.blit(this.framebuffers.pressure.write);
      this.framebuffers.pressure.swap();
    }
    
    gl.useProgram(this.programs.gradientSubtract.program);
    gl.uniform2f(this.programs.gradientSubtract.uniforms.texelSize, this.framebuffers.velocity.width, this.framebuffers.velocity.height);
    gl.uniform1i(this.programs.gradientSubtract.uniforms.uPressure, this.framebuffers.pressure.read.attach(0));
    gl.uniform1i(this.programs.gradientSubtract.uniforms.uVelocity, this.framebuffers.velocity.read.attach(1));
    this.blit(this.framebuffers.velocity.write);
    this.framebuffers.velocity.swap();
    
    gl.useProgram(this.programs.advection.program);
    gl.uniform2f(this.programs.advection.uniforms.texelSize, 1 / this.framebuffers.velocity.width, 1 / this.framebuffers.velocity.height);
    gl.uniform1i(this.programs.advection.uniforms.uVelocity, this.framebuffers.velocity.read.attach(0));
    gl.uniform1i(this.programs.advection.uniforms.uSource, this.framebuffers.velocity.read.attach(0));
    gl.uniform1f(this.programs.advection.uniforms.dt, dt);
    gl.uniform1f(this.programs.advection.uniforms.dissipation, this.config.VELOCITY_DISSIPATION);
    this.blit(this.framebuffers.velocity.write);
    this.framebuffers.velocity.swap();
    
    gl.uniform2f(this.programs.advection.uniforms.texelSize, 1 / this.framebuffers.dye.width, 1 / this.framebuffers.dye.height);
    gl.uniform1i(this.programs.advection.uniforms.uVelocity, this.framebuffers.velocity.read.attach(0));
    gl.uniform1i(this.programs.advection.uniforms.uSource, this.framebuffers.dye.read.attach(1));
    gl.uniform1f(this.programs.advection.uniforms.dissipation, this.config.DENSITY_DISSIPATION);
    this.blit(this.framebuffers.dye.write);
    this.framebuffers.dye.swap();
  }
  
  render() {
    const gl = this.gl;
    gl.useProgram(this.programs.display.program);
    gl.uniform1i(this.programs.display.uniforms.uTexture, this.framebuffers.dye.read.attach(0));
    this.blit(null);
  }
  
  updatePointer(x: number, y: number, time: number) {
    const pointer = this.pointers[0];
    pointer.prevX = pointer.x;
    pointer.prevY = pointer.y;
    pointer.x = x / this.canvas.width;
    pointer.y = 1 - y / this.canvas.height;
    pointer.dx = (pointer.x - pointer.prevX) * this.config.SPLAT_FORCE;
    pointer.dy = (pointer.y - pointer.prevY) * this.config.SPLAT_FORCE;
    
    // Calcular velocidade e ângulo
    pointer.speed = Math.sqrt(pointer.dx * pointer.dx + pointer.dy * pointer.dy);
    pointer.angle = Math.atan2(pointer.dy, pointer.dx);
    
    pointer.moved = pointer.speed > 0.1;
    this.lastTime = time;
  }
  
  applyInputs(time: number) {
    const pointer = this.pointers[0];
    if (pointer.moved) {
      pointer.moved = false;
      this.multiSplat(pointer.x, pointer.y, pointer.dx, pointer.dy, pointer.color, pointer.speed / 1000, pointer.angle, time);
    }
  }
  
  resize() {
    const gl = this.gl;
    const width = gl.canvas.clientWidth;
    const height = gl.canvas.clientHeight;
    if (gl.canvas.width !== width || gl.canvas.height !== height) {
      gl.canvas.width = width;
      gl.canvas.height = height;
      this.initFramebuffers();
    }
  }
}

// ============================================
// COMPONENTE FLUID CANVAS
// ============================================

function FluidCanvas({ onFluidReady }: { onFluidReady?: (fluid: FluidSimulation) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fluidRef = useRef<FluidSimulation | null>(null);
  
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const fluid = new FluidSimulation(canvasRef.current);
    fluidRef.current = fluid;
    onFluidReady?.(fluid);
    
    let lastTime = Date.now();
    let animationId: number;
    let time = 0;
    
    const animate = () => {
      const now = Date.now();
      const dt = Math.min((now - lastTime) / 1000, 0.016);
      lastTime = now;
      time += dt;
      
      fluid.resize();
      fluid.applyInputs(time);
      fluid.step(dt);
      fluid.render();
      
      animationId = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => cancelAnimationFrame(animationId);
  }, [onFluidReady]);
  
  return (
    <canvas 
      ref={canvasRef} 
      className="absolute inset-0 w-full h-full"
      style={{ mixBlendMode: 'screen' }}
    />
  );
}

// ============================================
// LOGO UNIFEI WIREFRAME
// ============================================

const LogoWireframe = ({ time }: { time: number }) => {
  const pulse = Math.sin(time * 0.8) * 2;

  return (
    <svg className="w-full h-full" viewBox="0 0 400 420" fill="none">
      <g style={{ transform: `rotate(${time * 6}deg)`, transformOrigin: '200px 190px' }}>
        <circle cx="200" cy="190" r={148 + pulse} stroke="#1a2332" strokeWidth="2.5" fill="none" />
        {Array.from({ length: 28 }).map((_, i) => {
          const angle = (i / 28) * Math.PI * 2;
          const r1 = 148 + pulse;
          const r2 = 168 + pulse;
          const x1 = 200 + Math.cos(angle) * r1;
          const y1 = 190 + Math.sin(angle) * r1;
          const x2 = 200 + Math.cos(angle) * r2;
          const y2 = 190 + Math.sin(angle) * r2;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#252f3f" strokeWidth={i % 2 === 0 ? 3 : 1.5} strokeLinecap="round" opacity="0.6" />;
        })}
      </g>
      <g style={{ transform: `rotate(${-time * 10}deg)`, transformOrigin: '200px 190px' }}>
        <circle cx="200" cy="190" r={118 + pulse * 0.5} stroke="#1a2332" strokeWidth="1.5" fill="none" opacity="0.5" strokeDasharray="15 8" />
      </g>
      <circle cx="200" cy="190" r="68" stroke="#1a2332" strokeWidth="1" fill="none" opacity="0.3" />
      <path d="M160 140 L240 140 L240 160 L185 160 L185 180 L230 180 L230 200 L185 200 L185 220 L240 220 L240 240 L160 240 Z" stroke="#252f3f" strokeWidth="1.5" fill="none" opacity="0.4" />
      <path d="M268 88 L235 168 L270 168 L230 285 L242 285 L218 340 L255 255 L220 255 L250 175 L215 175 L250 110 L232 110 Z" stroke="#2d3a4d" strokeWidth="1.5" fill="none" opacity="0.35" />
      <text x="200" y="390" textAnchor="middle" stroke="#252f3f" strokeWidth="0.8" fill="none" fontSize="28" fontWeight="600" fontFamily="system-ui" opacity="0.4" letterSpacing="10">UNIFEI</text>
    </svg>
  );
};

// ============================================
// LOGO UNIFEI COLORIDA
// ============================================

const LogoColored = ({ time }: { time: number }) => {
  const pulse = Math.sin(time * 0.8) * 2;

  return (
    <svg className="w-full h-full" viewBox="0 0 400 420" fill="none">
      <defs>
        <linearGradient id="metalBlue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#93c5fd" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id="metalRed" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fca5a5" />
          <stop offset="50%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#b91c1c" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="strongGlow">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      
      <circle cx="200" cy="190" r="175" fill="#0c1322" opacity="0.6" />
      
      <g style={{ transform: `rotate(${time * 6}deg)`, transformOrigin: '200px 190px' }} filter="url(#glow)">
        <circle cx="200" cy="190" r={148 + pulse} stroke="url(#metalBlue)" strokeWidth="5" fill="none" />
        {Array.from({ length: 28 }).map((_, i) => {
          const angle = (i / 28) * Math.PI * 2;
          const r1 = 148 + pulse;
          const r2 = 170 + pulse;
          const x1 = 200 + Math.cos(angle) * r1;
          const y1 = 190 + Math.sin(angle) * r1;
          const x2 = 200 + Math.cos(angle) * r2;
          const y2 = 190 + Math.sin(angle) * r2;
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="url(#metalBlue)" strokeWidth={i % 2 === 0 ? 5 : 3} strokeLinecap="round" opacity={0.7 + Math.sin(time * 2 + i * 0.25) * 0.3} />
              {i % 2 === 0 && <circle cx={x2} cy={y2} r="5" fill="url(#metalBlue)" />}
            </g>
          );
        })}
      </g>
      
      <g style={{ transform: `rotate(${-time * 10}deg)`, transformOrigin: '200px 190px' }}>
        <circle cx="200" cy="190" r={118 + pulse * 0.5} stroke="#3b82f6" strokeWidth="3" fill="none" opacity="0.7" strokeDasharray="20 10" />
      </g>
      
      <circle cx="200" cy="190" r="68" fill="#0c1322" />
      <circle cx="200" cy="190" r="68" stroke="url(#metalBlue)" strokeWidth="2" fill="none" opacity="0.6" />
      
      <g filter="url(#strongGlow)">
        <path d="M160 140 L240 140 L240 160 L185 160 L185 180 L230 180 L230 200 L185 200 L185 220 L240 220 L240 240 L160 240 Z" fill="url(#metalBlue)" />
      </g>
      
      <g filter="url(#strongGlow)">
        <path d="M268 88 L235 168 L270 168 L230 285 L242 285 L218 340 L255 255 L220 255 L250 175 L215 175 L250 110 L232 110 Z" fill="url(#metalRed)" />
      </g>
      
      <text x="200" y="395" textAnchor="middle" fill="url(#metalBlue)" fontSize="30" fontWeight="700" fontFamily="system-ui" letterSpacing="8" filter="url(#glow)">UNIFEI</text>
    </svg>
  );
};

// ============================================
// COMPONENTE PRINCIPAL DE REVELAÇÃO
// ============================================

function FluidReveal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const fluidRef = useRef<FluidSimulation | null>(null);
  const [time, setTime] = useState(0);
  const timeRef = useRef(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      timeRef.current += 0.016;
      setTime(timeRef.current);
    }, 16);
    return () => clearInterval(interval);
  }, []);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !fluidRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    fluidRef.current.updatePointer(e.clientX - rect.left, e.clientY - rect.top, timeRef.current);
  }, []);
  
  const handleFluidReady = useCallback((fluid: FluidSimulation) => {
    fluidRef.current = fluid;
  }, []);

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full"
      onMouseMove={handleMouseMove}
    >
      <div className="absolute inset-0 bg-[#040608]" />
      
      <div className="absolute inset-0 flex items-center justify-center z-10">
        <div className="w-[480px] h-[500px]">
          <LogoWireframe time={time} />
        </div>
      </div>
      
      <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none" style={{ mixBlendMode: 'lighten' }}>
        <div className="w-[480px] h-[500px]">
          <LogoColored time={time} />
        </div>
      </div>
      
      <div className="absolute inset-0 z-30" style={{ mixBlendMode: 'multiply', opacity: 0.85 }}>
        <FluidCanvas onFluidReady={handleFluidReady} />
      </div>
      
      <div className="absolute inset-0 z-40 pointer-events-none" style={{ background: 'radial-gradient(circle at center, transparent 20%, rgba(4,6,8,0.4) 60%)' }} />
    </div>
  );
}

// ============================================
// ÍCONES
// ============================================

const IconMessage = () => (<svg className="w-full h-full" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>);
const IconBuilding = () => (<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>);
const IconMail = () => (<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>);
const IconLock = () => (<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>);
const IconEye = () => (<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>);
const IconEyeOff = () => (<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>);
const IconArrow = () => (<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>);
const IconGithub = () => (<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>);
const IconGoogle = () => (<svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>);

// ============================================
// PÁGINA PRINCIPAL
// ============================================

export default function LoginPage() {
  const [matricula, setMatricula] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [tipoLogin, setTipoLogin] = useState<'sso' | 'email'>('sso');
  const [carregando, setCarregando] = useState(false);
  const [lembrarMe, setLembrarMe] = useState(false);

  const formatarMatricula = (value: string) => {
    const nums = value.replace(/\D/g, '');
    if (nums.length <= 4) return nums;
    if (nums.length <= 5) return `${nums.slice(0, 4)}.${nums.slice(4)}`;
    return `${nums.slice(0, 4)}.${nums.slice(4, 5)}.${nums.slice(5, 8)}`;
  };

  const handleMatriculaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatarMatricula(e.target.value);
    if (formatted.replace(/\D/g, '').length <= 8) setMatricula(formatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCarregando(true);
    await new Promise(r => setTimeout(r, 2000));
    setCarregando(false);
  };

  return (
    <div className="min-h-screen flex relative overflow-hidden bg-[#040608]">
      <div className="hidden lg:flex lg:w-[55%] relative">
        <FluidReveal />

        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-10 z-50">
          <motion.div className="pointer-events-auto" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500/10 backdrop-blur-sm border border-blue-500/20 rounded-xl flex items-center justify-center text-blue-400">
                <div className="w-5 h-5"><IconMessage /></div>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white">Forum <span className="text-blue-400">UNIFEI</span></h1>
                <p className="text-slate-500 text-xs">Conhecimento Compartilhado</p>
              </div>
            </div>
          </motion.div>

          <motion.div className="pointer-events-auto" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <p className="text-blue-400/60 text-sm mb-4">✨ Mova o cursor para revelar</p>
            <h2 className="text-3xl font-light text-white mb-2">Conecte-se.<span className="text-slate-500"> Aprenda.</span><span className="text-slate-600"> Evolua.</span></h2>
            <p className="text-slate-500 text-sm max-w-md mb-6">A comunidade dos estudantes de computação da UNIFEI.</p>
            <div className="flex gap-6">
              {[{ value: '2.4K', label: 'Perguntas' }, { value: '850+', label: 'Estudantes' }, { value: '98%', label: 'Resolvidas' }].map((stat) => (
                <div key={stat.label}>
                  <div className="text-xl font-semibold text-white">{stat.value}</div>
                  <div className="text-slate-600 text-xs">{stat.label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        <div className="absolute right-0 top-0 bottom-0 w-40 bg-gradient-to-l from-[#040608] to-transparent pointer-events-none z-50" />
      </div>

      <div className="w-full lg:w-[45%] flex items-center justify-center relative px-8 lg:px-16 z-50 bg-[#040608]">
        <motion.div className="relative w-full max-w-sm" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
          <div className="lg:hidden mb-10 text-center">
            <div className="inline-flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center text-blue-400">
                <div className="w-5 h-5"><IconMessage /></div>
              </div>
              <span className="text-lg font-semibold text-white">Forum UNIFEI</span>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-white mb-1">Bem-vindo</h2>
            <p className="text-slate-500 text-sm">Acesse sua conta para continuar</p>
          </div>

          <div className="flex p-1 mb-6 bg-slate-900/50 rounded-xl border border-slate-800/50">
            {[{ key: 'sso', label: 'SSO UNIFEI', icon: <IconBuilding /> }, { key: 'email', label: 'Email', icon: <IconMail /> }].map((opt) => (
              <button key={opt.key} onClick={() => setTipoLogin(opt.key as 'sso' | 'email')} className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${tipoLogin === opt.key ? 'bg-blue-500 text-white' : 'text-slate-400 hover:text-slate-300'}`}>
                {opt.icon}{opt.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm text-slate-400 mb-2 flex items-center gap-1.5">
                {tipoLogin === 'sso' ? <IconBuilding /> : <IconMail />}
                {tipoLogin === 'sso' ? 'Matrícula' : 'Email'}
              </label>
              <input type={tipoLogin === 'sso' ? 'text' : 'email'} value={matricula} onChange={tipoLogin === 'sso' ? handleMatriculaChange : (e) => setMatricula(e.target.value)} placeholder={tipoLogin === 'sso' ? '2022.1.001' : 'd20221001@unifei.edu.br'} className="w-full px-4 py-3 bg-slate-900/30 border border-slate-800/50 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 transition-colors" required />
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-2 flex items-center gap-1.5"><IconLock /> Senha</label>
              <div className="relative">
                <input type={mostrarSenha ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Digite sua senha" className="w-full px-4 py-3 pr-10 bg-slate-900/30 border border-slate-800/50 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 transition-colors" required />
                <button type="button" onClick={() => setMostrarSenha(!mostrarSenha)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {mostrarSenha ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={lembrarMe} onChange={(e) => setLembrarMe(e.target.checked)} className="checkbox-custom" />
                <span className="text-sm text-slate-500">Lembrar-me</span>
              </label>
              <a href="#" className="text-sm text-blue-400 hover:text-blue-300">Esqueceu?</a>
            </div>

            <motion.button type="submit" disabled={carregando} className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
              {carregando ? <motion.div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} /> : <>Entrar <IconArrow /></>}
            </motion.button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800/50" /></div>
            <div className="relative flex justify-center"><span className="px-4 bg-[#040608] text-slate-600 text-sm">ou</span></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[{ icon: <IconGoogle />, label: 'Google' }, { icon: <IconGithub />, label: 'GitHub' }].map((s) => (
              <button key={s.label} className="flex items-center justify-center gap-2 py-2.5 bg-slate-900/30 border border-slate-800/30 rounded-xl text-slate-400 hover:text-white hover:border-slate-700/50 transition-all">
                {s.icon}<span className="text-sm">{s.label}</span>
              </button>
            ))}
          </div>

          <p className="mt-8 text-center text-slate-500 text-sm">Novo por aqui? <a href="#" className="text-blue-400 hover:text-blue-300">Criar conta</a></p>
        </motion.div>
      </div>
    </div>
  );
}
