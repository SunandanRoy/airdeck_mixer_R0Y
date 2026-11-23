// @ts-check
/**
 * AutomationEngine: turns a transition Plan into AudioParam calls on the
 * AudioContext clock. Audio parameters are never driven by timers; timers are
 * used only for non-audio actions (play/pause a video, update the UI).
 */

/** @typedef {import('./transitions/common.js').Plan} Plan */
/** @typedef {import('./transitions/common.js').PlanAction} PlanAction */

export class AutomationEngine {
  /**
   * @param {BaseAudioContext} ctx
   * @param {(target: string) => AudioParam | null} resolve maps a target to its AudioParam
   * @param {(action: PlanAction, plan: Plan) => void} onAction
   */
  constructor(ctx, resolve, onAction) {
    this.ctx = ctx;
    this.resolve = resolve;
    this.onAction = onAction;
    /** @type {Plan | null} */
    this.current = null;
    /** @type {Map<string, number>} */
    this.baseline = new Map();
    /** @type {ReturnType<typeof setTimeout>[]} */
    this.timers = [];
  }

  get running() {
    return this.current !== null;
  }

  /**
   * Schedules a plan. Any running plan is finished first.
   * @param {Plan} plan
   */
  run(plan) {
    if (this.current) this.cancel(0.05);
    this.current = plan;
    this.baseline.clear();
    for (const target of plan.targets) {
      const param = this.resolve(target);
      if (!param) continue;
      this.baseline.set(target, param.value);
      hold(param, plan.t0);
    }
    for (const ev of plan.events) {
      const param = this.resolve(ev.target);
      if (!param) continue;
      switch (ev.type) {
        case 'set':
          param.setValueAtTime(/** @type {number} */ (ev.value), ev.time);
          break;
        case 'linear':
          param.linearRampToValueAtTime(/** @type {number} */ (ev.value), ev.time);
          break;
        case 'exp':
          param.exponentialRampToValueAtTime(Math.max(1e-4, /** @type {number} */ (ev.value)), ev.time);
          break;
        case 'curve':
          param.setValueCurveAtTime(Float32Array.from(/** @type {number[]} */ (ev.value)), ev.time, ev.duration ?? 0.1);
          break;
      }
    }
    for (const action of plan.actions) {
      const delayMs = Math.max(0, (action.time - this.ctx.currentTime) * 1000);
      this.timers.push(
        setTimeout(() => {
          if (this.current !== plan) return;
          if (action.type === 'done') this.current = null;
          this.onAction(action, plan);
        }, delayMs),
      );
    }
  }

  /**
   * Smoothly undoes the running plan: holds every touched param where it is,
   * then ramps it back to its value from before the plan over `seconds`.
   */
  cancel(seconds = 1) {
    const plan = this.current;
    if (!plan) return;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const now = this.ctx.currentTime;
    for (const target of plan.targets) {
      const param = this.resolve(target);
      if (!param) continue;
      hold(param, now);
      const back = this.baseline.get(target);
      if (back !== undefined) param.linearRampToValueAtTime(back, now + Math.max(0.01, seconds));
    }
    this.current = null;
    this.onAction({ type: 'done', time: now }, plan);
  }
}

/**
 * Freezes a param at its current value at `time` and drops later automation.
 * @param {AudioParam} param
 * @param {number} time
 */
export function hold(param, time) {
  const p = /** @type {AudioParam & {cancelAndHoldAtTime?: (t: number) => AudioParam}} */ (param);
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(time);
  } else {
    const v = param.value;
    param.cancelScheduledValues(time);
    param.setValueAtTime(v, time);
  }
}

/**
 * Click-free change of a param: ramps to `value` with a time constant.
 * @param {AudioParam} param
 * @param {number} value
 * @param {BaseAudioContext} ctx
 * @param {number} [timeConstant] seconds (default 15 ms ramp ≈ 3 time constants of 5 ms)
 */
export function smoothSet(param, value, ctx, timeConstant = 0.005) {
  const now = ctx.currentTime;
  hold(param, now);
  param.setTargetAtTime(value, now, timeConstant);
}
