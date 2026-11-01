import { describe, it, expect, beforeEach } from 'vitest';
import { NavigationGrid } from '../src/navigation/NavigationGrid.js';
import { AStarPlanner } from '../src/navigation/AStarPlanner.js';
import { ObstacleManager } from '../src/navigation/ObstacleManager.js';
import { AutonomousNavController } from '../src/navigation/AutonomousNavController.js';
import { DifferentialDriveController } from '../src/robot/DifferentialDriveController.js';

describe('NavigationGrid Coordinates & Obstacles', () => {
  let grid;

  beforeEach(() => {
    grid = new NavigationGrid({
      minX: -14.0,
      maxX: 14.0,
      minZ: -7.5,
      maxZ: 7.5,
      resolution: 0.25,
      robotRadius: 0.40
    });
  });

  it('converts world coordinates to grid indices correctly', () => {
    // (-14.0, -7.5) should be cell (0, 0)
    const minGrid = grid.worldToGrid(-14.0, -7.5);
    expect(minGrid.col).toBe(0);
    expect(minGrid.row).toBe(0);

    // (0, 0) should be center cell
    const centerGrid = grid.worldToGrid(0.0, 0.0);
    expect(centerGrid.col).toBe(Math.floor(14.0 / 0.25));
    expect(centerGrid.row).toBe(Math.floor(7.5 / 0.25));

    // Inverse grid to world should match within resolution / 2
    const centerWorld = grid.gridToWorld(centerGrid.col, centerGrid.row);
    expect(Math.abs(centerWorld.x - 0.0)).toBeLessThanOrEqual(grid.resolution / 2);
    expect(Math.abs(centerWorld.z - 0.0)).toBeLessThanOrEqual(grid.resolution / 2);
  });

  it('detects out-of-bounds cells correctly', () => {
    expect(grid.isInside(0, 0)).toBe(true);
    expect(grid.isInside(-1, 0)).toBe(false);
    expect(grid.isInside(0, -1)).toBe(false);
    expect(grid.isInside(grid.cols, 0)).toBe(false);
    expect(grid.isInside(0, grid.rows)).toBe(false);
  });

  it('registers box obstacles and inflation margins', () => {
    // Add obstacle at center
    grid.addStaticBox(0, 0, 1.0, 1.0, true);

    const center = grid.worldToGrid(0, 0);
    expect(grid.isWalkable(center.col, center.row)).toBe(false);

    // Margin cells around it should also be non-walkable due to robotRadius inflation
    const margin = grid.worldToGrid(0.6, 0.0);
    expect(grid.isWalkable(margin.col, margin.row)).toBe(false);

    // Far away cell should be walkable
    const far = grid.worldToGrid(6.0, 4.0);
    expect(grid.isWalkable(far.col, far.row)).toBe(true);
  });
});

