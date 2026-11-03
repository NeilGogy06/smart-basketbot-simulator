# SMART-BASKETBOT Simulator — Final Testing Guide

## 1. Testing Strategy & Philosophy

The SMART-BASKETBOT Simulator testing philosophy is built on three core pillars:
1. **Mathematical & Kinematic Correctness**: Every physical formula (differential kinematics, PID control, A* heuristics, apparent rim aperture, projectile ballistics) is validated against exact analytical solutions.
2. **Headless Execution Reliability**: Tests execute entirely in Node.js via Vitest without requiring a display server, GPU, or headless Chrome browser. WebGL and HTML Canvas APIs are cleanly abstracted or mocked.
3. **End-to-End Subsystem Integration**: High-level integration tests verify cross-system contracts, event pipelines, interlocks, and lifecycle reset behavior under nominal and failure conditions.

---

## 2. Test Suite Architecture & Summary

The test harness consists of **11 test suites** totaling **195 automated tests**, with a 100% pass rate:

```
tests/
├── kinematics.test.js           # 13 tests: Differential kinematics & velocity profiles
├── pid.test.js                  # 14 tests: Heading PID control & anti-windup clamping
├── differentialDrive.test.js    # 10 tests: Rapier3D physics body motion & limits
├── navigation.test.js           # 16 tests: Occupancy grid, A*, string pulling, pursuit
├── shooting.test.js             # 32 tests: Intake roller physics, optical break-beam, firing
├── shootingController.test.js   # 28 tests: Aperture optimization, adaptive corrections
├── vision.test.js               # 13 tests: Camera projection, FOV culling, tracking
├── autonomy.test.js             # 26 tests: 18-state machine, utility targeting, recovery
├── analytics.test.js            # 26 tests: Event aggregation, metrics, CSV/JSON export
├── simulation.test.js           # 9 tests: Scene graph, fixed-timestep physics stepping
└── systemIntegration.test.js    # 8 tests: End-to-end integration, interlocks, reset
```

**Total Tests: 195 | Passing: 195 | Failing: 0 | Duration: ~1.4s**

---

## 3. Running the Test Suites

### 3.1 Standard Test Execution
Run the complete test suite once from the project root:
```bash
# Using npm
npm test

# Using Vitest CLI directly
npx vitest run
```

### 3.2 Watch Mode (Test-Driven Development)
Run tests in interactive watch mode that automatically re-runs affected tests upon file modification:
```bash
npx vitest
```

### 3.3 Running Specific Test Suites
Target individual test files for focused debugging:
```bash
# Run Milestone 9 system integration tests
npx vitest run tests/systemIntegration.test.js

# Run autonomous state machine tests
npx vitest run tests/autonomy.test.js

# Run shooting controller and trajectory optimization tests
npx vitest run tests/shootingController.test.js

# Run perception and vision tracking tests
npx vitest run tests/vision.test.js
```

### 3.4 Test Coverage Analysis
Generate a comprehensive code coverage report:
```bash
npx vitest run --coverage
```

---

## 4. Test Suite Breakdown & Specifications

### 4.1 Kinematics (`tests/kinematics.test.js` - 13 tests)
- Validates forward differential drive velocity equations: $v = \frac{v_R + v_L}{2}$, $\omega = \frac{v_R - v_L}{L}$.
- Validates inverse kinematics wheel speed setpoints from target linear and angular velocities.
- Validates discrete pose integration ($x, z, \theta$).
- Validates angle normalization into $[-\pi, \pi)$ interval.
- Validates actuator limits: saturation of linear velocity, angular velocity, and individual wheel speeds.

### 4.2 PID Motion Control (`tests/pid.test.js` - 14 tests)
- Proportional response verification with zero error setpoint.
- Integral error accumulation and trapezoidal integration accuracy.
- Derivative response to rapid error rate changes.
- Anti-windup integral clamping enforcing $I_{\text{limit}}$.
- Output saturation clamping enforcing maximum control effort $u_{\text{max}}$.
- Reset behavior clearing accumulated integral and derivative states.

### 4.3 Differential Drive Physics Integration (`tests/differentialDrive.test.js` - 10 tests)
- Verifies Rapier3D rigid body creation and mass/inertia parameters.
- Validates torque and force application translating the robot across physics steps.
- Tests heading alignment under closed-loop PID control in Rapier.
- Verifies Emergency Stop behavior: linear and angular velocities zeroed instantly.

### 4.4 Navigation & A* Planning (`tests/navigation.test.js` - 16 tests)
- Occupancy grid world-to-grid and grid-to-world coordinate transformations.
- Static obstacle inflation with robot clearance margin.
- 8-connected A* shortest path search avoiding diagonal corner cutting.
- Euclidean distance heuristic admissibility.
- Line-of-sight raycasting string pulling reducing waypoint count by $>60\%$.
- Pure pursuit lookahead point selection and cubic deceleration profile.

### 4.5 Basketball Intake & Shooting Mechanism (`tests/shooting.test.js` - 32 tests)
- Intake state machine: `IDLE`, `INTAKING`, `POSSESSED`, `REJECTING`, `JAMMED`.
- Optical proximity break-beam sensor activation when ball enters cradle zone.
- Collider sensor transformation: switches basketball to trigger collider during possession.
- Launcher dual-flywheel spin-up inertia curve ($0.8\text{s}$ to `READY`).
- Ballistic launch impulse application to Rapier body with backspin angular momentum.
- Hoop detector scoring geometry, descent angle validation, and score/miss callback resolution.

