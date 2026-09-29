// Thin WebGL2 helpers: program compilation with readable errors, render targets, texture arrays.

export interface Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string, name: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`render: could not create shader ${name}`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    const numbered = source
      .split('\n')
      .map((l, i) => `${String(i + 1).padStart(3)} ${l}`)
      .join('\n');
    gl.deleteShader(shader);
    throw new Error(`render: ${name} ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader failed:\n${log}\n${numbered}`);
  }
  return shader;
}

/** Compile + link a program and look up the named uniforms. */
export function createProgram(gl: WebGL2RenderingContext, name: string, vs: string, fs: string, uniforms: string[]): Program {
  const v = compileShader(gl, gl.VERTEX_SHADER, vs, name);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs, name);
  const program = gl.createProgram();
  if (!program) throw new Error(`render: could not create program ${name}`);
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`render: ${name} link failed: ${gl.getProgramInfoLog(program) ?? ''}`);
  }
  const locations: Record<string, WebGLUniformLocation | null> = {};
  for (const u of uniforms) locations[u] = gl.getUniformLocation(program, u);
  return { program, uniforms: locations };
}

export interface ColorFormat {
  internal: number;
  format: number;
  type: number;
}

export function rgba8(gl: WebGL2RenderingContext): ColorFormat {
  return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
}

export function rgba16f(gl: WebGL2RenderingContext): ColorFormat {
  return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
}

/** Immutable single-level 2D texture for use as a render target. */
export function createTargetTexture(gl: WebGL2RenderingContext, w: number, h: number, fmt: ColorFormat, linear: boolean): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('render: createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, fmt.internal, w, h);
  const filter = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Framebuffer with the given colour attachments (in order). Returns null if incomplete. */
export function createFramebuffer(gl: WebGL2RenderingContext, textures: WebGLTexture[]): WebGLFramebuffer | null {
  const fb = gl.createFramebuffer();
  if (!fb) return null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const buffers: number[] = [];
  textures.forEach((t, i) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    buffers.push(gl.COLOR_ATTACHMENT0 + i);
  });
  gl.drawBuffers(buffers);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteFramebuffer(fb);
    return null;
  }
  return fb;
}

/** True if RGBA16F targets are renderable (and blendable) on this context. */
export function probeHalfFloatTargets(gl: WebGL2RenderingContext): boolean {
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return false;
  const tex = createTargetTexture(gl, 4, 4, rgba16f(gl), true);
  const fb = createFramebuffer(gl, [tex]);
  const ok = fb !== null;
  if (fb) gl.deleteFramebuffer(fb);
  gl.deleteTexture(tex);
  return ok;
}

/** Mutable RGBA8 texture array (nearest), allocated with `layers` layers of size×size. */
export function createTextureArray(gl: WebGL2RenderingContext, size: number, layers: number): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('render: createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 0);
  return tex;
}