describe('AStarPlanner Pathfinding', () => {
  let grid;
  let planner;

  beforeEach(() => {
    grid = new NavigationGrid({
      minX: -14.0,
      maxX: 14.0,
      minZ: -7.5,
      maxZ: 7.5,
      resolution: 0.25,
      robotRadius: 0.35
    });
    planner = new AStarPlanner(grid);
  });

  it('plans a direct path across open court without obstacles', () => {
    const start = { x: -5.0, z: 0.0 };
    const target = { x: 5.0, z: 0.0 };

    const plan = planner.planPath(start, target);
    expect(plan.success).toBe(true);
    expect(plan.waypoints.length).toBeGreaterThanOrEqual(2);

    // First waypoint should be start, last should be target
    expect(plan.waypoints[0].x).toBeCloseTo(start.x, 2);
    expect(plan.waypoints[0].z).toBeCloseTo(start.z, 2);
    expect(plan.waypoints[plan.waypoints.length - 1].x).toBeCloseTo(target.x, 2);
    expect(plan.waypoints[plan.waypoints.length - 1].z).toBeCloseTo(target.z, 2);
  });

  it('handles start and destination within the same cell', () => {
    const pt = { x: 2.1, z: 1.1 };
    const plan = planner.planPath(pt, pt);
    expect(plan.success).toBe(true);
    expect(plan.waypoints.length).toBe(1);
    expect(plan.waypoints[0].x).toBeCloseTo(pt.x, 2);
  });

  it('rejects targets outside court boundaries', () => {
    const start = { x: 0.0, z: 0.0 };
    const outTarget = { x: 25.0, z: 0.0 };

    const plan = planner.planPath(start, outTarget);
    expect(plan.success).toBe(false);
    expect(plan.waypoints.length).toBe(0);
  });

  it('routes around obstacles without penetrating them', () => {
    // Place a 2m wide obstacle right in the direct path between (0, -2) and (0, +2)
    grid.addStaticBox(0.0, 0.0, 2.0, 2.0, true);

    const start = { x: 0.0, z: -3.0 };
    const target = { x: 0.0, z: 3.0 };

    const plan = planner.planPath(start, target);
    expect(plan.success).toBe(true);
    expect(plan.waypoints.length).toBeGreaterThan(2); // Must route around obstacle

    // Verify none of the waypoints are inside the obstacle core
    plan.waypoints.forEach((wp) => {
      const isInsideCore = Math.abs(wp.x) < 1.0 && Math.abs(wp.z) < 1.0;
      expect(isInsideCore).toBe(false);
    });
  });

  it('declares destination unreachable if completely enclosed by obstacles', () => {
    // Create an enclosed box around (5, 0)
    grid.addStaticBox(4.0, 0.0, 0.5, 3.0, false);
    grid.addStaticBox(6.0, 0.0, 0.5, 3.0, false);
    grid.addStaticBox(5.0, 1.5, 2.5, 0.5, false);
    grid.addStaticBox(5.0, -1.5, 2.5, 0.5, false);

    const start = { x: 0.0, z: 0.0 };
    const enclosedTarget = { x: 5.0, z: 0.0 };

    const plan = planner.planPath(start, enclosedTarget);
    expect(plan.success).toBe(false);
    expect(plan.waypoints.length).toBe(0);
  });
});

