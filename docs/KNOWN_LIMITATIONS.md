# SMART-BASKETBOT Simulator — Known Limitations & Sim-to-Real Analysis

## 1. Overview

While the SMART-BASKETBOT Simulator provides high-fidelity 3D robotics simulation with accurate kinematic models, rigid-body physics, vision raycasting, and closed-loop control, all computer simulations operate under finite modeling abstractions. This document provides an engineering-level disclosure of known simulation boundaries, edge cases, and sim-to-real transfer gaps to assist researchers and engineers planning physical hardware implementation.

---

## 2. Physics Simulation Limitations

### 2.1 Fast-Bounce Collider Tunneling at High Velocities
- **Description**: In discrete-time physics engines, dynamic objects moving at high velocity relative to collider thickness can pass through solid geometry between simulation time steps (the "bullet through paper" problem).
- **Simulator Implementation**: Rapier3D's Continuous Collision Detection (CCD) is enabled on the basketball dynamic body (`rigidBody.enableCcd(true)`).
- **Limitation**: At extreme launch velocities exceeding $15.0\text{ m/s}$ or under severe browser frame drops ($\le 25\text{ FPS}$), the ball may occasionally penetrate the rim or backboard edges if sub-stepping limits ($5\text{ sub-steps}$) are exceeded.
- **Mitigation**: Launch velocities are clamped to safe ballistic operating ranges ($5.0\text{ m/s} \le v \le 12.0\text{ m/s}$).

### 2.2 Constant Coefficient of Restitution
- **Description**: Real basketball impacts exhibit non-linear viscoelastic restitution where the coefficient of restitution ($e$) decreases at higher impact velocities due to air compression and rubber hysteresis.
- **Simulator Implementation**: Rapier3D uses a fixed restitution coefficient ($e = 0.82$) across all velocities.
- **Limitation**: High-speed backboard bank shots rebound with slightly more kinetic energy in simulation than observed on regulation wooden backboards.

### 2.3 Simplified Aerodynamic Drag & Magnus Effect
- **Description**: Spinning basketballs in free flight experience aerodynamic drag $\mathbf{F}_D = -\frac{1}{2} \rho C_d A \|\mathbf{v}\| \mathbf{v}$ and lateral Magnus force $\mathbf{F}_M = S (\boldsymbol{\omega} \times \mathbf{v})$ created by differential boundary layer separation.
- **Simulator Implementation**: The simulation calculates ballistic parabolic trajectories with empirical linear and quadratic drag approximations. Backspin angular momentum is injected into the Rapier body upon launch to model rim spin-in traction.
- **Limitation**: True aerodynamic lift from high-RPM backspin that flattens flight trajectory is approximated via empirical velocity scaling rather than full Navier-Stokes integration.

---

## 3. Perception & Vision Subsystem Limitations

### 3.1 Geometric Raycasting vs. Deep Learning Vision
- **Description**: Physical basketball robots process noisy RGB camera streams using convolutional neural networks (e.g. YOLOv8, MobileNet) to estimate bounding boxes and 3D pose under variable stadium lighting, shadows, and motion blur.
- **Simulator Implementation**: The simulated camera performs 3D perspective projection, frustum testing, and raycast line-of-sight checks against 3D scene meshes, injecting simulated Gaussian noise and distance-dependent optical confidence metrics.
- **Limitation**: The vision system does not experience optical aberrations, lens distortion, rolling shutter artifacts, ambient lighting changes, or visual occlusion from spectators and moving referees.

### 3.2 Idealized Hoop Center Estimation
- **Description**: Real vision systems detect rim rims as 2D projected ellipses and solve Perspective-n-Point (PnP) pose estimation, which suffers from depth ambiguities at distances $> 10\text{m}$.
- **Simulator Implementation**: The simulator calculates the exact 3D Euclidean coordinates of the hoop rim center $(+12.425, +3.05, 0.0)$, adding small synthetic distance-dependent noise to azimuth and elevation measurements.

---

