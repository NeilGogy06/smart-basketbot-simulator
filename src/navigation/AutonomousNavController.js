/**
 * AutonomousNavController.js
 * Closed-loop autonomous navigation manager coordinating A* path planning,
 * obstacle avoidance, sequential waypoint progression, deceleration profiles,
 * and closed-loop heading PID steering via DifferentialDriveController.
 */

import { NavigationGrid } from './NavigationGrid.js';
import { AStarPlanner } from './AStarPlanner.js';
import { ObstacleManager } from './ObstacleManager.js';
import { RobotKinematics } from '../robot/RobotKinematics.js';

export class AutonomousNavController {
  /**
   * @param {Object} options
   * @param {import('../robot/DifferentialDriveController.js').DifferentialDriveController} options.driveController
   * @param {NavigationGrid} [options.grid]
   * @param {ObstacleManager} [options.obstacleManager]
   * @param {AStarPlanner} [options.planner]
   * @param {number} [options.waypointTolerance=0.40] Distance to advance to next waypoint (meters)
   * @param {number} [options.goalTolerance=0.15] Distance to declare goal reached (meters)
   * @param {number} [options.maxSpeed=1.8] Maximum cruising speed during navigation (m/s)
   * @param {number} [options.decelDistance=1.5] Distance to begin linear deceleration (meters)
   */
  constructor(options) {
    this.driveController = options.driveController;

    this.grid = options.grid ?? new NavigationGrid();
    this.obstacleManager = options.obstacleManager ?? new ObstacleManager(this.grid);
    this.planner = options.planner ?? new AStarPlanner(this.grid);

    this.waypointTolerance = options.waypointTolerance ?? 0.40;
    this.goalTolerance = options.goalTolerance ?? 0.15;
    this.maxSpeed = options.maxSpeed ?? 1.8;
    this.decelDistance = options.decelDistance ?? 1.5;

    // Navigation state: 'IDLE', 'PLANNING', 'NAVIGATING', 'APPROACHING_GOAL', 'GOAL_REACHED', 'BLOCKED', 'CANCELLED'
    this.state = 'IDLE';

    this.destination = null; // { x, z }
    this.waypoints = [];     // Array of { x, z }
    this.currentWaypointIndex = 0;
    this.statusMessage = 'System Ready';

    // Replanning timer
    this.replanTimer = 0;
    this.replanInterval = 0.5; // Re-evaluate path every 0.5s for dynamic obstacles
  }

  /**
   * Computes an A* path to the target coordinates and begins autonomous traversal.
   * @param {number} targetX World X coordinate
   * @param {number} targetZ World Z coordinate
   * @param {{ x: number, z: number, heading: number }} currentRobotPose
   * @returns {boolean} Whether path planning succeeded
   */
  navigateTo(targetX, targetZ, currentRobotPose) {
    if (this.driveController.mode === 'E_STOP') {
      this.statusMessage = 'Cannot navigate while Emergency Stop is engaged';
      return false;
    }

    this.state = 'PLANNING';
    this.destination = { x: targetX, z: targetZ };

    // Clear dynamic obstacle cache before initial path generation
    this.obstacleManager.updateGrid(null);

    const plan = this.planner.planPath(
      { x: currentRobotPose.x, z: currentRobotPose.z },
      this.destination
    );

    if (!plan.success || plan.waypoints.length === 0) {
      this.state = 'BLOCKED';
      this.waypoints = [];
      this.currentWaypointIndex = 0;
      this.statusMessage = plan.message || 'No traversable path to destination';
      this.driveController.stop();
      return false;
    }

    this.waypoints = plan.waypoints;
    // If first waypoint is very close to current robot start, skip to next
    this.currentWaypointIndex = 0;
    if (this.waypoints.length > 1) {
      const d0 = Math.hypot(this.waypoints[0].x - currentRobotPose.x, this.waypoints[0].z - currentRobotPose.z);
      if (d0 < this.waypointTolerance) {
        this.currentWaypointIndex = 1;
      }
    }

    this.state = 'NAVIGATING';
    this.statusMessage = `Navigating to (${targetX.toFixed(1)}, ${targetZ.toFixed(1)}) - ${this.waypoints.length} waypoints`;
    return true;
  }

  /**
   * Cancels active navigation and halts robot motion.
   */
  cancel() {
    this.state = 'CANCELLED';
    this.statusMessage = 'Navigation cancelled by user';
    this.waypoints = [];
    this.currentWaypointIndex = 0;
    this.destination = null;
    this.driveController.stop();
  }

  /**
   * Emergency stop: aborts navigation instantly.
   */
  emergencyStop() {
    this.state = 'CANCELLED';
    this.statusMessage = 'Emergency Stop triggered';
    this.waypoints = [];
    this.currentWaypointIndex = 0;
    this.destination = null;
    this.driveController.emergencyStop();
  }

  /**
   * Clears all navigation goals and resets to IDLE.
   */
  reset() {
    this.state = 'IDLE';
    this.statusMessage = 'System Ready';
    this.destination = null;
    this.waypoints = [];
    this.currentWaypointIndex = 0;
    this.replanTimer = 0;
  }

