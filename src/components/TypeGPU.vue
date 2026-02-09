<script setup lang="ts">
import tgpu, {
  type SampledFlag,
  type TgpuBuffer,
  type TgpuRoot,
  type TgpuTexture,
  type UniformFlag,
} from "typegpu";
import * as d from "typegpu/data";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { shaderCode } from "../shaders/image.ts";
import Slider from "@/components/ui/slider/Slider.vue";
import Button from "@/components/ui/button/Button.vue";
import { MinusIcon, PlusIcon } from "lucide-vue-next";

const Adjustments = d.struct({
  exposure: d.f32,
  contrast: d.f32,
  highlights: d.f32,
  shadows: d.f32,
  orderedMatrixArray: d.arrayOf(d.f32, 100),
  matrixWidth: d.i32,
  matrixHeight: d.i32,
});

let imageTexture: TgpuTexture<{ size: [number, number]; format: "rgba8unorm" }> & SampledFlag;

let canvas: HTMLCanvasElement;
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
    orderedMatrixArray: d.WgslArray<d.F32>;
    matrixWidth: d.I32;
    matrixHeight: d.I32;
  }>
> &
  UniformFlag;

type AdjustmentsKey = Exclude<
  keyof typeof adjustmentsBuffer.dataType.propTypes,
  "matrixHeight" | "matrixWidth" | "orderedMatrixArray"
>;

const ADJUSTMENTS_CONTROLS: {
  key: AdjustmentsKey;
  min: number;
  max: number;
  step: number;
  defaultValue: [number];
  onUpdate: (value: number[] | undefined) => void;
}[] = [
  {
    key: "exposure",
    min: -2,
    max: 2,
    step: 0.01,
    defaultValue: [1],
    onUpdate: (value) => {
      if (value) setBufferValue("exposure", value[0]!);
    },
  },
  {
    key: "contrast",
    min: 0,
    max: 2,
    step: 0.01,
    defaultValue: [1],
    onUpdate: (value) => {
      if (value) setBufferValue("contrast", value[0]!);
    },
  },
  {
    key: "highlights",
    min: 0,
    max: 2,
    step: 0.01,
    defaultValue: [1],
    onUpdate: (value) => {
      if (value) setBufferValue("highlights", value[0]!);
    },
  },
  {
    key: "shadows",
    min: 0.1,
    max: 1.9,
    step: 0.01,
    defaultValue: [1],
    onUpdate: (value) => {
      if (value) setBufferValue("shadows", value[0]!);
    },
  },
] as const;
const adjustmentsValues = ref<Record<AdjustmentsKey, number>>({
  contrast: 1,
  exposure: 1,
  highlights: 1,
  shadows: 1,
});

// prettier-ignore
const orderedMatrix = [
  [ 0, 12,  3, 15],
  [ 8,  4, 11,  7],
  [ 2, 14,  1, 13],
  [10,  6,  9,  5],
];

const matrix = ref<number[][]>(orderedMatrix);
const matrixWidth = computed(() => matrix.value[0]!.length);
const matrixHeight = computed(() => matrix.value.length);

async function ready() {
  root = await tgpu.init();
  device = root.device;
  canvas = document.querySelector("canvas") as HTMLCanvasElement;
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

  canvas.setAttribute("width", `${srcWidth}`);
  canvas.setAttribute("height", `${srcHeight}`);

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

  adjustmentsBuffer.write({
    orderedMatrixArray: orderedMatrix.flat().map((n) => n / 16),
    matrixHeight: 4,
    matrixWidth: 4,

    exposure: 1,
    contrast: 1,
    highlights: 1,
    shadows: 1,
  });
  init();
});

onUnmounted(() => {
  onCleanup();
});
</script>

<template>
  <main class="grid grid-cols-1 lg:grid-cols-3 mx-auto container p-2 gap-4">
    <div class="w-full">
      <canvas class="w-full" />
    </div>

    <div class="lg:col-span-2 grid gap-4">
      <div class="flex flex-col gap-2">
        <label v-for="control in ADJUSTMENTS_CONTROLS" class="flex flex-row gap-2">
          <div class="capitalize w-30">{{ control.key }}</div>
          <div class="font-mono w-16">
            {{ adjustmentsValues[control.key].toFixed(2) }}
          </div>
          <Slider
            :min="control.min"
            :max="control.max"
            :step="control.step"
            :modelValue="[adjustmentsValues[control.key]]"
            :defaultValue="control.defaultValue"
            @update:modelValue="
              (value) => {
                if (value) {
                  adjustmentsValues[control.key] = value[0]!;
                  control.onUpdate(value);
                }
              }
            "
          />
        </label>
      </div>

      <table class="[&_td]:border w-full">
        <tr v-for="(row, y) in matrix">
          <td v-for="(cell, x) in row" class="p-1">
            <div class="flex flex-row items-center gap-1">
              <Button
                variant="outline"
                class="p-2 size-6"
                :disabled="cell == 0"
                @click="
                  () => {
                    matrix[y]![x]! -= 1;
                    adjustmentsBuffer.writePartial({
                      orderedMatrixArray: matrix
                        .flat()
                        .map((value, idx) => ({ idx, value: value / 16 })),
                    });
                    render();
                  }
                "
              >
                <MinusIcon />
              </Button>

              <div
                class="size-5 shrink-0"
                :style="{
                  backgroundColor: `hsl(0 0% ${(cell / (matrixHeight * matrixWidth)) * 100}%)`,
                }"
              />

              <input
                class="font-mono w-full text-center"
                type="number"
                min="0"
                step="1"
                :value="cell"
                @change="
                  (e) => {
                    const value = (e.target as HTMLInputElement).valueAsNumber;
                    matrix[y]![x]! = value;
                    adjustmentsBuffer.writePartial({
                      orderedMatrixArray: matrix
                        .flat()
                        .map((value, idx) => ({ idx, value: value / 16 })),
                    });
                    render();
                  }
                "
              />

              <Button
                variant="outline"
                class="p-2 size-6"
                :disabled="cell == matrixHeight * matrixWidth - 1"
                @click="
                  () => {
                    matrix[y]![x]! += 1;
                    adjustmentsBuffer.writePartial({
                      orderedMatrixArray: matrix
                        .flat()
                        .map((value, idx) => ({ idx, value: value / 16 })),
                    });
                    render();
                  }
                "
              >
                <PlusIcon />
              </Button>
            </div>
          </td>
        </tr>
      </table>
    </div>
  </main>
</template>

<style lang="css" scoped>
/*
Source - https://stackoverflow.com/a/27935448
Posted by Josh Crozier, modified by community. See post 'Timeline' for change history
Retrieved 2026-02-09, License - CC BY-SA 3.0
*/

input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  -moz-appearance: textfield;
}
</style>
