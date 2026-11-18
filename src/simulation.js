export class SimulationController {
  constructor(machine, tweens, onChange) {
    this.machine = machine;
    this.tweens = tweens;
    this.onChange = onChange;
    this.mode = "single";
    this.speed = 1;
    this.state = "idle";
    this.paused = false;
    this.sequence = [];
    this.stepIndex = 0;
    this.currentStep = null;
    this.isPrepared = false;
    this.loopActive = false;
    this.pauseAfterStep = false;
    this.runToken = 0;
    this.firstResults = [];
    this.secondResults = [];
    this.defects = [];
    this.refilledCount = 0;
    this.totalDefects = 0;
    this.cycleCount = 0;
    this.startedAt = 0;
    this.elapsedMs = 0;
    this.lastSnapshotReason = "init";
    this._duration = (ms) => Math.max(90, ms / this.speed);
  }

  initialize() {
    this.machine.setRandomDefects("single");
    this.defects = this.machine.getDefects();
    this.totalDefects = this.defects.length;
    this._syncSnapshotResults();
    this._notify("initialize");
  }

  setMode(mode) {
    if (this.state === "running") return;
    this.mode = mode;
    this._cancelRun();
    this.sequence = [];
    this.stepIndex = 0;
    this.isPrepared = false;
    this.currentStep = null;
    this.state = "idle";
    this.paused = false;
    this.refilledCount = 0;
    const defects = this.machine.setRandomDefects(mode);
    this.defects = defects;
    this.totalDefects = defects.length;
    this.firstResults = [];
    this.secondResults = [];
    this._syncSnapshotResults();
    this._notify("mode");
  }

  setSpeed(speed) {
    this.speed = Number(speed);
    this._notify("speed");
  }

  toggleProduct(row, col) {
    if (this.state === "running" || this.state === "preparing") return false;
    const product = this.machine.getProduct(row, col);
    if (!product) return false;
    this.machine.setProductPresent(row, col, !product.present, true);
    this.defects = this.machine.getDefects();
    this.totalDefects = this.defects.length;
    this.mode = this.totalDefects === 0 ? "normal" : this.totalDefects === 1 ? "single" : "multi";
    this.isPrepared = false;
    this.sequence = [];
    this.stepIndex = 0;
    this.state = "idle";
    this.firstResults = [];
    this.secondResults = [];
    this._notify("manual");
    return true;
  }

  async play() {
    if (this.loopActive && this.paused) {
      this.paused = false;
      this.state = "running";
      this.tweens.setChannelPaused("simulation", false);
      this._notify("resume");
      return;
    }
    if (this.loopActive) return;
    if (this.state === "completed") {
      this._prepareNextCycle();
    }
    await this._startLoop();
  }

  pause() {
    if (!this.loopActive || this.state !== "running") return;
    this.paused = true;
    this.state = "paused";
    this.tweens.setChannelPaused("simulation", true);
    this._notify("pause");
  }

  async step() {
    if (this.loopActive) {
      if (!this.paused) return;
      this.pauseAfterStep = true;
      this.paused = false;
      this.state = "running";
      this.tweens.setChannelPaused("simulation", false);
      this._notify("step-continue");
      return;
    }
    if (this.state === "running" || this.state === "preparing") return;
    if (this.state === "completed") this._prepareNextCycle();

    const token = ++this.runToken;
    await this._ensurePrepared();
    if (token !== this.runToken) return;
    if (this.stepIndex >= this.sequence.length) return;

    this.state = "running";
    const step = this.sequence[this.stepIndex];
    this.currentStep = step;
    this._notify("step-start");
    try {
      await step.run();
    } catch (error) {
      if (token === this.runToken) {
        this.state = "fault";
        this.lastSnapshotReason = error?.message || "step-error";
        this._notify("fault");
      }
      return;
    }
    if (token !== this.runToken) return;
    this.stepIndex += 1;
    this.state = this.stepIndex >= this.sequence.length ? "completed" : "paused";
    this.paused = this.state === "paused";
    this.tweens.setChannelPaused("simulation", false);
    this._notify("step-complete");
  }

  reset() {
    this._cancelRun();
    this.mode = "normal";
    this.speed = this.speed;
    this.state = "idle";
    this.paused = false;
    this.sequence = [];
    this.stepIndex = 0;
    this.currentStep = null;
    this.isPrepared = false;
    this.firstResults = [];
    this.secondResults = [];
    this.refilledCount = 0;
    this.totalDefects = 0;
    this.elapsedMs = 0;
    this.machine.resetGridPresence();
    this.machine.resetMotion();
    this.machine.setBacklight(false);
    this._syncSnapshotResults();
    this._notify("reset");
  }

  setManualDefects(defectList) {
    if (this.state === "running") return;
    this._cancelRun();
    this.machine.resetGridPresence();
    for (const defect of defectList) {
      this.machine.setProductPresent(defect.row, defect.col, false, false);
    }
    this.defects = this.machine.getDefects();
    this.totalDefects = this.defects.length;
    this.mode = this.totalDefects === 0 ? "normal" : this.totalDefects === 1 ? "single" : "multi";
    this.state = "idle";
    this.isPrepared = false;
    this.stepIndex = 0;
    this.sequence = [];
    this._notify("manual");
  }

  async _startLoop() {
    const token = ++this.runToken;
    this.loopActive = true;
    this.paused = false;
    this.state = this.isPrepared ? "running" : "preparing";
    this._notify("prepare");
    await this._ensurePrepared();
    if (token !== this.runToken) return;
    this.state = "running";
    this.startedAt = performance.now() - this.elapsedMs;
    this.machine.conveyorRunning = true;
    this._notify("run");

    while (this.stepIndex < this.sequence.length) {
      if (token !== this.runToken) return;
      const step = this.sequence[this.stepIndex];
      this.currentStep = step;
      this._notify("step-start");
      try {
        await step.run();
      } catch (error) {
        if (token === this.runToken) {
          this.state = "fault";
          this.lastSnapshotReason = error?.message || "step-error";
          this.loopActive = false;
          this.machine.conveyorRunning = false;
          this._notify("fault");
        }
        return;
      }
      if (token !== this.runToken) return;
      this.stepIndex += 1;
      this.elapsedMs = performance.now() - this.startedAt;
      this._notify("step-complete");

      if (this.pauseAfterStep) {
        this.pauseAfterStep = false;
        this.paused = true;
        this.state = "paused";
        this.loopActive = false;
        this.tweens.setChannelPaused("simulation", true);
        this._notify("pause");
        return;
      }
    }

    if (token !== this.runToken) return;
    this.activeStep = null;
    this.currentStep = null;
    this.state = "completed";
    this.paused = false;
    this.loopActive = false;
    this.machine.conveyorRunning = false;
    this.machine.setBacklight(false);
    this.machine.setVacuum(false);
    this.cycleCount += 1;
    this._notify("complete");
  }

  async _ensurePrepared() {
    if (this.isPrepared) return;
    await this.machine.resetMotion();
    this.defects = this.machine.getDefects();
    this.totalDefects = this.defects.length;
    this.refilledCount = 0;
    this.firstResults = [];
    this.secondResults = [];
    this.elapsedMs = 0;
    this.sequence = this._buildSequence();
    this.stepIndex = 0;
    this.isPrepared = true;
    this._notify("prepared");
  }

  _prepareNextCycle() {
    this._cancelRun();
    this.machine.setRandomDefects(this.mode);
    this.defects = this.machine.getDefects();
    this.totalDefects = this.defects.length;
    this.isPrepared = false;
    this.sequence = [];
    this.stepIndex = 0;
    this.refilledCount = 0;
    this.firstResults = [];
    this.secondResults = [];
    this.state = "idle";
    this.elapsedMs = 0;
  }

  _cancelRun() {
    this.runToken += 1;
    this.loopActive = false;
    this.pauseAfterStep = false;
    this.paused = false;
    this.tweens.killChannel("simulation", true);
    this.tweens.setChannelPaused("simulation", false);
    this.machine.conveyorRunning = false;
  }

  _captureGrid() {
    return this.machine.mainProducts.map((product) => product.present);
  }

  _syncSnapshotResults() {
    this.firstResults = this._captureGrid();
    this.secondResults = [...this.firstResults];
  }

  _buildSequence() {
    const steps = [];
    const duration = this._duration.bind(this);
    const add = (id, title, area, run) => steps.push({ id, title, area, run });

    add("load", "X轴料盘上料", "X AXIS", async () => {
      this.machine.setBacklight(false);
      this.machine.conveyorRunning = true;
      await this.machine.movePalletX(-0.015, duration(1050));
      await this.tweens.wait(duration(180), "simulation");
    });

    add("locate", "料盘到位定位", "X/Y STAGE", async () => {
      await Promise.all([
        this.machine.movePalletY(0, duration(420)),
        this.tweens.wait(duration(420), "simulation"),
      ]);
    });

    add("backlight", "背光点亮", "VISION", async () => {
      this.machine.setBacklight(true, 3.1);
      await this.tweens.wait(duration(430), "simulation");
    });

    add("capture-1", "相机第一次拍照", "AOI", async () => {
      this.machine.flashCamera(duration(600));
      await this.tweens.wait(duration(540), "simulation");
      this.firstResults = this._captureGrid();
      this._notify("vision-first");
      await this.tweens.wait(duration(260), "simulation");
    });

    add("transfer-y", "Y轴转移料盘", "Y AXIS", async () => {
      await this.machine.movePalletY(0.075, duration(720));
      await this.tweens.wait(duration(140), "simulation");
    });

    add("capture-2", "相机第二次拍照", "AOI", async () => {
      this.machine.flashCamera(duration(600));
      await this.tweens.wait(duration(540), "simulation");
      this.secondResults = this._captureGrid();
      this._notify("vision-second");
      await this.tweens.wait(duration(260), "simulation");
    });

    add("compare", "双图对比 / 缺料判定", "VISION", async () => {
      this.defects = this.machine.getDefects();
      this.totalDefects = this.defects.length;
      await this.tweens.wait(duration(560), "simulation");
      this._notify("compare");
    });

    add("decision", "流程分流", "PLC", async () => {
      this.machine.setBacklight(false);
      await this.machine.movePalletY(0, duration(520));
      await this.tweens.wait(duration(400), "simulation");
    });

    if (this.defects.length === 0) {
      add("release", "无缺料 · 自动放行", "X AXIS", async () => {
        this.machine.conveyorRunning = true;
        await this.machine.movePalletX(0.57, duration(1100));
        await this.tweens.wait(duration(250), "simulation");
        this.machine.conveyorRunning = false;
      });
    } else {
      this.defects.forEach((defect, defectIndex) => {
        let pickedSupply = null;
        const supplyRow = defectIndex % this.machine.gridConfig.rows;
        const supplyCol = (defectIndex * 3 + 2) % this.machine.gridConfig.cols;
        add(`refill-${defectIndex}-travel-supply`, `前往供料盘 R${defect.row + 1}C${defect.col + 1}`, "XYZ", async () => {
          pickedSupply =
            this.machine.pickSupplyProduct(supplyRow, supplyCol) ||
            this.machine.pickSupplyProduct();
          if (!pickedSupply) throw new Error("独立供料盘已空");
          const supply = this.machine.supplyPositionFor(pickedSupply);
          await this.machine.moveXYZ({ x: supply.x, z: supply.z, zHeight: 0.075 }, duration(760));
          await this.tweens.wait(duration(120), "simulation");
        });

        add(`refill-${defectIndex}-down-1`, "Z轴下降吸取", "Z AXIS", async () => {
          await this.machine.moveXYZ({ zHeight: -0.24 }, duration(420));
        });

        add(`refill-${defectIndex}-pick`, "真空吸取产品", "VACUUM", async () => {
          this.machine.setVacuum(true);
          this.machine.setCarriedProductVisible(true);
          await this.tweens.wait(duration(360), "simulation");
        });

        add(`refill-${defectIndex}-up-1`, "Z轴吸取上升", "Z AXIS", async () => {
          await this.machine.moveXYZ({ zHeight: 0.08 }, duration(380));
        });

        add(`refill-${defectIndex}-travel-defect`, `移至缺料位 R${defect.row + 1}C${defect.col + 1}`, "XYZ", async () => {
          const target = this.machine.palletPositionFor(defect.row, defect.col);
          await this.machine.moveXYZ({ x: target.x, z: target.z }, duration(820));
          await this.tweens.wait(duration(120), "simulation");
        });

        add(`refill-${defectIndex}-down-2`, "Z轴下降放置", "Z AXIS", async () => {
          await this.machine.moveXYZ({ zHeight: -0.245 }, duration(420));
        });

        add(`refill-${defectIndex}-place`, "真空释放 / 放置", "VACUUM", async () => {
          this.machine.setCarriedProductVisible(false);
          this.machine.setProductPresent(defect.row, defect.col, true, true);
          this.machine.setVacuum(false);
          this.refilledCount += 1;
          this.secondResults = this._captureGrid();
          await this.tweens.wait(duration(360), "simulation");
          this._notify("refill");
        });

        add(`refill-${defectIndex}-up-2`, "Z轴复位上升", "Z AXIS", async () => {
          await this.machine.moveXYZ({ zHeight: 0.08 }, duration(360));
          await this.tweens.wait(duration(130), "simulation");
        });
      });

      add("all-refilled", "补料完成检查", "PLC", async () => {
        const remaining = this.machine.getDefects();
        if (remaining.length) throw new Error(`仍有 ${remaining.length} 个缺料位未完成`);
        await this.tweens.wait(duration(420), "simulation");
      });

      add("release-refilled", "料盘自动放行", "X AXIS", async () => {
        this.machine.conveyorRunning = true;
        await this.machine.movePalletX(0.57, duration(1100));
        await this.tweens.wait(duration(250), "simulation");
        this.machine.conveyorRunning = false;
      });
    }

    add("cycle-end", "循环结束", "SYSTEM", async () => {
      this.machine.setBacklight(false);
      this.machine.setVacuum(false);
      await this.tweens.wait(duration(300), "simulation");
    });

    return steps;
  }

  getSnapshot() {
    const step = this.currentStep;
    const completion = this.sequence.length ? Math.round((this.stepIndex / this.sequence.length) * 100) : 0;
    return {
      state: this.state,
      mode: this.mode,
      speed: this.speed,
      stepIndex: this.stepIndex,
      totalSteps: this.sequence.length,
      currentStep: step ? { id: step.id, title: step.title, area: step.area } : null,
      progress: completion,
      defects: this.defects.map(({ row, col, id }) => ({ row, col, id })),
      totalDefects: this.totalDefects,
      refilledCount: this.refilledCount,
      firstResults: [...this.firstResults],
      secondResults: [...this.secondResults],
      grid: this.machine.getGridState(),
      cycleCount: this.cycleCount,
      elapsedMs: this.elapsedMs,
      paused: this.paused,
      loopActive: this.loopActive,
      reason: this.lastSnapshotReason,
    };
  }

  _notify(reason) {
    this.lastSnapshotReason = reason;
    this.onChange?.(this.getSnapshot(), reason);
  }
}
