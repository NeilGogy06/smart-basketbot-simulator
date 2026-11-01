import { describe, it, expect, beforeEach } from 'vitest';
import { PIDController, HeadingPIDController } from '../src/robot/PIDController.js';

describe('PIDController', () => {
  let pid;

  beforeEach(() => {
    pid = new PIDController({
      kp: 2.0,
      ki: 0.5,
      kd: 0.1,
      minOutput: -10.0,
      maxOutput: 10.0,
      integralLimit: 5.0
    });
  });

  describe('Proportional Response', () => {
    it('produces output proportional to error on first step without integral/derivative history', () => {
      // With dt = 0.01, error = 3.0:
      // P = kp * error = 2.0 * 3.0 = 6.0
      // I = ki * (error * dt) = 0.5 * (3.0 * 0.01) = 0.015
      // D = 0 (first step has no previous error)
      const output = pid.update(3.0, 0.01);
      const tel = pid.getTelemetry();

      expect(tel.pTerm).toBeCloseTo(6.0, 6);
      expect(output).toBeCloseTo(6.015, 6);
    });

    it('produces negative proportional response for negative error', () => {
      const output = pid.update(-2.5, 0.01);
      const tel = pid.getTelemetry();

      expect(tel.pTerm).toBeCloseTo(-5.0, 6);
      expect(output).toBeLessThan(0);
    });

    it('returns 0 proportional response when error is zero', () => {
      pid.update(0.0, 0.01);
      const tel = pid.getTelemetry();
      expect(tel.pTerm).toBe(0.0);
    });
  });

  describe('Integral Response', () => {
    it('accumulates error over time to eliminate steady-state error', () => {
      const error = 1.0;
      const dt = 0.1;

      // Step 1
      pid.update(error, dt);
      expect(pid.integral).toBeCloseTo(0.1, 6);

      // Step 2
      pid.update(error, dt);
      expect(pid.integral).toBeCloseTo(0.2, 6);

      // Step 3
      pid.update(error, dt);
      expect(pid.integral).toBeCloseTo(0.3, 6);

      // I-term = ki * integral = 0.5 * 0.3 = 0.15
      const tel = pid.getTelemetry();
      expect(tel.iTerm).toBeCloseTo(0.15, 6);
    });

    it('reduces integral accumulator when error reverses sign', () => {
      pid.update(2.0, 0.1); // integral = +0.2
      pid.update(-2.0, 0.1); // integral = +0.2 - 0.2 = 0.0
      expect(pid.integral).toBeCloseTo(0.0, 6);
    });
  });

  describe('Derivative Response', () => {
    it('opposes sudden rate of change in error', () => {
      // Step 1: error = 1.0
      pid.update(1.0, 0.1);

      // Step 2: error spikes to 3.0 in 0.1s -> rate of change = (3.0 - 1.0) / 0.1 = 20.0
      // D-term = kd * dError = 0.1 * 20.0 = 2.0
      pid.update(3.0, 0.1);
      const tel = pid.getTelemetry();

      expect(tel.dTerm).toBeCloseTo(2.0, 6);
    });

    it('dampens rapid drop in error', () => {
      pid.update(4.0, 0.1);
      // Sudden drop from 4.0 to 1.0 -> dError = (1.0 - 4.0)/0.1 = -30.0
      // D-term = 0.1 * -30.0 = -3.0
      pid.update(1.0, 0.1);
      const tel = pid.getTelemetry();

      expect(tel.dTerm).toBeCloseTo(-3.0, 6);
    });
  });

  describe('Integral Windup Protection', () => {
    it('clamps integral accumulator within configured integralLimit under sustained error', () => {
      // With integralLimit = 5.0, sustained large error should never exceed 5.0
      const largeError = 100.0;
      const dt = 0.1;

      for (let i = 0; i < 20; i++) {
        pid.update(largeError, dt);
      }

      expect(pid.integral).toBe(5.0);
      expect(pid.getTelemetry().iTerm).toBeCloseTo(0.5 * 5.0, 6); // 2.5
    });

    it('clamps negative integral accumulator to -integralLimit', () => {
      const negativeError = -100.0;
      const dt = 0.1;

      for (let i = 0; i < 20; i++) {
        pid.update(negativeError, dt);
      }

      expect(pid.integral).toBe(-5.0);
    });
  });

  describe('Output Saturation Limits', () => {
    it('saturates output at maxOutput', () => {
      const output = pid.update(50.0, 0.1);
      expect(output).toBe(10.0);
    });

    it('saturates output at minOutput', () => {
      const output = pid.update(-50.0, 0.1);
      expect(output).toBe(-10.0);
    });
  });

  describe('Reset Functionality', () => {
    it('clears accumulated integral and previous error history', () => {
      pid.update(4.0, 0.1);
      pid.update(5.0, 0.1);
      expect(pid.integral).toBeGreaterThan(0);

      pid.reset();

      expect(pid.integral).toBe(0.0);
      expect(pid.prevError).toBe(0.0);
      expect(pid.hasRun).toBe(false);

      const tel = pid.getTelemetry();
      expect(tel.pTerm).toBe(0.0);
      expect(tel.iTerm).toBe(0.0);
      expect(tel.dTerm).toBe(0.0);
      expect(tel.output).toBe(0.0);
    });
  });

  describe('HeadingPIDController Angular Wrapping', () => {
    let headingPID;

    beforeEach(() => {
      headingPID = new HeadingPIDController({
        kp: 3.0,
        ki: 0.1,
        kd: 0.2,
        minOutput: -3.5,
        maxOutput: 3.5
      });
    });

    it('turns shortest path across the 180° / -180° boundary', () => {
      // Current heading is 170° (+2.967 rad), Target heading is -170° (-2.967 rad)
      // Linear difference is -340° (-5.934 rad)
      // But shortest angular path is +20° (+0.349 rad) turning counter-clockwise!
      const current = 170 * (Math.PI / 180);
      const target = -170 * (Math.PI / 180);

      const output = headingPID.computeAngularVelocity(target, current, 0.05);

      // Shortest turn is positive (turning left +20°)
      expect(output).toBeGreaterThan(0);
      expect(headingPID.lastError).toBeCloseTo(20 * (Math.PI / 180), 4);
    });

    it('turns clockwise when target is immediately to the right', () => {
      const current = 0.0;
      const target = -Math.PI / 4; // -45°

      const output = headingPID.computeAngularVelocity(target, current, 0.05);
      expect(output).toBeLessThan(0);
      expect(headingPID.lastError).toBeCloseTo(-Math.PI / 4, 4);
    });
  });
});
