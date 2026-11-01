/**
 * SimulationConfig.js
 * Central configuration parameters for SMART-BASKETBOT simulation environment,
 * physics world, robot geometry, basketball specifications, and rendering setup.
 */

export const SIMULATION_CONFIG = {
  // Rendering & Viewport
  render: {
    clearColor: 0x0a0e14,
    shadows: true,
    antialias: true,
    pixelRatioLimit: 2,
    toneMappingExposure: 1.05
  },

  // Camera settings
  camera: {
    fov: 48,
    near: 0.1,
    far: 200,
    initialPosition: { x: -16.0, y: 12.0, z: 18.0 },
    initialTarget: { x: 2.0, y: 1.0, z: 0.0 }
  },

  // Physics simulation
  physics: {
    gravity: { x: 0.0, y: -9.81, z: 0.0 },
    timeStep: 1 / 60,
    maxSubSteps: 5,
    enableCcd: true
  },

  // Basketball Court dimensions (FIBA standard proportions)
  court: {
    length: 28.0, // X-axis (-14 to +14)
    width: 15.0,  // Z-axis (-7.5 to +7.5)
    apron: 2.0,   // Surrounding out-of-bounds border
    floorThickness: 0.5,
    keyWidth: 4.9,
    keyLength: 5.8,
    centerCircleRadius: 1.8,
    threePointRadius: 6.75, // Radius from basket plumb point
    threePointStraightDist: 0.9, // Distance from sideline for straight corner 3
    freeThrowDistance: 5.8, // From baseline
    basketCenterOverhang: 1.575 // Plumb point of rim center from baseline
  },

  // Basketball Hoop & Backboard specifications
  hoop: {
    rimHeight: 3.05,       // Regulation 10ft = 3.048m
    rimRadius: 0.225,      // Regulation 18in diameter = 0.45m
    rimTubeRadius: 0.012,  // Orange metal ring thickness
    backboardWidth: 1.8,
    backboardHeight: 1.05,
    backboardThickness: 0.04,
    backboardOffsetFromBaseline: 1.2, // 1.2m overhang inside court
    backboardBottomHeight: 2.9,
    targetBoxWidth: 0.59,
    targetBoxHeight: 0.45,
    supportPostDistance: 1.5 // Distance behind baseline for stanchion anchor
  },

  // Basketball specifications (FIBA Size 7 regulation)
  ball: {
    radius: 0.12,          // ~24cm diameter
    mass: 0.62,            // 620 grams
    restitution: 0.82,     // High bounce characteristic of inflated basketball
    friction: 0.65,
    linearDamping: 0.08,
    angularDamping: 0.1,
    initialPosition: { x: 4.5, y: 2.2, z: 1.0 }, // In front of robot, ready for drop/interaction
    alternateDropPosition: { x: 7.0, y: 3.8, z: 0.0 } // Elevated drop test position
  },

  // Robot Model specifications (Autonomous Mobile Basketball Robot)
  robot: {
    chassis: {
      length: 0.76,
      width: 0.62,
      height: 0.18,
      groundClearance: 0.04
    },
    driveWheels: {
      radius: 0.10,
      width: 0.05,
      trackWidth: 0.64 // Distance between left and right wheels
    },
    casterWheel: {
      radius: 0.05,
      offsetZ: 0.0
    },
    intake: {
      width: 0.42,
      depth: 0.26,
      rollerRadius: 0.035
    },
    shooter: {
      barrelLength: 0.38,
      barrelDiameter: 0.26,
      elevationAngleDeg: 52
    },
    mass: 38.0, // kg
    initialPosition: { x: 1.5, y: 0.14, z: 1.0 },
    initialHeadingDeg: 0 // Degrees, 0 pointing towards hoop (+X)
  }
};
