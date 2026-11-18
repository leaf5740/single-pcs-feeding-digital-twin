import * as THREE from "three";
import { getPartDefinition } from "./parts.js";

function isInsideSelection(object, selectedRoot) {
  let current = object;
  while (current) {
    if (current === selectedRoot) return true;
    if (!current.parent) break;
    current = current.parent;
  }
  return false;
}

function findPartId(object) {
  let current = object;
  while (current) {
    if (current.userData?.partId) return current.userData.partId;
    current = current.parent;
  }
  return null;
}

export class SelectionManager {
  constructor({ machine, camera, renderer, controls, tweens, onChange, onHover }) {
    this.machine = machine;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.tweens = tweens;
    this.onChange = onChange;
    this.onHover = onHover;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.selected = null;
    this.selectedId = null;
    this.selectionHelper = null;
    this.materialBackups = new Map();
    this.pointerDown = { x: 0, y: 0, button: 0 };
    this.pointerMoved = false;
    this.hoverLabel = document.getElementById("hoverLabel");
    this.marker = document.getElementById("selectionMarker");
    this.cameraDefault = {
      position: new THREE.Vector3(3, 2.1, 4.2),
      target: new THREE.Vector3(0, 1, 0),
    };
  }

  attach(canvas) {
    this.canvas = canvas;
    canvas.addEventListener("pointerdown", this._onPointerDown);
    canvas.addEventListener("pointermove", this._onPointerMove);
    canvas.addEventListener("pointerup", this._onPointerUp);
    canvas.addEventListener("pointerleave", this._onPointerLeave);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  _onPointerDown = (event) => {
    this.pointerDown = {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      time: performance.now(),
    };
    this.pointerMoved = false;
  };

  _onPointerMove = (event) => {
    const dx = event.clientX - this.pointerDown.x;
    const dy = event.clientY - this.pointerDown.y;
    if (Math.hypot(dx, dy) > 5) this.pointerMoved = true;
    this._updatePointer(event);
    this._updateHover(event);
  };

  _onPointerUp = (event) => {
    if (event.button !== 0 || this.pointerMoved) return;
    const elapsed = performance.now() - this.pointerDown.time;
    if (elapsed > 700) return;
    this._updatePointer(event);
    const hit = this._raycast();
    const id = hit ? findPartId(hit.object) : null;
    if (id) {
      this.selectById(id, { focus: true, source: "scene" });
    } else {
      this.clearSelection({ resetFocus: false });
    }
  };

  _onPointerLeave = () => {
    this.hoverLabel.hidden = true;
  };

  _updatePointer(event) {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  }

  _raycast() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObject(this.machine.root, true);
    return intersections.find((hit) => {
      const object = hit.object;
      if (!object.visible) return false;
      if (object.userData?.isHelper || object.userData?.isOutline) return false;
      if (object.isLine || object.isSprite) return false;
      const material = object.material;
      if (material?.transparent && material?.opacity < 0.3) return false;
      return Boolean(findPartId(object));
    });
  }

  _updateHover(event) {
    if (event.buttons || this.pointerMoved) {
      this.hoverLabel.hidden = true;
      this.canvas.style.cursor = event.buttons ? "grabbing" : "default";
      return;
    }
    const hit = this._raycast();
    const id = hit ? findPartId(hit.object) : null;
    if (!id) {
      this.hoverLabel.hidden = true;
      this.canvas.style.cursor = "default";
      return;
    }
    const definition = getPartDefinition(id);
    this.hoverLabel.textContent = definition.name;
    this.hoverLabel.style.left = `${event.clientX + 14}px`;
    this.hoverLabel.style.top = `${event.clientY + 14}px`;
    this.hoverLabel.hidden = false;
    this.canvas.style.cursor = "pointer";
    this.onHover?.(id, definition);
  }

  selectById(id, options = {}) {
    const object = this.machine.getPartObject(id);
    if (!object) return null;
    if (!object.visible) object.visible = true;
    const definition = getPartDefinition(id);
    this._restoreMaterials();
    this._removeHelper();
    this.selected = object;
    this.selectedId = id;
    this._dimOtherParts(object);
    this._highlightSelected(object);
    this._createHelper(object);
    if (options.focus !== false) this.focusOn(object);
    this.marker?.classList.add("is-visible");
    this.onChange?.({
      id,
      object,
      definition,
      visible: object.visible,
      source: options.source || "api",
    });
    return object;
  }

  clearSelection(options = {}) {
    this._restoreMaterials();
    this._removeHelper();
    this.marker?.classList.remove("is-visible");
    this.selected = null;
    this.selectedId = null;
    if (options.resetFocus) {
      this.tweens.to(this.controls.target, {
        x: this.cameraDefault.target.x,
        y: this.cameraDefault.target.y,
        z: this.cameraDefault.target.z,
      }, 750, { channel: "camera" });
    }
    this.onChange?.(null);
  }

