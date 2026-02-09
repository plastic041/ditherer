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
import { shaderCode } from "../shaders/image.ts";

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

function onCleanup() {
  root.destroy();
}

function setBufferValue(key: keyof typeof adjustmentsBuffer.dataType.propTypes, value: number) {
  adjustmentsBuffer.writePartial({ [key]: value });
  render();
}

onMounted(async () => {
  await ready();
  adjustmentsBuffer.writePartial({ exposure: 1 });
  adjustmentsBuffer.writePartial({ highlights: 1 });
  adjustmentsBuffer.writePartial({ saturation: 1 });
  adjustmentsBuffer.writePartial({ shadows: 1 });
  adjustmentsBuffer.writePartial({ contrast: 1 });
  init();
});

onUnmounted(() => {
  onCleanup();
});
</script>

<template>
  <canvas />
  <div class="flex flex-col">
    <label>
      Exposure
      <input
        type="range"
        min="-2"
        max="2"
        step="0.1"
        defaultValue="1"
        @input="
          (e) => {
            setBufferValue('exposure', (e.currentTarget as HTMLInputElement).valueAsNumber);
          }
        "
      />
    </label>
    <label>
      Highlights
      <input
        type="range"
        min="0"
        max="2"
        step="0.1"
        defaultValue="1"
        @input="
          (e) => {
            setBufferValue('highlights', (e.currentTarget as HTMLInputElement).valueAsNumber);
          }
        "
      />
    </label>
    <label>
      Saturation
      <input
        type="range"
        min="0"
        max="2"
        step="0.1"
        defaultValue="1"
        @input="
          (e) => {
            setBufferValue('saturation', (e.currentTarget as HTMLInputElement).valueAsNumber);
          }
        "
      />
    </label>
    <label>
      Shadows
      <input
        type="range"
        min="0.1"
        max="1.9"
        step="0.1"
        defaultValue="1"
        @input="
          (e) => {
            setBufferValue('shadows', (e.currentTarget as HTMLInputElement).valueAsNumber);
          }
        "
      />
    </label>
    <label>
      Contrast
      <input
        type="range"
        min="0"
        max="2"
        step="0.1"
        defaultValue="1"
        @input="
          (e) => {
            setBufferValue('contrast', (e.currentTarget as HTMLInputElement).valueAsNumber);
          }
        "
      />
    </label>
  </div>
</template>
