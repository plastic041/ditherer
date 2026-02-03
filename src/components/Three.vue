<script setup lang="ts">
import {
  texture,
  vec4,
  uv,
  Fn,
  mod,
  grayscale,
  step,
  array,
  vec3,
  floor,
  uniform,
  vec2,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { onMounted, useTemplateRef } from "vue";

const ditherFn = Fn(
  ([inputTexture, bayerMatrix, resolution]: [THREE.Texture, THREE.ArrayNode, THREE.ArrayNode]) => {
    const uv0 = uv();

    const pixelCoord = floor(uv0.mul(resolution));
    const bayerCoord = mod(pixelCoord, vec2(4, 4));

    const bayerValue = bayerMatrix.element(bayerCoord.y).element(bayerCoord.x);

    const myMap = texture(inputTexture, uv0);
    const gray = grayscale(myMap.rgb);

    return vec4(vec3(step(bayerValue, gray)), 1.0);
  },
);

const bayerIndex = array([
  vec4(0.0, 12.0 / 16.0, 3.0 / 16.0, 15.0 / 16.0),
  vec4(8.0 / 16.0, 4.0 / 16.0, 11.0 / 16.0, 7.0 / 16.0),
  vec4(2.0 / 16.0, 14.0 / 16.0, 1.0 / 16.0, 13.0 / 16.0),
  vec4(10.0 / 16.0, 6.0 / 16.0, 9.0 / 16.0, 5.0 / 16.0),
]);

// Create uniform for texture
const textureUniform = uniform(new THREE.TextureLoader().load("./textures/uv_grid_opengl.jpg"));
textureUniform.value.wrapS = THREE.RepeatWrapping;
textureUniform.value.colorSpace = THREE.SRGBColorSpace;

const output = ditherFn(textureUniform.value, bayerIndex, vec2(512, 512));

const canvasRef = useTemplateRef<HTMLCanvasElement>("canvasRef");

const dither = Fn(([originalTexture, ditherMatrix]: [THREE.Texture, THREE.Texture]) => {
  const color = texture(originalTexture, uv());
  const grayed = grayscale(color);

  const ditherUV = uv().mul(500).div(4);
  const threshold = texture(ditherMatrix, ditherUV).r;

  const dithered = step(grayed.r, threshold);

  return vec4(vec3(dithered), color.a);
});

onMounted(async () => {
  if (!canvasRef.value) {
    return;
  }

  // prettier-ignore
  // const bayerMatrix = new Uint8Array(
  //   [
  //               0, 12.0 / 16.0,  3.0 / 16.0, 15.0 / 16.0,
  //      8.0 / 16.0,  4.0 / 16.0, 11.0 / 16.0,  7.0 / 16.0,
  //      2.0 / 16.0, 14.0 / 16.0,  1.0 / 16.0, 13.0 / 16.0,
  //     10.0 / 16.0,  6.0 / 16.0,  9.0 / 16.0,  5.0 / 16.0
  //   ],
  // );
  const bayerMatrix = new Uint8Array([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5
].map(v => (v / 15) * 255));

  const bayerTexture = new THREE.DataTexture(
    bayerMatrix,
    4,
    4,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  bayerTexture.needsUpdate = true;
  bayerTexture.minFilter = THREE.NearestFilter;
  bayerTexture.magFilter = THREE.NearestFilter;
  bayerTexture.wrapS = THREE.RepeatWrapping;
  bayerTexture.wrapT = THREE.RepeatWrapping;

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.z = 2;

  const scene = new THREE.Scene();

  const imageTexture = await new Promise<THREE.Texture>((res) =>
    new THREE.TextureLoader().load("./images/test_image.jpeg", (t) => res(t)),
  );
  imageTexture.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  material.colorNode = dither(imageTexture, bayerTexture);
  scene.add(mesh);

  const renderer = new THREE.WebGPURenderer({ canvas: canvasRef.value });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(500, 500);

  await renderer.init();

  renderer.render(scene, camera);
});
</script>

<template>
  <canvas ref="canvasRef" />
  <span>canvas</span>
</template>
