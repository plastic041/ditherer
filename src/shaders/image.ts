export const shaderCode = /* wgsl */ `
// basic image adjustments code is from
// https://docs.swmansion.com/TypeGPU/examples/#example=image-processing--image-tuning
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

const bayerIndex = mat4x4<f32>(
    vec4<f32>(00.0/16.0, 12.0/16.0, 03.0/16.0, 15.0/16.0),
    vec4<f32>(08.0/16.0, 04.0/16.0, 11.0/16.0, 07.0/16.0),
    vec4<f32>(02.0/16.0, 14.0/16.0, 01.0/16.0, 13.0/16.0),
    vec4<f32>(10.0/16.0, 06.0/16.0, 09.0/16.0, 05.0/16.0)
);

@fragment
fn main_frag(
  @location(0) uv: vec2f,
  @builtin(position) fragCoord: vec4<f32>
) -> @location(0) vec4f {
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
  let grayscale = mix(highlightLuminance, shadowLuminanceAdjust, shadowWeight);
  
  let bayerValue = bayerIndex[i32(fragCoord.x) % 4][i32(fragCoord.y) % 4];
  let ditheredColor = vec3f(step(bayerValue, grayscale));

  return vec4f(ditheredColor, 1.0);
}
`;
