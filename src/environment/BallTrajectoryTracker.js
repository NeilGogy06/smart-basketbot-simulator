/**
 * BallTrajectoryTracker.js
 * Real-Time 3D Basketball Trajectory Tracking System for SMART-BASKETBOT Simulator.
 *
 * Tracks the basketball's actual center of mass (Rapier rigid-body translation coordinates)
 * as it moves through the 3D simulation environment across all physical movement stages:
 * - Manual movement & drop tests
 * - Ballistic shooting launches
 * - Airborne flight & gravity arcs
 * - Backboard and rim collisions & rebounds
 * - Ground impacts, bouncing, and rolling to rest
 *
 * Renders a high-contrast continuous 3D line via a persistent, reusable Three.js BufferGeometry
 * with zero per-frame memory allocation.
 */

import * as THREE from 'three';

export class BallTrajectoryTracker {
  /**
   * @param {THREE.Scene} scene Three.js scene to attach trajectory line
   * @param {Object} [options]
   * @param {number} [options.maxPoints=3000] Maximum recorded 3D positions in buffer
   * @param {number} [options.minDistance=0.015] Minimum spatial separation (meters) between successive points
   * @param {number} [options.minSpeedThreshold=0.08] Minimum speed (m/s) to be considered in motion
   * @param {number} [options.stationaryTimeThreshold=0.35] Settling duration (s) before transitioning to PRESERVED
   * @param {number} [options.color=0x00f0ff] Trajectory line color (bright cyan default)
   * @param {number} [options.opacity=0.95] Line opacity
   * @param {boolean} [options.visible=true] Initial visibility
   * @param {boolean} [options.autoClearOnNewShot=true] Automatically clear old trajectory when a new shot starts
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this.maxPoints = options.maxPoints ?? 3000;
    this.minDistance = options.minDistance ?? 0.015;
    this.minSpeedThreshold = options.minSpeedThreshold ?? 0.08;
    this.stationaryTimeThreshold = options.stationaryTimeThreshold ?? 0.35;
    this.autoClearOnNewShot = options.autoClearOnNewShot ?? true;

    // Visual attributes
    this.color = options.color ?? 0x00f0ff;
    this.opacity = options.opacity ?? 0.95;
    this.isVisible = options.visible ?? true;

    // Tracking state: 'IDLE' | 'TRACKING' | 'PRESERVED'
    this.state = 'IDLE';

    // Quantitative metrics
    this.pointCount = 0;
    this.totalDistance = 0.0;
    this.peakHeight = 0.0;
    this.stationaryTimer = 0.0;
    this.lastRecordedPos = { x: 0, y: 0, z: 0 };
    this.trackedBallId = null;

    // State transition latches
    this._wasPossessed = false;
    this._lastState = null;

    // 1. Scene Container
    this.group = new THREE.Group();
    this.group.name = 'BasketballTrajectoryTracker';

    // 2. Pre-allocated BufferGeometry with DynamicDrawUsage
    // Avoids creating new geometries or buffers on every frame
    this.positions = new Float32Array(this.maxPoints * 3);
    this.geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setDrawRange(0, 0);

    // 3. High-contrast line material
    this.material = new THREE.LineBasicMaterial({
      color: this.color,
      linewidth: 3,
      transparent: true,
      opacity: this.opacity,
      depthWrite: true
    });

    // 4. Three.js continuous line
    this.line = new THREE.Line(this.geometry, this.material);
    this.line.name = 'BallTrajectoryLine';
    this.line.frustumCulled = false; // Prevent culling when camera rotates away from center
    this.line.visible = this.isVisible;

    this.group.add(this.line);

    if (this.scene) {
      this.scene.add(this.group);
    }
  }

  /**
   * Samples the basketball's center-of-mass world position directly from Rapier rigid body translation.
   * @param {Object} ball
   * @returns {{ x: number, y: number, z: number } | null}
   */
  samplePosition(ball) {
    if (!ball) return null;
    if (ball.rigidBody && typeof ball.rigidBody.translation === 'function') {
      const t = ball.rigidBody.translation();
      return { x: t.x, y: t.y, z: t.z };
    }
    if (typeof ball.getPosition === 'function') {
      const p = ball.getPosition();
      return { x: p.x, y: p.y, z: p.z };
    }
    if (ball.mesh && ball.mesh.position) {
      return { x: ball.mesh.position.x, y: ball.mesh.position.y, z: ball.mesh.position.z };
    }
    return null;
  }

