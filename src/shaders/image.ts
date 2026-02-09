export const shaderCode = /* wgsl */ `
@vertex
fn main_vert(@builtin(vertex_index) index: u32) -> VertexOutput {
  const vertices = array<vec2f, 4>(
    vec2f(-1.0, -1.0), // Bottom-left
    vec2f(-1.0,  1.0), // Top-left
    vec2f( 1.0, -1.0), // Bottom-right
    vec2f( 1.0,  1.0)  // Top-right
  );

  let pos = vertices[index];
  var output: VertexOutput;
  output.position = vec4f(pos, 0.0, 1.0);

  output.uv = vec2f((pos.x + 1.0) * 0.5, 1.0 - (pos.y + 1.0) * 0.5);
  return output;
}

@fragment
fn main_frag(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = textureSample(inTexture, inSampler, uv).rgb;
  let inputLuminance = dot(color, vec3f(0.299, 0.587, 0.114));
  let normColor = clamp(color, vec3f(0.0), vec3f(1.0));

  let exposureBiased = adjustments.exposure * 0.25;
  let exposureColor = clamp(normColor * pow(2.0, exposureBiased), vec3f(0.0), vec3f(2.0));
  let exposureLuminance = clamp(inputLuminance * pow(2.0, exposureBiased), 0.0, 2.0);

  let contrastColor = (exposureColor - vec3f(0.5)) * adjustments.contrast + vec3f(0.5);
  let contrastLuminance = (exposureLuminance - 0.5) * adjustments.contrast + 0.5;
  let contrastColorLuminance = dot(contrastColor, vec3f(0.299, 0.587, 0.114));

  let highlightShift = adjustments.highlights - 1.0;
  let highlightBiased = select(highlightShift * 0.25, highlightShift, adjustments.highlights >= 1.0);
  let highlightFactor = 1.0 + highlightBiased * 0.5 * contrastColorLuminance;
  let highlightWeight = smoothstep(0.5, 1.0, contrastColorLuminance);
  let highlightLuminanceAdjust = contrastLuminance * highlightFactor;
  let highlightLuminance = mix(contrastLuminance, clamp(highlightLuminanceAdjust, 0.0, 1.0), highlightWeight);
  let highlightColor = mix(contrastColor, clamp(contrastColor * highlightFactor, vec3f(0.0), vec3f(1.0)), highlightWeight);

  let shadowWeight = 1.0 - contrastColorLuminance;
  let shadowAdjust = pow(highlightColor, vec3f(1.0 / adjustments.shadows));
  let shadowLuminanceAdjust = pow(highlightLuminance, 1.0 / adjustments.shadows);

  let toneColor = mix(highlightColor, shadowAdjust, shadowWeight);
  let toneLuminance = mix(highlightLuminance, shadowLuminanceAdjust, shadowWeight);

  let finalToneColor = clamp(toneColor, vec3f(0.0), vec3f(1.0));
  let grayscaleColor = vec3f(toneLuminance);
  let finalColor = mix(grayscaleColor, finalToneColor, adjustments.saturation);

  return vec4f(finalColor, 1.0);
}
`;