  _cloneMaterials(mesh) {
    if (this.materialBackups.has(mesh)) return;
    const original = mesh.material;
    if (!original) return;
    this.materialBackups.set(mesh, original);
    const cloneMaterial = (material) => {
      const clone = material.clone();
      if (clone.color) clone.color.lerp(new THREE.Color(0x101a22), 0.48);
      if ("emissive" in clone && clone.emissive) {
        clone.emissive.setHex(0x071118);
        clone.emissiveIntensity = Math.min(clone.emissiveIntensity || 0, 0.2);
      }
      if (clone.transparent) clone.opacity *= 0.54;
      clone.needsUpdate = true;
      return clone;
    };
    mesh.material = Array.isArray(original) ? original.map(cloneMaterial) : cloneMaterial(original);
  }

  _dimOtherParts(selectedRoot) {
    this.machine.root.traverse((object) => {
      if (!object.isMesh || object.userData?.isHelper || object.userData?.isOutline) return;
      if (isInsideSelection(object, selectedRoot)) return;
      this._cloneMaterials(object);
    });
  }

  _highlightSelected(selectedRoot) {
    selectedRoot.traverse((object) => {
      if (!object.isMesh || object.userData?.isHelper || object.userData?.isOutline) return;
      const original = object.material;
      if (!original) return;
      this.materialBackups.set(object, original);
      const highlight = (material) => {
        const clone = material.clone();
        if (clone.color) clone.color.lerp(new THREE.Color(0x5accef), 0.12);
        if ("emissive" in clone && clone.emissive) {
          clone.emissive.setHex(0x0b5370);
          clone.emissiveIntensity = Math.max(0.65, clone.emissiveIntensity || 0);
        }
        if (clone.transparent) clone.opacity = Math.max(clone.opacity, 0.26);
        clone.needsUpdate = true;
        return clone;
      };
      object.material = Array.isArray(original) ? original.map(highlight) : highlight(original);
    });
  }

  _restoreMaterials() {
    for (const [mesh, material] of this.materialBackups) {
      const current = mesh.material;
      if (current && current !== material) {
        if (Array.isArray(current)) current.forEach((item) => item?.dispose?.());
        else current.dispose?.();
      }
      mesh.material = material;
    }
    this.materialBackups.clear();
  }

  _createHelper(object) {
    const helper = new THREE.BoxHelper(object, 0x52d9ff);
    helper.name = "SelectionOutline";
    helper.material.transparent = true;
    helper.material.opacity = 0.92;
    helper.material.depthTest = false;
    helper.material.depthWrite = false;
    helper.material.blending = THREE.AdditiveBlending;
    helper.renderOrder = 999;
    helper.userData.isOutline = true;
    this.machine.root.add(helper);
    this.selectionHelper = helper;
  }

  _removeHelper() {
    if (!this.selectionHelper) return;
    this.selectionHelper.removeFromParent();
    this.selectionHelper.geometry.dispose();
    this.selectionHelper.material.dispose();
    this.selectionHelper = null;
  }

  focusOn(object) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const radius = Math.max(0.035, size.length() * 0.5);
    const direction = this.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSq() < 0.001) direction.set(1, 0.6, 1);
    direction.normalize();
    const currentDistance = this.camera.position.distanceTo(center);
    const desiredDistance = Math.max(0.32, Math.min(radius * 4.2, currentDistance * 0.86));
    const desiredPosition = center.clone().add(direction.multiplyScalar(desiredDistance));
    this.tweens.to(this.controls.target, { x: center.x, y: center.y, z: center.z }, 720, {
      channel: "camera",
      easing: "easeInOut",
    });
    this.tweens.to(this.camera.position, {
      x: desiredPosition.x,
      y: desiredPosition.y,
      z: desiredPosition.z,
    }, 720, {
      channel: "camera",
      easing: "easeInOut",
    });
  }

  setSelectedVisible(visible) {
    if (!this.selected) return;
    this.selected.visible = visible;
    if (this.selectionHelper) this.selectionHelper.visible = visible;
    this.marker?.classList.toggle("is-visible", visible);
    this.onChange?.({
      id: this.selectedId,
      object: this.selected,
      definition: getPartDefinition(this.selectedId),
      visible,
      source: "visibility",
    });
  }

  update() {
    if (!this.selectionHelper || !this.selected) return;
    this.selectionHelper.update();
    const bounds = new THREE.Box3().setFromObject(this.selected);
    if (bounds.isEmpty()) return;
    const center = new THREE.Vector3();
    bounds.getCenter(center);
    center.project(this.camera);
    const canvasBounds = this.renderer.domElement.getBoundingClientRect();
    const x = (center.x * 0.5 + 0.5) * canvasBounds.width;
    const y = (-center.y * 0.5 + 0.5) * canvasBounds.height;
    if (this.marker) {
      this.marker.style.left = `${x}px`;
      this.marker.style.top = `${y}px`;
      this.marker.style.transform = "translate(14px, 14px)";
    }
  }
}