  /**
   * Main closed-loop guidance update step.
   * Calculates distance, desired heading, deceleration profile, and commands the drive controller.
   * @param {number} dt Time step in seconds
   * @param {{ x: number, z: number, heading: number }} currentRobotPose
   * @param {{ x: number, z: number } | null} [ballPose]
   */
  update(dt, currentRobotPose, ballPose = null) {
    if (this.state !== 'NAVIGATING' && this.state !== 'APPROACHING_GOAL') {
      return;
    }

    if (this.driveController.mode === 'E_STOP') {
      this.emergencyStop();
      return;
    }

    // Dynamic obstacle grid sync & periodic path validation
    this.replanTimer += dt;
    if (this.replanTimer >= this.replanInterval) {
      this.replanTimer = 0;
      // Filter out ball obstacle if ball is near robot or near destination
      let activeBallObs = ballPose;
      if (ballPose) {
        const dBot = Math.hypot(ballPose.x - currentRobotPose.x, ballPose.z - currentRobotPose.z);
        const dDest = this.destination ? Math.hypot(ballPose.x - this.destination.x, ballPose.z - this.destination.z) : 999;
        if (dBot < 0.85 || dDest < 1.0) {
          activeBallObs = null;
        }
      }
      this.obstacleManager.updateGrid(activeBallObs);
      this.validateCurrentPath(currentRobotPose);
    }

    if (this.waypoints.length === 0 || !this.destination) {
      this.state = 'IDLE';
      this.driveController.stop();
      return;
    }

    const currentWP = this.waypoints[this.currentWaypointIndex];
    const isFinalWaypoint = (this.currentWaypointIndex === this.waypoints.length - 1);

    const distToWP = Math.hypot(currentWP.x - currentRobotPose.x, currentWP.z - currentRobotPose.z);
    const distToGoal = Math.hypot(this.destination.x - currentRobotPose.x, this.destination.z - currentRobotPose.z);

    // 1. Goal completion check
    if (distToGoal <= this.goalTolerance) {
      this.state = 'GOAL_REACHED';
      this.statusMessage = `Goal reached within ${(distToGoal * 100).toFixed(0)}cm tolerance`;
      this.driveController.stop();
      return;
    }

    // 2. Intermediate waypoint progression
    if (!isFinalWaypoint && distToWP <= this.waypointTolerance) {
      this.currentWaypointIndex++;
      return;
    }

    // 3. Desired heading calculation
    // Forward vector is (cos(theta), 0, -sin(theta))
    const dx = currentWP.x - currentRobotPose.x;
    const dz = currentWP.z - currentRobotPose.z;
    const desiredHeadingRad = Math.atan2(-dz, dx);

    const headingError = RobotKinematics.normalizeAngle(desiredHeadingRad - currentRobotPose.heading);

    // 4. Linear speed calculation with deceleration ramp
    let targetSpeed = this.maxSpeed;

    if (isFinalWaypoint) {
      this.state = 'APPROACHING_GOAL';
      if (distToGoal < this.decelDistance) {
        // Proportional deceleration down to minimum creeping speed (0.25 m/s)
        const ratio = distToGoal / this.decelDistance;
        targetSpeed = Math.max(0.25, this.maxSpeed * ratio);
      }
    }

    // 5. Heading alignment speed gating:
    // If heading error is large, slow down or turn in place so robot doesn't drift wide
    const absHeadingErr = Math.abs(headingError);
    if (absHeadingErr > Math.PI / 3) { // > 60°
      // Turn nearly in-place
      targetSpeed = 0.05;
    } else if (absHeadingErr > Math.PI / 6) { // > 30°
      targetSpeed *= Math.cos(headingError);
    }

    // 6. Command closed-loop steering and speed through DifferentialDriveController
    this.driveController.setTargetHeading(desiredHeadingRad, targetSpeed);
  }

  /**
   * Verifies that the path ahead is not obstructed by a newly appeared obstacle.
   */
  validateCurrentPath(currentRobotPose) {
    if (this.currentWaypointIndex >= this.waypoints.length) return;

    const currentWP = this.waypoints[this.currentWaypointIndex];
    if (this.obstacleManager.isPointObstructed(currentWP.x, currentWP.z)) {
      // Replan immediately
      this.replan(currentRobotPose);
    }
  }

  /**
   * Triggers an A* replan to the current destination.
   */
  replan(currentRobotPose) {
    if (!this.destination) return false;

    const plan = this.planner.planPath(
      { x: currentRobotPose.x, z: currentRobotPose.z },
      this.destination
    );

    if (plan.success && plan.waypoints.length > 0) {
      this.waypoints = plan.waypoints;
      this.currentWaypointIndex = (this.waypoints.length > 1) ? 1 : 0;
      this.statusMessage = 'Path replanned around obstacle';
      return true;
    } else {
      this.state = 'BLOCKED';
      this.statusMessage = 'Path blocked by obstacle: no alternate route';
      this.driveController.stop();
      return false;
    }
  }

  /**
   * Navigation telemetry snapshot for UI display and unit tests.
   */
  getTelemetry(currentRobotPose = { x: 0, z: 0, heading: 0 }) {
    const distRemaining = this.destination
      ? Math.hypot(this.destination.x - currentRobotPose.x, this.destination.z - currentRobotPose.z)
      : 0;

    const currentWP = this.waypoints[this.currentWaypointIndex] || null;
    const desiredHeadingRad = currentWP
      ? Math.atan2(-(currentWP.z - currentRobotPose.z), currentWP.x - currentRobotPose.x)
      : currentRobotPose.heading;

    return {
      state: this.state,
      statusMessage: this.statusMessage,
      destination: this.destination ? { ...this.destination } : null,
      distanceRemaining: distRemaining,
      waypointCount: this.waypoints.length,
      currentWaypointIndex: this.currentWaypointIndex,
      currentWaypoint: currentWP ? { ...currentWP } : null,
      desiredHeadingDeg: (desiredHeadingRad * 180) / Math.PI,
      headingErrorDeg: (RobotKinematics.normalizeAngle(desiredHeadingRad - currentRobotPose.heading) * 180) / Math.PI
    };
  }
}