### 4.6 Closed-Loop Shooting & Trajectory Optimization (`tests/shootingController.test.js` - 28 tests)
- Apparent rim aperture minor axis calculation: $D_{\text{eff}} = D_{\text{rim}} \sin(\theta_{\text{entry}})$.
- Physical clearance margin calculation: $C = D_{\text{eff}} - D_{\text{ball}}$.
- Elevation angle sweep from $45^\circ$ to $65^\circ$ evaluating candidate trajectories.
- Trajectory optimization choosing maximum steepness and clearance score.
- Adaptive shot correction updating velocity and azimuth biases based on miss offset vectors.
- ClosedLoopShootingController state workflow and alignment timeout aborts.

### 4.7 Simulated Vision & Object Detection (`tests/vision.test.js` - 13 tests)
- 6-DOF camera pose tracking matching robot translation and yaw orientation.
- Perspective projection mapping 3D coordinates into camera NDC and screen space.
- Frustum culling rejecting objects behind the optical plane or outside FOV.
- Distance threshold gating rejecting objects beyond maximum detection range ($18.0\text{m}$).
- Raycast line-of-sight occlusion testing against obstacles.
- Multi-ball temporal tracking with Euclidean association and $\alpha$-$\beta$ position filtering.
- Track coasting and loss pruning after $1.5\text{s}$ timeout.

### 4.8 Autonomous Basketball Intelligence (`tests/autonomy.test.js` - 26 tests)
- 18-state deterministic state machine transitions, timers, and history logging.
- Autonomous decision engine multi-factor utility function target scoring.
- Boundary filtering rejecting basketballs outside court playing boundaries.
- Continuous gameplay progression: search $\to$ select $\to$ navigate $\to$ collect $\to$ shoot $\to$ repeat.
- Fixed-target mode completion upon achieving target successful shots.
- Recovery branches handling visual tracking loss, intake timeouts, and path blockages.
- Mode separation: yields manual controls upon autonomy start, cancels controllers on stop.

### 4.9 Analytics & Performance Monitoring (`tests/analytics.test.js` - 26 tests)
- Event subscription to `HoopDetector` shot attempts, makes, and misses.
- Shooting metrics: accuracy %, average launch speed, average flight time.
- Navigation metrics: total distance, average speed, path efficiency %.
- Autonomy metrics: state durations, recovery success rate, session completion tracking.
- Bounded history buffers maintaining constant memory overhead.
- Serialization and integrity verification of JSON and CSV data exports.

### 4.10 Simulation Environment & Physics (`tests/simulation.test.js` - 9 tests)
- Rapier3D physics world initialization with $\mathbf{g} = [0, -9.81, 0]^T$.
- Static collider creation for court floor and backboards.
- Dynamic rigid body creation for basketball and robot chassis.
- Three.js mesh transform synchronization with Rapier bodies during simulation steps.
- Clean destruction and resource disposal.

### 4.11 Milestone 9 System Integration (`tests/systemIntegration.test.js` - 8 tests)
1. **Full Lifecycle Reset**: Verifies that resetting the simulation clears all subsystems simultaneously without leaving ghost states, lingering timers, or sensor collider traps.
2. **Mode Transition Separation**: Ensures switching between Manual teleoperation and Autonomous mode zeroes setpoints, releases keyboard flags, and prevents command conflicts.
3. **Clean Manual Yield**: Verifies that stopping or cancelling an autonomous session cleanly returns control to manual teleoperation and halts all drive motors.
4. **Vision-to-Navigation Pipeline**: Validates that camera perception detects the basketball, the decision engine selects it, and the navigation controller generates an obstacle-free A* path to the approach waypoint.
5. **Intake Possession Interlock**: Enforces the safety interlock preventing the launcher from firing unless a basketball is physically captured in the cradle.
6. **End-to-End Scoring Flow**: Verifies single deduplicated shot recording, score resolution in hoop detector, and accurate metric propagation into analytics JSON/CSV exports.
7. **Emergency Stop Safety**: Verifies that pressing E-Stop immediately aborts the autonomous state machine, cancels path navigation, stops intake rollers, and halts drive actuators.
8. **Fixed-Target Completion**: Validates session progress tracking and clean completion upon achieving the target number of successful baskets.

---

## 5. Headless Environment Mocking & Portability

To achieve deterministic test execution in headless environments (e.g. Node.js CLI, CI/CD runners):
- **DOM Document Check**: Canvas generation (`document.createElement('canvas')`) is guarded with `if (typeof document !== 'undefined')` to safely bypass texture rendering in Node.js while maintaining full physical functionality.
- **WebGL Render Target**: Offscreen render target creation in `CameraSystem.js` detects headless test environments and gracefully disables pixel buffer readbacks without crashing.
- **Host Robot Occlusion Exclusion**: `VisionManager.refreshOccluders()` traverses parent hierarchies to exclude meshes belonging to `SmartBasketBot` and ground court planes from raycast occlusion lists, preventing self-occlusion artifacts during headless testing.
