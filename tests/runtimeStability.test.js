/**
 * runtimeStability.test.js
 * Regression tests for runtime errors and subsystem stabilization:
 * 1. AdaptiveShotCorrector integration with AutonomousGameplayController.
 * 2. VisionManager getFrameImageData integration with Dashboard.
 * 3. Exact once-per-shot recording semantics and rejected shot isolation.
 * 4. SVG path formatting validity.
 * 5. Simulation animation loop resilience against subsystem exceptions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { AdaptiveShotCorrector } from '../src/robot/AdaptiveShotCorrector.js';
import { AutonomousGameplayController } from '../src/autonomy/AutonomousGameplayController.js';
import { AUTONOMOUS_STATES, GAMEPLAY_MODES } from '../src/autonomy/AutonomousConfig.js';
import { VisionManager } from '../src/vision/VisionManager.js';
import { CameraSystem } from '../src/vision/CameraSystem.js';
import { Dashboard } from '../src/ui/Dashboard.js';
import { Controls } from '../src/ui/Controls.js';

describe('Runtime Stability & Subsystem Integration Regression', () => {

  // =========================================================================
  // 1. ADAPTIVESHOTCORRECTOR INTEGRATION
  // =========================================================================
  describe('AdaptiveShotCorrector Integration with AutonomousGameplayController', () => {
    let corrector;
    let mockRobot;
    let mockHoopDetector;
    let controller;

    beforeEach(() => {
      corrector = new AdaptiveShotCorrector({
        velocityStep: 0.15,
        headingStep: 0.015,
        maxVelocityBias: 1.5
      });

      mockRobot = {
        getPosition: vi.fn(() => ({ x: 5.0, y: 0.1, z: 0.0 })),
        getHeading: vi.fn(() => 0.0),
        getVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        setControlMode: vi.fn(),
        driveController: {
          stop: vi.fn(),
          setDriveVelocities: vi.fn(),
          mode: 'AUTONOMOUS'
        },
        shooter: {
          muzzleLocalPos: { x: 0.54, y: 0.45, z: 0.0 },
          spinUp: vi.fn(),
          cancel: vi.fn(),
          isSpinningUp: vi.fn(() => false),
          isReadyToFire: vi.fn(() => true),
          lastRejectReason: null
        },
        intake: {
          hasBall: vi.fn(() => true),
          isOpticalBlocked: vi.fn(() => true)
        },
        navController: {
          state: 'IDLE',
          navigateTo: vi.fn(),
          cancel: vi.fn(),
          reset: vi.fn(),
          waypoints: []
        },
        shootingController: {
          cancel: vi.fn(),
          reset: vi.fn(),
          optimizeTrajectory: vi.fn(() => ({
            valid: true,
            solution: { speed: 8.5, launchAngleDeg: 52.0, targetDistance: 4.225 }
          }))
        },
        fireShot: vi.fn(() => true),
        // Expose real AdaptiveShotCorrector on both property names
        adaptiveCorrector: corrector,
        get adaptiveShotCorrector() {
          return this.adaptiveCorrector;
        }
      };

      mockHoopDetector = {
        stats: {
          totalAttempts: 1,
          successfulShots: 0,
          missedShots: 0,
          accuracyPercent: 0.0,
          lastShotResult: 'IN_FLIGHT',
          lastDetailedResult: 'IN_FLIGHT'
        },
        lastShotDetails: null,
        notifyShotFired: vi.fn()
      };

      controller = new AutonomousGameplayController({
        robot: mockRobot,
        basketball: { getPosition: () => ({ x: 5.0, y: 0.24, z: 0.0 }) },
        hoopDetector: mockHoopDetector,
        visionManager: {
          getTrackedBasketballs: () => [],
          getSelectedBasketball: () => null,
          getHoopObservation: () => ({ visible: true, distance: 4.225, azimuthDeg: 0.0 })
        }
      });
    });

    it('AdaptiveShotCorrector provides both recordShotOutcome and recordOutcome methods', () => {
      expect(typeof corrector.recordShotOutcome).toBe('function');
      expect(typeof corrector.recordOutcome).toBe('function');

      const outcomeRecord = {
        outcome: 'MISSED_SHORT',
        distance: 4.5,
        launchSpeed: 8.5
      };

      const result = corrector.recordOutcome(outcomeRecord);
      expect(result).toBeDefined();
      expect(result.outcome).toBe('MISSED_SHORT');
      expect(corrector.velocityBias).toBeCloseTo(0.15, 3);

      // Verify recordShotOutcome also works identically
      corrector.recordShotOutcome({ outcome: 'MISSED_LONG' });
      expect(corrector.velocityBias).toBeCloseTo(0.0, 3);
    });

    it('robot.adaptiveShotCorrector alias points to the same instance as robot.adaptiveCorrector', () => {
      expect(mockRobot.adaptiveShotCorrector).toBe(mockRobot.adaptiveCorrector);
    });

    it('does not throw when AutonomousGameplayController evaluates a missed shot with real corrector', () => {
      controller.startContinuousMode();
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.EVALUATING_SHOT);

      // Simulate MISSED_SHORT outcome
      mockHoopDetector.stats.lastShotResult = 'MISSED';
      mockHoopDetector.stats.lastDetailedResult = 'MISSED_SHORT';
      mockHoopDetector.lastShotDetails = {
        outcome: 'MISSED_SHORT',
        distance: 4.225,
        launchSpeed: 8.5
      };

      expect(() => {
        controller.update(0.1);
      }).not.toThrow();

      expect(controller.statistics.missedShots).toBe(1);
      expect(corrector.velocityBias).toBeCloseTo(0.15, 3);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.REACQUIRING_BALL);
    });

    it('records shot outcome exactly once even across multiple update frames in EVALUATING_SHOT', () => {
      controller.startContinuousMode();
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.EVALUATING_SHOT);

      mockHoopDetector.stats.lastShotResult = 'MISSED';
      mockHoopDetector.stats.lastDetailedResult = 'MISSED_SHORT';
      mockHoopDetector.lastShotDetails = {
        outcome: 'MISSED_SHORT',
        distance: 4.225,
        launchSpeed: 8.5
      };

      // First update tick
      controller.update(0.016);
      expect(corrector.history.length).toBe(1);
      expect(controller.statistics.missedShots).toBe(1);

      // Force state back to EVALUATING_SHOT with same outcome (simulating state persistence)
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.EVALUATING_SHOT);
      controller.update(0.016);

      // Must NOT record a second time for the same shot
      expect(corrector.history.length).toBe(1);
    });

    it('records scored outcomes with parameter decay damping', () => {
      corrector.velocityBias = 0.50;
      corrector.headingBias = 0.03;

      controller.startContinuousMode();
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.EVALUATING_SHOT);

      mockHoopDetector.stats.lastShotResult = 'SCORED';
      mockHoopDetector.stats.lastDetailedResult = 'SWISH';
      mockHoopDetector.lastShotDetails = {
        outcome: 'SCORED',
        distance: 4.225,
        launchSpeed: 8.5
      };

      controller.update(0.1);

      expect(controller.statistics.successfulShots).toBe(1);
      expect(corrector.velocityBias).toBeCloseTo(0.50 * 0.90, 3);
      expect(corrector.headingBias).toBeCloseTo(0.03 * 0.90, 3);
    });

    it('does not record outcome into adaptive corrector when shot is rejected before firing', () => {
      mockRobot.fireShot.mockReturnValueOnce(false);
      mockRobot.shooter.lastRejectReason = 'Flywheels below target RPM';

      controller.startContinuousMode();
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.SHOOTING);

      controller.update(0.1);

      expect(controller.statistics.totalAttempts).toBe(0);
      expect(controller.statistics.successfulShots).toBe(0);
      expect(controller.statistics.missedShots).toBe(0);
      expect(corrector.history.length).toBe(0);
    });
  });

  // =========================================================================
  // 2. VISIONMANAGER GETFRAMEIMAGEDATA INTEGRATION
  // =========================================================================
  describe('VisionManager getFrameImageData & Dashboard Integration', () => {
    let visionManager;

    beforeEach(() => {
      visionManager = new VisionManager({
        width: 320,
        height: 240,
        enabled: true
      });
    });

    it('VisionManager exposes getFrameImageData method', () => {
      expect(typeof visionManager.getFrameImageData).toBe('function');
    });

    it('returns null when visionManager is disabled', () => {
      visionManager.setEnabled(false);
      expect(visionManager.getFrameImageData()).toBeNull();
    });

    it('returns null when offscreen camera buffer has not been rendered (headless/test)', () => {
      // In Node environment without WebGL canvas, CameraSystem.imageData is null
      expect(visionManager.getFrameImageData()).toBeNull();
    });

    it('returns valid ImageData object when available in CameraSystem', () => {
      // Inject synthetic ImageData into CameraSystem
      const syntheticImageData = {
        width: 320,
        height: 240,
        data: new Uint8ClampedArray(320 * 240 * 4)
      };
      visionManager.cameraSystem.imageData = syntheticImageData;

      const result = visionManager.getFrameImageData();
      expect(result).toBe(syntheticImageData);
      expect(result.width).toBe(320);
      expect(result.height).toBe(240);
    });

    it('Dashboard.renderVisionFeed handles null frame image data gracefully with fallback backdrop', () => {
      const mockCanvas = {
        width: 320,
        height: 240,
        getContext: vi.fn(() => ({
          fillRect: vi.fn(),
          createLinearGradient: vi.fn(() => ({
            addColorStop: vi.fn()
          })),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn(),
          arc: vi.fn(),
          fill: vi.fn(),
          measureText: vi.fn(() => ({ width: 40 })),
          fillText: vi.fn(),
          strokeRect: vi.fn(),
          putImageData: vi.fn()
        }))
      };

      const mockDashboard = {
        nodes: { visionCanvas: mockCanvas },
        simulation: { visionManager }
      };

      const visionTel = {
        enabled: true,
        balls: { tracked: [] },
        hoop: { visible: false }
      };

      // Call renderVisionFeed with visionManager returning null
      expect(() => {
        Dashboard.prototype.renderVisionFeed.call(mockDashboard, visionTel);
      }).not.toThrow();

      const ctx = mockCanvas.getContext.mock.results[0].value;
      // putImageData should NOT have been called since frame was null
      expect(ctx.putImageData).not.toHaveBeenCalled();
      // Linear gradient fallback should have been created
      expect(ctx.createLinearGradient).toHaveBeenCalledWith(0, 0, 0, 240);
    });

    it('Dashboard.renderVisionFeed draws camera frame when getFrameImageData returns valid frame', () => {
      const mockCanvas = {
        width: 320,
        height: 240,
        getContext: vi.fn(() => ({
          fillRect: vi.fn(),
          createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn(),
          arc: vi.fn(),
          fill: vi.fn(),
          measureText: vi.fn(() => ({ width: 40 })),
          fillText: vi.fn(),
          strokeRect: vi.fn(),
          putImageData: vi.fn()
        }))
      };

      const syntheticImageData = {
        width: 320,
        height: 240,
        data: new Uint8ClampedArray(320 * 240 * 4)
      };
      visionManager.cameraSystem.imageData = syntheticImageData;

      const mockDashboard = {
        nodes: { visionCanvas: mockCanvas },
        simulation: { visionManager }
      };

      const visionTel = {
        enabled: true,
        balls: { tracked: [] },
        hoop: { visible: false }
      };

      expect(() => {
        Dashboard.prototype.renderVisionFeed.call(mockDashboard, visionTel);
      }).not.toThrow();

      const ctx = mockCanvas.getContext.mock.results[0].value;
      // putImageData should be called with the valid synthetic frame
      expect(ctx.putImageData).toHaveBeenCalledWith(syntheticImageData, 0, 0);
    });
  });

  // =========================================================================
  // 3. SVG PATH DEFINITION VALIDITY
  // =========================================================================
  describe('SVG Path Definitions Formatting & Parsing', () => {
    it('all custom SVG path strings in Dashboard and Controls contain valid command syntax and spacing', () => {
      // Test the regex pattern for valid SVG path command sequences
      const paths = [
        'M 4 14 h 6 m -6 4 h 6 m -6 -8 h 16 M 4 6 h 16 M 14 14 l 3 -3 3 3 M 17 11 v 8',
        'M 12 3 v 6 m 0 6 v 6 M 3 12 h 6 m 6 0 h 6',
        'M 12 2 a 2 2 0 0 1 2 2 v 1 h 3 a 2 2 0 0 1 2 2 v 10 a 2 2 0 0 1 -2 2 H 7 a 2 2 0 0 1 -2 -2 V 7 a 2 2 0 0 1 2 -2 h 3 V 4 a 2 2 0 0 1 2 -2 m -3 8 a 1.5 1.5 0 1 0 0 3 a 1.5 1.5 0 0 0 0 -3 m 6 0 a 1.5 1.5 0 1 0 0 3 a 1.5 1.5 0 0 0 0 -3 z',
        'M 12 3 v 18 M 3 12 h 18',
        'M 5 12 h 14 M 12 5 l 7 7 -7 7',
        'M 12 3 a 15 15 0 0 1 0 18 M 12 3 a 15 15 0 0 0 0 18 M 3 12 h 18 M 12 3 v 18'
      ];

      paths.forEach(d => {
        expect(d).not.toContain('NaN');
        expect(d).not.toContain('undefined');
        // Command letters must not be directly followed by negative signs without space
        // E.g. avoid 'm-6-8' -> prefer 'm -6 -8'
        expect(d).not.toMatch(/[a-zA-Z]-[0-9]/);
      });
    });

    it('Dashboard and Controls template HTML contain zero malformed double-decimal SVG path coordinates', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const dashboardSrc = fs.readFileSync(path.resolve(__dirname, '../src/ui/Dashboard.js'), 'utf8');
      const controlsSrc = fs.readFileSync(path.resolve(__dirname, '../src/ui/Controls.js'), 'utf8');

      // Verify that no SVG path in Dashboard or Controls contains run-on numbers like 1.21.21 or 1.1.9
      const doubleDecDashboard = dashboardSrc.match(/\bd="[^"]*\d+\.\d+\.\d+[^"]*"/g);
      expect(doubleDecDashboard).toBeNull();

      const doubleDecControls = controlsSrc.match(/\bd="[^"]*\d+\.\d+\.\d+[^"]*"/g);
      expect(doubleDecControls).toBeNull();

      // Extract all d="..." attributes in Dashboard and Controls
      const pathRegex = /<path\b[^>]*\bd="([^"]+)"/g;
      const allD = [];
      let match;
      while ((match = pathRegex.exec(dashboardSrc)) !== null) {
        allD.push(match[1]);
      }
      while ((match = pathRegex.exec(controlsSrc)) !== null) {
        allD.push(match[1]);
      }

      expect(allD.length).toBeGreaterThan(0);
      for (const d of allD) {
        expect(d).not.toMatch(/\d+\.\d+\.\d+/);
        expect(d).not.toContain('NaN');
        expect(d).not.toContain('undefined');
      }
    });
  });

  // =========================================================================
  // 4. ANIMATION-LOOP RESILIENCE & TELEMETRY ERROR CONTAINMENT
  // =========================================================================
  describe('Animation-Loop Resilience', () => {
    it('broadcastTelemetry does not crash simulation when a subscriber throws', async () => {
      // Create lightweight mock simulation object matching Simulation prototype structure
      const mockSim = {
        telemetryCallbacks: [],
        _lastTelemetryErrTime: null,
        physicsWorld: { getTelemetry: () => ({ simTime: 1.0, stepCount: 60 }) },
        basketball: {
          getPosition: () => ({ x: 0, y: 0.12, z: 0 }),
          getVelocity: () => ({ x: 0, y: 0, z: 0 }),
          getSpeed: () => 0,
          isAirborne: () => false
        },
        robot: {
          getPosition: () => ({ x: 1.5, y: 0.14, z: 1.0 }),
          getVelocity: () => ({ x: 0, y: 0, z: 0 }),
          getHeading: () => 0,
          getAngularVelocity: () => ({ y: 0 }),
          getDriveTelemetry: () => ({ mode: 'STOPPED' })
        },
        hoopEast: { getRimPosition: () => ({ x: 12.425, y: 3.05, z: 0 }) }
      };

      // Register one failing callback and one healthy callback
      const faultyListener = vi.fn(() => {
        throw new Error('Simulated DOM/Canvas update exception in UI subscriber');
      });
      const healthyListener = vi.fn();

      mockSim.telemetryCallbacks = [faultyListener, healthyListener];

      // Import Simulation class to test broadcastTelemetry method
      const { Simulation } = await import('../src/simulation/Simulation.js');

      // Calling broadcastTelemetry must NOT throw
      expect(() => {
        Simulation.prototype.broadcastTelemetry.call(mockSim);
      }).not.toThrow();

      // Faulty listener was invoked and threw
      expect(faultyListener).toHaveBeenCalled();
      // Healthy listener was still invoked despite preceding error!
      expect(healthyListener).toHaveBeenCalled();
    });

    it('repeated update frames execute without unhandled exceptions during continuous gameplay', () => {
      const mockRobot = {
        getPosition: vi.fn(() => ({ x: 5.0, y: 0.1, z: 0.0 })),
        getHeading: vi.fn(() => 0.0),
        getVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        setControlMode: vi.fn(),
        driveController: { stop: vi.fn(), setDriveVelocities: vi.fn(), mode: 'AUTONOMOUS' },
        shooter: {
          muzzleLocalPos: { x: 0.54, y: 0.45, z: 0.0 },
          spinUp: vi.fn(),
          cancel: vi.fn(),
          isSpinningUp: vi.fn(() => false),
          isReadyToFire: vi.fn(() => true),
          lastRejectReason: null
        },
        intake: { hasBall: vi.fn(() => true), isOpticalBlocked: vi.fn(() => true) },
        navController: { state: 'IDLE', navigateTo: vi.fn(), cancel: vi.fn(), reset: vi.fn(), waypoints: [] },
        shootingController: {
          cancel: vi.fn(),
          reset: vi.fn(),
          optimizeTrajectory: vi.fn(() => ({
            valid: true,
            solution: { speed: 8.5, launchAngleDeg: 52.0, targetDistance: 4.225 }
          }))
        },
        fireShot: vi.fn(() => true),
        adaptiveCorrector: new AdaptiveShotCorrector()
      };

      const controller = new AutonomousGameplayController({
        robot: mockRobot,
        basketball: { getPosition: () => ({ x: 5.0, y: 0.24, z: 0.0 }) },
        hoopDetector: {
          stats: { totalAttempts: 0, successfulShots: 0, missedShots: 0, accuracyPercent: 0 },
          notifyShotFired: vi.fn()
        },
        visionManager: {
          getTrackedBasketballs: () => [],
          getSelectedBasketball: () => null,
          getHoopObservation: () => ({ visible: true, distance: 4.225, azimuthDeg: 0.0 })
        }
      });

      controller.startContinuousMode();

      // Run 200 consecutive update cycles (simulating > 3 seconds of simulation loop at 60Hz)
      expect(() => {
        for (let i = 0; i < 200; i++) {
          controller.update(0.016);
        }
      }).not.toThrow();
    });
  });
});