describe('AutonomousNavController Integration', () => {
  let grid;
  let driveController;
  let navController;

  beforeEach(() => {
    grid = new NavigationGrid({
      minX: -14.0,
      maxX: 14.0,
      minZ: -7.5,
      maxZ: 7.5,
      resolution: 0.25,
      robotRadius: 0.35
    });

    driveController = new DifferentialDriveController({
      wheelRadius: 0.10,
      trackWidth: 0.64,
      maxLinearVelocity: 2.0,
      maxAngularVelocity: 3.0
    });

    navController = new AutonomousNavController({
      driveController,
      grid,
      waypointTolerance: 0.40,
      goalTolerance: 0.15,
      maxSpeed: 1.6,
      decelDistance: 1.5
    });
  });

  it('initializes in IDLE state with clear targets', () => {
    expect(navController.state).toBe('IDLE');
    expect(navController.destination).toBeNull();
    expect(navController.waypoints.length).toBe(0);
  });

  it('starts autonomous navigation and generates waypoints to destination', () => {
    const robotPose = { x: 0.0, z: 0.0, heading: 0.0 };
    const success = navController.navigateTo(6.0, 0.0, robotPose);

    expect(success).toBe(true);
    expect(navController.state).toBe('NAVIGATING');
    expect(navController.destination.x).toBe(6.0);
    expect(navController.destination.z).toBe(0.0);
    expect(navController.waypoints.length).toBeGreaterThanOrEqual(1);
  });

  it('calculates desired heading and steering angle correctly', () => {
    // Robot at (0, 0) facing +X (heading = 0). Target at (0, -4.0).
    // In our coordinate system, forward is (cos(theta), 0, -sin(theta)).
    // Moving towards (0, -4.0) means dx = 0, dz = -4.0
    // desiredHeading = atan2(-dz, dx) = atan2(4.0, 0) = +PI/2 rad (90 deg)
    const robotPose = { x: 0.0, z: 0.0, heading: 0.0 };
    navController.navigateTo(0.0, -4.0, robotPose);

    const tel = navController.getTelemetry(robotPose);
    expect(tel.desiredHeadingDeg).toBeCloseTo(90.0, 1);
  });

  it('advances sequential waypoints as robot moves along path', () => {
    // Create a path with multiple waypoints
    navController.waypoints = [
      { x: 1.0, z: 0.0 },
      { x: 3.0, z: 0.0 },
      { x: 5.0, z: 0.0 }
    ];
    navController.currentWaypointIndex = 0;
    navController.destination = { x: 5.0, z: 0.0 };
    navController.state = 'NAVIGATING';

    // Robot approaches within waypointTolerance (0.4m) of waypoint 0
    const robotNearWP0 = { x: 0.9, z: 0.0, heading: 0.0 };
    navController.update(0.1, robotNearWP0);

    // Waypoint index should advance to 1
    expect(navController.currentWaypointIndex).toBe(1);

    // Robot approaches within waypointTolerance of waypoint 1
    const robotNearWP1 = { x: 2.8, z: 0.0, heading: 0.0 };
    navController.update(0.1, robotNearWP1);

    // Waypoint index should advance to 2
    expect(navController.currentWaypointIndex).toBe(2);
  });

  it('decelerates approaching goal and marks GOAL_REACHED within tolerance', () => {
    navController.waypoints = [{ x: 5.0, z: 0.0 }];
    navController.currentWaypointIndex = 0;
    navController.destination = { x: 5.0, z: 0.0 };
    navController.state = 'NAVIGATING';

    // Robot at 1.0m from goal (within decelDistance of 1.5m)
    const robotDecel = { x: 4.0, z: 0.0, heading: 0.0 };
    navController.update(0.1, robotDecel);

    expect(navController.state).toBe('APPROACHING_GOAL');
    expect(driveController.targetLinearVelocity).toBeLessThan(1.6); // Decelerating

    // Robot arrives within goalTolerance (0.15m)
    const robotAtGoal = { x: 4.95, z: 0.0, heading: 0.0 };
    navController.update(0.1, robotAtGoal);

    expect(navController.state).toBe('GOAL_REACHED');
    expect(driveController.targetLinearVelocity).toBe(0.0);
  });

  it('cancels navigation cleanly when requested', () => {
    const robotPose = { x: 0.0, z: 0.0, heading: 0.0 };
    navController.navigateTo(5.0, 2.0, robotPose);
    expect(navController.state).toBe('NAVIGATING');

    navController.cancel();

    expect(navController.state).toBe('CANCELLED');
    expect(navController.destination).toBeNull();
    expect(navController.waypoints.length).toBe(0);
    expect(driveController.targetLinearVelocity).toBe(0.0);
  });

  it('handles emergency stop immediately during navigation', () => {
    const robotPose = { x: 0.0, z: 0.0, heading: 0.0 };
    navController.navigateTo(5.0, 2.0, robotPose);

    navController.emergencyStop();

    expect(navController.state).toBe('CANCELLED');
    expect(driveController.mode).toBe('E_STOP');
    expect(driveController.currentLinearVelocity).toBe(0.0);
  });

  it('integrates heading PID control to steer robot during navigation', () => {
    const robotPose = { x: 0.0, z: 0.0, heading: 0.0 };
    // Navigate towards a point at 45 degrees
    navController.navigateTo(4.0, -4.0, robotPose);

    navController.update(0.1, robotPose);

    // Differential drive target heading should match desired heading (45°)
    expect(driveController.mode).toBe('HEADING_HOLD');
    expect(driveController.targetHeadingRad).toBeCloseTo(Math.PI / 4, 3);
    expect(driveController.targetLinearVelocity).toBeGreaterThan(0.0);
  });
});
