"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

type GamePhase =
  | "idle"
  | "ready"
  | "charging"
  | "flying"
  | "resolving"
  | "transition";

type HudState = {
  level: 1 | 2;
  score: number;
  levelScore: number;
  shots: number;
  status: string;
  toast: string;
  transition: string;
  transitionKicker: string;
};

type Target = {
  center: THREE.Vector3;
  mouthY: number;
  bottomY: number;
  innerRadius: number;
  rimRadius: number;
  baseRadius: number;
};

type BoxCollider = {
  min: THREE.Vector3;
  max: THREE.Vector3;
  restitution: number;
};

type BuiltLevel = {
  group: THREE.Group;
  target: Target;
  trajectoryColor: number;
  colliders: BoxCollider[];
};

type LiveBall = {
  mesh: THREE.Group;
  position: THREE.Vector3;
  previous: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  age: number;
  scored: boolean;
  insideBin: boolean;
  bounces: number;
  trail: THREE.Line;
  trailPoints: THREE.Vector3[];
  trailTick: number;
};

type GameApi = {
  start: () => void;
  restart: () => void;
  toggleSound: () => boolean;
};

const PAPER_RADIUS = 0.13;
const FIXED_STEP = 1 / 120;
const GRAVITY = 9.81;

function makeDynamicGeometry(capacity: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(capacity * 3), 3),
  );
  geometry.setDrawRange(0, 0);
  return geometry;
}

function updateDynamicGeometry(
  geometry: THREE.BufferGeometry,
  points: THREE.Vector3[],
  capacity: number,
): void {
  const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
  const count = Math.min(points.length, capacity);
  for (let i = 0; i < count; i += 1) {
    attribute.setXYZ(i, points[i].x, points[i].y, points[i].z);
  }
  attribute.needsUpdate = true;
  geometry.setDrawRange(0, count);
  geometry.computeBoundingSphere();
}

function collider(
  center: [number, number, number],
  size: [number, number, number],
  restitution = 0.24,
): BoxCollider {
  const half = new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2);
  const middle = new THREE.Vector3(...center);
  return {
    min: middle.clone().sub(half),
    max: middle.clone().add(half),
    restitution,
  };
}

function initialHud(): HudState {
  return {
    level: 1,
    score: 0,
    levelScore: 0,
    shots: 0,
    status: "CLOCK IN TO BEGIN",
    toast: "",
    transition: "",
    transitionKicker: "",
  };
}

function createPaperBall(): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.IcosahedronGeometry(PAPER_RADIUS, 2);
  const position = geometry.getAttribute("position");

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const ripple =
      1 +
      Math.sin(x * 67 + y * 41) * 0.075 +
      Math.cos(z * 73 - x * 29) * 0.05;
    position.setXYZ(i, x * ripple, y * ripple, z * ripple);
  }
  geometry.computeVertexNormals();

  const paper = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0xf5f1e6,
      roughness: 0.88,
      metalness: 0,
      flatShading: true,
    }),
  );
  paper.castShadow = true;
  paper.receiveShadow = true;
  group.add(paper);

  const creaseGeometry = new THREE.EdgesGeometry(geometry, 24);
  const creases = new THREE.LineSegments(
    creaseGeometry,
    new THREE.LineBasicMaterial({
      color: 0x8c8b82,
      transparent: true,
      opacity: 0.18,
    }),
  );
  group.add(creases);
  group.rotation.set(0.3, 0.7, -0.2);
  return group;
}

function makeCanvasTexture(
  painter: (context: CanvasRenderingContext2D, size: number) => void,
  size = 256,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is unavailable");
  }
  painter(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeNoiseTexture(
  base: string,
  speckle: string,
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
  const texture = makeCanvasTexture((context, size) => {
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);
    context.fillStyle = speckle;
    for (let i = 0; i < 1500; i += 1) {
      const x = (i * 83) % size;
      const y = (i * 149 + (i % 7) * 19) % size;
      const alpha = 0.025 + ((i * 17) % 20) / 500;
      context.globalAlpha = alpha;
      context.fillRect(x, y, 1 + (i % 2), 1 + ((i + 1) % 2));
    }
    context.globalAlpha = 1;
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

function makeLabel(
  text: string,
  color: string,
  background: string,
  width = 2.8,
  height = 0.7,
): THREE.Mesh {
  const texture = makeCanvasTexture((context, size) => {
    context.fillStyle = background;
    context.fillRect(0, 0, size, size);
    context.strokeStyle = color;
    context.lineWidth = 7;
    context.strokeRect(10, 10, size - 20, size - 20);
    context.fillStyle = color;
    context.font = "700 29px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, size / 2, size / 2);
  }, 512);
  const material = new THREE.MeshBasicMaterial({ map: texture });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
}

function addRoundedBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  color: number,
  radius = 0.06,
  roughness = 0.72,
  metalness = 0,
): THREE.Mesh {
  const geometry = new RoundedBoxGeometry(
    size[0],
    size[1],
    size[2],
    3,
    Math.min(radius, Math.min(...size) / 3),
  );
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness, metalness }),
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addOfficeDesk(
  parent: THREE.Object3D,
  x: number,
  z: number,
  rotation = 0,
): void {
  const desk = new THREE.Group();
  desk.position.set(x, 0, z);
  desk.rotation.y = rotation;

  addRoundedBox(desk, [3.15, 0.14, 1.35], [0, 0.83, 0], 0x2a6b64, 0.06);
  addRoundedBox(desk, [0.13, 0.76, 1.12], [-1.35, 0.4, 0], 0x174c47, 0.04);
  addRoundedBox(desk, [0.13, 0.76, 1.12], [1.35, 0.4, 0], 0x174c47, 0.04);

  const monitor = new THREE.Group();
  monitor.position.set(-0.4, 0.95, 0);
  addRoundedBox(monitor, [0.9, 0.66, 0.54], [0, 0.32, 0], 0xbdb59e, 0.09);
  const screen = addRoundedBox(
    monitor,
    [0.68, 0.42, 0.025],
    [0, 0.34, 0.278],
    0x163b35,
    0.04,
    0.35,
  );
  (screen.material as THREE.MeshStandardMaterial).emissive.setHex(0x0b5a4f);
  (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7;
  addRoundedBox(monitor, [0.36, 0.1, 0.3], [0, -0.04, 0], 0xa89f88, 0.03);
  desk.add(monitor);

  addRoundedBox(desk, [0.78, 0.055, 0.32], [0.68, 0.93, 0.18], 0xcac2aa, 0.025);
  addRoundedBox(desk, [0.44, 0.07, 0.25], [0.68, 0.98, -0.3], 0xddd6c1, 0.02);
  parent.add(desk);
}

function addOfficeBasket(parent: THREE.Object3D, center: THREE.Vector3): void {
  const basket = new THREE.Group();
  basket.position.copy(center);
  const dark = new THREE.MeshStandardMaterial({
    color: 0x172421,
    roughness: 0.38,
    metalness: 0.55,
  });
  const rim = new THREE.MeshStandardMaterial({
    color: 0x7a8c86,
    roughness: 0.3,
    metalness: 0.85,
  });

  const liner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.41, 0.32, 0.82, 24, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x0b1210,
      roughness: 0.9,
      transparent: true,
      opacity: 0.58,
      side: THREE.DoubleSide,
    }),
  );
  liner.position.y = 0.42;
  liner.castShadow = true;
  basket.add(liner);

  for (let i = 0; i < 18; i += 1) {
    const angle = (i / 18) * Math.PI * 2;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.82, 6), dark);
    rod.position.set(Math.cos(angle) * 0.365, 0.42, Math.sin(angle) * 0.365);
    rod.rotation.z = Math.sin(angle) * -0.085;
    rod.rotation.x = Math.cos(angle) * 0.085;
    basket.add(rod);
  }

  for (const [radius, y, material] of [
    [0.42, 0.84, rim],
    [0.38, 0.53, dark],
    [0.34, 0.12, dark],
  ] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.025, 8, 40), material);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    ring.castShadow = true;
    basket.add(ring);
  }
  parent.add(basket);
}

