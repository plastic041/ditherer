<script setup lang="ts">
// see https://docs.swmansion.com/TypeGPU/examples/#example=image-processing--image-tuning
import tgpu, {
  type SampledFlag,
  type TgpuBuffer,
  type TgpuRoot,
  type TgpuTexture,
  type UniformFlag,
} from "typegpu";
import * as d from "typegpu/data";
import { onMounted, onUnmounted } from "vue";

const Adjustments = d.struct({
  exposure: d.f32,
  contrast: d.f32,
  highlights: d.f32,
  shadows: d.f32,
  saturation: d.f32,
});

let imageTexture: TgpuTexture<{ size: [number, number]; format: "rgba8unorm" }> & SampledFlag;

let root: TgpuRoot;
let device: GPUDevice;
let context: GPUCanvasContext;
let presentationFormat: GPUTextureFormat;
let adjustmentsBuffer: TgpuBuffer<
  d.WgslStruct<{
    exposure: d.F32;
    contrast: d.F32;
    highlights: d.F32;
    shadows: d.F32;
    saturation: d.F32;
  }>
> &
  UniformFlag;

async function ready() {
  root = await tgpu.init();
  device = root.device;
  const canvas = document.querySelector("canvas") as HTMLCanvasElement;
  context = canvas.getContext("webgpu") as GPUCanvasContext;
  presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format: presentationFormat,
    alphaMode: "premultiplied",
  });

  adjustmentsBuffer = root.createBuffer(Adjustments).$usage("uniform");
}

const shaderCode = /* wgsl */ `
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

function render() {
  const uniformLayout = tgpu.bindGroupLayout({
    adjustments: { uniform: Adjustments },
  });

  const renderLayout = tgpu.bindGroupLayout({
    inTexture: { texture: d.texture2d(d.f32) },
    inSampler: { sampler: "filtering" },
  });

  const imageSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  const uniformBindGroup = root.createBindGroup(uniformLayout, {
    adjustments: adjustmentsBuffer,
  });

  const renderBindGroup = root.createBindGroup(renderLayout, {
    inTexture: imageTexture.createView(d.texture2d(d.f32)),
    inSampler: imageSampler,
  });

  const shaderModule = device.createShaderModule({
    code: tgpu.resolve({
      template: shaderCode,
      externals: {
        VertexOutput: d.struct({
          position: d.builtin.position,
          uv: d.location(0, d.vec2f),
        }),
        ...uniformLayout.bound,
        ...renderLayout.bound,
      },
    }),
  });

  const renderPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [root.unwrap(uniformLayout), root.unwrap(renderLayout)],
    }),
    vertex: { module: shaderModule },
    fragment: {
      module: shaderModule,
      targets: [{ format: presentationFormat }],
    },
    primitive: {
      topology: "triangle-strip",
    },
  });

  const renderPassDescriptor: GPURenderPassDescriptor = {
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        clearValue: [0, 0, 0, 1],
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  };

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass(renderPassDescriptor);
  pass.setPipeline(renderPipeline);
  pass.setBindGroup(0, root.unwrap(uniformBindGroup));
  pass.setBindGroup(1, root.unwrap(renderBindGroup));
  pass.draw(4);
  pass.end();

  device.queue.submit([encoder.finish()]);
}

async function init() {
  const response = await fetch("/images/test_image.jpeg");
  const imageBitmap = await createImageBitmap(await response.blob());
  const [srcWidth, srcHeight] = [imageBitmap.width, imageBitmap.height];

  imageTexture = root["~unstable"]
    .createTexture({
      size: [srcWidth, srcHeight],
      format: "rgba8unorm",
    })
    .$usage("sampled", "render");

  device.queue.copyExternalImageToTexture(
    { source: imageBitmap },
    { texture: root.unwrap(imageTexture) },
    [srcWidth, srcHeight],
  );

  render();
}

// const controls = {
//   exposure: {
//     initial: 0.0,
//     min: -2.0,
//     max: 2.0,
//     step: 0.1,
//     onSliderChange(value: number) {
//       adjustmentsBuffer.writePartial({ exposure: value });
//       loop();
//     },
//   },
//   contrast: {
//     initial: 1.0,
//     min: 0.0,
//     max: 2.0,
//     step: 0.1,
//     onSliderChange(value: number) {
//       adjustmentsBuffer.writePartial({ contrast: value });
//       loop();
//     },
//   },
//   highlights: {
//     initial: 1.0,
//     min: 0.0,
//     max: 2.0,
//     step: 0.1,
//     onSliderChange(value: number) {
//       adjustmentsBuffer.writePartial({ highlights: value });
//       loop();
//     },
//   },
//   shadows: {
//     initial: 1.0,
//     min: 0.1,
//     max: 1.9,
//     step: 0.1,
//     onSliderChange(value: number) {
//       adjustmentsBuffer.writePartial({ shadows: value });
//       loop();
//     },
//   },
//   saturation: {
//     initial: 1.0,
//     min: 0.0,
//     max: 2.0,
//     step: 0.1,
//     onSliderChange(value: number) {
//       adjustmentsBuffer.writePartial({ saturation: value });
//       loop();
//     },
//   },
// };

function onCleanup() {
  root.destroy();
}

onMounted(async () => {
  await ready();
  adjustmentsBuffer.writePartial({ contrast: 1 });
  adjustmentsBuffer.writePartial({ exposure: 1 });
  adjustmentsBuffer.writePartial({ highlights: 1 });
  adjustmentsBuffer.writePartial({ saturation: 1 });
  adjustmentsBuffer.writePartial({ shadows: 1 });
  init();
});

onUnmounted(() => {
  onCleanup();
});
</script>

<template>
  <canvas />
</template>
