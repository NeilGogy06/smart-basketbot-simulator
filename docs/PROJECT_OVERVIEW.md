# SMART-BASKETBOT — Project Overview

**Project Title:** Design and Development of an Autonomous Basketball-Playing Robot using AI, Robotics, and Control Systems (SMART-BASKETBOT)  
**Classification:** Academic Engineering Project / Cyber-Physical Robotics Digital Twin  
**Target Environment:** Client-Side Web Browser (WebGL 2.0 & WebAssembly)  
**Repository:** [smart-basketbot-simulator](https://github.com/NeilGogy06/smart-basketbot-simulator)  

---

## 1. Background & Motivation

Autonomous Mobile Robots (AMRs) operating in dynamic, semi-structured sports environments represent a premier testing ground for cyber-physical systems (CPS) engineering. Unlike automated guided vehicles (AGVs) constrained to static warehouse paths, an autonomous basketball robot must operate across complex spatial dimensions. It must execute continuous, real-time loops of spatial perception, multi-target decision ranking, collision-free global navigation, physical ball manipulation, closed-loop heading alignment, and precision ballistic projectile launching.

Developing physical sports robots directly in hardware involves substantial practical friction:
- **High Fabrication & Component Costs:** Custom CNC-machined aluminum chassis, high-RPM brushless DC motors, precision planetary gearboxes, optical wheel encoders, and high-frame-rate depth cameras represent significant financial capital.
- **Kinetic Risk & Mechanical Wear:** High-velocity projectile launchers operating at 3,000+ RPM generate severe kinetic pinch-point hazards. Premature hardware testing without verified trajectory solvers frequently results in structural damage, broken rim mountings, or misfired projectiles.
- **Lengthy Debugging & Tuning Cycles:** Tuning closed-loop PID gains, wheel slip thresholds, and state machine edge-case transitions directly on physical hardware is labor-intensive and constrained by battery discharge cycles.

To address these challenges, **SMART-BASKETBOT** was conceived and engineered as an engineering-grade, high-fidelity **Cyber-Physical Digital Twin**. By leveraging browser-native **Three.js (WebGL)** for hardware-accelerated 3D rendering and **Rapier3D (WebAssembly)** for deterministic rigid-body dynamics, the platform provides a zero-install virtual laboratory where control theory, computer vision geometry, path planning algorithms, and autonomous finite state machines can be rigorously developed, validated, and stress-tested at 60 Hz before hardware realization.

---

## 2. Problem Statement

An autonomous basketball-playing robot must solve five interdependent engineering challenges simultaneously:

1. **Spatial Perception under Viewport Constraints:** The robot must identify and track regulation basketballs distributed across a 28m x 15m court using an on-board camera with a limited horizontal field of view (75°), subject to dynamic heading changes and visual occlusion from backboards and hoop stanchions.
2. **Multi-Target Utility Optimization:** Given multiple candidate basketballs, the robot must evaluate a multi-factor utility function (balancing distance, heading alignment, optical tracking confidence, and boundary safety) to select the optimal target without exhibiting erratic target thrashing.
3. **Obstacle-Free Mobile Navigation:** The robot must autonomously compute and traverse optimal, collision-free paths from its current position to the target ball, respecting court boundaries and avoiding static structures with smooth differential-drive kinematics.
4. **Physical Ball Acquisition & Retention:** Upon reaching the ball, the robot must actuate an intake scoop, confirm ball possession via a simulated optical beam-break sensor, and latch the ball into a cradle constraint without knocking it away.
5. **Dynamic Ballistic Trajectory Calculation & Aiming:** Unlike stationary pitching machines, a mobile robot shoots from dynamic, arbitrary court coordinates. It must solve non-linear ballistic equations with aerodynamic drag to calculate launch velocity and elevation angle, enforce a steep entry angle ($\theta_{\text{entry}} \ge 32^\circ$) for maximum apparent rim clearance, and align its chassis heading within tight tolerances ($\le 2^\circ$).

---

## 3. Engineering Objectives

The SMART-BASKETBOT project established and fulfilled nine specific, testable technical objectives:

| Objective ID | Objective Title | Description & Verifiable Scope |
| :---: | :--- | :--- |
| **OBJ-01** | **3D Court Simulation** | Model a regulation FIBA basketball court ($28\text{m} \times 15\text{m}$) in WebGL with authentic hardwood textures, line markings, backboards ($1.8\text{m} \times 1.05\text{m}$), and dual hoops ($3.05\text{m}$ rim elevation). |
| **OBJ-02** | **Rigid-Body Physics Engine** | Integrate Rapier3D WebAssembly at a fixed 60 Hz timestep ($\Delta t = 0.01667\text{s}$) with a sub-step accumulator to ensure numerical determinism, momentum conservation, and realistic restitution. |
| **OBJ-03** | **Differential Kinematics & PID** | Implement unicycle forward and inverse kinematics for a two-wheel differential drive base with dual independent PID closed-loop velocity controllers and anti-windup clamping. |
| **OBJ-04** | **Synthetic Computer Vision** | Engineer a 75° horizontal FOV synthetic camera frustum performing 3D bounding box projection, line-of-sight raycast occlusion checks, distance/azimuth estimation, and Kalman-filtered tracking. |
| **OBJ-05** | **Occupancy Grid & A\* Navigation** | Discretize the court into a 2D occupancy grid ($0.25\text{m}$ resolution) with $0.42\text{m}$ obstacle inflation, an 8-connected A\* pathfinder, and a raycast string-pulling smoother. |
| **OBJ-06** | **Hoop Collision Geometry** | Model the circular hoop rim ($0.45\text{m}$ inner diameter) using a 16-segment compound rotated rigid-body collider to eliminate artificial axis-aligned box boundary collisions. |
| **OBJ-07** | **Damped Ballistic Solver** | Formulate projectile equations accounting for linear air drag ($\gamma = 0.08\text{ s}^{-1}$), solved via Newton-Raphson numerical root finding with an entry angle constraint $\theta_{\text{entry}} \ge 32^\circ$. |
| **OBJ-08** | **Intake & Shooter Hardware** | Implement an autonomous two-stage ball intake (optical beam-break sensor, counter-rotating rollers) and variable-RPM dual-flywheel launcher with cradle constraint locking. |
| **OBJ-09** | **Hierarchical FSM Supervisor** | Architect a 14-state deterministic finite state machine managing continuous gameplay cycles (Search $\to$ Navigate $\to$ Capture $\to$ Align $\to$ Shoot $\to$ Verify $\to$ Recover) with automated fault handling. |

---

## 4. System Concept & Digital Twin Scope

```
+---------------------------------------------------------------------------------------+
|                               SMART-BASKETBOT SIMULATOR                               |
+---------------------------------------------------------------------------------------+
                                           |
          +--------------------------------+--------------------------------+
          |                                                                 |
          v                                                                 v
+-----------------------------------+             +-------------------------------------+
|        VIRTUAL ENVIRONMENT        |             |        AUTONOMOUS INTELLIGENCE      |
|  - Three.js WebGL 3D Scene Graph  |             |  - 14-State Finite State Machine    |
|  - Rapier3D Wasm Rigid Bodies     |== Sensor ==>|  - Multi-Factor Utility Selection   |
|  - 16-Segment Hoop Rim Colliders  |  Telemetry  |  - 8-Connected A* + String Pulling  |
|  - Synthetic Camera Frustum       |             |  - Newton-Raphson Ballistic Solver  |
|  - Optical Beam-Break Sensor Gate |<== Action ==|  - Closed-Loop Heading PID Alignment|
+-----------------------------------+   Commands  +-------------------------------------+
                                           |
                                           v
                          +----------------------------------+
                          |      HUD & ANALYTICS ENGINE      |
                          |  - Real-Time 60Hz Telemetry Gauges |
                          |  - 2D Court Radar Display        |
                          |  - Dynamic Chart.js Analytics    |
                          |  - JSON / CSV Dataset Export     |
                          +----------------------------------+
```

### Clarification of Cyber-Physical Scope
- **Pure Software Simulation:** SMART-BASKETBOT is executed entirely as client-side software. No physical hardware chassis was manufactured, and no physical camera or motor hardware was wired.
- **Physics-Backed Modeling:** All actuators, sensors, and structural components are modeled through their exact mathematical and rigid-body physical equivalents in Rapier3D.
- **Algorithmic Vision Pipeline:** The perception subsystem uses simulated geometric computer vision (3D perspective projection, frustum culling, raycast occlusion testing, and Kalman filtering) rather than trained deep-learning convolutional neural networks.
- **Rule-Based Autonomous Intelligence:** Decision-making is governed by a deterministic, rule-based hierarchical finite state machine with mathematical utility scoring rather than a reinforcement-learned black-box policy.

---

## 5. Main Features

- **High-Performance Client-Side Execution:** Executes at a stable 60 FPS in modern web browsers without server dependencies or external plugins.
- **Dual Operational Modes:**
  - **Manual Teleoperation:** Full manual driving (`W/A/S/D`), manual intake toggle (`I`), manual launcher spinup and firing (`F`), and emergency stop (`Space`).
  - **Autonomous Gameplay:** Hands-free continuous gameplay (unbroken cycles of ball search, approach, intake, alignment, shooting, and reacquisition) and fixed-target gameplay (e.g. play until $N$ baskets scored).
- **Interactive Cockpit HUD:** Comprehensive heads-up display featuring a 2D court radar, targeting reticle, camera feed overlays, live velocity and motor gauges, FSM state indicators, and four preset camera views (Overview, Robot Orbit, Hoop Focus, Tactical Top-Down).
- **Integrated Performance Analytics:** Real-time Chart.js graphs displaying shooting accuracy trends, launch velocities, flight times, and autonomous state dwell time distributions, with one-click export to CSV and JSON formats.
- **Rigorous Automated Testing:** Accompanied by an automated test harness of **18 test suites and 302 passing unit and integration tests** in Vitest.

---

## 6. Expected Outcomes & Practical Applications

1. **Academic Robotics Education:** Serves as an open-access, zero-install educational testbed for students and researchers to study mobile robot kinematics, PID tuning, A\* graph search, and finite state machines without physical hardware kits.
2. **Competitive Robotics Prototyping:** Provides a deterministic digital twin for student teams participating in international robotics competitions (such as RoboCup Middle Size League or DJI RoboMaster) to prototype motion planning and launcher algorithms.
3. **Athletic Training Technology:** Establishes a computational blueprint for commercial automated basketball rebounding and passing robots, validating ballistic calculations and court navigation envelopes before hardware tooling.