function addBeachBasket(parent: THREE.Object3D, center: THREE.Vector3): void {
  const basket = new THREE.Group();
  basket.position.copy(center);
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.36, 0.88, 12, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x173b4b,
      roughness: 0.44,
      metalness: 0.18,
      side: THREE.DoubleSide,
    }),
  );
  body.position.y = 0.44;
  body.castShadow = true;
  body.receiveShadow = true;
  basket.add(body);

  const interior = new THREE.Mesh(
    new THREE.CylinderGeometry(0.435, 0.33, 0.72, 12, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x071b24,
      roughness: 0.92,
      side: THREE.BackSide,
    }),
  );
  interior.position.y = 0.46;
  basket.add(interior);

  const brass = new THREE.MeshStandardMaterial({
    color: 0xc6a15b,
    roughness: 0.23,
    metalness: 0.88,
  });
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.035, 10, 48), brass);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.89;
  lip.castShadow = true;
  basket.add(lip);

  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const flute = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.73, 0.03),
      new THREE.MeshStandardMaterial({
        color: i % 2 ? 0x225264 : 0x102f3b,
        roughness: 0.52,
      }),
    );
    flute.position.set(Math.cos(angle) * 0.408, 0.43, Math.sin(angle) * 0.408);
    flute.rotation.y = -angle;
    basket.add(flute);
  }
  parent.add(basket);
}

function buildOffice(scene: THREE.Scene, camera: THREE.PerspectiveCamera): BuiltLevel {
  const group = new THREE.Group();
  group.name = "office-level";
  scene.add(group);
  scene.background = new THREE.Color(0x9fb7aa);
  scene.fog = new THREE.Fog(0xa9bdb2, 11, 28);

  camera.position.set(0, 1.68, 7.35);
  camera.fov = 58;
  camera.updateProjectionMatrix();
  camera.lookAt(0.1, 1.02, -2.2);

  group.add(new THREE.HemisphereLight(0xd8efe4, 0x1e3c35, 1.25));
  const key = new THREE.DirectionalLight(0xe8fff3, 2.2);
  key.position.set(-3, 6.5, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -11;
  key.shadow.camera.right = 11;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  group.add(key);

  const carpetTexture = makeNoiseTexture("#31544a", "#91aca1", 7, 5);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 25),
    new THREE.MeshStandardMaterial({ map: carpetTexture, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -2.5;
  floor.receiveShadow = true;
  group.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xc9d0c3, roughness: 0.92 });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(28, 3.6, 0.18), wallMaterial);
  backWall.position.set(0, 1.8, -10.2);
  backWall.receiveShadow = true;
  group.add(backWall);
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.6, 25), wallMaterial);
  leftWall.position.set(-10, 1.8, -1.5);
  group.add(leftWall);
  const rightWall = leftWall.clone();
  rightWall.position.x = 10;
  group.add(rightWall);

  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d8c9, roughness: 0.9 });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(28, 25), ceilingMaterial);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 3.55, -2.5);
  group.add(ceiling);

  const beamMaterial = new THREE.MeshStandardMaterial({ color: 0x64766d, roughness: 0.75 });
  for (let x = -9; x <= 9; x += 3) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.035, 22), beamMaterial);
    beam.position.set(x, 3.52, -1.5);
    group.add(beam);
  }
  for (let z = -9; z <= 7; z += 2.75) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(20, 0.035, 0.025), beamMaterial);
    beam.position.set(0, 3.52, z);
    group.add(beam);
  }

  for (const [x, z] of [
    [-6, 4.4],
    [0, 4.4],
    [6, 4.4],
    [-6, -1.1],
    [0, -1.1],
    [6, -1.1],
    [-3, -6.6],
    [3, -6.6],
  ]) {
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.045, 0.42),
      new THREE.MeshStandardMaterial({
        color: 0xf1f3df,
        emissive: 0xe2f6dd,
        emissiveIntensity: 2.8,
      }),
    );
    light.position.set(x, 3.49, z);
    group.add(light);
  }

  addOfficeDesk(group, -3.4, 1.1, 0.04);
  addOfficeDesk(group, 4.25, -0.4, -0.06);
  addOfficeDesk(group, -4.6, -5.0, 0.08);
  addOfficeDesk(group, 4.55, -6.1, -0.04);

  const corridor = addRoundedBox(group, [2.3, 3.05, 0.22], [0, 1.52, -10.05], 0x173f3a, 0.04);
  corridor.castShadow = false;
  const corridorInset = addRoundedBox(group, [1.75, 2.72, 0.12], [0, 1.42, -9.9], 0x102f2c, 0.03);
  (corridorInset.material as THREE.MeshStandardMaterial).emissive.setHex(0x08201d);

  const sign = makeLabel("REFINE YOUR WASTE", "#c7ded2", "#174a43", 3.4, 0.72);
  sign.position.set(-4.5, 2.25, -10.08);
  group.add(sign);

  const clock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.37, 0.37, 0.08, 32),
    new THREE.MeshStandardMaterial({ color: 0xe7e2d4, roughness: 0.7 }),
  );
  clock.rotation.x = Math.PI / 2;
  clock.position.set(4.8, 2.15, -10.04);
  group.add(clock);

  const center = new THREE.Vector3(1.35, 0, -1.55);
  addOfficeBasket(group, center);

  return {
    group,
    target: {
      center,
      mouthY: 0.84,
      bottomY: 0.1,
      innerRadius: 0.39,
      rimRadius: 0.42,
      baseRadius: 0.34,
    } satisfies Target,
    trajectoryColor: 0xd8e875,
    colliders: [
      collider([-3.4, 0.72, 1.1], [3.35, 1.45, 1.55]),
      collider([4.25, 0.72, -0.4], [3.35, 1.45, 1.55]),
      collider([-4.6, 0.72, -5], [3.35, 1.45, 1.55]),
      collider([4.55, 0.72, -6.1], [3.35, 1.45, 1.55]),
      collider([0, 1.8, -10.2], [20, 3.6, 0.2], 0.18),
      collider([-10, 1.8, -1.5], [0.2, 3.6, 25], 0.18),
      collider([10, 1.8, -1.5], [0.2, 3.6, 25], 0.18),
    ],
  };
}