## 4. Actuator & Chassis Motion Limitations

### 4.1 Kinematic Velocity Control vs. Torque & Motor Saturation
- **Description**: Physical DC brushless motors (e.g. NEO / Falcon 500) operate under voltage limits, winding resistance, thermal derating, back-EMF saturation, and battery voltage sag under peak current draw.
- **Simulator Implementation**: The differential drive controller enforces maximum linear and angular velocities and acceleration ramp limits ($a_{\text{max}} = 3.5\text{ m/s}^2$). Velocity setpoints are mapped directly to Rapier rigid body linear and angular velocities.
- **Limitation**: Transient current spikes, motor thermal degradation, and battery depletion over a 20-minute match are not currently simulated.

### 4.2 Wheel-Floor Traction & Wheel Slip
- **Description**: Real differential drive mobile robots experience longitudinal wheel slip during aggressive acceleration and lateral scrub during high-speed pivot turns.
- **Simulator Implementation**: Wheels are modeled as non-slipping kinematic inputs driving the chassis body with Rapier friction ($0.7$).
- **Limitation**: Odometry drift caused by wheel slippage on dusty hardwood floors is not accumulated into the ground-truth robot pose estimator.

---

## 5. Navigation & Path Planning Limitations

### 5.1 Static Discretized Occupancy Grid
- **Description**: The court is mapped into a $0.25\text{m}$ resolution 2D occupancy grid with static obstacle inflation.
- **Limitation**: Dynamic obstacles (e.g. moving human defenders or referee incursions) are not continuously tracked in a dynamic velocity obstacle (VO) or local costmap layer. The path planner replans at fixed $1.0\text{s}$ intervals if blocked.

---

## 6. Browser & WebGL Environment Limitations

### 6.1 JavaScript Garbage Collection & Frame Drops
- **Description**: Browser JavaScript engines (V8, SpiderMonkey) execute automatic generational garbage collection. Excessive temporary object allocations per frame cause momentary micro-stutter ($10\text{ms}$ to $50\text{ms}$).
- **Mitigation**:
  - Pre-allocated reusable Three.js vectors and quaternions across math loops.
  - Throttled DOM updates in `Dashboard.js` to 4 Hz ($250\text{ms}$).
  - Throttled offscreen camera rendering to 15 Hz.
- **Limitation**: Extreme CPU loads or background browser tab throttling may still introduce frame rate drops below 60 FPS, reducing physics step accuracy if sub-stepping limits are reached.

### 6.2 Headless Node.js Differences
- **Description**: Vitest executes in headless Node.js where `window`, `document`, and `WebGLRenderingContext` do not natively exist.
- **Mitigation**: All DOM and Canvas interactions are safely guarded with `typeof document !== 'undefined'`. Offscreen render targets fall back to headless mathematical projection.

---

## 7. Sim-to-Real Transfer Gap Analysis

For teams deploying the SMART-BASKETBOT architecture to physical hardware (e.g. aluminum chassis, Roborio / Raspberry Pi / Jetson Orin compute), the following bridge components must be introduced:

```
+-------------------------------------------------------------------------------+
|                        SIM-TO-REAL TRANSFER ARCHITECTURE                      |
+-------------------------------------------------------------------------------+
| Simulation Layer (SMART-BASKETBOT) | Physical Hardware Equivalent             |
+------------------------------------+------------------------------------------+
| Rapier3D Ground Truth Pose         | Extended Kalman Filter (Wheel Enc + IMU) |
| Synthetic Pinhole Projection       | RealSense D435 / Oak-D Depth Camera      |
| Raycast Occlusion Gating           | YOLOv8 Object Detection TensorRT Model   |
| Direct Rapier Velocity Impulses    | CAN Bus Motor Controllers (SparkMax)     |
| Instantaneous Ball Capture Trigger | Compliant Silicone Roller + IR Beam Gate |
| Analytic Trajectory Calculator     | Empirical Ballistic Lookup Table         |
+-------------------------------------------------------------------------------+
```
