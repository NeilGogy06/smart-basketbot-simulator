import { describe, it, expect } from 'vitest';
import { RobotKinematics } from '../src/robot/RobotKinematics.js';

describe('RobotKinematics', () => {
  const r = 0.10; // 10cm wheel radius
  const L = 0.64; // 64cm track width
  const kinematics = new RobotKinematics(r, L);

  describe('Constructor validation', () => {
    it('throws error on zero or negative wheel radius', () => {
      expect(() => new RobotKinematics(0, L)).toThrow();
      expect(() => new RobotKinematics(-0.1, L)).toThrow();
    });

    it('throws error on zero or negative track width', () => {
      expect(() => new RobotKinematics(r, 0)).toThrow();
      expect(() => new RobotKinematics(r, -0.5)).toThrow();
    });
  });

  describe('Forward Kinematics', () => {
    it('computes pure forward linear velocity with equal wheel speeds', () => {
      // v_left = 1.0 m/s, v_right = 1.0 m/s
      const result = kinematics.forwardKinematics(1.0, 1.0);
      expect(result.linearVelocity).toBeCloseTo(1.0, 6);
      expect(result.angularVelocity).toBeCloseTo(0.0, 6);
    });

    it('computes pure reverse linear velocity', () => {
      const result = kinematics.forwardKinematics(-1.5, -1.5);
      expect(result.linearVelocity).toBeCloseTo(-1.5, 6);
      expect(result.angularVelocity).toBeCloseTo(0.0, 6);
    });

    it('computes pure counter-clockwise (left) rotation in place', () => {
      // Point turn left: right wheel forward, left wheel reverse
      const v = 0.64;
      const result = kinematics.forwardKinematics(-v, v);
      expect(result.linearVelocity).toBeCloseTo(0.0, 6);
      // w = (v_right - v_left) / L = (0.64 - (-0.64)) / 0.64 = 1.28 / 0.64 = 2.0 rad/s
      expect(result.angularVelocity).toBeCloseTo(2.0, 6);
    });

    it('computes pure clockwise (right) rotation in place', () => {
      // Point turn right: left wheel forward, right wheel reverse
      const v = 0.64;
      const result = kinematics.forwardKinematics(v, -v);
      expect(result.linearVelocity).toBeCloseTo(0.0, 6);
      // w = (-0.64 - 0.64) / 0.64 = -2.0 rad/s
      expect(result.angularVelocity).toBeCloseTo(-2.0, 6);
    });

    it('computes forward kinematics from wheel angular velocities (rad/s)', () => {
      // omega_left = 10 rad/s, omega_right = 10 rad/s -> v = r * omega = 0.1 * 10 = 1.0 m/s
      const result = kinematics.forwardKinematicsFromAngular(10.0, 10.0);
      expect(result.linearVelocity).toBeCloseTo(1.0, 6);
      expect(result.angularVelocity).toBeCloseTo(0.0, 6);
      expect(result.vLeft).toBeCloseTo(1.0, 6);
      expect(result.vRight).toBeCloseTo(1.0, 6);
    });
  });

  describe('Inverse Kinematics', () => {
    it('computes wheel velocities for pure forward translation', () => {
      const { vLeft, vRight, omegaLeft, omegaRight } = kinematics.inverseKinematics(1.5, 0.0);
      expect(vLeft).toBeCloseTo(1.5, 6);
      expect(vRight).toBeCloseTo(1.5, 6);
      expect(omegaLeft).toBeCloseTo(15.0, 6); // 1.5 / 0.1
      expect(omegaRight).toBeCloseTo(15.0, 6);
    });

    it('computes wheel velocities for pure reverse translation', () => {
      const { vLeft, vRight, omegaLeft, omegaRight } = kinematics.inverseKinematics(-1.0, 0.0);
      expect(vLeft).toBeCloseTo(-1.0, 6);
      expect(vRight).toBeCloseTo(-1.0, 6);
      expect(omegaLeft).toBeCloseTo(-10.0, 6);
      expect(omegaRight).toBeCloseTo(-10.0, 6);
    });

    it('computes differential wheel speeds for curved arc motion', () => {
      const v = 1.0;
      const omega = 1.5;
      const { vLeft, vRight, omegaLeft, omegaRight } = kinematics.inverseKinematics(v, omega);

      // v_left = v - omega * L / 2 = 1.0 - (1.5 * 0.64) / 2 = 1.0 - 0.48 = 0.52 m/s
      // v_right = v + omega * L / 2 = 1.0 + 0.48 = 1.48 m/s
      expect(vLeft).toBeCloseTo(0.52, 6);
      expect(vRight).toBeCloseTo(1.48, 6);
      expect(omegaLeft).toBeCloseTo(5.2, 6);
      expect(omegaRight).toBeCloseTo(14.8, 6);
    });

    it('satisfies inverse and forward roundtrip identity', () => {
      const testCases = [
        { v: 1.2, w: 0.0 },
        { v: -0.8, w: 0.5 },
        { v: 0.0, w: 2.5 },
        { v: 1.5, w: -1.8 }
      ];

      for (const { v, w } of testCases) {
        const inv = kinematics.inverseKinematics(v, w);
        const fwd = kinematics.forwardKinematics(inv.vLeft, inv.vRight);
        expect(fwd.linearVelocity).toBeCloseTo(v, 6);
        expect(fwd.angularVelocity).toBeCloseTo(w, 6);
      }
    });
  });

  describe('Unit Conversions and Angle Normalization', () => {
    it('converts angular velocity (rad/s) to RPM and back', () => {
      const radPerSec = 10.0;
      const rpm = RobotKinematics.radPerSecToRpm(radPerSec);
      // 10 * 30 / PI = 95.492965855
      expect(rpm).toBeCloseTo(95.493, 3);

      const backToRad = RobotKinematics.rpmToRadPerSec(rpm);
      expect(backToRad).toBeCloseTo(radPerSec, 6);
    });

    it('normalizes angles into [-PI, PI]', () => {
      expect(RobotKinematics.normalizeAngle(0)).toBeCloseTo(0, 6);
      expect(RobotKinematics.normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 6);
      expect(RobotKinematics.normalizeAngle(-Math.PI)).toBeCloseTo(-Math.PI, 6);
      expect(RobotKinematics.normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 6);
      expect(RobotKinematics.normalizeAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI, 6);
      expect(RobotKinematics.normalizeAngle(Math.PI / 2 + 2 * Math.PI)).toBeCloseTo(Math.PI / 2, 6);
    });
  });
});