function addSectional(parent: THREE.Object3D): void {
  const sofa = new THREE.Group();
  sofa.position.set(-4.7, 0, -1.8);
  sofa.rotation.y = -0.08;
  const cream = 0xe6dcca;
  addRoundedBox(sofa, [4.2, 0.45, 1.65], [0, 0.38, 0], cream, 0.18, 0.9);
  addRoundedBox(sofa, [4.15, 0.74, 0.38], [0, 0.84, -0.64], cream, 0.16, 0.9);
  addRoundedBox(sofa, [1.35, 0.42, 3.25], [-1.42, 0.37, 0.72], cream, 0.18, 0.9);
  addRoundedBox(sofa, [0.36, 0.64, 1.5], [2.0, 0.63, 0], 0xd8cbb8, 0.16, 0.9);
  addRoundedBox(sofa, [0.72, 0.34, 0.72], [-0.7, 0.83, -0.06], 0xd97964, 0.13, 0.86);
  addRoundedBox(sofa, [0.82, 0.34, 0.72], [0.25, 0.83, -0.06], 0x24586b, 0.13, 0.86);
  parent.add(sofa);
}

function addPlant(parent: THREE.Object3D): void {
  const plant = new THREE.Group();
  plant.position.set(5.1, 0, -6.7);
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.34, 0.72, 14),
    new THREE.MeshStandardMaterial({ color: 0xc7b397, roughness: 0.84 }),
  );
  pot.position.y = 0.36;
  pot.castShadow = true;
  plant.add(pot);
  const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x456f50, roughness: 0.8 });
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x4f825d,
    roughness: 0.82,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2;
    const height = 1.1 + (i % 3) * 0.28;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.038, height, 6), stemMaterial);
    stem.position.set(Math.cos(angle) * 0.12, 0.65 + height / 2, Math.sin(angle) * 0.12);
    stem.rotation.z = Math.cos(angle) * 0.2;
    stem.rotation.x = Math.sin(angle) * 0.2;
    plant.add(stem);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 7), leafMaterial);
    leaf.scale.set(1.55, 0.18, 0.7);
    leaf.position.set(
      Math.cos(angle) * 0.42,
      0.72 + height,
      Math.sin(angle) * 0.42,
    );
    leaf.rotation.y = -angle;
    leaf.rotation.z = 0.15 * Math.sin(angle);
    leaf.castShadow = true;
    plant.add(leaf);
  }
  parent.add(plant);
}

function buildBeach(scene: THREE.Scene, camera: THREE.PerspectiveCamera): BuiltLevel {
  const group = new THREE.Group();
  group.name = "beach-level";
  scene.add(group);
  scene.background = new THREE.Color(0xa9dbe2);
  scene.fog = new THREE.Fog(0xbfe1df, 22, 54);

  camera.position.set(0, 1.7, 7.6);
  camera.fov = 60;
  camera.updateProjectionMatrix();
  camera.lookAt(-0.15, 1.05, -2.1);

  group.add(new THREE.HemisphereLight(0xc8f3ff, 0xa87c55, 2.15));
  const sun = new THREE.DirectionalLight(0xfff0d0, 4.4);
  sun.position.set(-7, 10, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = -13;
  sun.shadow.camera.right = 13;
  sun.shadow.camera.top = 13;
  sun.shadow.camera.bottom = -13;
  group.add(sun);

  const woodTexture = makeCanvasTexture((context, size) => {
    context.fillStyle = "#c79f70";
    context.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 32) {
      context.fillStyle = x % 64 ? "#bd9467" : "#cfa879";
      context.fillRect(x, 0, 30, size);
      context.strokeStyle = "rgba(78,48,25,.18)";
      context.strokeRect(x, 0, 30, size);
      for (let y = 8; y < size; y += 17) {
        context.fillStyle = "rgba(82,50,25,.07)";
        context.fillRect(x + 4 + ((x + y) % 13), y, 19, 1);
      }
    }
  });
  woodTexture.wrapS = THREE.RepeatWrapping;
  woodTexture.wrapT = THREE.RepeatWrapping;
  woodTexture.repeat.set(8, 10);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 28),
    new THREE.MeshStandardMaterial({ map: woodTexture, roughness: 0.66 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -3;
  floor.receiveShadow = true;
  group.add(floor);

  const plaster = new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: 0.92 });
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.24, 6.2, 28), plaster);
  leftWall.position.set(-8.7, 3.1, -3);
  leftWall.receiveShadow = true;
  group.add(leftWall);
  const rightWall = leftWall.clone();
  rightWall.position.x = 8.7;
  group.add(rightWall);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(18, 28), plaster);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 6.15, -3);
  group.add(ceiling);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 12),
    new THREE.MeshStandardMaterial({ color: 0xe9d6ad, roughness: 1 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, -0.18, -19.5);
  group.add(sand);

  const oceanGeometry = new THREE.PlaneGeometry(45, 30, 45, 30);
  const ocean = new THREE.Mesh(
    oceanGeometry,
    new THREE.MeshPhysicalMaterial({
      color: 0x218ba4,
      roughness: 0.22,
      metalness: 0.08,
      transmission: 0.08,
      clearcoat: 0.7,
      clearcoatRoughness: 0.22,
    }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.42, -30);
  ocean.userData.waveBase = Float32Array.from(oceanGeometry.getAttribute("position").array);
  ocean.userData.isOcean = true;
  group.add(ocean);

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xd8fbff,
    transparent: true,
    opacity: 0.2,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.32,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(16.8, 5.9), glassMaterial);
  glass.position.set(0, 2.95, -11.2);
  group.add(glass);
  const bronze = new THREE.MeshStandardMaterial({ color: 0x3b3430, roughness: 0.28, metalness: 0.75 });
  for (const x of [-8.4, -5.6, -2.8, 0, 2.8, 5.6, 8.4]) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.065, 6.0, 0.08), bronze);
    mullion.position.set(x, 3.0, -11.08);
    mullion.castShadow = true;
    group.add(mullion);
  }
  const topRail = new THREE.Mesh(new THREE.BoxGeometry(16.9, 0.07, 0.08), bronze);
  topRail.position.set(0, 5.95, -11.08);
  group.add(topRail);

  addSectional(group);
  addPlant(group);

  const marbleTexture = makeCanvasTexture((context, size) => {
    context.fillStyle = "#ddd6ca";
    context.fillRect(0, 0, size, size);
    context.strokeStyle = "rgba(92,104,105,.28)";
    context.lineWidth = 3;
    context.beginPath();
    for (let x = -20; x < size + 30; x += 7) {
      const y = size * 0.5 + Math.sin(x * 0.045) * 31 + Math.sin(x * 0.13) * 9;
      if (x === -20) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  });
  const table = new THREE.Mesh(
    new RoundedBoxGeometry(2.9, 0.22, 1.45, 4, 0.13),
    new THREE.MeshStandardMaterial({ map: marbleTexture, roughness: 0.42 }),
  );
  table.position.set(2.9, 0.56, 1.0);
  table.castShadow = true;
  table.receiveShadow = true;
  group.add(table);
  addRoundedBox(group, [0.18, 0.52, 1.05], [2.9, 0.27, 1.0], 0xb79250, 0.04, 0.26, 0.82);

  for (const x of [-2.4, 0, 2.4]) {
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 2.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x5f5045, roughness: 0.5 }),
    );
    cord.position.set(x, 4.9, -2.7);
    group.add(cord);
    const pendant = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 10),
      new THREE.MeshStandardMaterial({
        color: 0xc3a261,
        emissive: 0xd5a750,
        emissiveIntensity: 0.8,
        roughness: 0.28,
        metalness: 0.65,
      }),
    );
    pendant.position.set(x, 3.62, -2.7);
    pendant.scale.y = 1.4;
    group.add(pendant);
  }

  const center = new THREE.Vector3(-1.15, 0, -1.95);
  addBeachBasket(group, center);
  return {
    group,
    target: {
      center,
      mouthY: 0.89,
      bottomY: 0.09,
      innerRadius: 0.435,
      rimRadius: 0.48,
      baseRadius: 0.36,
    } satisfies Target,
    trajectoryColor: 0x64e6df,
    colliders: [
      collider([-4.7, 0.65, -1.8], [4.6, 1.3, 1.9]),
      collider([-6.1, 0.55, -0.9], [1.5, 1.1, 3.5]),
      collider([2.9, 0.52, 1], [3.1, 1.04, 1.65], 0.2),
      collider([-8.7, 3.1, -3], [0.24, 6.2, 28], 0.16),
      collider([8.7, 3.1, -3], [0.24, 6.2, 28], 0.16),
      collider([0, 2.95, -11.2], [16.8, 5.9, 0.08], 0.12),
    ],
  };
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = mesh.material
      ? Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]
      : [];
    for (const material of materials) {
      const mapped = material as THREE.Material & {
        map?: THREE.Texture;
        normalMap?: THREE.Texture;
        roughnessMap?: THREE.Texture;
      };
      mapped.map?.dispose();
      mapped.normalMap?.dispose();
      mapped.roughnessMap?.dispose();
      material.dispose();
    }
  });
}

