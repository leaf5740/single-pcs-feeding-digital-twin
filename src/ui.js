import { PART_CATEGORY_COLORS, PART_TREE, getPartDefinition } from "./parts.js";

const pad = (value) => String(value).padStart(2, "0");

function formatCycleTime(milliseconds) {
  const totalTenths = Math.max(0, Math.floor(milliseconds / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${pad(minutes)}:${pad(seconds)}.${tenths}`;
}

function refreshIcons() {
  window.lucide?.createIcons({
    attrs: {
      width: 16,
      height: 16,
      "stroke-width": 1.8,
    },
  });
}

export class UIController {
  constructor({ machine, simulation, selection, tweens, onView }) {
    this.machine = machine;
    this.simulation = simulation;
    this.selection = selection;
    this.tweens = tweens;
    this.onView = onView;
    this.activeVisionTab = "first";
    this.toastTimer = null;
    this.lastSnapshot = null;
    this.selectedPartId = null;
    this.explodeModes = ["transparent", "hidden", "solid"];
    this._bind();
    this._renderTree();
    this._renderInspector(null);
    this._startClock();
    refreshIcons();
  }

  _bind() {
    document.getElementById("structureToggle")?.addEventListener("click", () => this._togglePanel("structurePanel"));
    document.getElementById("detailToggle")?.addEventListener("click", () => this._togglePanel("detailPanel"));
    document.getElementById("structureClose")?.addEventListener("click", () => this._closePanel("structurePanel"));
    document.getElementById("detailClose")?.addEventListener("click", () => this._closePanel("detailPanel"));
    document.getElementById("fullscreenButton")?.addEventListener("click", () => this._toggleFullscreen());

    document.getElementById("playButton")?.addEventListener("click", () => this.simulation.play());
    document.getElementById("pauseButton")?.addEventListener("click", () => this.simulation.pause());
    document.getElementById("stepButton")?.addEventListener("click", () => this.simulation.step());
    document.getElementById("resetButton")?.addEventListener("click", () => {
      this.selection.clearSelection({ resetFocus: true });
      this.simulation.reset();
      this.machine.restoreExplosion();
      this.showToast("设备与运行流程已复位");
    });

    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        if (this.simulation.state === "running") {
          this.showToast("请先暂停或复位当前流程");
          return;
        }
        this.simulation.setMode(button.dataset.mode);
      });
    });

    const speedRange = document.getElementById("speedRange");
    speedRange?.addEventListener("input", () => {
      const value = Number(speedRange.value);
      this.simulation.setSpeed(value);
      this._updateSpeedVisual(value);
    });

    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        const view = button.dataset.view;
        this.onView?.(view);
        if (view !== "reset") {
          document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("is-active", item === button));
        } else {
          document.querySelector('[data-view="iso"]')?.classList.add("is-active");
        }
      });
    });

    document.getElementById("explodeButton")?.addEventListener("click", (event) => {
      event.stopPropagation();
      this._toggleExplodeMenu();
    });
    document.getElementById("restoreButton")?.addEventListener("click", () => {
      this.machine.restoreExplosion();
      this.showToast("结构已恢复装配状态");
    });
    document.getElementById("explodeMenu")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-explode]");
      if (!button) return;
      if (this._isCycleBusy()) {
        this.showToast("运行流程进行中，暂不能拆解");
        return;
      }
      this.machine.setExploded(button.dataset.explode);
      this._hideExplodeMenu();
      this.showToast("已载入结构拆解预设");
    });

    document.getElementById("shellModeButton")?.addEventListener("click", () => {
      const currentIndex = this.explodeModes.indexOf(this.machine.shellMode);
      const nextMode = this.explodeModes[(currentIndex + 1) % this.explodeModes.length];
      this.machine.setShellMode(nextMode);
      const labels = { transparent: "透明", hidden: "已隐藏", solid: "实心" };
      this.showToast(`防护罩：${labels[nextMode]}`);
      const label = document.querySelector("#shellModeButton span");
      if (label) label.textContent = `外壳·${labels[nextMode]}`;
    });

    document.querySelectorAll("[data-vision-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        this.activeVisionTab = button.dataset.visionTab;
        document.querySelectorAll("[data-vision-tab]").forEach((item) => {
          const active = item === button;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", String(active));
        });
        if (this.lastSnapshot) this._renderVision(this.lastSnapshot);
      });
    });

    document.getElementById("visionGrid")?.addEventListener("click", (event) => {
      const cell = event.target.closest("[data-row]");
      if (!cell) return;
      if (this.simulation.state === "running" || this.simulation.state === "preparing") {
        this.showToast("运行中不能修改产品状态");
        return;
      }
      this.simulation.toggleProduct(Number(cell.dataset.row), Number(cell.dataset.col));
    });

    document.getElementById("arraySettingsButton")?.addEventListener("click", () => this._openArrayDialog());
    document.getElementById("arrayDialogClose")?.addEventListener("click", () => document.getElementById("arrayDialog")?.close());
    document.getElementById("arrayCancelButton")?.addEventListener("click", () => document.getElementById("arrayDialog")?.close());
    document.getElementById("arrayForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this._isCycleBusy()) {
        this.showToast("运行流程进行中，暂不能修改阵列");
        return;
      }
      const result = this.machine.rebuildGrid(
        Number(document.getElementById("gridRows").value),
        Number(document.getElementById("gridCols").value),
        Number(document.getElementById("pitchX").value),
        Number(document.getElementById("pitchZ").value),
      );
      this.selection.clearSelection({ resetFocus: false });
      this.simulation.reset();
      document.getElementById("arrayDialog")?.close();
      this.showToast(`阵列已更新为 ${result.rows} × ${result.cols}，共 ${result.rows * result.cols} PCS`);
    });

    document.getElementById("partInspector")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-part-action]");
      if (!button || !this.selection.selected) return;
      const action = button.dataset.partAction;
      if (action === "visibility") {
        this.selection.setSelectedVisible(!this.selection.selected.visible);
        const label = button.querySelector("span");
        if (label) label.textContent = this.selection.selected.visible ? "隐藏" : "显示";
        this.showToast(this.selection.selected.visible ? "部件已显示" : "部件已隐藏");
      } else if (action === "focus") {
        this.selection.focusOn(this.selection.selected);
      } else if (action === "explode") {
        if (this._isCycleBusy()) {
          this.showToast("运行流程进行中，暂不能拆解");
          return;
        }
        const result = this.machine.togglePartExplode(this.selection.selectedId);
        this.showToast(result.exploded ? "部件已按预设方向拆解" : "部件已恢复装配位置");
      }
    });

    document.addEventListener("pointerdown", (event) => {
      const menu = document.getElementById("explodeMenu");
      const trigger = document.getElementById("explodeButton");
      if (!menu || menu.hidden || menu.contains(event.target) || trigger?.contains(event.target)) return;
      this._hideExplodeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (this.simulation.state === "running") this.simulation.pause();
        else this.simulation.play();
      }
      if (event.key === "Escape") {
        this._hideExplodeMenu();
        this.selection.clearSelection({ resetFocus: false });
        this._closePanel("structurePanel");
        this._closePanel("detailPanel");
      }
    });
  }

  _renderTree() {
    const container = document.getElementById("structureTree");
    if (!container) return;
    container.innerHTML = PART_TREE.map((category, categoryIndex) => {
      const open = categoryIndex < 3;
      const parts = category.parts
        .map((partId) => {
          const definition = getPartDefinition(partId);
          return `
            <button type="button" class="tree-part" data-part-id="${partId}">
              <span>${definition.name}</span>
            </button>
          `;
        })
        .join("");
      return `
        <div class="tree-category ${open ? "is-open" : ""}" data-category="${category.id}">
          <button type="button" class="tree-category-header">
            <i data-lucide="${category.icon}" aria-hidden="true"></i>
            <span></span>
            <span class="tree-category-label">${category.label}</span>
            <i class="tree-chevron" data-lucide="chevron-right" aria-hidden="true"></i>
          </button>
          <div class="tree-children">${parts}</div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".tree-category-header").forEach((button) => {
      button.addEventListener("click", () => button.closest(".tree-category")?.classList.toggle("is-open"));
    });
    container.querySelectorAll(".tree-part").forEach((button) => {
      button.addEventListener("click", () => {
        this.selection.selectById(button.dataset.partId, { focus: true, source: "tree" });
        if (window.innerWidth <= 980) this._closePanel("structurePanel");
      });
    });
    document.getElementById("assetCount").textContent = String(this.machine.parts.size).padStart(2, "0");
  }

  _renderInspector(selection) {
    const container = document.getElementById("partInspector");
    if (!container) return;
    document.querySelectorAll(".tree-part").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.partId === selection?.id);
    });

    if (!selection) {
      this.selectedPartId = null;
      document.getElementById("sceneSubtitle").textContent = "1600 × 1000 × 1800 mm";
      container.innerHTML = `
        <div class="part-category-row">
          <span class="part-category">SYSTEM OVERVIEW</span>
          <span class="part-status">ONLINE</span>
        </div>
        <h3>单 PCS 自动补料设备</h3>
        <p class="part-function">面向单 PCS 产品的输送、双工位视觉检测、缺料判定与 XYZ 真空自动补偿一体化设备。</p>
        <dl class="part-spec-grid">
          <dt>外形尺寸</dt><dd>1600 × 1000 × 1800 mm</dd>
          <dt>产品容量</dt><dd>${document.getElementById("trayLayoutText")?.textContent || "8 R × 8 C"} / PCS</dd>
          <dt>控制架构</dt><dd>PLC + IPC + Servo + GigE Vision</dd>
          <dt>工作模式</dt><dd>自动检测 / 单缺料 / 多缺料</dd>
        </dl>
      `;
      return;
    }

    const { definition, id, object } = selection;
    this.selectedPartId = id;
    document.getElementById("sceneSubtitle").textContent = `${definition.category} · ${id}`;
    const accent = PART_CATEGORY_COLORS[definition.category] || "#4fd7ff";
    const params = definition.params.map((item) => `<dd>${item}</dd>`).join("");
    container.innerHTML = `
      <div class="part-category-row">
        <span class="part-category" style="color:${accent}">${definition.category}</span>
        <span class="part-status">${object.visible ? "ASSEMBLED" : "HIDDEN"}</span>
      </div>
      <h3>${definition.name}</h3>
      <p class="part-function">${definition.function}</p>
      <dl class="part-spec-grid">
        <dt>机械参数</dt>${params}
        <dt>安装位置</dt><dd>${definition.install}</dd>
        <dt>运动方向</dt><dd>${definition.motion}</dd>
      </dl>
      <div class="part-actions">
        <button type="button" class="part-action-button" data-part-action="visibility">
          <i data-lucide="${object.visible ? "eye-off" : "eye"}"></i><span>${object.visible ? "隐藏" : "显示"}</span>
        </button>
        <button type="button" class="part-action-button" data-part-action="focus">
          <i data-lucide="focus"></i><span>聚焦</span>
        </button>
        <button type="button" class="part-action-button" data-part-action="explode">
          <i data-lucide="move-up-right"></i><span>拆解</span>
        </button>
      </div>
    `;
    refreshIcons();
  }

  handleSelection(selection) {
    this._renderInspector(selection);
    if (selection && window.innerWidth <= 980 && selection.source === "scene") {
      this._togglePanel("detailPanel", true);
    }
  }

  update(snapshot, reason = "") {
    this.lastSnapshot = snapshot;
    if (reason === "vision-second" || reason === "compare") {
      this.activeVisionTab = "compare";
      document.querySelectorAll("[data-vision-tab]").forEach((item) => {
        const active = item.dataset.visionTab === "compare";
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
    }
    this._updateControls(snapshot);
    this._updateProcess(snapshot);
    this._renderVision(snapshot);
    this._updateStatusText(snapshot, reason);
  }

  _updateControls(snapshot) {
    const playLabel = document.querySelector("#playButton span");
    if (playLabel) playLabel.textContent = snapshot.paused ? "继续" : "播放";
    document.getElementById("pauseButton").disabled = snapshot.state !== "running";

    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === snapshot.mode);
    });

    const stepCounter = document.getElementById("stepCounter");
    stepCounter.textContent = `${pad(snapshot.stepIndex)} / ${pad(snapshot.totalSteps)}`;
    document.getElementById("cycleTime").textContent = formatCycleTime(snapshot.elapsedMs);

    const speedValue = document.getElementById("speedValue");
    if (speedValue) speedValue.textContent = `${snapshot.speed.toFixed(1)}×`;
    const speedRange = document.getElementById("speedRange");
    if (speedRange && Number(speedRange.value) !== snapshot.speed) speedRange.value = String(snapshot.speed);
    this._updateSpeedVisual(snapshot.speed);
  }

  _updateSpeedVisual(speed) {
    const speedRange = document.getElementById("speedRange");
    if (!speedRange) return;
    const percent = ((Number(speed) - Number(speedRange.min)) / (Number(speedRange.max) - Number(speedRange.min))) * 100;
    speedRange.style.background = `linear-gradient(90deg, var(--cyan) ${percent}%, #223746 ${percent}%)`;
  }

  _mapStepToProcess(snapshot) {
    const id = snapshot.currentStep?.id || "";
    if (!id) {
      if (snapshot.state === "completed") return "release";
      return "load";
    }
    if (id.startsWith("refill") || id === "all-refilled") return "refill";
    if (id.includes("capture-1")) return "capture-1";
    if (id.includes("transfer-y")) return "transfer-y";
    if (id.includes("capture-2")) return "capture-2";
    if (id.includes("compare") || id.includes("decision")) return "compare";
    if (id.includes("release")) return "release";
    if (id === "cycle-end") return "release";
    return "load";
  }

  _updateProcess(snapshot) {
    const processOrder = ["load", "capture-1", "transfer-y", "capture-2", "compare", "refill", "release"];
    const active = this._mapStepToProcess(snapshot);
    const activeIndex = processOrder.indexOf(active);
    document.querySelectorAll(".process-node").forEach((node) => {
      const index = processOrder.indexOf(node.dataset.step);
      node.classList.toggle("is-active", snapshot.state !== "completed" && node.dataset.step === active);
      node.classList.toggle("is-complete", snapshot.state === "completed" || (activeIndex >= 0 && index < activeIndex));
    });
    document.getElementById("processProgress").style.width = `${Math.min(100, Math.max(0, snapshot.progress))}%`;

    const stateLabels = {
      idle: "READY",
      preparing: "PREPARING",
      running: "RUNNING",
      paused: "PAUSED",
      completed: "COMPLETE",
      fault: "FAULT",
    };
    const processState = document.getElementById("processState");
    processState.textContent = stateLabels[snapshot.state] || "READY";
    processState.style.color = snapshot.state === "fault" ? "var(--red)" : snapshot.state === "paused" ? "var(--amber)" : "var(--mint)";
  }

  _renderVision(snapshot) {
    const container = document.getElementById("visionGrid");
    if (!container) return;
    const { grid } = snapshot;
    const products = grid.products;
    container.style.gridTemplateColumns = `repeat(${grid.cols}, minmax(0, 1fr))`;
    container.style.gridTemplateRows = `repeat(${grid.rows}, minmax(0, 1fr))`;
    document.getElementById("trayLayoutText").textContent = `${grid.rows} R × ${grid.cols} C`;
    document.getElementById("detectedCount").textContent = String(products.length);

    const currentMissing = products.filter((product) => !product.present).length;
    document.getElementById("missingCount").textContent = pad(currentMissing);
    document.getElementById("refilledCount").textContent = pad(snapshot.refilledCount);

    const activeRefillIndex = this._getActiveRefillIndex(snapshot);
    const defectIndexMap = new Map();
    snapshot.defects.forEach((defect, index) => defectIndexMap.set(`${defect.row}-${defect.col}`, index));

    container.innerHTML = products.map((product, index) => {
      let state = product.present ? "present" : "missing";
      if (this.activeVisionTab === "first") {
        if (snapshot.firstResults.length) state = snapshot.firstResults[index] ? "present" : "missing";
        else state = product.present ? "present" : "missing";
      } else if (this.activeVisionTab === "second") {
        if (snapshot.secondResults.length) state = snapshot.secondResults[index] ? "present" : "missing";
        else state = "unknown";
      } else {
        state = product.present ? "present" : "missing";
      }
      const defectIndex = defectIndexMap.get(`${product.row}-${product.col}`);
      if (defectIndex === activeRefillIndex && !product.present && snapshot.state === "running") {
        state = "refilling";
      }
      return `
        <button
          type="button"
          class="vision-cell"
          data-state="${state}"
          data-row="${product.row}"
          data-col="${product.col}"
          data-code="${product.row + 1}${product.col + 1}"
          aria-label="第 ${product.row + 1} 行，第 ${product.col + 1} 列，${this._stateLabel(state)}"
          title="R${product.row + 1} C${product.col + 1} · ${this._stateLabel(state)}"
        ></button>
      `;
    }).join("");

    const trayStage = container.closest(".tray-stage");
    trayStage?.classList.toggle("is-scanning", snapshot.currentStep?.id?.includes("capture"));
    this._updateVisionResult(snapshot, currentMissing);
  }

  _getActiveRefillIndex(snapshot) {
    const id = snapshot.currentStep?.id || "";
    const match = id.match(/^refill-(\d+)/);
    return match ? Number(match[1]) : -1;
  }

  _stateLabel(state) {
    return {
      present: "有料",
      missing: "缺料",
      refilling: "补料中",
      unknown: "未检测",
    }[state] || "未检测";
  }

  _updateVisionResult(snapshot, currentMissing) {
    const bar = document.getElementById("visionResultBar");
    if (!bar) return;
    bar.classList.remove("is-warning", "is-success");
    let text = "制程待机 · 等待首次拍照";
    let icon = "scan-search";
    if (snapshot.state === "preparing") {
      text = "设备准备 · 运动轴归零";
    } else if (snapshot.currentStep?.id === "capture-1") {
      text = "第一次拍照中 · 保存基准影像";
      icon = "camera";
    } else if (snapshot.currentStep?.id === "capture-2") {
      text = "第二次拍照中 · 获取复检影像";
      icon = "camera";
    } else if (snapshot.currentStep?.id === "compare") {
      text = currentMissing ? `对比完成 · 检测到 ${currentMissing} 个缺料位` : "对比完成 · 未发现缺料";
      bar.classList.add(currentMissing ? "is-warning" : "is-success");
      icon = currentMissing ? "triangle-alert" : "badge-check";
    } else if (snapshot.currentStep?.id?.startsWith("refill")) {
      text = `${snapshot.currentStep.title} · ${snapshot.refilledCount}/${snapshot.defects.length}`;
      bar.classList.add("is-warning");
      icon = "crosshair";
    } else if (snapshot.state === "completed") {
      text = "循环完成 · 料盘自动放行";
      bar.classList.add("is-success");
      icon = "circle-check-big";
    } else if (snapshot.state === "running") {
      text = `${snapshot.currentStep?.area || "SYSTEM"} · ${snapshot.currentStep?.title || "运行中"}`;
    } else if (snapshot.defects.length) {
      text = `配方就绪 · ${snapshot.defects.length} 个缺料位待处理`;
      bar.classList.add("is-warning");
      icon = "triangle-alert";
    } else {
      text = "配方就绪 · 良品直通";
      bar.classList.add("is-success");
      icon = "badge-check";
    }
    bar.innerHTML = `<i data-lucide="${icon}"></i><span>${text}</span>`;
    refreshIcons();
  }

  _updateStatusText(snapshot, reason) {
    const plc = document.getElementById("plcStatus");
    const aoi = document.getElementById("aoiStatus");
    const visionLive = document.getElementById("visionLive");
    if (plc) {
      plc.textContent =
        snapshot.state === "fault"
          ? "FAULT"
          : snapshot.state === "running"
            ? "AUTO RUN"
            : snapshot.state === "paused"
              ? "HOLD"
              : "CONNECTED";
    }
    if (aoi) {
      aoi.textContent = reason.includes("vision") ? "CAPTURE" : snapshot.defects.length ? "DEFECT" : "READY";
    }
    if (visionLive) {
      visionLive.style.color = snapshot.defects.length && snapshot.state !== "completed" ? "var(--amber)" : "var(--mint)";
    }
  }

  _openArrayDialog() {
    if (this._isCycleBusy()) {
      this.showToast("运行流程进行中，暂不能修改阵列");
      return;
    }
    document.getElementById("gridRows").value = this.machine.gridConfig.rows;
    document.getElementById("gridCols").value = this.machine.gridConfig.cols;
    document.getElementById("pitchX").value = Math.round(this.machine.gridConfig.pitchX * 1000);
    document.getElementById("pitchZ").value = Math.round(this.machine.gridConfig.pitchZ * 1000);
    document.getElementById("arrayDialog")?.showModal();
  }

  _isCycleBusy() {
    return this.simulation.state === "running" || this.simulation.state === "preparing" || this.simulation.loopActive;
  }

  _toggleExplodeMenu() {
    const menu = document.getElementById("explodeMenu");
    if (!menu) return;
    if (!menu.hidden) {
      this._hideExplodeMenu();
      return;
    }
    const rect = document.getElementById("explodeButton").getBoundingClientRect();
    menu.hidden = false;
    const width = menu.offsetWidth || 218;
    const height = menu.offsetHeight || 320;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
    menu.style.top = `${Math.max(8, rect.top - height - 9)}px`;
    refreshIcons();
  }

  _hideExplodeMenu() {
    const menu = document.getElementById("explodeMenu");
    if (menu) menu.hidden = true;
  }

  _togglePanel(id, forceOpen = null) {
    const panel = document.getElementById(id);
    if (!panel) return;
    const open = forceOpen ?? !panel.classList.contains("is-open");
    panel.classList.toggle("is-open", open);
  }

  _closePanel(id) {
    document.getElementById(id)?.classList.remove("is-open");
  }

  async _toggleFullscreen() {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  }

  _startClock() {
    const update = () => {
      const now = new Date();
      const text = now.toLocaleTimeString("zh-CN", { hour12: false });
      const element = document.getElementById("clockText");
      if (element) element.textContent = text;
    };
    update();
    setInterval(update, 1000);
  }

  showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2300);
  }
}