  /**
   * Samples scalar linear speed (m/s) from Rapier rigid body linvel.
   * @param {Object} ball
   * @returns {number}
   */
  sampleSpeed(ball) {
    if (!ball) return 0.0;
    if (ball.rigidBody && typeof ball.rigidBody.linvel === 'function') {
      const v = ball.rigidBody.linvel();
      return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    }
    if (typeof ball.getSpeed === 'function') {
      return ball.getSpeed();
    }
    return 0.0;
  }

  /**
   * Checks if the basketball is currently captured / possessed inside robot cradle.
   * @param {Object} ball
   * @param {Object} [robot]
   * @returns {boolean}
   */
  checkPossession(ball, robot) {
    if (ball.isPossessed || ball.state === 'POSSESSED') return true;
    if (robot && robot.intake && typeof robot.intake.isBallCaptured === 'function') {
      if (robot.intake.isBallCaptured() && (robot.intake.capturedBall === ball || !robot.intake.capturedBall)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks whether the current position has moved beyond minDistance from the last recorded position.
   * @param {{ x: number, y: number, z: number }} pos
   * @returns {boolean}
   */
  shouldRecordPoint(pos) {
    if (this.pointCount === 0) return true;
    const dx = pos.x - this.lastRecordedPos.x;
    const dy = pos.y - this.lastRecordedPos.y;
    const dz = pos.z - this.lastRecordedPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    return distSq >= (this.minDistance * this.minDistance);
  }

  /**
   * Appends a new 3D vertex to the pre-allocated position buffer.
   * @param {{ x: number, y: number, z: number }} pos
   */
  addPoint(pos) {
    if (this.pointCount >= this.maxPoints) {
      return; // Buffer limit reached; stop appending to prevent overflow
    }

    const idx = this.pointCount * 3;
    this.positions[idx] = pos.x;
    this.positions[idx + 1] = pos.y;
    this.positions[idx + 2] = pos.z;

    if (this.pointCount > 0) {
      const prevIdx = (this.pointCount - 1) * 3;
      const dx = pos.x - this.positions[prevIdx];
      const dy = pos.y - this.positions[prevIdx + 1];
      const dz = pos.z - this.positions[prevIdx + 2];
      this.totalDistance += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    if (pos.y > this.peakHeight) {
      this.peakHeight = pos.y;
    }

    this.lastRecordedPos.x = pos.x;
    this.lastRecordedPos.y = pos.y;
    this.lastRecordedPos.z = pos.z;

    this.pointCount++;

    // Dynamically update draw range without allocating new geometry
    this.geometry.setDrawRange(0, this.pointCount);
    this.positionAttribute.needsUpdate = true;
  }

  /**
   * Main update step invoked on every simulation/physics cycle.
   * @param {number} dt Delta time in seconds
   * @param {Object} ball Active basketball instance
   * @param {Object} [robot] Robot instance for intake containment check
   */
  update(dt, ball, robot = null) {
    if (!ball) return;

    // 1. Obtain center of mass coordinates
    const pos = this.samplePosition(ball);
    if (!pos) return;

    const speed = this.sampleSpeed(ball);
    const isPossessed = this.checkPossession(ball, robot);
    const ballState = ball.state || 'AVAILABLE';

    // 2. Handle possession gating
    if (isPossessed) {
      if (this.state === 'TRACKING') {
        this.state = 'PRESERVED';
      }
      this._wasPossessed = true;
      this._lastState = ballState;
      return;
    }

    // 3. Detect shot release / ballistic launch from robot intake
    const justLaunched = (this._wasPossessed && !isPossessed) ||
                         (this._lastState !== 'IN_FLIGHT' && ballState === 'IN_FLIGHT');

    if (justLaunched) {
      if (this.autoClearOnNewShot) {
        this.clear();
      }
      this.state = 'TRACKING';
      this.trackedBallId = ball.id || 'basketball';
      this.stationaryTimer = 0.0;
      this.addPoint(pos);
      this._wasPossessed = false;
      this._lastState = ballState;
      return;
    }

    this._wasPossessed = false;
    this._lastState = ballState;

    // 4. Physical motion evaluation
    const isMoving = speed >= this.minSpeedThreshold;

    if (this.state === 'IDLE') {
      if (isMoving) {
        this.state = 'TRACKING';
        this.trackedBallId = ball.id || 'basketball';
        this.stationaryTimer = 0.0;
        this.addPoint(pos);
      }
    } else if (this.state === 'PRESERVED') {
      // If ball was resting with preserved line and experiences a major impulse (e.g. drop test or new shot)
      if (ballState === 'IN_FLIGHT' || speed > 1.2) {
        if (this.autoClearOnNewShot) {
          this.clear();
        }
        this.state = 'TRACKING';
        this.trackedBallId = ball.id || 'basketball';
        this.stationaryTimer = 0.0;
        this.addPoint(pos);
      } else if (isMoving && this.shouldRecordPoint(pos)) {
        this.state = 'TRACKING';
        this.stationaryTimer = 0.0;
        this.addPoint(pos);
      }
    } else if (this.state === 'TRACKING') {
      if (isMoving) {
        this.stationaryTimer = 0.0;
        if (this.shouldRecordPoint(pos)) {
          this.addPoint(pos);
        }
      } else {
        // Ball speed dropped below threshold; accumulate stationary duration
        this.stationaryTimer += dt;
        if (this.stationaryTimer >= this.stationaryTimeThreshold) {
          if (this.shouldRecordPoint(pos)) {
            this.addPoint(pos);
          }
          this.state = 'PRESERVED';
        }
      }
    }
  }

  /**
   * Clears the recorded trajectory points and resets visual line geometry.
   */
  clear() {
    this.pointCount = 0;
    this.totalDistance = 0.0;
    this.peakHeight = 0.0;
    this.stationaryTimer = 0.0;
    this.state = 'IDLE';
    this.lastRecordedPos.x = 0;
    this.lastRecordedPos.y = 0;
    this.lastRecordedPos.z = 0;

    if (this.geometry) {
      this.geometry.setDrawRange(0, 0);
      if (this.positionAttribute) {
        this.positionAttribute.needsUpdate = true;
      }
    }
  }

  /**
   * Sets visibility of trajectory line without destroying recorded points.
   * @param {boolean} visible
   */
  setVisible(visible) {
    this.isVisible = Boolean(visible);
    if (this.line) {
      this.line.visible = this.isVisible;
    }
  }

  /**
   * Toggles visibility state.
   * @returns {boolean} New visibility state
   */
  toggleVisibility() {
    this.setVisible(!this.isVisible);
    return this.isVisible;
  }

  /**
   * Changes line rendering color.
   * @param {number|string} color Three.js Color argument
   */
  setColor(color) {
    this.color = color;
    if (this.material) {
      this.material.color.set(color);
    }
  }

  /**
   * Returns current telemetry and status readout.
   */
  getStatus() {
    return {
      state: this.state, // 'IDLE' | 'TRACKING' | 'PRESERVED'
      pointCount: this.pointCount,
      maxPoints: this.maxPoints,
      visible: this.isVisible,
      totalDistance: parseFloat(this.totalDistance.toFixed(2)),
      peakHeight: parseFloat(this.peakHeight.toFixed(2)),
      lastPosition: { ...this.lastRecordedPos },
      trackedBallId: this.trackedBallId
    };
  }

  /**
   * Telemetry accessor alias for monitoring subsystems.
   */
  getTelemetry() {
    return this.getStatus();
  }

  /**
   * Frees GPU resources and removes mesh from scene.
   */
  dispose() {
    this.clear();
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    if (this.line && this.line.parent) this.line.parent.remove(this.line);
    if (this.group && this.group.parent) this.group.parent.remove(this.group);
  }
}