export function TrashketballGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const powerRef = useRef<HTMLDivElement>(null);
  const aimRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameApi | null>(null);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hud, setHud] = useState<HudState>(initialHud);

  const startGame = useCallback(() => {
    gameRef.current?.start();
    setStarted(true);
  }, []);

  const restartGame = useCallback(() => {
    gameRef.current?.restart();
    setStarted(true);
  }, []);

  const toggleSound = useCallback(() => {
    const isMuted = gameRef.current?.toggleSound() ?? !muted;
    setMuted(isMuted);
  }, [muted]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute("aria-label", "Interactive 3D trashketball game");
    renderer.domElement.setAttribute("role", "application");
    renderer.domElement.setAttribute("aria-describedby", "game-controls");
    renderer.domElement.tabIndex = -1;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.05, 90);
    const ballLayer = new THREE.Group();
    ballLayer.name = "paper-balls";
    scene.add(ballLayer);

    let level: 1 | 2 = 1;
    let totalScore = 0;
    let levelScore = 0;
    let shots = 0;
    let phase: GamePhase = "idle";
    let currentLevel = buildOffice(scene, camera);
    let target = currentLevel.target;
    let trajectoryColor = currentLevel.trajectoryColor;
    let heldBall: THREE.Group | null = createPaperBall();
    ballLayer.add(heldBall);
    let activeBall: LiveBall | null = null;
    const settledBalls: THREE.Group[] = [];
    const timeouts = new Set<number>();
    let soundMuted = false;
    let audioContext: AudioContext | null = null;
    let power = 0.56;
    let chargeStarted = 0;
    let aimYawOffset = 0;
    let aimPitchOffset = 0;
    let accumulator = 0;
    let previousFrame = performance.now();
    let animationFrame = 0;
    let elapsed = 0;
    let disposed = false;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const trajectoryGeometry = makeDynamicGeometry(64);
    const trajectoryMaterial = new THREE.LineBasicMaterial({
      color: trajectoryColor,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      depthTest: false,
    });
    const trajectory = new THREE.Line(trajectoryGeometry, trajectoryMaterial);
    trajectory.frustumCulled = false;
    trajectory.renderOrder = 20;
    scene.add(trajectory);
    const dotGeometry = makeDynamicGeometry(32);
    const dotMaterial = new THREE.PointsMaterial({
      color: trajectoryColor,
      size: 0.075,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      depthTest: false,
      sizeAttenuation: true,
    });
    const trajectoryDots = new THREE.Points(dotGeometry, dotMaterial);
    trajectoryDots.frustumCulled = false;
    trajectoryDots.renderOrder = 21;
    scene.add(trajectoryDots);
    const landingMaterial = new THREE.MeshBasicMaterial({
      color: trajectoryColor,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      depthTest: false,
    });
    const landingMarker = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 6, 28), landingMaterial);
    landingMarker.rotation.x = Math.PI / 2;
    landingMarker.renderOrder = 22;
    scene.add(landingMarker);

    const schedule = (callback: () => void, delay: number) => {
      const id = window.setTimeout(() => {
        timeouts.delete(id);
        if (!disposed) callback();
      }, delay);
      timeouts.add(id);
    };

    const setStatus = (status: string) => {
      setHud((previous) => ({ ...previous, status }));
    };

    const heldPosition = () => {
      const offset = new THREE.Vector3(0.34, -0.29, -0.72).applyQuaternion(camera.quaternion);
      return camera.position.clone().add(offset);
    };

    const aimDirection = () => {
      const start = heldPosition();
      const dx = target.center.x - start.x;
      const dz = target.center.z - start.z;
      const baseYaw = Math.atan2(dx, -dz);
      const yaw = baseYaw + aimYawOffset;
      const basePitch = level === 1 ? THREE.MathUtils.degToRad(16.5) : THREE.MathUtils.degToRad(17.2);
      const pitch = THREE.MathUtils.clamp(
        basePitch + aimPitchOffset,
        THREE.MathUtils.degToRad(7),
        THREE.MathUtils.degToRad(29),
      );
      return new THREE.Vector3(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch),
      ).normalize();
    };

    const launchSpeed = () => 9.45 + power * 4.15;

    const playTone = (kind: "throw" | "score" | "miss" | "unlock") => {
      if (soundMuted) return;
      try {
        audioContext ??= new AudioContext();
        if (audioContext.state === "suspended") void audioContext.resume();
        const now = audioContext.currentTime;
        const gain = audioContext.createGain();
        gain.connect(audioContext.destination);
        const oscillator = audioContext.createOscillator();
        oscillator.connect(gain);
        oscillator.type = kind === "throw" ? "triangle" : "sine";
        const startFrequency = kind === "score" ? 520 : kind === "unlock" ? 390 : kind === "miss" ? 120 : 230;
        const endFrequency = kind === "score" ? 980 : kind === "unlock" ? 780 : kind === "miss" ? 80 : 90;
        oscillator.frequency.setValueAtTime(startFrequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + (kind === "unlock" ? 0.45 : 0.18));
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(kind === "score" ? 0.13 : 0.065, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "unlock" ? 0.5 : 0.24));
        oscillator.start(now);
        oscillator.stop(now + (kind === "unlock" ? 0.52 : 0.26));
      } catch {
        // Audio is optional; gameplay remains fully functional without it.
      }
    };

    const clearBallLayer = () => {
      if (activeBall?.trail.parent) activeBall.trail.parent.remove(activeBall.trail);
      if (activeBall) {
        activeBall.trail.geometry.dispose();
        (activeBall.trail.material as THREE.Material).dispose();
      }
      while (ballLayer.children.length) {
        const child = ballLayer.children[0];
        ballLayer.remove(child);
        disposeObject(child);
      }
      settledBalls.length = 0;
      heldBall = null;
      activeBall = null;
    };

    const createHeld = () => {
      if (heldBall || activeBall || phase === "transition") return;
      heldBall = createPaperBall();
      ballLayer.add(heldBall);
      heldBall.position.copy(heldPosition());
      heldBall.scale.setScalar(1);
      power = 0.56;
      if (powerRef.current) powerRef.current.style.setProperty("--power", `${power}`);
    };

    const loadLevel = (nextLevel: 1 | 2) => {
      clearBallLayer();
      scene.remove(currentLevel.group);
      disposeObject(currentLevel.group);
      level = nextLevel;
      currentLevel = nextLevel === 1 ? buildOffice(scene, camera) : buildBeach(scene, camera);
      target = currentLevel.target;
      trajectoryColor = currentLevel.trajectoryColor;
      trajectoryMaterial.color.setHex(trajectoryColor);
      dotMaterial.color.setHex(trajectoryColor);
      landingMaterial.color.setHex(trajectoryColor);
      renderer.toneMappingExposure = nextLevel === 1 ? 1.06 : 1.16;
      aimYawOffset = 0;
      aimPitchOffset = 0;
      createHeld();
    };

    const beginTransition = () => {
      phase = "transition";
      trajectory.visible = false;
      trajectoryDots.visible = false;
      landingMarker.visible = false;
      playTone("unlock");
      setHud((previous) => ({
        ...previous,
        status: "QUOTA COMPLETE",
        transition: "TRANSFER APPROVED",
        transitionKicker: "100 / 100 · DESTINATION UNLOCKED",
      }));
      schedule(() => {
        levelScore = 0;
        loadLevel(2);
        setHud((previous) => ({
          ...previous,
          level: 2,
          levelScore: 0,
          status: "COASTAL OPEN PLAY",
          transition: "WELCOME TO THE OUTIE RETREAT",
          transitionKicker: "LEVEL 02 · BEACH HOUSE",
        }));
      }, reduceMotion ? 280 : 1050);
      schedule(() => {
        phase = "ready";
        createHeld();
        setHud((previous) => ({
          ...previous,
          status: "AIM · HOLD · RELEASE",
          transition: "",
          transitionKicker: "",
        }));
      }, reduceMotion ? 900 : 2600);
    };

    const scoreBall = () => {
      totalScore += 10;
      levelScore += 10;
      playTone("score");
      setHud((previous) => ({
        ...previous,
        score: totalScore,
        levelScore,
        status: level === 1 && levelScore >= 100 ? "QUOTA COMPLETE" : "PERFECT SWISH",
        toast: "+10 · SWISH",
      }));
      schedule(() => {
        setHud((previous) => ({ ...previous, toast: "" }));
      }, 850);
      if (level === 1 && levelScore >= 100) {
        schedule(beginTransition, reduceMotion ? 220 : 780);
      }
    };

    const finishBall = (wasScore: boolean) => {
      if (!activeBall) return;
      const finished = activeBall;
      activeBall = null;
      if (finished.trail.parent) finished.trail.parent.remove(finished.trail);
      finished.trail.geometry.dispose();
      (finished.trail.material as THREE.Material).dispose();
      settledBalls.push(finished.mesh);
      while (settledBalls.length > 7) {
        const oldest = settledBalls.shift();
        if (oldest) {
          ballLayer.remove(oldest);
          disposeObject(oldest);
        }
      }
      if (phase === "transition") return;
      phase = "resolving";
      if (!wasScore) {
        playTone("miss");
        setStatus("RECYCLE · TRY AGAIN");
      }
      schedule(() => {
        if (phase === "resolving") {
          phase = "ready";
          createHeld();
          setStatus("AIM · HOLD · RELEASE");
        }
      }, wasScore ? 520 : 620);
    };

    const checkRimCollision = (ball: LiveBall) => {
      if (ball.insideBin) return;
      const dx = ball.position.x - target.center.x;
      const dz = ball.position.z - target.center.z;
      const radial = Math.hypot(dx, dz) || 0.0001;
      const rimPoint = new THREE.Vector3(
        target.center.x + (dx / radial) * target.rimRadius,
        target.mouthY,
        target.center.z + (dz / radial) * target.rimRadius,
      );
      const normal = ball.position.clone().sub(rimPoint);
      const distance = normal.length();
      const collisionDistance = ball.radius + 0.028;
      if (distance < collisionDistance && Math.abs(ball.position.y - target.mouthY) < 0.24) {
        normal.normalize();
        ball.position.addScaledVector(normal, collisionDistance - distance + 0.002);
        const incoming = ball.velocity.dot(normal);
        if (incoming < 0) ball.velocity.addScaledVector(normal, -1.42 * incoming);
        ball.velocity.multiplyScalar(0.82);
      }
    };

    const resolveBoxCollision = (ball: LiveBall, box: BoxCollider) => {
      const closest = new THREE.Vector3(
        THREE.MathUtils.clamp(ball.position.x, box.min.x, box.max.x),
        THREE.MathUtils.clamp(ball.position.y, box.min.y, box.max.y),
        THREE.MathUtils.clamp(ball.position.z, box.min.z, box.max.z),
      );
      const normal = ball.position.clone().sub(closest);
      const distanceSquared = normal.lengthSq();
      if (distanceSquared >= ball.radius * ball.radius) return;

      if (distanceSquared > 0.000001) {
        const distance = Math.sqrt(distanceSquared);
        normal.multiplyScalar(1 / distance);
        ball.position.addScaledVector(normal, ball.radius - distance + 0.001);
      } else {
        const faces = [
          { distance: ball.position.x - box.min.x, normal: new THREE.Vector3(-1, 0, 0), value: box.min.x - ball.radius, axis: "x" },
          { distance: box.max.x - ball.position.x, normal: new THREE.Vector3(1, 0, 0), value: box.max.x + ball.radius, axis: "x" },
          { distance: ball.position.y - box.min.y, normal: new THREE.Vector3(0, -1, 0), value: box.min.y - ball.radius, axis: "y" },
          { distance: box.max.y - ball.position.y, normal: new THREE.Vector3(0, 1, 0), value: box.max.y + ball.radius, axis: "y" },
          { distance: ball.position.z - box.min.z, normal: new THREE.Vector3(0, 0, -1), value: box.min.z - ball.radius, axis: "z" },
          { distance: box.max.z - ball.position.z, normal: new THREE.Vector3(0, 0, 1), value: box.max.z + ball.radius, axis: "z" },
        ] as const;
        const nearest = faces.reduce((best, face) => face.distance < best.distance ? face : best);
        normal.copy(nearest.normal);
        ball.position[nearest.axis] = nearest.value;
      }

      const incoming = ball.velocity.dot(normal);
      if (incoming < 0) {
        ball.velocity.addScaledVector(normal, -(1 + box.restitution) * incoming);
        ball.velocity.multiplyScalar(0.82);
      }
    };

    const resolveBinBody = (ball: LiveBall) => {
      if (ball.insideBin || ball.position.y >= target.mouthY - 0.035) return;
      if (ball.position.y <= target.bottomY - ball.radius) return;
      const dx = ball.position.x - target.center.x;
      const dz = ball.position.z - target.center.z;
      const radial = Math.hypot(dx, dz) || 0.0001;
      const heightRatio = THREE.MathUtils.clamp(
        (ball.position.y - target.bottomY) / (target.mouthY - target.bottomY),
        0,
        1,
      );
      const bodyRadius = THREE.MathUtils.lerp(target.baseRadius, target.rimRadius, heightRatio);
      const limit = bodyRadius + ball.radius;
      if (radial >= limit) return;
      const nx = dx / radial;
      const nz = dz / radial;
      ball.position.x = target.center.x + nx * limit;
      ball.position.z = target.center.z + nz * limit;
      const inward = ball.velocity.x * nx + ball.velocity.z * nz;
      if (inward < 0) {
        ball.velocity.x -= inward * nx * 1.45;
        ball.velocity.z -= inward * nz * 1.45;
        ball.velocity.multiplyScalar(0.76);
      }
    };

    const updateBall = (ball: LiveBall, step: number) => {
      ball.previous.copy(ball.position);
      ball.velocity.y -= GRAVITY * step;
      ball.velocity.multiplyScalar(Math.exp(-0.13 * step));
      ball.position.addScaledVector(ball.velocity, step);
      ball.age += step;

      for (const box of currentLevel.colliders) resolveBoxCollision(ball, box);

      if (!ball.scored && ball.previous.y >= target.mouthY && ball.position.y < target.mouthY && ball.velocity.y < 0) {
        const denominator = ball.previous.y - ball.position.y;
        const t = denominator > 0 ? (ball.previous.y - target.mouthY) / denominator : 0;
        const crossX = THREE.MathUtils.lerp(ball.previous.x, ball.position.x, t);
        const crossZ = THREE.MathUtils.lerp(ball.previous.z, ball.position.z, t);
        const distance = Math.hypot(crossX - target.center.x, crossZ - target.center.z);
        if (distance < target.innerRadius - ball.radius) {
          ball.scored = true;
          ball.insideBin = true;
          ball.velocity.x *= 0.42;
          ball.velocity.z *= 0.42;
          scoreBall();
        }
      }

      checkRimCollision(ball);
      resolveBinBody(ball);

      if (ball.insideBin && ball.position.y < target.mouthY) {
        const dx = ball.position.x - target.center.x;
        const dz = ball.position.z - target.center.z;
        const radial = Math.hypot(dx, dz) || 0.0001;
        const limit = target.innerRadius - ball.radius * 0.78;
        if (radial > limit) {
          const nx = dx / radial;
          const nz = dz / radial;
          ball.position.x = target.center.x + nx * limit;
          ball.position.z = target.center.z + nz * limit;
          const outward = ball.velocity.x * nx + ball.velocity.z * nz;
          if (outward > 0) {
            ball.velocity.x -= outward * nx * 1.45;
            ball.velocity.z -= outward * nz * 1.45;
          }
        }
        const bottom = target.bottomY + ball.radius;
        if (ball.position.y <= bottom) {
          ball.position.y = bottom;
          ball.velocity.y = Math.abs(ball.velocity.y) * 0.16;
          ball.velocity.x *= 0.52;
          ball.velocity.z *= 0.52;
          if (Math.abs(ball.velocity.y) < 0.32 || ball.age > 3) finishBall(true);
        }
      } else if (ball.position.y <= ball.radius) {
        ball.position.y = ball.radius;
        if (ball.velocity.y < 0) {
          ball.velocity.y = Math.abs(ball.velocity.y) * 0.24;
          ball.velocity.x *= 0.66;
          ball.velocity.z *= 0.66;
          ball.bounces += 1;
        }
        if ((ball.bounces >= 2 && ball.velocity.length() < 1.15) || ball.age > 4.7) finishBall(false);
      }

      if (!activeBall) return;
      if (ball.age > 6 || Math.abs(ball.position.x) > 22 || Math.abs(ball.position.z) > 34) {
        finishBall(ball.scored);
        return;
      }

      ball.mesh.position.copy(ball.position);
      ball.mesh.rotation.x += ball.velocity.z * step * 0.55;
      ball.mesh.rotation.z -= ball.velocity.x * step * 0.55;
      ball.trailTick += 1;
      if (ball.trailTick % 4 === 0) {
        ball.trailPoints.push(ball.position.clone());
        if (ball.trailPoints.length > 22) ball.trailPoints.shift();
        updateDynamicGeometry(ball.trail.geometry, ball.trailPoints, 22);
      }
    };

    const release = () => {
      if (phase !== "charging" || !heldBall) return;
      const mesh = heldBall;
      heldBall = null;
      const start = heldPosition();
      mesh.position.copy(start);
      const trailGeometry = makeDynamicGeometry(22);
      updateDynamicGeometry(trailGeometry, [start, start], 22);
      const trail = new THREE.Line(
        trailGeometry,
        new THREE.LineBasicMaterial({
          color: trajectoryColor,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        }),
      );
      scene.add(trail);
      activeBall = {
        mesh,
        position: start,
        previous: start.clone(),
        velocity: aimDirection().multiplyScalar(launchSpeed()),
        radius: PAPER_RADIUS,
        age: 0,
        scored: false,
        insideBin: false,
        bounces: 0,
        trail,
        trailPoints: [start.clone()],
        trailTick: 0,
      };
      shots += 1;
      phase = "flying";
      trajectory.visible = false;
      trajectoryDots.visible = false;
      landingMarker.visible = false;
      playTone("throw");
      setHud((previous) => ({ ...previous, shots, status: "PAPER IN FLIGHT" }));
    };

    const beginCharge = () => {
      if (phase !== "ready" || !heldBall) return;
      phase = "charging";
      chargeStarted = performance.now();
      power = 0.32;
      setStatus("BUILDING THROW POWER");
    };

    const syncReticle = () => {
      if (aimRef.current) {
        const x = THREE.MathUtils.clamp(aimYawOffset / 0.14, -1, 1);
        const y = THREE.MathUtils.clamp(-aimPitchOffset / 0.15, -1, 1);
        aimRef.current.style.setProperty("--aim-x", `${x * 28}px`);
        aimRef.current.style.setProperty("--aim-y", `${y * 22}px`);
      }
    };

    const updateAimFromPointer = (event: PointerEvent) => {
      if (phase !== "ready" && phase !== "charging") return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const x = THREE.MathUtils.clamp(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -1, 1);
      const y = THREE.MathUtils.clamp(((event.clientY - bounds.top) / bounds.height) * 2 - 1, -1, 1);
      aimYawOffset = x * 0.14;
      aimPitchOffset = -y * 0.15;
      syncReticle();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || phase === "idle") return;
      renderer.domElement.focus({ preventScroll: true });
      renderer.domElement.setPointerCapture(event.pointerId);
      updateAimFromPointer(event);
      beginCharge();
    };
    const onPointerMove = (event: PointerEvent) => updateAimFromPointer(event);
    const onPointerUp = (event: PointerEvent) => {
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      updateAimFromPointer(event);
      release();
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      if (phase === "charging") {
        phase = "ready";
        power = 0.56;
        setStatus("AIM · HOLD · RELEASE");
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (document.activeElement !== renderer.domElement) return;
      if (event.code === "Space") {
        if (phase !== "ready" && phase !== "charging") return;
        event.preventDefault();
        if (!event.repeat) beginCharge();
        return;
      }
      if (phase !== "ready" && phase !== "charging") return;
      const key = event.key.toLowerCase();
      const isAimKey = ["arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s"].includes(key);
      if (!isAimKey) return;
      event.preventDefault();
      const yawStep = THREE.MathUtils.degToRad(0.8);
      const pitchStep = THREE.MathUtils.degToRad(0.7);
      if (key === "arrowleft" || key === "a") aimYawOffset -= yawStep;
      if (key === "arrowright" || key === "d") aimYawOffset += yawStep;
      if (key === "arrowup" || key === "w") aimPitchOffset += pitchStep;
      if (key === "arrowdown" || key === "s") aimPitchOffset -= pitchStep;
      aimYawOffset = THREE.MathUtils.clamp(aimYawOffset, -0.2, 0.2);
      aimPitchOffset = THREE.MathUtils.clamp(aimPitchOffset, -0.17, 0.2);
      syncReticle();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (document.activeElement === renderer.domElement && event.code === "Space" && phase === "charging") {
        event.preventDefault();
        release();
      }
    };

    const updateTrajectory = () => {
      if ((phase !== "ready" && phase !== "charging") || !heldBall) {
        trajectory.visible = false;
        trajectoryDots.visible = false;
        landingMarker.visible = false;
        aimRef.current?.classList.remove("on-target");
        return;
      }
      const points: THREE.Vector3[] = [];
      const position = heldPosition();
      const previous = position.clone();
      const velocity = aimDirection().multiplyScalar(launchSpeed());
      let predictedScore = false;
      let landed = false;
      let landing = position.clone();
      for (let i = 0; i < 360; i += 1) {
        previous.copy(position);
        velocity.y -= GRAVITY * FIXED_STEP;
        velocity.multiplyScalar(Math.exp(-0.13 * FIXED_STEP));
        position.addScaledVector(velocity, FIXED_STEP);
        if (i % 6 === 0) points.push(position.clone());
        if (previous.y >= target.mouthY && position.y < target.mouthY && velocity.y < 0) {
          const denominator = previous.y - position.y;
          const t = denominator > 0 ? (previous.y - target.mouthY) / denominator : 0;
          const crossX = THREE.MathUtils.lerp(previous.x, position.x, t);
          const crossZ = THREE.MathUtils.lerp(previous.z, position.z, t);
          const distance = Math.hypot(crossX - target.center.x, crossZ - target.center.z);
          if (distance < target.innerRadius - PAPER_RADIUS) {
            predictedScore = true;
            const mouthPoint = new THREE.Vector3(crossX, target.mouthY, crossZ);
            points.push(mouthPoint);
            landing = new THREE.Vector3(crossX, target.mouthY + 0.018, crossZ);
            landed = true;
            break;
          }
        }

        const radial = Math.hypot(
          position.x - target.center.x,
          position.z - target.center.z,
        );
        const rimDistance = Math.hypot(
          radial - target.rimRadius,
          position.y - target.mouthY,
        );
        if (rimDistance < PAPER_RADIUS + 0.028) {
          landing = position.clone();
          landed = true;
          break;
        }

        const hitsScene = currentLevel.colliders.some((box) =>
          position.x > box.min.x - PAPER_RADIUS &&
          position.x < box.max.x + PAPER_RADIUS &&
          position.y > box.min.y - PAPER_RADIUS &&
          position.y < box.max.y + PAPER_RADIUS &&
          position.z > box.min.z - PAPER_RADIUS &&
          position.z < box.max.z + PAPER_RADIUS,
        );
        if (hitsScene) {
          landing = position.clone();
          landed = true;
          break;
        }
        if (position.y <= PAPER_RADIUS) {
          landing = position.clone();
          landing.y = 0.012;
          landed = true;
          break;
        }
      }
      updateDynamicGeometry(trajectoryGeometry, points, 64);
      updateDynamicGeometry(
        dotGeometry,
        points.filter((_, index) => index % 2 === 0),
        32,
      );
      const color = predictedScore ? 0xb8ffbd : trajectoryColor;
      trajectoryMaterial.color.setHex(color);
      dotMaterial.color.setHex(color);
      landingMaterial.color.setHex(color);
      trajectory.visible = true;
      trajectoryDots.visible = true;
      landingMarker.visible = landed;
      if (landed) landingMarker.position.copy(landing);
      aimRef.current?.classList.toggle("on-target", predictedScore);
    };

    const updateOcean = (time: number) => {
      const ocean = currentLevel.group.children.find((child) => child.userData.isOcean) as THREE.Mesh | undefined;
      if (!ocean) return;
      const geometry = ocean.geometry as THREE.PlaneGeometry;
      const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
      const base = ocean.userData.waveBase as Float32Array;
      for (let i = 0; i < positions.count; i += 1) {
        const x = base[i * 3];
        const y = base[i * 3 + 1];
        positions.setZ(i, Math.sin(x * 0.42 + time * 1.2) * 0.08 + Math.sin(y * 0.31 - time * 0.85) * 0.055);
      }
      positions.needsUpdate = true;
      if (Math.floor(time * 10) % 3 === 0) geometry.computeVertexNormals();
    };

    const renderFrame = (now: number) => {
      if (disposed) return;
      const frameDelta = Math.min((now - previousFrame) / 1000, 0.05);
      previousFrame = now;
      elapsed += frameDelta;

      if (phase === "charging") {
        const charge = Math.min((now - chargeStarted) / 1200, 1);
        power = 0.32 + charge * 0.68;
      }
      if (powerRef.current) {
        powerRef.current.style.setProperty("--power", `${power}`);
        powerRef.current.parentElement?.setAttribute(
          "aria-valuenow",
          `${Math.round(power * 100)}`,
        );
      }

      if (heldBall) {
        heldBall.position.copy(heldPosition());
        const pulse = !reduceMotion && phase === "charging" ? 1 + Math.sin(elapsed * 16) * 0.035 : 1;
        heldBall.scale.setScalar(pulse);
        if (!reduceMotion) heldBall.rotation.y += frameDelta * 0.45;
      }

      accumulator += frameDelta;
      while (accumulator >= FIXED_STEP) {
        if (activeBall) updateBall(activeBall, FIXED_STEP);
        accumulator -= FIXED_STEP;
      }

      updateTrajectory();
      if (level === 2 && !reduceMotion) updateOcean(elapsed);
      if (!reduceMotion) landingMarker.rotation.z += frameDelta * 0.7;
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(renderFrame);
    };

    const onResize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", onResize);

    gameRef.current = {
      start: () => {
        if (phase === "idle") {
          phase = "ready";
          renderer.domElement.tabIndex = 0;
          void audioContext?.resume();
          setHud((previous) => ({ ...previous, status: "AIM · HOLD · RELEASE" }));
          schedule(() => renderer.domElement.focus({ preventScroll: true }), 0);
        }
      },
      restart: () => {
        for (const id of timeouts) window.clearTimeout(id);
        timeouts.clear();
        totalScore = 0;
        levelScore = 0;
        shots = 0;
        phase = "ready";
        renderer.domElement.tabIndex = 0;
        loadLevel(1);
        setHud({ ...initialHud(), status: "AIM · HOLD · RELEASE" });
        schedule(() => renderer.domElement.focus({ preventScroll: true }), 0);
      },
      toggleSound: () => {
        soundMuted = !soundMuted;
        return soundMuted;
      },
    };

    heldBall.position.copy(heldPosition());
    animationFrame = requestAnimationFrame(renderFrame);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      for (const id of timeouts) window.clearTimeout(id);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
      void audioContext?.close();
      gameRef.current = null;
    };
  }, []);

  const quotaPercent = Math.min(hud.levelScore, 100);
  const score = String(hud.score).padStart(3, "0");

  return (
    <main className={`game-shell level-${hud.level} ${started ? "is-started" : "is-idle"}`}>
      <div ref={mountRef} className="game-viewport" data-testid="game-viewport" />

      <div className="grain" aria-hidden="true" />

      {started && (
        <>
      <header className="top-hud" aria-label="Game status">
        <div className="brand-lockup hud-card">
          <span className="eyebrow">QUARTERLY WASTE REFINEMENT</span>
          <strong>TRASHKETBALL</strong>
          <span className="level-readout">LEVEL 0{hud.level} / {hud.level === 1 ? "SEVERED FLOOR" : "COASTAL HOUSE"}</span>
        </div>

        <div className="quota-card hud-card">
          <div className="quota-copy">
            <span>{hud.level === 1 ? "QUOTA" : "MODE"}</span>
            <strong>{hud.level === 1 ? `${String(hud.levelScore).padStart(3, "0")} / 100` : "OPEN PLAY"}</strong>
          </div>
          <div
            className="quota-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={hud.level === 1 ? quotaPercent : 100}
            aria-label={hud.level === 1 ? `${quotaPercent}% of level quota` : "Open play mode"}
          >
            <span style={{ width: hud.level === 1 ? `${quotaPercent}%` : "100%" }} />
          </div>
        </div>

        <div className="score-card hud-card">
          <span className="eyebrow">TOTAL SCORE</span>
          <strong>{score}</strong>
          <span>{hud.shots} {hud.shots === 1 ? "THROW" : "THROWS"}</span>
        </div>
      </header>

      <div ref={aimRef} className="aim-reticle" aria-hidden="true">
        <span className="aim-ring" />
        <span className="aim-dot" />
      </div>

      <div className="status-pill" role="status" aria-live="polite">
        <span className="status-light" />
        {hud.status}
      </div>

      <aside id="game-controls" className="controls-hint" aria-label="Controls">
        <span><kbd>DRAG</kbd> AIM</span>
        <span><kbd>HOLD</kbd> POWER</span>
        <span><kbd>RELEASE</kbd> THROW</span>
        <span className="keyboard-only"><kbd>ARROWS</kbd> KEYBOARD AIM</span>
        <span className="keyboard-only"><kbd>SPACE</kbd> KEYBOARD THROW</span>
      </aside>

      <div className="mobile-controls-hint">DRAG TO AIM · HOLD · RELEASE</div>

      <div className="throw-meter" aria-label="Throw power">
        <div className="meter-labels">
          <span>THROW POWER</span>
          <span>MAX</span>
        </div>
        <div
          className="meter-track"
          role="progressbar"
          aria-label="Current throw power"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={56}
        >
          <div ref={powerRef} className="meter-fill" />
          <i className="sweet-spot" />
        </div>
      </div>

      <div className="hud-actions">
        <button
          type="button"
          onClick={toggleSound}
          aria-label={muted ? "Turn sound on" : "Mute sound"}
          aria-pressed={muted}
        >
          {muted ? "SOUND OFF" : "SOUND ON"}
        </button>
        <button type="button" onClick={restartGame}>RESTART</button>
      </div>

      {hud.toast && <div className="score-toast">{hud.toast}</div>}

      {hud.transition && (
        <div className="transition-card" role="status" aria-live="assertive">
          <span>{hud.transitionKicker}</span>
          <strong>{hud.transition}</strong>
          <i />
        </div>
      )}
        </>
      )}

      {!started && (
        <section className="start-screen" aria-labelledby="game-title">
          <div className="start-panel">
            <div className="file-tab">WTR-02 / ACTIVE ASSIGNMENT</div>
            <p className="start-kicker">A TWO-STAGE PAPERWORK EXERCISE</p>
            <h1 id="game-title">
              MAKE WASTE.
              <br />
              <em>MEET QUOTA.</em>
            </h1>
            <p className="start-copy">
              Sink ten paper balls on the severed floor to earn your coastal transfer. Every clean basket is worth 10 points.
            </p>
            <div className="mission-grid">
              <div><span>01</span><strong>OFFICE QUOTA</strong><small>100 points to transfer</small></div>
              <div><span>02</span><strong>BEACH OPEN PLAY</strong><small>High ceilings · open play</small></div>
            </div>
            <button className="start-button" type="button" onClick={startGame}>
              <span>CLOCK IN</span>
              <i aria-hidden="true">↗</i>
            </button>
            <p className="start-footnote">Works with mouse, touch, or keyboard · trajectory assistance enabled</p>
          </div>
        </section>
      )}
    </main>
  );
}
