import * as THREE from "three";
import { RoundedBoxGeometry } from "../vendor/RoundedBoxGeometry.js";
import { PART_DEFS, getPartDefinition } from "./parts.js";

const TAU = Math.PI * 2;

function createGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(215,248,255,1)");
  gradient.addColorStop(0.16, "rgba(90,212,255,.9)");
  gradient.addColorStop(0.45, "rgba(27,136,255,.28)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createLabelTexture(lines, options = {}) {
  const {
    width = 512,
    height = 160,
    background = "#07111c",
    foreground = "#d8f5ff",
    accent = "#4fd7ff",
    align = "center",
  } = options;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(79, 215, 255, .35)";
  context.lineWidth = 4;
  context.strokeRect(2, 2, width - 4, height - 4);
  context.fillStyle = accent;
  context.fillRect(0, 0, 12, height);
  context.textAlign = align;
  context.textBaseline = "middle";
  const content = Array.isArray(lines) ? lines : [lines];
  content.forEach((line, index) => {
    const primary = index === 0;
    context.font = `${primary ? 700 : 500} ${primary ? 42 : 28}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    context.fillStyle = primary ? foreground : "rgba(174, 217, 235, .72)";
    const x = align === "center" ? width / 2 : 34;
    context.fillText(line, x, height * (primary ? 0.4 : 0.7));
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class Machine {
  constructor(scene, tweens) {
    this.scene = scene;
    this.tweens = tweens;
    this.root = new THREE.Group();
    this.root.name = "SinglePCS_AutomaticFeeding_Machine";
    this.scene.add(this.root);

    this.parts = new Map();
    this.sections = {};
    this.mainProducts = [];
    this.supplyProducts = [];
    this.gridConfig = {
      rows: 8,
      cols: 8,
      pitchX: 0.034,
      pitchZ: 0.022,
    };
    this.onConveyorSpeed = 0;
    this.cameraFlashTimer = 0;
    this.conveyorRunning = false;
    this.vacuumActive = false;
    this.shellMode = "transparent";
    this.cabinetOpen = false;
    this.exploded = null;
    this.partExplodeStates = new Map();

    this._createMaterials();
    this._createSections();
    this._buildFrame();
    this._buildConveyor();
    this._buildTransferSystem();
    this._buildVisionSystem();
    this._buildXYZSystem();
    this._buildSupplySystem();
    this._buildElectricalSystem();
    this._buildHMI();
    this._createScannerEffect();
    this._optimizeStaticRender();
    this._captureHomeTransforms();
  }

  _createMaterials() {
    const standard = (color, metalness, roughness, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });

    this.materials = {
      frame: standard(0x8797a6, 0.82, 0.33),
      frameDark: standard(0x172535, 0.76, 0.3),
      brushed: standard(0x526476, 0.9, 0.24),
      steel: standard(0xb9c3cb, 0.95, 0.18),
      blackMetal: standard(0x050b12, 0.68, 0.31),
      furniture: standard(0x0a1520, 0.5, 0.4),
      rubber: standard(0x071015, 0.08, 0.72),
      blue: standard(0x148dd2, 0.75, 0.2, { emissive: 0x063f71, emissiveIntensity: 1.1 }),
      cyan: standard(0x67dfff, 0.55, 0.18, { emissive: 0x0d8dbf, emissiveIntensity: 1.8 }),
      green: standard(0x38e4a0, 0.2, 0.24, { emissive: 0x0f9f68, emissiveIntensity: 2.2 }),
      amber: standard(0xffbb4d, 0.25, 0.25, { emissive: 0xa95c08, emissiveIntensity: 1.7 }),
      red: standard(0xff4f55, 0.3, 0.3, { emissive: 0x9e0812, emissiveIntensity: 1.6 }),
      gold: standard(0xc79845, 0.8, 0.28),
      ceramic: standard(0x17323d, 0.25, 0.45),
      productTop: standard(0x2cc6a2, 0.35, 0.3, { emissive: 0x063d32, emissiveIntensity: 0.45 }),
      screen: standard(0x04141d, 0.2, 0.23, { emissive: 0x0a5f7d, emissiveIntensity: 0.7 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x69b7d8,
        metalness: 0.1,
        roughness: 0.08,
        transmission: 0,
        transparent: true,
        opacity: 0.17,
        thickness: 0,
        ior: 1.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      darkGlass: new THREE.MeshPhysicalMaterial({
        color: 0x0a3146,
        metalness: 0.2,
        roughness: 0.12,
        transmission: 0,
        transparent: true,
        opacity: 0.66,
        thickness: 0,
        side: THREE.DoubleSide,
      }),
      emissivePanel: new THREE.MeshStandardMaterial({
        color: 0xa7ecff,
        emissive: 0x5bdcff,
        emissiveIntensity: 2.8,
        metalness: 0.1,
        roughness: 0.22,
      }),
    };
    this.shellMaterials = [this.materials.glass];
    this.backlightMaterials = [];
  }

  _createSections() {
    const sectionNames = ["frame", "shell", "conveyor", "yTransfer", "vision", "xyz", "supply", "electrical", "hmi"];
    for (const name of sectionNames) {
      const group = new THREE.Group();
      group.name = `section_${name}`;
      this.root.add(group);
      this.sections[name] = group;
    }

    this.guardGroup = new THREE.Group();
    this.guardGroup.name = "IndustrialSafetyEnclosure";
    this.sections.shell.add(this.guardGroup);
    this._registerPart("safetyEnclosure", this.guardGroup);
  }

  _registerPart(id, object) {
    object.name = object.name || id;
    object.userData.partId = id;
    object.userData.partDefinition = getPartDefinition(id);
    this.parts.set(id, object);
    return object;
  }

  _markPart(object, id) {
    object.userData.partId = id;
    object.userData.partDefinition = getPartDefinition(id);
    this.parts.set(id, object);
    return object;
  }

  _group(parent, name, position = [0, 0, 0]) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(...position);
    parent.add(group);
    return group;
  }

  _mesh(parent, name, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  _box(parent, name, size, position, material, options = {}) {
    const geometry = options.rounded
      ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, options.radius ?? Math.min(...size) * 0.12)
      : new THREE.BoxGeometry(...size);
    const mesh = this._mesh(parent, name, geometry, material, position, options.rotation || [0, 0, 0]);
    if (options.edges) this._addEdges(mesh, options.edgeColor ?? 0x61798d, options.edgeOpacity ?? 0.38);
    return mesh;
  }

  _cylinder(parent, name, radiusTop, radiusBottom, height, position, material, rotation = [0, 0, 0], segments = 24) {
    return this._mesh(
      parent,
      name,
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
      material,
      position,
      rotation,
    );
  }

  _addEdges(mesh, color = 0x61798d, opacity = 0.4) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 20),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
    );
    edges.name = `${mesh.name}_Edges`;
    edges.userData.isHelper = true;
    mesh.add(edges);
    return edges;
  }

  _beam(parent, name, size, position, material = this.materials.frame, options = {}) {
    const beam = this._box(parent, name, size, position, material, { edges: true, ...options });
    const longAxis = size.indexOf(Math.max(...size));
    if (options.grooves !== false) {
      const grooveMaterial = this.materials.frameDark;
      if (longAxis === 0) {
        for (const y of [-size[1] * 0.2, size[1] * 0.2]) {
          this._box(parent, `${name}_Groove_${y}`, [size[0] * 0.94, size[1] * 0.025, 0.003], [position[0], position[1] + y, position[2] + size[2] / 2 + 0.002], grooveMaterial);
        }
      } else if (longAxis === 1) {
        for (const x of [-size[0] * 0.2, size[0] * 0.2]) {
          this._box(parent, `${name}_Groove_${x}`, [size[0] * 0.025, size[1] * 0.94, 0.003], [position[0] + x, position[1], position[2] + size[2] / 2 + 0.002], grooveMaterial);
        }
      } else {
        for (const x of [-size[0] * 0.2, size[0] * 0.2]) {
          this._box(parent, `${name}_Groove_${x}`, [size[0] * 0.025, 0.003, size[2] * 0.94], [position[0] + x, position[1] + size[1] / 2 + 0.002, position[2]], grooveMaterial);
        }
      }
    }
    return beam;
  }

  _addLabel(parent, name, lines, size, position, rotation = [0, 0, 0], options = {}) {
    const texture = createLabelTexture(lines, options);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: options.transparent ?? false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const plane = this._mesh(
      parent,
      name,
      new THREE.PlaneGeometry(size[0], size[1]),
      material,
      position,
      rotation,
    );
    plane.userData.isLabel = true;
    plane.castShadow = false;
    return plane;
  }

  _buildFrame() {
    const section = this.sections.frame;
    const frame = this._group(section, "AluminumFrameAssembly");
    this._registerPart("mainFrame", frame);

    this._box(frame, "MachinePlinth", [1.66, 0.1, 1.06], [0, 0.05, 0], this.materials.blackMetal, {
      rounded: true,
      radius: 0.012,
      edges: true,
      edgeColor: 0x34495d,
    });
    this._box(frame, "MachineDeck", [1.58, 0.035, 0.98], [0, 0.685, 0], this.materials.frameDark, {
      edges: true,
      edgeColor: 0x334c61,
    });
    this._box(frame, "LowerKickPanel", [1.54, 0.48, 0.035], [0, 0.37, 0.495], this.materials.furniture, {
      rounded: true,
      radius: 0.01,
      edges: true,
      edgeOpacity: 0.2,
    });
    this._addLabel(
      frame,
      "MachineNameplate",
      ["SINGLE PCS", "AUTO FEEDING · INSPECTION"],
      [0.48, 0.14],
      [-0.36, 0.39, 0.516],
      [0, 0, 0],
      { width: 820, height: 220, align: "left", background: "#06111b", foreground: "#bcefff", accent: "#4fd7ff" },
    );

    for (const x of [-0.74, 0.74]) {
      for (const z of [-0.44, 0.44]) {
        this._cylinder(frame, `LevelingFoot_${x}_${z}`, 0.025, 0.031, 0.055, [x, 0.028, z], this.materials.steel, [0, 0, 0], 16);
      }
    }

    for (const x of [-0.77, 0.77]) {
      for (const z of [-0.47, 0.47]) {
        this._beam(frame, `FramePost_${x}_${z}`, [0.046, 1.52, 0.046], [x, 0.91, z], this.materials.frame, { grooves: false });
      }
    }

    this._beam(frame, "FrontTopBeam", [1.59, 0.055, 0.055], [0, 1.68, 0.47], this.materials.frame, { grooves: false });
    this._beam(frame, "RearTopBeam", [1.59, 0.055, 0.055], [0, 1.68, -0.47], this.materials.frame, { grooves: false });
    this._beam(frame, "TopLeftBeam", [0.045, 0.045, 0.95], [-0.77, 1.64, 0], this.materials.frame, { grooves: false });
    this._beam(frame, "TopRightBeam", [0.045, 0.045, 0.95], [0.77, 1.64, 0], this.materials.frame, { grooves: false });
    this._beam(frame, "MidFrontBeam", [1.59, 0.04, 0.04], [0, 0.71, 0.47], this.materials.frameDark, { grooves: false });
    this._beam(frame, "MidRearBeam", [1.59, 0.04, 0.04], [0, 0.71, -0.47], this.materials.frameDark, { grooves: false });
    this._beam(frame, "LeftMidPost", [0.04, 0.5, 0.04], [-0.77, 0.46, 0.42], this.materials.frameDark, { grooves: false });
    this._beam(frame, "RightMidPost", [0.04, 0.5, 0.04], [0.77, 0.46, 0.42], this.materials.frameDark, { grooves: false });

    const warningGroup = this._group(frame, "SafetyStripeGroup", [-0.58, 0.12, 0.519]);
    for (let i = 0; i < 9; i += 1) {
      this._box(warningGroup, `SafetyStripe_${i}`, [0.025, 0.12, 0.004], [-0.16 + i * 0.04, 0, 0], this.materials.amber, {
        rotation: [0, 0, -0.6],
      });
    }

    this._buildSafetyEnclosure(frame);
    this._buildSignalTower(frame);
    this._buildEStop(frame);
  }

  _buildSafetyEnclosure(frame) {
    const glass = this.materials.glass;
    const sideX = 0.785;
    this._box(this.guardGroup, "LeftSafetyWindow", [0.006, 1.18, 0.82], [-sideX, 1.06, 0], glass);
    this._box(this.guardGroup, "RightSafetyWindow", [0.006, 1.18, 0.82], [sideX, 1.06, 0], glass);
    this._box(this.guardGroup, "RearSafetyWindow", [1.48, 1.1, 0.006], [0, 1.05, -0.492], glass);
    this._box(this.guardGroup, "TopSafetyWindow", [1.48, 0.006, 0.82], [0, 1.71, 0], glass);

    for (const side of [-1, 1]) {
      const x = side * sideX;
      this._box(this.guardGroup, `SideWindowFrameFront_${side}`, [0.018, 1.22, 0.018], [x, 1.06, 0.42], this.materials.frameDark, { edges: true });
      this._box(this.guardGroup, `SideWindowFrameRear_${side}`, [0.018, 1.22, 0.018], [x, 1.06, -0.42], this.materials.frameDark, { edges: true });
    }

    const doorGroup = this._group(this.guardGroup, "FrontSafetyDoors", [0, 0, 0]);
    this._registerPart("frontDoor", doorGroup);
    this.frontDoors = [];
    for (const side of [-1, 1]) {
      const hinge = this._group(doorGroup, `FrontDoorHinge_${side > 0 ? "R" : "L"}`, [side * 0.76, 1.06, 0.49]);
      this.frontDoors.push(hinge);
      const sign = -side;
      this._box(hinge, `FrontDoorGlass_${side}`, [0.7, 1.14, 0.008], [sign * 0.35, 0, 0], this.materials.glass);
      this._box(hinge, `FrontDoorTopRail_${side}`, [0.71, 0.028, 0.025], [sign * 0.35, 0.58, 0], this.materials.frameDark, { edges: true });
      this._box(hinge, `FrontDoorBottomRail_${side}`, [0.71, 0.028, 0.025], [sign * 0.35, -0.58, 0], this.materials.frameDark, { edges: true });
      this._box(hinge, `FrontDoorInnerRail_${side}`, [0.028, 1.15, 0.025], [sign * 0.015, 0, 0], this.materials.frameDark, { edges: true });
      this._box(hinge, `FrontDoorOuterRail_${side}`, [0.028, 1.15, 0.025], [sign * 0.69, 0, 0], this.materials.frameDark, { edges: true });
      this._box(hinge, `DoorHandle_${side}`, [0.022, 0.18, 0.035], [sign * 0.62, 0, 0.035], this.materials.steel);
      this._box(hinge, `DoorHandleMount_${side}`, [0.045, 0.06, 0.018], [sign * 0.62, 0, 0.018], this.materials.blackMetal);
    }
  }

  _buildSignalTower(frame) {
    const tower = this._group(frame, "StatusTowerAssembly", [0.69, 1.7, -0.38]);
    this._registerPart("signalTower", tower);
    this._cylinder(tower, "StatusTowerPole", 0.012, 0.012, 0.18, [0, 0.08, 0], this.materials.steel, [0, 0, 0], 16);
    this._cylinder(tower, "StatusTowerBase", 0.028, 0.032, 0.03, [0, 0.01, 0], this.materials.blackMetal);
    this.statusLights = [];
    const colors = [
      [0x39e3a0, this.materials.green],
      [0xffb64f, this.materials.amber],
      [0xff4d59, this.materials.red],
    ];
    for (let i = 0; i < 3; i += 1) {
      const material = colors[i][1].clone();
      material.emissiveIntensity = i === 0 ? 2.8 : 0.25;
      this.statusLights.push(material);
      this._cylinder(tower, `StatusLight_${i}`, 0.031, 0.031, 0.058, [0, 0.19 + i * 0.06, 0], material, [0, 0, 0], 24);
    }
    this._cylinder(tower, "StatusTowerCap", 0.035, 0.026, 0.02, [0, 0.38, 0], this.materials.blackMetal);
  }

  _buildEStop(frame) {
    const box = this._group(frame, "EmergencyStopStation", [0.69, 0.55, 0.522]);
    this._registerPart("estop", box);
    this._box(box, "EStopPanel", [0.2, 0.19, 0.025], [0, 0, 0], this.materials.frameDark, { rounded: true, radius: 0.01, edges: true });
    this._cylinder(box, "EStopYellowRing", 0.047, 0.047, 0.018, [0, 0.02, 0.022], this.materials.amber, [Math.PI / 2, 0, 0], 32);
    this._cylinder(box, "EStopRedMushroom", 0.035, 0.041, 0.036, [0, 0.02, 0.047], this.materials.red, [Math.PI / 2, 0, 0], 24);
    this._addLabel(
      box,
      "EmergencyStopLabel",
      ["EMERGENCY STOP"],
      [0.16, 0.038],
      [0, -0.06, 0.014],
      [0, 0, 0],
      { width: 700, height: 100, background: "#151000", foreground: "#ffd969", accent: "#ffbb3d" },
    );
  }

  _buildConveyor() {
    const section = this.sections.conveyor;
    this.conveyorRailsGroup = this._group(section, "ConveyorRailAssembly");
    this._registerPart("conveyorRails", this.conveyorRailsGroup);
    const railL = this._group(this.conveyorRailsGroup, "ConveyorRail_Left", [0, 0, -0.155]);
    const railR = this._group(this.conveyorRailsGroup, "ConveyorRail_Right", [0, 0, 0.155]);
    this.conveyorRailParts = [railL, railR];
    for (const [index, rail] of this.conveyorRailParts.entries()) {
      this._box(rail, `ConveyorRailProfile_${index}`, [1.22, 0.045, 0.055], [0, 0.735, 0], this.materials.frame, {
        rounded: true,
        radius: 0.008,
        edges: true,
        edgeColor: 0x66849a,
      });
      this._box(rail, `ConveyorRailTopStrip_${index}`, [1.18, 0.008, 0.013], [0, 0.762, 0], this.materials.steel);
      this._box(rail, `ConveyorRailScale_${index}`, [1.04, 0.0015, 0.006], [0, 0.778, -0.02], this.materials.emissivePanel);
    }

    const beltAssembly = this._group(section, "DualBeltConveyor");
    this._registerPart("conveyorBelt", beltAssembly);
    this.beltRollers = [];
    for (const z of [-0.085, 0.085]) {
      this._box(beltAssembly, `ConveyorBelt_${z}`, [1.13, 0.012, 0.075], [0, 0.781, z], this.materials.rubber, {
        rounded: true,
        radius: 0.006,
      });
      for (let i = 0; i < 18; i += 1) {
        const roller = this._cylinder(
          beltAssembly,
          `ConveyorRoller_${z}_${i}`,
          0.018,
          0.018,
          0.092,
          [-0.54 + i * 0.064, 0.775, z],
          this.materials.steel,
          [Math.PI / 2, 0, 0],
          16,
        );
        this.beltRollers.push(roller);
      }
    }

    const motorGroup = this._group(section, "ConveyorDriveMotorGroup", [-0.62, 0.685, -0.2]);
    this._registerPart("conveyorMotor", motorGroup);
    this._cylinder(motorGroup, "ConveyorMotorBody", 0.052, 0.052, 0.12, [0, 0, 0], this.materials.frameDark, [0, 0, Math.PI / 2], 28);
    this._cylinder(motorGroup, "ConveyorGearbox", 0.045, 0.045, 0.055, [0.085, 0, 0], this.materials.brushed, [0, 0, Math.PI / 2], 24);
    this._box(motorGroup, "ConveyorMotorMount", [0.085, 0.08, 0.12], [-0.04, -0.04, 0], this.materials.frameDark, { edges: true });
    this._addLabel(
      motorGroup,
      "ConveyorMotorLabel",
      ["SERVO · 200W"],
      [0.15, 0.035],
      [0, 0.052, 0],
      [-Math.PI / 2, 0, 0],
      { width: 580, height: 100, background: "#06111b", foreground: "#b9eaff", accent: "#4fd7ff" },
    );

    const locatorGroup = this._group(section, "PalletLocatorGroup");
    this._registerPart("palletLocator", locatorGroup);
    for (const side of [-1, 1]) {
      this._cylinder(
        locatorGroup,
        `PalletLocatorCylinder_${side}`,
        0.018,
        0.018,
        0.075,
        [0.07, 0.79, side * 0.18],
        this.materials.frameDark,
        [0, 0, 0],
        18,
      );
      this._box(locatorGroup, `PalletLocatorPin_${side}`, [0.018, 0.018, 0.032], [0.07, 0.823, side * 0.16], this.materials.cyan);
    }

    this.palletXGroup = this._group(section, "PalletXTransport", [-0.52, 0.79, 0]);
    this.palletYGroup = this._group(this.palletXGroup, "PalletYTransfer", [0, 0, 0]);
    this._registerPart("transferStage", this.palletYGroup);

    const pallet = this._group(this.palletYGroup, "MainInspectionPallet");
    this._registerPart("mainPallet", pallet);
    this.mainPalletGroup = pallet;
    this._box(pallet, "MainPalletBody", [0.3, 0.018, 0.2], [0, 0, 0], this.materials.blackMetal, {
      rounded: true,
      radius: 0.006,
      edges: true,
      edgeColor: 0x5c7b90,
    });
    this._box(pallet, "MainPalletTopPlate", [0.282, 0.004, 0.182], [0, 0.011, 0], this.materials.furniture);
    for (const x of [-0.139, 0.139]) {
      this._box(pallet, `MainPalletSideRail_${x}`, [0.012, 0.035, 0.196], [x, 0.016, 0], this.materials.frame, { edges: true });
    }
    for (const z of [-0.09, 0.09]) {
      this._box(pallet, `MainPalletEndRail_${z}`, [0.276, 0.035, 0.012], [0, 0.016, z], this.materials.frame, { edges: true });
    }
    this._box(pallet, "PalletRFIDTag", [0.036, 0.004, 0.018], [-0.11, 0.016, 0.075], this.materials.cyan);

    this.mainProductContainer = this._group(pallet, "MainProductArray", [0, 0.022, 0]);
    this._markPart(this.mainProductContainer, "mainProducts");
    this._rebuildProductArray(this.mainProductContainer, this.mainProducts, "mainProduct", false);

    this._addLabel(
      section,
      "ConveyorStationLabel",
      ["X-AXIS · PALLET FEED"],
      [0.3, 0.045],
      [0, 0.7, 0.25],
      [-Math.PI / 2, 0, 0],
      { width: 800, height: 120, background: "#06121d", foreground: "#b8efff", accent: "#40d4ff" },
    );

    this._box(section, "OutputBufferPlate", [0.42, 0.02, 0.18], [0.53, 0.72, -0.16], this.materials.frameDark, {
      rounded: true,
      radius: 0.008,
      edges: true,
      edgeOpacity: 0.18,
    });
  }

  _buildTransferSystem() {
    const section = this.sections.yTransfer;
    const guides = this._group(section, "YTransferGuideAssembly");
    this._registerPart("transferGuides", guides);
    for (const z of [-0.12, 0.12]) {
      this._box(guides, `YTransferGuide_${z}`, [0.26, 0.025, 0.018], [0, 0.662, z], this.materials.steel, {
        edges: true,
        edgeColor: 0x8facbe,
      });
    }
    this._box(guides, "YTransferMountPlate", [0.32, 0.012, 0.25], [0, 0.647, 0], this.materials.frameDark, { edges: true });
    this._cylinder(guides, "YTransferLeadScrew", 0.008, 0.008, 0.39, [0.16, 0.674, 0], this.materials.steel, [Math.PI / 2, 0, 0], 18);

    const clamps = this._group(section, "PalletPositioningClamps");
    this._registerPart("locatorClamps", clamps);
    for (const side of [-1, 1]) {
      this._box(clamps, `LocatorClampJaw_${side}`, [0.045, 0.022, 0.045], [0.18, 0.8, side * 0.13], this.materials.cyan, {
        rounded: true,
        radius: 0.004,
      });
      this._box(clamps, `LocatorClampBody_${side}`, [0.04, 0.052, 0.038], [0.18, 0.77, side * 0.17], this.materials.frameDark);
    }

    const drive = this._group(section, "YTransferServoDrive", [0.18, 0.65, -0.245]);
    this._registerPart("transferDrive", drive);
    this._cylinder(drive, "YTransferServoMotor", 0.038, 0.038, 0.1, [0, 0, 0], this.materials.frameDark, [0, 0, Math.PI / 2], 24);
    this._cylinder(drive, "YTransferCoupler", 0.024, 0.024, 0.035, [0.069, 0, 0], this.materials.steel, [0, 0, Math.PI / 2], 18);
    this._addLabel(
      section,
      "YStageLabel",
      ["Y-AXIS TRANSFER"],
      [0.22, 0.035],
      [0.26, 0.665, 0.05],
      [-Math.PI / 2, 0, -Math.PI / 2],
      { width: 650, height: 100, background: "#05131a", foreground: "#bdeffe", accent: "#67d7ff" },
    );
  }

  _buildVisionSystem() {
    const section = this.sections.vision;
    const bracket = this._group(section, "VisionCameraBracket");
    this._registerPart("cameraBracket", bracket);
    this._beam(bracket, "CameraCrossBeam", [1.2, 0.052, 0.05], [0, 1.58, -0.04], this.materials.frame, { grooves: false });
    this._box(bracket, "CameraVerticalBracket", [0.045, 0.27, 0.045], [0, 1.44, -0.04], this.materials.frame, { edges: true });
    this._box(bracket, "CameraFineAdjustPlate", [0.14, 0.012, 0.12], [0, 1.345, -0.04], this.materials.brushed, { edges: true });

    const camera = this._group(section, "HikrobotIndustrialCamera", [0, 1.34, -0.04]);
    this._registerPart("visionCamera", camera);
    this._box(camera, "HikrobotCameraBody", [0.105, 0.09, 0.13], [0, 0, 0], this.materials.darkGlass, {
      rounded: true,
      radius: 0.01,
      edges: true,
      edgeColor: 0x74a9c2,
    });
    this._box(camera, "HikrobotCameraRear", [0.085, 0.074, 0.025], [0, 0, -0.075], this.materials.frameDark, { rounded: true, radius: 0.006 });
    this._box(camera, "HikrobotCameraLED", [0.04, 0.006, 0.006], [0, 0.04, -0.07], this.materials.cyan);
    this._addLabel(
      camera,
      "HikrobotCameraLabel",
      ["HIKROBOT", "MV-CS050-10GC"],
      [0.09, 0.045],
      [0, 0, 0.066],
      [0, 0, 0],
      { width: 560, height: 180, background: "#061621", foreground: "#d6f7ff", accent: "#4ed8ff" },
    );

    const lens = this._group(camera, "IndustrialCameraLens", [0, -0.1, 0]);
    this._registerPart("visionLens", lens);
    this._cylinder(lens, "LensBarrel", 0.033, 0.039, 0.08, [0, 0, 0], this.materials.frameDark, [0, 0, 0], 32);
    this._cylinder(lens, "LensGlass", 0.028, 0.028, 0.008, [0, -0.043, 0], this.materials.darkGlass, [0, 0, 0], 32);
    this._cylinder(lens, "LensLightRing", 0.045, 0.045, 0.008, [0, -0.052, 0], this.materials.cyan, [0, 0, 0], 32);
    this._cylinder(lens, "LensLockRing", 0.04, 0.04, 0.012, [0, 0.025, 0], this.materials.steel, [0, 0, 0], 32);

    const backlight = this._group(section, "BacklightAssembly", [0, 0.664, 0.015]);
    this._registerPart("backlight", backlight);
    this._box(backlight, "BacklightHousing", [0.34, 0.028, 0.235], [0, 0, 0], this.materials.frameDark, {
      rounded: true,
      radius: 0.008,
      edges: true,
      edgeColor: 0x3d6e84,
    });
    const lightMaterial = this.materials.emissivePanel.clone();
    lightMaterial.emissiveIntensity = 0.16;
    this.backlightMaterials.push(lightMaterial);
    this._box(backlight, "BacklightDiffuser", [0.295, 0.004, 0.19], [0, 0.017, 0], lightMaterial);
    this._box(backlight, "BacklightCable", [0.012, 0.012, 0.22], [0.18, 0.005, -0.12], this.materials.rubber);

    this.cameraFlashLight = new THREE.PointLight(0xb8f1ff, 0, 1.4, 2);
    this.cameraFlashLight.position.set(0, 1.14, 0);
    section.add(this.cameraFlashLight);
    this.cameraFlashSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createGlowTexture(),
        color: 0x8fe9ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.cameraFlashSprite.scale.set(0.38, 0.38, 1);
    this.cameraFlashSprite.position.set(0, 1.02, 0.015);
    section.add(this.cameraFlashSprite);
  }

  _buildXYZSystem() {
    const section = this.sections.xyz;
    this.xAxisGroup = this._group(section, "XAxisServoModule");
    this._registerPart("xAxisModule", this.xAxisGroup);

    this._beam(this.xAxisGroup, "XAxisBeam", [1.36, 0.085, 0.105], [0, 1.52, -0.03], this.materials.frameDark, { grooves: false });
    this._box(this.xAxisGroup, "XAxisLinearRail", [1.24, 0.018, 0.025], [0, 1.482, 0.026], this.materials.steel, { edges: true, edgeOpacity: 0.28 });
    this._cylinder(this.xAxisGroup, "XAxisBallScrew", 0.009, 0.009, 1.26, [0, 1.49, -0.03], this.materials.steel, [0, 0, Math.PI / 2], 18);
    this._box(this.xAxisGroup, "XAxisCableDuct", [1.18, 0.04, 0.035], [0, 1.58, -0.085], this.materials.rubber);
    const xServo = this._group(this.xAxisGroup, "XAxisServoMotor", [-0.72, 1.52, -0.03]);
    this._cylinder(xServo, "XAxisServoBody", 0.046, 0.046, 0.12, [0, 0, 0], this.materials.frameDark, [0, 0, Math.PI / 2], 24);
    this._cylinder(xServo, "XAxisServoCap", 0.042, 0.042, 0.03, [0.075, 0, 0], this.materials.cyan, [0, 0, Math.PI / 2], 24);
    this._addLabel(
      this.xAxisGroup,
      "XAxisModuleLabel",
      ["X SERVO · 1.2M"],
      [0.19, 0.03],
      [0.21, 1.477, 0.056],
      [0, 0, 0],
      { width: 560, height: 100, background: "#051521", foreground: "#c9f5ff", accent: "#48cfff" },
    );

    this.xCarriageGroup = this._group(this.xAxisGroup, "XAxisMovingCarriage");
    this._box(this.xCarriageGroup, "XAxisCarriageBlock", [0.13, 0.1, 0.13], [0, 1.455, 0], this.materials.brushed, {
      rounded: true,
      radius: 0.008,
      edges: true,
      edgeColor: 0x7eb4c9,
    });
    this._box(this.xCarriageGroup, "XAxisCarriageGlow", [0.08, 0.006, 0.012], [0, 1.407, 0.068], this.materials.cyan);

    this.yAxisGroup = this._group(this.xCarriageGroup, "YAxisServoModule", [0, 1.43, 0]);
    this._registerPart("yAxisModule", this.yAxisGroup);
    this._beam(this.yAxisGroup, "YAxisBeam", [0.12, 0.08, 0.7], [0, 0, 0], this.materials.frameDark, { grooves: false });
    this._box(this.yAxisGroup, "YAxisLinearRail", [0.028, 0.018, 0.62], [0, -0.03, 0], this.materials.steel, { edges: true, edgeOpacity: 0.25 });
    this._cylinder(this.yAxisGroup, "YAxisBallScrew", 0.008, 0.008, 0.64, [0.045, -0.004, 0], this.materials.steel, [Math.PI / 2, 0, 0], 16);
    const yServo = this._group(this.yAxisGroup, "YAxisServoMotor", [0, 0.045, -0.39]);
    this._cylinder(yServo, "YAxisServoBody", 0.04, 0.04, 0.11, [0, 0, 0], this.materials.frameDark, [Math.PI / 2, 0, 0], 24);
    this._cylinder(yServo, "YAxisServoCap", 0.038, 0.038, 0.03, [0, 0, -0.07], this.materials.cyan, [Math.PI / 2, 0, 0], 24);

    this.yCarriageGroup = this._group(this.yAxisGroup, "YAxisMovingCarriage");
    this._box(this.yCarriageGroup, "YAxisCarriageBlock", [0.14, 0.11, 0.1], [0, -0.01, 0], this.materials.brushed, {
      rounded: true,
      radius: 0.008,
      edges: true,
      edgeColor: 0x76aec5,
    });

    this.zAxisGroup = this._group(this.yCarriageGroup, "ZAxisServoModule", [0, 0, 0.08]);
    this._registerPart("zAxisModule", this.zAxisGroup);
    this._box(this.zAxisGroup, "ZAxisBackPlate", [0.12, 0.42, 0.12], [0, -0.16, 0], this.materials.frameDark, {
      rounded: true,
      radius: 0.009,
      edges: true,
      edgeColor: 0x5c8598,
    });
    this._box(this.zAxisGroup, "ZAxisLinearRail", [0.025, 0.34, 0.018], [0, -0.18, 0.064], this.materials.steel, { edges: true, edgeOpacity: 0.2 });
    this._cylinder(this.zAxisGroup, "ZAxisBallScrew", 0.007, 0.007, 0.35, [0.038, -0.18, 0.046], this.materials.steel, [0, 0, 0], 16);
    const zServo = this._group(this.zAxisGroup, "ZAxisServoMotor", [0, 0.08, -0.045]);
    this._cylinder(zServo, "ZAxisServoBody", 0.044, 0.044, 0.12, [0, 0, 0], this.materials.frameDark, [0, 0, 0], 24);
    this._cylinder(zServo, "ZAxisServoBrake", 0.042, 0.042, 0.025, [0, 0.071, 0], this.materials.cyan, [0, 0, 0], 24);

    this.zStageGroup = this._group(this.zAxisGroup, "ZAxisNozzleStage", [0, 0.02, 0.078]);
    this._box(this.zStageGroup, "NozzleStageBody", [0.09, 0.08, 0.075], [0, -0.17, 0], this.materials.brushed, {
      rounded: true,
      radius: 0.006,
      edges: true,
      edgeColor: 0x80b6cd,
    });
    const nozzle = this._group(this.zStageGroup, "VacuumNozzleAssembly", [0, -0.25, 0]);
    this._registerPart("vacuumNozzle", nozzle);
    this._cylinder(nozzle, "VacuumNozzleShaft", 0.005, 0.005, 0.16, [0, -0.04, 0], this.materials.steel, [0, 0, 0], 16);
    this._cylinder(nozzle, "VacuumNozzleCup", 0.009, 0.018, 0.023, [0, -0.128, 0], this.materials.cyan, [0, 0, 0], 20);
    this._cylinder(nozzle, "VacuumNozzleSpring", 0.011, 0.011, 0.032, [0, -0.085, 0], this.materials.amber, [0, 0, 0], 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x5de4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.vacuumGlow = this._mesh(nozzle, "VacuumGlowRing", new THREE.TorusGeometry(0.018, 0.003, 8, 28), glowMaterial, [0, -0.14, 0], [Math.PI / 2, 0, 0]);

    const tubing = this._group(this.zAxisGroup, "VacuumTubeAssembly");
    this._registerPart("vacuumTubing", tubing);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.01, 0.02),
      new THREE.Vector3(0.095, 0.04, 0.02),
      new THREE.Vector3(0.12, -0.08, 0.035),
      new THREE.Vector3(0.075, -0.18, 0.06),
      new THREE.Vector3(0.015, -0.245, 0.04),
    ]);
    this._mesh(tubing, "VacuumFlexibleTube", new THREE.TubeGeometry(curve, 36, 0.0045, 8, false), this.materials.blue);

    this.vacuumLight = new THREE.PointLight(0x4bd9ff, 0.3, 0.5, 2);
    this.vacuumLight.position.set(0, -0.35, 0);
    this.zStageGroup.add(this.vacuumLight);

    this.carriedProduct = this._createProductModel(this.zStageGroup, "mainProduct-carried", [0, -0.39, 0], true);
    this.carriedProduct.visible = false;

    this._addLabel(
      section,
      "XYZAxisCoordinateTag",
      ["XYZ · SERVO GANTRY", "±0.02 mm"],
      [0.22, 0.055],
      [-0.42, 1.59, -0.03],
      [0, 0, 0],
      { width: 640, height: 170, background: "#05121e", foreground: "#d1f5ff", accent: "#49d8ff" },
    );
  }

  _buildSupplySystem() {
    const section = this.sections.supply;
    const lift = this._group(section, "SupplyTrayLift");
    this._registerPart("supplyLift", lift);
    for (const x of [-0.11, 0.11]) {
      for (const z of [-0.075, 0.075]) {
        this._cylinder(lift, `SupplyLiftPost_${x}_${z}`, 0.008, 0.008, 0.075, [0.51 + x, 0.745, 0.27 + z], this.materials.steel, [0, 0, 0], 12);
      }
    }
    this._box(lift, "SupplyLiftPlate", [0.31, 0.012, 0.21], [0.51, 0.781, 0.27], this.materials.frameDark, {
      rounded: true,
      radius: 0.005,
      edges: true,
      edgeOpacity: 0.2,
    });

    const tray = this._group(section, "IndependentSupplyTray", [0.51, 0.795, 0.27]);
    this._registerPart("supplyTray", tray);
    this.supplyTrayGroup = tray;
    this._box(tray, "SupplyTrayFrame", [0.3, 0.018, 0.2], [0, 0, 0], this.materials.frameDark, {
      rounded: true,
      radius: 0.006,
      edges: true,
      edgeColor: 0x6a8494,
    });
    this._box(tray, "SupplyTrayInsert", [0.282, 0.004, 0.182], [0, 0.011, 0], this.materials.furniture);
    this._box(tray, "SupplyTrayFrontRail", [0.29, 0.028, 0.01], [0, 0.017, 0.094], this.materials.frame, { edges: true });
    this._addLabel(
      tray,
      "SupplyTrayLabel",
      ["AUX FEED · 64 PCS"],
      [0.22, 0.032],
      [0, 0.018, 0.019],
      [-Math.PI / 2, 0, 0],
      { width: 720, height: 100, background: "#0c1117", foreground: "#ffd987", accent: "#f5b84b" },
    );

    this.supplyProductContainer = this._group(tray, "SupplyProductArray", [0, 0.022, 0]);
    this._markPart(this.supplyProductContainer, "supplyTray");
    this._rebuildProductArray(this.supplyProductContainer, this.supplyProducts, "supplyProduct", true);

    this._addLabel(
      section,
      "SupplyStationTag",
      ["AUXILIARY TRAY", "独立供料"],
      [0.21, 0.05],
      [0.51, 0.73, 0.405],
      [-Math.PI / 2, 0, 0],
      { width: 650, height: 150, background: "#07110d", foreground: "#ffe4ac", accent: "#f5b84b" },
    );
  }

  _buildElectricalSystem() {
    const section = this.sections.electrical;
    const cabinet = this._group(section, "ElectricalControlCabinet", [-0.17, 0.39, -0.255]);
    this._registerPart("electricalCabinet", cabinet);
    this.electricalCabinetGroup = cabinet;
    this._box(cabinet, "CabinetOuterShell", [0.86, 0.5, 0.34], [0, 0, 0], this.materials.frameDark, {
      rounded: true,
      radius: 0.012,
      edges: true,
      edgeColor: 0x4e7186,
    });
    this._box(cabinet, "CabinetBackPlate", [0.8, 0.44, 0.008], [0, 0, -0.13], this.materials.brushed);
    const door = this._group(cabinet, "ElectricalCabinetDoor", [-0.42, 0, 0.178]);
    this.cabinetDoorGroup = door;
    this._box(door, "CabinetDoorPanel", [0.83, 0.47, 0.014], [0.415, 0, 0], this.materials.darkGlass, {
      rounded: true,
      radius: 0.008,
      edges: true,
      edgeColor: 0x67899d,
    });
    this._box(door, "CabinetDoorHandle", [0.025, 0.12, 0.025], [0.78, 0, 0.025], this.materials.steel);
    this._addLabel(
      door,
      "CabinetDoorLabel",
      ["CONTROL CABINET", "PLC · SERVO · 24VDC"],
      [0.25, 0.075],
      [0.43, 0.12, 0.012],
      [0, 0, 0],
      { width: 780, height: 220, background: "#06111a", foreground: "#d0f2ff", accent: "#52d9ff" },
    );

    const din = this._group(cabinet, "CabinetDINRails");
    this._registerPart("dinRail", din);
    for (const y of [-0.07, 0.115]) {
      this._box(din, `DINRail_${y}`, [0.74, 0.012, 0.012], [0.01, y, 0.078], this.materials.steel);
    }
    for (const x of [-0.3, -0.05, 0.2]) {
      this._box(din, `WireDuctVertical_${x}`, [0.026, 0.38, 0.022], [x, 0.01, 0.065], this.materials.frameDark);
    }
    const wireDuct = this._group(cabinet, "CabinetWiringDucts");
    this._registerPart("wiringDucts", wireDuct);
    this._box(wireDuct, "WireDuctHorizontalTop", [0.7, 0.022, 0.022], [0.01, 0.165, 0.075], this.materials.frameDark);
    this._box(wireDuct, "WireDuctHorizontalBottom", [0.7, 0.022, 0.022], [0.01, -0.16, 0.075], this.materials.frameDark);

    const plc = this._group(cabinet, "PLCController", [-0.2, 0.115, 0.091]);
    this._registerPart("plc", plc);
    this._box(plc, "PLCBody", [0.19, 0.11, 0.06], [0, 0, 0], this.materials.steel, {
      rounded: true,
      radius: 0.004,
      edges: true,
      edgeColor: 0x96b6c8,
    });
    for (let i = 0; i < 6; i += 1) {
      this._box(plc, `PLCStatusLED_${i}`, [0.012, 0.005, 0.004], [-0.07 + i * 0.018, 0.028, 0.033], i === 0 ? this.materials.green : this.materials.cyan);
    }
    this._box(plc, "PLCTerminalBlock", [0.19, 0.02, 0.025], [0, -0.055, 0.043], this.materials.frameDark);

    const drives = this._group(cabinet, "ServoDriveBank", [0.08, 0.115, 0.092]);
    this._registerPart("servoDrives", drives);
    for (let i = 0; i < 4; i += 1) {
      this._box(drives, `ServoDrive_${i}`, [0.07, 0.12, 0.07], [-0.1 + i * 0.075, 0, 0], this.materials.frameDark, {
        rounded: true,
        radius: 0.003,
        edges: true,
        edgeColor: 0x537b90,
      });
      this._box(drives, `ServoDriveDisplay_${i}`, [0.034, 0.018, 0.004], [-0.1 + i * 0.075, 0.028, 0.038], this.materials.cyan);
    }

    const power = this._group(cabinet, "SwitchModePowerSupply", [0.3, 0.115, 0.095]);
    this._registerPart("powerSupply", power);
    this._box(power, "PowerSupplyBody", [0.1, 0.12, 0.075], [0, 0, 0], this.materials.steel, { edges: true, edgeColor: 0x8da8b8 });
    this._box(power, "PowerSupplyGrille", [0.056, 0.06, 0.005], [0, 0.012, 0.04], this.materials.blackMetal);
    this._box(power, "PowerSupplyLED", [0.009, 0.009, 0.005], [0.032, 0.036, 0.041], this.materials.green);

    const relays = this._group(cabinet, "RelayModuleBank", [-0.12, -0.07, 0.092]);
    this._registerPart("relays", relays);
    for (let i = 0; i < 8; i += 1) {
      this._box(relays, `RelayModule_${i}`, [0.037, 0.075, 0.052], [-0.15 + i * 0.043, 0, 0], this.materials.frameDark, {
        edges: true,
        edgeOpacity: 0.2,
      });
      this._box(relays, `RelayLED_${i}`, [0.006, 0.006, 0.004], [-0.15 + i * 0.043, 0.025, 0.03], this.materials.amber);
    }

    const breakers = this._group(cabinet, "CircuitBreakerBank", [-0.3, 0.05, 0.086]);
    this._registerPart("breakers", breakers);
    for (let i = 0; i < 5; i += 1) {
      this._box(breakers, `CircuitBreaker_${i}`, [0.042, 0.105, 0.055], [0, -i * 0.048, 0], this.materials.frameDark, {
        rounded: true,
        radius: 0.002,
        edges: true,
        edgeOpacity: 0.18,
      });
      this._box(breakers, `BreakerToggle_${i}`, [0.017, 0.018, 0.016], [0, 0.02, 0.035], this.materials.steel);
    }

    const io = this._group(cabinet, "RemoteIOModules", [0.29, -0.06, 0.089]);
    this._registerPart("ioModules", io);
    for (let i = 0; i < 3; i += 1) {
      this._box(io, `IOModule_${i}`, [0.082, 0.1, 0.055], [-0.06 + i * 0.088, 0, 0], this.materials.steel, { edges: true, edgeOpacity: 0.2 });
      this._box(io, `IOModuleLabel_${i}`, [0.048, 0.014, 0.004], [-0.06 + i * 0.088, 0.027, 0.03], this.materials.cyan);
    }
  }

  _buildHMI() {
    const section = this.sections.hmi;
    const industrialPc = this._group(section, "IndustrialComputer", [0.5, 0.43, -0.08]);
    this._registerPart("industrialPC", industrialPc);
    this._box(industrialPc, "IndustrialPCChassis", [0.32, 0.16, 0.38], [0, 0, 0], this.materials.frameDark, {
      rounded: true,
      radius: 0.01,
      edges: true,
      edgeColor: 0x537a8d,
    });
    for (let i = 0; i < 7; i += 1) {
      this._box(industrialPc, `IPCGrille_${i}`, [0.2, 0.004, 0.008], [0, 0.046 - i * 0.014, 0.193], this.materials.blackMetal);
    }
    this._box(industrialPc, "IPCPowerLED", [0.008, 0.008, 0.005], [0.13, 0.065, 0.194], this.materials.green);

    const bracket = this._group(section, "HMI SupportBracket", [0.62, 1.13, 0.53]);
    this._registerPart("hmiBracket", bracket);
    this._box(bracket, "HMI VerticalMount", [0.045, 0.3, 0.045], [0, -0.09, -0.015], this.materials.frame, { edges: true });
    this._box(bracket, "HMI Arm", [0.18, 0.04, 0.045], [-0.08, 0.05, 0], this.materials.frameDark, { edges: true });
    this._cylinder(bracket, "HMI Pivot", 0.025, 0.025, 0.06, [-0.17, 0.05, 0], this.materials.steel, [0, 0, Math.PI / 2], 20);

    const hmi = this._group(section, "IndustrialHMI_Display", [0.45, 1.13, 0.57]);
    this._registerPart("hmiDisplay", hmi);
    hmi.rotation.x = -0.1;
    this._box(hmi, "HMIDisplayBezel", [0.38, 0.25, 0.035], [0, 0, 0], this.materials.frameDark, {
      rounded: true,
      radius: 0.01,
      edges: true,
      edgeColor: 0x6d93a8,
    });
    this._addLabel(
      hmi,
      "HMIDisplayPanel",
      ["SINGLE PCS · AUTO FEED", "RUN   COUNTER 0064   AOI PASS"],
      [0.335, 0.2],
      [0, 0, 0.019],
      [0, 0, 0],
      { width: 960, height: 560, background: "#031019", foreground: "#d7fbff", accent: "#43d7ff" },
    );
    this._box(hmi, "HMIStatusBar", [0.03, 0.2, 0.003], [-0.152, 0, 0.023], this.materials.cyan);

    const buttons = this._group(section, "OperatorControlPanel", [0.44, 0.94, 0.614]);
    this._registerPart("operatorButtons", buttons);
    this._box(buttons, "OperatorPanelPlate", [0.28, 0.08, 0.025], [0, 0, 0], this.materials.frameDark, {
      rounded: true,
      radius: 0.008,
      edges: true,
      edgeOpacity: 0.2,
    });
    for (let i = 0; i < 4; i += 1) {
      const material = i === 0 ? this.materials.green : i === 1 ? this.materials.cyan : i === 2 ? this.materials.amber : this.materials.red;
      this._cylinder(buttons, `OperatorButton_${i}`, 0.016, 0.016, 0.012, [-0.09 + i * 0.06, 0, 0.018], material, [Math.PI / 2, 0, 0], 20);
    }
  }

  _createScannerEffect() {
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: 0x36c9ff,
      transparent: true,
      opacity: 0.09,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.scannerPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.12), beamMaterial);
    this.scannerPlane.name = "AOI_ScanLight";
    this.scannerPlane.rotation.x = -Math.PI / 2;
    this.scannerPlane.position.set(0, 0.845, 0);
    this.sections.vision.add(this.scannerPlane);
    this.scannerLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.11, 0, 0), new THREE.Vector3(0.11, 0, 0)]),
      new THREE.LineBasicMaterial({ color: 0xb8f3ff, transparent: true, opacity: 0.85 }),
    );
    this.scannerPlane.add(this.scannerLine);
  }

  _captureHomeTransforms() {
    this.root.traverse((object) => {
      object.userData.homePosition = object.position.clone();
      object.userData.homeRotation = object.rotation.clone();
    });
  }

  _optimizeStaticRender() {
    this.root.traverse((object) => {
      if (!object.isMesh || object.userData.isHelper || object.userData.isLabel) return;
      object.geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      object.geometry.boundingBox.getSize(size);
      const largestDimension = Math.max(size.x, size.y, size.z);
      object.castShadow = largestDimension > 0.075 && !object.material?.transparent;
      object.receiveShadow = largestDimension > 0.045 && !object.material?.transparent;
    });
  }

  _createProductModel(parent, id, position, carried = false) {
    const group = this._group(parent, `Product_${id}`, position);
    group.userData.productId = id;
    const baseSize = 0.024;
    const depthSize = 0.014;
    const baseHeight = 0.006;
    const body = this._box(
      group,
      `${id}_Body`,
      [baseSize, baseHeight, depthSize],
      [0, 0, 0],
      this.materials.ceramic,
      { rounded: true, radius: 0.0025, edges: true, edgeColor: 0x326a78, edgeOpacity: 0.42 },
    );
    const top = this._box(group, `${id}_Top`, [baseSize * 0.7, 0.0022, depthSize * 0.65], [0, baseHeight / 2 + 0.0015, 0], this.materials.productTop);
    this._box(group, `${id}_Pad`, [baseSize * 0.3, 0.001, depthSize * 0.28], [0, baseHeight / 2 + 0.003, 0], this.materials.gold);
    group.userData.body = body;
    group.userData.top = top;
    group.userData.isProduct = true;
    if (carried) {
      group.userData.isCarried = true;
    } else {
      this._markPart(group, id);
    }
    return group;
  }

  _getGridOffsets(rows, cols, pitchX, pitchZ) {
    const offsets = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        offsets.push({
          row,
          col,
          x: (col - (cols - 1) / 2) * pitchX,
          z: (row - (rows - 1) / 2) * pitchZ,
        });
      }
    }
    return offsets;
  }

  _rebuildProductArray(container, collection, prefix, supply = false) {
    for (const item of collection) {
      container.remove(item.group);
      item.group.traverse((object) => {
        if (object.geometry) object.geometry.dispose?.();
      });
    }
    collection.length = 0;
    const { rows, cols, pitchX, pitchZ } = this.gridConfig;
    const offsets = this._getGridOffsets(rows, cols, pitchX, pitchZ);
    for (const offset of offsets) {
      const id = `${prefix}-${offset.row}-${offset.col}`;
      const product = this._createProductModel(container, id, [offset.x, 0, offset.z]);
      if (supply) product.rotation.y = Math.PI;
      product.userData.row = offset.row;
      product.userData.col = offset.col;
      product.userData.present = true;
      collection.push({
        id,
        row: offset.row,
        col: offset.col,
        x: offset.x,
        z: offset.z,
        group: product,
        present: true,
      });
    }
  }

  rebuildGrid(rows, cols, pitchXmm, pitchZmm) {
    const safeRows = THREE.MathUtils.clamp(Math.round(rows), 2, 12);
    const safeCols = THREE.MathUtils.clamp(Math.round(cols), 2, 12);
    const maxPitchX = 0.3 / Math.max(1, safeCols);
    const maxPitchZ = 0.2 / Math.max(1, safeRows);
    this.gridConfig = {
      rows: safeRows,
      cols: safeCols,
      pitchX: THREE.MathUtils.clamp(pitchXmm / 1000, 0.014, maxPitchX - 0.004),
      pitchZ: THREE.MathUtils.clamp(pitchZmm / 1000, 0.012, maxPitchZ - 0.004),
    };
    this._rebuildProductArray(this.mainProductContainer, this.mainProducts, "mainProduct", false);
    this._rebuildProductArray(this.supplyProductContainer, this.supplyProducts, "supplyProduct", true);
    return this.getGridState();
  }

  getGridState() {
    return {
      ...this.gridConfig,
      pitchXmm: Math.round(this.gridConfig.pitchX * 1000),
      pitchZmm: Math.round(this.gridConfig.pitchZ * 1000),
      products: this.mainProducts.map((product) => ({
        id: product.id,
        row: product.row,
        col: product.col,
        present: product.present,
      })),
    };
  }

  getProduct(row, col) {
    return this.mainProducts.find((product) => product.row === row && product.col === col);
  }

  setProductPresent(row, col, present, animate = true) {
    const product = this.getProduct(row, col);
    if (!product) return;
    product.present = present;
    product.group.userData.present = present;
    if (!animate) {
      product.group.visible = present;
      product.group.scale.setScalar(1);
      return;
    }
    if (present) {
      product.group.visible = true;
      product.group.scale.setScalar(0.01);
      this.tweens.to(product.group.scale, { x: 1, y: 1, z: 1 }, 320, {
        easing: "backOut",
        channel: "machine",
      });
    } else {
      this.tweens
        .to(product.group.scale, { x: 0.01, y: 0.01, z: 0.01 }, 220, {
          easing: "easeOut",
          channel: "machine",
        })
        .then(() => {
          product.group.visible = false;
          product.group.scale.setScalar(1);
        });
    }
  }

  pickSupplyProduct(preferredRow = null, preferredCol = null) {
    let index = -1;
    if (preferredRow !== null && preferredCol !== null) {
      index = this.supplyProducts.findIndex((item) => item.present && item.row === preferredRow && item.col === preferredCol);
    }
    if (index < 0) index = this.supplyProducts.findIndex((item) => item.present);
    if (index < 0) return null;
    const item = this.supplyProducts[index];
    item.present = false;
    item.group.visible = false;
    return { ...item };
  }

  supplyPositionFor(item) {
    return {
      x: this.supplyTrayGroup.position.x + item.x,
      z: this.supplyTrayGroup.position.z + item.z,
    };
  }

  palletPositionFor(row, col) {
    const product = this.getProduct(row, col);
    const palletWorld = new THREE.Vector3();
    this.mainPalletGroup.getWorldPosition(palletWorld);
    return {
      x: palletWorld.x + (product?.x || 0),
      z: palletWorld.z + (product?.z || 0),
    };
  }

  setCarriedProductVisible(visible) {
    this.carriedProduct.visible = visible;
    this.carriedProduct.scale.setScalar(visible ? 1 : 0.01);
  }

  setVacuum(active) {
    this.vacuumActive = active;
    this.vacuumGlow.material.opacity = active ? 0.95 : 0;
    this.vacuumLight.intensity = active ? 1.8 : 0.3;
  }

  flashCamera(duration = 900) {
    this.cameraFlashTimer = duration;
    this.cameraFlashLight.intensity = 4.8;
    this.cameraFlashSprite.material.opacity = 0.9;
  }

  setBacklight(active, intensity = 2.5) {
    for (const material of this.backlightMaterials) {
      material.emissiveIntensity = active ? intensity : 0.16;
    }
    this.scannerPlane.material.opacity = active ? 0.18 : 0.04;
  }

  setShellMode(mode) {
    this.shellMode = mode;
    const visible = mode !== "hidden";
    this.guardGroup.visible = visible;
    for (const material of this.shellMaterials) {
      material.opacity = mode === "solid" ? 0.78 : 0.18;
      material.transmission = 0;
    }
  }

  setCabinetOpen(open) {
    this.cabinetOpen = open;
    this.tweens.to(this.cabinetDoorGroup.rotation, { y: open ? -1.48 : 0 }, 800, {
      easing: "easeInOut",
      channel: "machine",
    });
  }

  movePalletX(x, duration = 900) {
    return this.tweens.to(this.palletXGroup.position, { x }, duration, {
      easing: "easeInOut",
      channel: "simulation",
    });
  }

  movePalletY(z, duration = 700) {
    return this.tweens.to(this.palletYGroup.position, { z }, duration, {
      easing: "easeInOut",
      channel: "simulation",
    });
  }

  moveXYZ(target, duration = 850) {
    const tasks = [];
    if (Number.isFinite(target.x)) {
      tasks.push(
        this.tweens.to(this.xCarriageGroup.position, { x: target.x }, duration, {
          easing: "easeInOut",
          channel: "simulation",
        }),
      );
    }
    if (Number.isFinite(target.z)) {
      tasks.push(
        this.tweens.to(this.yCarriageGroup.position, { z: target.z }, duration, {
          easing: "easeInOut",
          channel: "simulation",
        }),
      );
    }
    if (Number.isFinite(target.zHeight)) {
      tasks.push(
        this.tweens.to(this.zStageGroup.position, { y: target.zHeight }, duration, {
          easing: "easeInOut",
          channel: "simulation",
        }),
      );
    }
    return Promise.all(tasks);
  }

  async resetMotion() {
    this.conveyorRunning = false;
    this.setVacuum(false);
    this.setCarriedProductVisible(false);
    this.setBacklight(false);
    await Promise.all([
      this.tweens.to(this.palletXGroup.position, { x: -0.52 }, 700, { channel: "simulation" }),
      this.tweens.to(this.palletYGroup.position, { z: 0 }, 500, { channel: "simulation" }),
      this.tweens.to(this.xCarriageGroup.position, { x: 0 }, 700, { channel: "simulation" }),
      this.tweens.to(this.yCarriageGroup.position, { z: 0 }, 700, { channel: "simulation" }),
      this.tweens.to(this.zStageGroup.position, { y: 0.02 }, 500, { channel: "simulation" }),
    ]);
  }

  resetGridPresence() {
    for (const product of this.mainProducts) {
      product.present = true;
      product.group.visible = true;
      product.group.scale.setScalar(1);
    }
    for (const product of this.supplyProducts) {
      product.present = true;
      product.group.visible = true;
      product.group.scale.setScalar(1);
    }
  }

  setRandomDefects(mode) {
    this.resetGridPresence();
    if (mode === "normal") return [];
    const count = mode === "single" ? 1 : 2 + Math.floor(Math.random() * Math.min(5, this.mainProducts.length - 1));
    const indices = new Set();
    while (indices.size < count) indices.add(Math.floor(Math.random() * this.mainProducts.length));
    return [...indices].map((index) => {
      const product = this.mainProducts[index];
      this.setProductPresent(product.row, product.col, false, false);
      return { row: product.row, col: product.col };
    });
  }

  getDefects() {
    return this.mainProducts.filter((product) => !product.present).map(({ row, col, id }) => ({ row, col, id }));
  }

  setExploded(sectionName) {
    this.exploded = sectionName;
    const targets = this._getExplodeTargets(sectionName);
    for (const [group, target] of targets) {
      this.tweens.to(group.position, target.position, 950, {
        easing: "easeInOut",
        channel: "explode",
      });
      if (target.rotation) {
        this.tweens.to(group.rotation, target.rotation, 950, {
          easing: "easeInOut",
          channel: "explode",
        });
      }
    }
    if (sectionName === "electrical") this.setCabinetOpen(true);
    if (sectionName === "shell") this.setShellMode("transparent");
  }

  restoreExplosion() {
    this.exploded = null;
    for (const [id, home] of this.partExplodeStates) {
      const object = this.parts.get(id);
      if (!object) continue;
      this.tweens.to(object.position, { x: home.x, y: home.y, z: home.z }, 850, {
        channel: "explode",
        easing: "easeInOut",
      });
    }
    this.partExplodeStates.clear();
    const groups = new Set([
      ...Object.values(this.sections),
      this.guardGroup,
      this.conveyorRailsGroup,
      ...this.conveyorRailParts,
      this.xAxisGroup,
      this.yAxisGroup,
      this.zAxisGroup,
      this.xCarriageGroup,
      this.yCarriageGroup,
      this.zStageGroup,
      this.mainPalletGroup,
      this.frontDoors[0],
      this.frontDoors[1],
    ]);
    for (const group of groups) {
      if (!group?.userData.homePosition) continue;
      this.tweens.to(group.position, {
        x: group.userData.homePosition.x,
        y: group.userData.homePosition.y,
        z: group.userData.homePosition.z,
      }, 900, { channel: "explode", easing: "easeInOut" });
      this.tweens.to(group.rotation, {
        x: group.userData.homeRotation.x,
        y: group.userData.homeRotation.y,
        z: group.userData.homeRotation.z,
      }, 900, { channel: "explode", easing: "easeInOut" });
    }
    this.cabinetOpen = false;
    this.tweens.to(this.cabinetDoorGroup.rotation, { y: 0 }, 700, { channel: "machine" });
  }

  togglePartExplode(id) {
    const object = this.parts.get(id);
    if (!object) return { exploded: false, reason: "missing" };
    if (this.partExplodeStates.has(id)) {
      const home = this.partExplodeStates.get(id);
      this.tweens.to(object.position, { x: home.x, y: home.y, z: home.z }, 760, {
        channel: "explode",
        easing: "easeInOut",
      });
      this.partExplodeStates.delete(id);
      return { exploded: false };
    }

    const definition = getPartDefinition(id);
    const category = definition.category || "";
    let offset = new THREE.Vector3(0, 0.1, 0.1);
    if (category.includes("设备主体")) offset.set(0, 0.16, 0);
    else if (category.includes("X轴机构")) offset.set(0, 0.1, 0.15);
    else if (category.includes("Y轴机构")) offset.set(0, 0.08, 0.18);
    else if (category.includes("视觉系统")) offset.set(0, 0.18, 0);
    else if (category.includes("XYZ机构")) offset.set(0, 0.14, 0.08);
    else if (category.includes("供料系统")) offset.set(0, 0.06, 0.18);
    else if (category.includes("电气系统")) offset.set(0, 0, -0.16);
    else if (category.includes("工控机")) offset.set(0, 0.12, 0.16);
    else if (category.includes("输送系统")) offset.set(0, 0.1, 0.1);

    const home = object.position.clone();
    this.partExplodeStates.set(id, home);
    this.tweens.to(object.position, {
      x: home.x + offset.x,
      y: home.y + offset.y,
      z: home.z + offset.z,
    }, 820, {
      channel: "explode",
      easing: "easeOut",
    });
    return { exploded: true };
  }

  _getExplodeTargets(sectionName) {
    const map = new Map();
    const sectionPosition = (section, dx, dy, dz) => {
      const home = this.sections[section].userData.homePosition;
      map.set(this.sections[section], {
        position: { x: home.x + dx, y: home.y + dy, z: home.z + dz },
      });
    };

    if (sectionName === "whole") {
      sectionPosition("frame", 0, 0, 0);
      sectionPosition("shell", 0, 0.28, 0);
      sectionPosition("conveyor", 0, -0.14, 0.18);
      sectionPosition("yTransfer", 0, -0.12, 0.08);
      sectionPosition("vision", 0, 0.24, 0);
      sectionPosition("xyz", 0, 0.08, -0.18);
      sectionPosition("supply", 0, -0.12, 0.12);
      sectionPosition("electrical", 0, 0, -0.28);
      sectionPosition("hmi", 0, 0, 0.18);
      map.set(this.frontDoors[0], { position: { x: this.frontDoors[0].position.x + 0.32, y: this.frontDoors[0].position.y, z: this.frontDoors[0].position.z } });
      map.set(this.frontDoors[1], { position: { x: this.frontDoors[1].position.x - 0.32, y: this.frontDoors[1].position.y, z: this.frontDoors[1].position.z } });
    } else if (sectionName === "xyz") {
      sectionPosition("xyz", 0, 0.18, 0);
      map.set(this.xAxisGroup, {
        position: { x: 0, y: this.xAxisGroup.userData.homePosition.y + 0.08, z: this.xAxisGroup.userData.homePosition.z - 0.04 },
      });
      map.set(this.yAxisGroup, {
        position: { x: 0, y: this.yAxisGroup.userData.homePosition.y, z: this.yAxisGroup.userData.homePosition.z - 0.12 },
      });
      map.set(this.zAxisGroup, {
        position: { x: 0.08, y: this.zAxisGroup.userData.homePosition.y, z: this.zAxisGroup.userData.homePosition.z + 0.08 },
      });
    } else if (sectionName === "vision") {
      sectionPosition("vision", 0, 0.2, 0);
      map.set(this.parts.get("visionCamera"), {
        position: { x: 0.16, y: this.parts.get("visionCamera").userData.homePosition.y + 0.08, z: -0.04 },
      });
      map.set(this.parts.get("cameraBracket"), {
        position: { x: -0.08, y: this.parts.get("cameraBracket").userData.homePosition.y + 0.12, z: -0.08 },
      });
      map.set(this.parts.get("backlight"), {
        position: { x: 0, y: this.parts.get("backlight").userData.homePosition.y - 0.12, z: 0.015 },
      });
    } else if (sectionName === "conveyor") {
      sectionPosition("conveyor", 0, -0.08, 0.16);
      map.set(this.conveyorRailParts[0], {
        position: { x: 0, y: 0, z: this.conveyorRailParts[0].userData.homePosition.z - 0.18 },
      });
      map.set(this.conveyorRailParts[1], {
        position: { x: 0, y: 0, z: this.conveyorRailParts[1].userData.homePosition.z + 0.18 },
      });
      map.set(this.mainPalletGroup, {
        position: { x: 0, y: this.mainPalletGroup.userData.homePosition.y + 0.16, z: 0 },
      });
    } else if (sectionName === "electrical") {
      sectionPosition("electrical", 0, 0, -0.2);
    } else if (sectionName === "shell") {
      sectionPosition("shell", 0, 0.08, 0);
      map.set(this.frontDoors[0], { position: { x: this.frontDoors[0].position.x + 0.32, y: this.frontDoors[0].position.y, z: 0.49 } });
      map.set(this.frontDoors[1], { position: { x: this.frontDoors[1].position.x - 0.32, y: this.frontDoors[1].position.y, z: 0.49 } });
    } else if (sectionName === "supply") {
      sectionPosition("supply", 0, 0.04, 0.18);
    }
    return map;
  }

  setPartVisibility(id, visible) {
    const object = this.parts.get(id);
    if (!object) return false;
    object.visible = visible;
    return true;
  }

  getPartObject(id) {
    return this.parts.get(id);
  }

  getWorldCenter(object) {
    const box = new THREE.Box3().setFromObject(object);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    return { center, radius: sphere.radius };
  }

  getAxisReadout() {
    return {
      x: Math.round(this.xCarriageGroup.position.x * 1000),
      y: Math.round(-this.yCarriageGroup.position.z * 1000),
      z: Math.round((0.75 - this.zStageGroup.position.y) * 1000),
      palletX: Math.round((this.palletXGroup.position.x + 0.52) * 1000),
      palletY: Math.round(this.palletYGroup.position.z * 1000),
    };
  }

  update(elapsed, delta) {
    if (this.conveyorRunning) {
      for (const roller of this.beltRollers) roller.rotation.y += delta * 8;
    }
    const pulse = 0.5 + Math.sin(elapsed * 3.6) * 0.5;
    if (this.statusLights) {
      this.statusLights[0].emissiveIntensity = 1.4 + pulse * 2;
      this.statusLights[1].emissiveIntensity = this.exploded ? 0.3 : 0.2;
      this.statusLights[2].emissiveIntensity = 0.2;
    }
    if (this.cameraFlashTimer > 0) {
      this.cameraFlashTimer -= delta * 1000;
      this.cameraFlashLight.intensity = THREE.MathUtils.lerp(0, 4.8, Math.max(0, this.cameraFlashTimer / 900));
      this.cameraFlashSprite.material.opacity = THREE.MathUtils.lerp(0, 0.9, Math.max(0, this.cameraFlashTimer / 900));
    } else {
      this.cameraFlashLight.intensity = 0;
      this.cameraFlashSprite.material.opacity = 0;
    }
    if (this.scannerPlane.visible) {
      this.scannerPlane.position.z = Math.sin(elapsed * 1.4) * 0.06;
      this.scannerPlane.material.opacity = 0.1 + pulse * 0.1;
    }
    if (this.vacuumActive) {
      this.vacuumGlow.material.opacity = 0.65 + pulse * 0.3;
      this.vacuumGlow.rotation.z += delta * 2.5;
    }
  }
}
