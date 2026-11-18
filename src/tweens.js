const EASING = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  backOut: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

function getProperty(target, path) {
  return path.split(".").reduce((value, key) => value?.[key], target);
}

function setProperty(target, path, value) {
  const keys = path.split(".");
  const leaf = keys.pop();
  const owner = keys.reduce((current, key) => current[key], target);
  owner[leaf] = value;
}

export class TweenManager {
  constructor() {
    this.tweens = [];
    this.pausedChannels = new Set();
    this.time = 0;
  }

  to(target, properties, duration = 600, options = {}) {
    const {
      easing = "easeInOut",
      channel = "ui",
      delay = 0,
      onUpdate,
      onComplete,
      replace = true,
    } = options;

    if (replace) {
      this.tweens = this.tweens.filter((tween) => {
        if (tween.target !== target) return true;
        const overlaps = Object.keys(properties).some((path) => tween.paths.includes(path));
        if (overlaps) {
          tween.cancelled = true;
          tween.resolve?.({ cancelled: true });
          return false;
        }
        return true;
      });
    }

    return new Promise((resolve) => {
      const tween = {
        target,
        paths: Object.keys(properties),
        properties,
        duration: Math.max(1, duration),
        elapsed: -Math.max(0, delay),
        channel,
        easing: typeof easing === "function" ? easing : (EASING[easing] || EASING.easeInOut),
        onUpdate,
        onComplete,
        resolve,
        cancelled: false,
        started: false,
        from: {},
      };
      requestAnimationFrame(() => {
        if (tween.cancelled) return;
        for (const path of tween.paths) tween.from[path] = getProperty(target, path);
        tween.started = true;
      });
      this.tweens.push(tween);
    });
  }

  wait(duration = 500, channel = "simulation") {
    const placeholder = { progress: 0 };
    return this.to(placeholder, { progress: 1 }, duration, {
      easing: "linear",
      channel,
      replace: false,
    });
  }

  update(deltaSeconds) {
    const delta = Math.min(deltaSeconds, 0.05) * 1000;
    this.time += delta;

    for (const tween of this.tweens) {
      if (tween.cancelled || !tween.started || this.pausedChannels.has(tween.channel)) continue;
      tween.elapsed += delta;
      if (tween.elapsed < 0) continue;

      const progress = Math.min(1, tween.elapsed / tween.duration);
      const eased = tween.easing(progress);
      for (const path of tween.paths) {
        const from = Number(tween.from[path]) || 0;
        const to = Number(tween.properties[path]);
        setProperty(tween.target, path, from + (to - from) * eased);
      }
      tween.onUpdate?.(eased);

      if (progress >= 1) {
        tween.cancelled = true;
        tween.onComplete?.();
        tween.resolve({ cancelled: false });
      }
    }

    this.tweens = this.tweens.filter((tween) => !tween.cancelled);
  }

  setChannelPaused(channel, paused) {
    if (paused) this.pausedChannels.add(channel);
    else this.pausedChannels.delete(channel);
  }

  isChannelPaused(channel) {
    return this.pausedChannels.has(channel);
  }

  killChannel(channel, resolve = true) {
    for (const tween of this.tweens) {
      if (tween.channel !== channel) continue;
      tween.cancelled = true;
      if (resolve) tween.resolve({ cancelled: true });
    }
    this.tweens = this.tweens.filter((tween) => tween.channel !== channel);
    this.pausedChannels.delete(channel);
  }
}

export function easeOutCubic(t) {
  return EASING.easeOut(t);
}
