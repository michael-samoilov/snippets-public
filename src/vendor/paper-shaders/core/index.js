/* Local re-export barrel for the vendored Paper Shaders core
   (only what the PaperTexture chain needs). */
export { ShaderMount, isPaperShaderElement } from "./shader-mount.js";
export { emptyPixel } from "./empty-pixel.js";
export { defaultObjectSizing, defaultPatternSizing, ShaderFitOptions } from "./shader-sizing.js";
export { getShaderColorFromString } from "./get-shader-color-from-string.js";
export { getShaderNoiseTexture } from "./get-shader-noise-texture.js";
export { paperTextureFragmentShader } from "./shaders/paper-texture.js";
