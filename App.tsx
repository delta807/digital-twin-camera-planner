/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI } from "@google/genai";
import { AlertCircle, Loader2, Sparkles, X } from 'lucide-react';
import loadMujoco from 'mujoco_wasm';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { v4 as uuidv4 } from 'uuid';
import { MujocoSim } from './MujocoSim';
import { WorkspaceDock } from './components/WorkspaceDock';
import { Measurement } from './MeasureTool';
import { RobotSelector } from './components/RobotSelector';
import { SensorView } from './components/SensorView';
import { FeedsDock } from './components/FeedsDock';
import { Toolbar } from './components/Toolbar';
import { UnifiedSidebar } from './components/UnifiedSidebar';
import { ArmInstance, CameraIntrinsics, CameraViewToggles, D435I_DEFAULT_PROFILE_ID, D435I_PRESET, D435I_RGB_640X480_PRESET, D435I_STREAM_PROFILES, DEFAULT_CAMERA_TOGGLES, DEFAULT_WORKCELL_CONFIG, DetectedItem, DetectType, LengthUnit, LogEntry, MujocoModule, WorkcellConfig } from './types';
import type { SelectionInfo } from './SelectionController';
import { SelectionInspector } from './components/SelectionInspector';
import { PlannerToggles } from './WorkspacePlanner';
import { LayoutProfile, listProfiles, saveProfile, deleteProfile } from './profiles';
import { fetchSharedProfiles, publishSharedProfiles } from './cloudProfiles';
import { LayoutProfiles } from './components/LayoutProfiles';
import { OverlayLegend } from './components/OverlayLegend';
import { TweaksPanel } from './components/TweaksPanel';
import { MetricBar } from './components/MetricBar';
import { ModeRail, WorkMode } from './components/ModeRail';
import { CompareView } from './components/CompareView';
import type { CompareSetup } from './components/SceneMap';
import { RadialMenu, RadialItem } from './components/RadialMenu';
import { NavCube } from './components/NavCube';
import { Bot, Box as BoxIcon, Camera as CameraIcon, Copy, EyeOff, Hand, Move as MoveIcon, Package, PanelLeft, PanelRight, Pin, RotateCw, Trash2 } from 'lucide-react';

const GEMINI_API_KEY = process.env.API_KEY || '';

/** Live camera feeds from the Jetson Orin Nano (Tailscale) "SO101 Rig — Live Views" dashboard on
 *  :8088. We superimpose each REAL feed over its matching sim PIP to tune the sim to reality:
 *    • scene = the OVERHEAD D435i (post-mounted, looks down across the worktop) → the D435i PIP.
 *    • wrist = the gripper-mounted HBVCAM (the follower's wrist) → the primary arm's wrist PIP. */
const JETSON_SCENE_STREAM = 'http://100.68.215.10:8088/scene.mjpg';
const JETSON_WRIST_STREAM = 'http://100.68.215.10:8088/wrist.mjpg';

/**
 * Default prompt parts for different detection types.
 */
export const defaultPromptParts = {
  '2D bounding boxes': [
    'Detect',
    'items',
    ', with no more than 25 items. DO NOT detect items that only match the description partially. Output a json list where each entry contains the 2D bounding box in "box_2d" and a text label in "label".',
  ],
  'Points': [
    'Identify ',
    'items',
    ' in the scene and mark them with points. DO NOT mark items that only match the description partially. Follow the JSON format: [{"point": [y, x], "label": "label"}, ...]. The points are in [y, x] format normalized to 0-1000.',
  ],
};

function normalizeGeminiDetections(value: unknown): Array<{ box_2d?: number[]; point?: number[]; label: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { box_2d?: unknown; point?: unknown; label?: unknown };
    const label = typeof record.label === 'string' ? record.label.slice(0, 120) : 'detected';
    const box = Array.isArray(record.box_2d) ? record.box_2d.map(Number) : null;
    const point = Array.isArray(record.point) ? record.point.map(Number) : null;
    const coords = box?.length === 4 ? box : point?.length === 2 ? point : null;
    if (!coords || !coords.every((coord) => Number.isFinite(coord) && coord >= 0 && coord <= 1000)) continue;
    const detection = box?.length === 4 ? { box_2d: coords, label } : { point: coords, label };
    const serialized = JSON.stringify(detection);
    if (seen.has(serialized)) continue;
    seen.add(serialized);
    normalized.push(detection);
    if (normalized.length >= 25) break;
  }

  return normalized;
}

interface LogOverlayProps {
  log: LogEntry;
}

/**
 * LogOverlay
 * Draws Gemini detection results (boxes/points) over an image.
 * Uses a normalized 1000x1000 coordinate system.
 */
export function LogOverlay({ log }: LogOverlayProps) {
  if (!log.result || !Array.isArray(log.result)) return null;
  
  const results = log.result as DetectedItem[];
  const shapes = results.map((item, idx) => {
    if (item.box_2d) {
      const [ymin, xmin, ymax, xmax] = item.box_2d;
      return (
        <rect 
          key={idx} x={xmin} y={ymin} width={xmax - xmin} height={ymax - ymin} 
          fill="rgba(79, 70, 229, 0.15)" stroke="#4f46e5" strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      );
    } else if (item.point) {
      const [y, x] = item.point;
      // Using vector-effect="non-scaling-stroke" ensures the circle border is visible even in small miniatures.
      // cx/cy are normalized 0-1000.
      return <circle key={idx} cx={x} cy={y} r="10" fill="#4f46e5" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />;
    }
    return null;
  });

  return (
    <svg 
      viewBox="0 0 1000 1000" 
      preserveAspectRatio="none" 
      className="absolute inset-0 pointer-events-none w-full h-full z-10"
    >
      {shapes}
    </svg>
  );
}

type Rod = { a: THREE.Vector3; b: THREE.Vector3; label: string; center?: THREE.Vector3 };

/** Clamped projection of a point onto a rod segment → parameter t∈[0,1] + the point on the rod. */
function projectToRod(p: THREE.Vector3, rod: Rod): { t: number; point: THREE.Vector3 } {
  const ab = rod.b.clone().sub(rod.a);
  const len2 = ab.lengthSq();
  const t = len2 > 1e-9 ? THREE.MathUtils.clamp(p.clone().sub(rod.a).dot(ab) / len2, 0, 1) : 0;
  return { t, point: rod.a.clone().addScaledVector(ab, t) };
}

/** Nearest rod to a point (for snap-to-rod). */
function nearestRod(p: THREE.Vector3, rods: Rod[]): { index: number; t: number; point: THREE.Vector3 } | null {
  let best: { index: number; t: number; point: THREE.Vector3 } | null = null, bestD = Infinity;
  rods.forEach((rod, index) => {
    const { t, point } = projectToRod(p, rod);
    const d = point.distanceTo(p);
    if (d < bestD) { bestD = d; best = { index, t, point }; }
  });
  return best;
}

/**
 * Main Application Component
 */
export function App() {
  const containerRef = useRef<HTMLDivElement>(null); 
  const simRef = useRef<MujocoSim | null>(null);      
  const isMounted = useRef(true);                     
  const mujocoModuleRef = useRef<MujocoModule | null>(null);          

  const [isLoading, setIsLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState("Initializing Spatial Engine...");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mujocoReady, setMujocoReady] = useState(false); 
  
  const [isPaused, setIsPaused] = useState(false);
  // Interactive joint posing (leLab-style): click a link of the arm + drag to rotate its joint.
  const [poseMode, setPoseMode] = useState(false);
  const [hoveredJoint, setHoveredJoint] = useState<string | null>(null);
  const togglePoseMode = () => {
    const next = !poseMode;
    setPoseMode(next);
    if (!next) setHoveredJoint(null);
    simRef.current?.setPoseMode(next, setHoveredJoint);
  };
  // Right-click radial menu: switch an object's interaction mode (Jog / Move / Aim) without the
  // dock — reuses the existing mode functions (togglePoseMode, handleDragMode, setArmAim).
  const [radial, setRadial] = useState<{ x: number; y: number; kind: 'arm' | 'camera' | 'station' | 'wristcam' | 'object' | 'prop' | 'create'; gx?: number; gy?: number } | null>(null);
  // Initialize sidebar based on screen width (hidden on mobile by default)
  const [showSidebar, setShowSidebar] = useState(() => window.innerWidth >= 660);
  // Feeds dock (consolidated camera PIPs) open/closed — default open on desktop.
  const [feedsOpen, setFeedsOpen] = useState(() => window.innerWidth >= 660);
  // Layout-profiles panel is a toggle (off the always-on top bar that collided with the title).
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  // Appearance tweaks panel — now opened from the toolbar (was a floating bottom-right gear).
  const [tweaksOpen, setTweaksOpen] = useState(false);
  // Brief "saved" confirmation after recording the current jogged pose as the default rest pose.
  const [restSaved, setRestSaved] = useState(false);
  const handleSaveRestPose = () => {
    if (simRef.current?.saveRestPose().length) { setRestSaved(true); setTimeout(() => setRestSaved(false), 1800); }
  };
  // Lab-instrument shell: work mode (Edit vs Compare A/B) + dock visibility, driven by the mode rail.
  const [mode, setMode] = useState<WorkMode>('edit');
  // Compare mode holds two captured WORKSTATION SETUPS (full layouts), shown side-by-side.
  const [compareA, setCompareA] = useState<CompareSetup | null>(null);
  const [compareB, setCompareB] = useState<CompareSetup | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try { return localStorage.getItem('theme') === 'dark'; } catch { return false; }
  });
  // Apply the persisted theme to the 3D scene once the sim is ready.
  useEffect(() => { if (!isLoading) simRef.current?.renderSys.setDarkMode(isDarkMode); }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  
  const [erLoading, setErLoading] = useState(false);
  const [logs, setLogs] = useState<Array<LogEntry>>([]);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [flash, setFlash] = useState(false); 
  const detectedTargets = useRef<Array<{pos: THREE.Vector3, markerId: number}>>([]); 
  const [detectedCount, setDetectedCount] = useState(0); 
  
  const [isPickingUp, setIsPickingUp] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const [gizmoStats, setGizmoStats] = useState<{pos: string, rot: string} | null>(null);

  // --- Coordinate readout (Phase 3) ---
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>('mm');
  const [axesVisible, setAxesVisible] = useState(true);
  const [cameraPos, setCameraPos] = useState<{ x: number; y: number; z: number } | null>(null);
  const [measureActive, setMeasureActive] = useState(false);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  // --- Sensor-camera planner state ---
  const [cameraToggles, setCameraToggles] = useState<CameraViewToggles>({ ...DEFAULT_CAMERA_TOGGLES });
  // Initialise from the DEFAULT stream profile (now RGB 640×480 4:3, matching the real rig).
  const defaultProfileIntrinsics = D435I_STREAM_PROFILES.find((p) => p.id === D435I_DEFAULT_PROFILE_ID)?.intrinsics ?? D435I_RGB_640X480_PRESET;
  const [intrinsics, setIntrinsics] = useState<CameraIntrinsics>({ ...defaultProfileIntrinsics });
  const [selectedProfileId, setSelectedProfileId] = useState(D435I_DEFAULT_PROFILE_ID);
  const [dragMode, setDragMode] = useState<'translate' | 'rotate'>('translate');
  const sensorViewRef = useRef<HTMLDivElement>(null);
  // Superimpose the live real feeds (Jetson MJPEG) over their matching sim PIPs to tune the sim
  // until they match. Both app + Jetson are http (no mixed-content); <img> needs no CORS.
  // Independent enable per feed (overhead scene + primary wrist); shared opacity + blend mode.
  const [sceneOverlayOn, setSceneOverlayOn] = useState(false);
  const [wristOverlayOn, setWristOverlayOn] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [overlayBlend, setOverlayBlend] = useState<'normal' | 'difference'>('normal');
  // Real-camera stream URLs are editable + persisted (the baked-in defaults are a Tailscale Jetson,
  // unreachable off that tailnet / blocked as mixed-content on https hosts — so let users repoint them).
  const [sceneStreamUrl, setSceneStreamUrl] = useState(() => { try { return localStorage.getItem('so101-scene-stream') || JETSON_SCENE_STREAM; } catch { return JETSON_SCENE_STREAM; } });
  const [wristStreamUrl, setWristStreamUrl] = useState(() => { try { return localStorage.getItem('so101-wrist-stream') || JETSON_WRIST_STREAM; } catch { return JETSON_WRIST_STREAM; } });
  const updateSceneStream = (v: string) => { setSceneStreamUrl(v); try { localStorage.setItem('so101-scene-stream', v); } catch { /* ignore */ } };
  const updateWristStream = (v: string) => { setWristStreamUrl(v); try { localStorage.setItem('so101-wrist-stream', v); } catch { /* ignore */ } };
  // Simulated D435i DEPTH stream toggle for the overhead PIP (depth colormap, 0.3–3 m range).
  const [depthView, setDepthView] = useState(false);
  useEffect(() => { simRef.current?.renderSys.cameraRig.setDepthMode(depthView); }, [depthView, isLoading]);

  // Saved layout profiles: the positional config (worktop + arm bases + overhead camera) the user
  // mapped to the real rig, persisted so they can save/switch named bench layouts.
  const [profiles, setProfiles] = useState<LayoutProfile[]>(() => listProfiles());
  const handleSaveProfile = (name: string) => {
    const rig = simRef.current?.renderSys.cameraRig;
    setProfiles(saveProfile({
      name, savedAt: Date.now(),
      workcell: workcellConfigRef.current,
      arms: armInstancesRef.current.map((a) => ({ ...a })),
      camera: rig ? rig.getPose() : null,
    }));
  };
  const handleDeleteProfile = (name: string) => setProfiles(deleteProfile(name));
  // Team sync (Netlify Blobs): on load, pull any shared layouts + merge (local/built-in win by name).
  // No-op under plain `vite dev` (the function isn't there) — sync activates once deployed.
  const mergeShared = (shared: LayoutProfile[]) => setProfiles((prev) => { const names = new Set(prev.map((p) => p.name)); return [...prev, ...shared.filter((p) => !names.has(p.name))]; });
  useEffect(() => { fetchSharedProfiles().then((sp) => { if (sp.length) mergeShared(sp); }); }, []);
  const handlePublishProfiles = async (): Promise<boolean> => {
    const ok = await publishSharedProfiles(profiles.filter((p) => !p.builtin && !p.shared));
    if (ok) { const sp = await fetchSharedProfiles(); setProfiles(listProfiles()); mergeShared(sp); }
    return ok;
  };
  const handleLoadProfile = (p: LayoutProfile) => {
    const sim = simRef.current;
    // Worktop (live rebuild).
    setWorkcellConfig(p.workcell);
    sim?.setWorkcell(p.workcell);
    // Arms: restore all instances + relocate the primary base, then re-place ghosts.
    setArmInstances(p.arms.map((a) => ({ ...a })));
    sim?.setArmInstances(p.arms);
    const primary = p.arms.find((a) => a.primary);
    if (primary && sim) sim.relocateBase(primary.x, primary.y, primary.yaw);
    setSelectedArmId(primary?.id ?? p.arms[0]?.id ?? 'so101-1');
    // Overhead camera pose (position + aim/roll + FOV).
    if (p.camera) simRef.current?.renderSys.cameraRig.applyPose(p.camera);
  };
  const cameraTogglesRef = useRef(cameraToggles); // latest toggles for imperative callbacks
  cameraTogglesRef.current = cameraToggles;

  const rig = () => simRef.current?.renderSys.cameraRig ?? null;
  const simGroup = () => simRef.current?.renderSys.simGroup ?? null;

  // --- Reachability planner state (SO-101 only) ---
  const [sceneIsFranka, setSceneIsFranka] = useState(false);
  const [plannerToggles, setPlannerToggles] = useState<PlannerToggles>({ outline: true, reach: false, basePlacement: false, tasks: false, baseDrag: false });
  const [reachResolution, setReachResolution] = useState(9);
  const [baseResult, setBaseResult] = useState<{ covered: number; total: number } | null>(null);
  const [computingReach, setComputingReach] = useState(false);
  const [workcellConfig, setWorkcellConfig] = useState<WorkcellConfig>({ ...DEFAULT_WORKCELL_CONFIG });
  const workcellConfigRef = useRef(workcellConfig);
  workcellConfigRef.current = workcellConfig;
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [taskBodies, setTaskBodies] = useState<{ bodyId: number; name: string }[]>([]);
  const [armInstances, setArmInstances] = useState<ArmInstance[]>([
    { id: 'so101-1', label: 'SO101 1', x: 0, y: 0, yaw: 0, primary: true },
  ]);
  const [selectedArmId, setSelectedArmId] = useState('so101-1');
  const nextArmNumberRef = useRef(2);
  const armInstancesRef = useRef(armInstances);
  armInstancesRef.current = armInstances;
  const primaryRelocateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const plannerTogglesRef = useRef(plannerToggles);
  plannerTogglesRef.current = plannerToggles;
  const reachResolutionRef = useRef(reachResolution);
  reachResolutionRef.current = reachResolution;
  const planner = () => simRef.current?.planner ?? null;

  // Deriving activeLog directly from the latest logs state ensures UI reactivity
  const activeLog = expandedLogId ? logs.find(l => l.id === expandedLogId) : null;

  useEffect(() => {
    isMounted.current = true;
    loadMujoco({
      locateFile: (path: string) => path.endsWith('.wasm') ? "https://unpkg.com/mujoco-js@0.0.7/dist/mujoco_wasm.wasm" : path,
      printErr: (text: string) => { 
        if (text.includes("Aborted") && isMounted.current) {
            setLoadError(prev => prev ? prev : "Simulation crashed. Reload page."); 
        }
      }
    }).then((inst: unknown) => { 
      if (isMounted.current) { 
        mujocoModuleRef.current = inst as MujocoModule; 
        setMujocoReady(true); 
      } 
    }).catch((err: Error) => { 
      if (isMounted.current) { 
        setLoadError(err.message || "Failed to init spatial simulation"); 
        setIsLoading(false); 
      } 
    });
    return () => { isMounted.current = false; simRef.current?.dispose(); };
  }, []);

  useEffect(() => {
      if (!mujocoReady || !containerRef.current || !mujocoModuleRef.current) return;
      setIsLoading(true); 
      setLoadError(null); 
      setIsPaused(false);
      
      simRef.current?.dispose();
      
      try {
          simRef.current = new MujocoSim(containerRef.current, mujocoModuleRef.current);
          simRef.current.renderSys.setDarkMode(isDarkMode);
          // Re-apply planner UI state whenever the SO-101 scene (re)loads (e.g. base relocation).
          simRef.current.onSceneReload = applyPlannerState;

          // Default to the SO-101 workspace twin (Franka demo stays available via "franka_panda_stack").
          simRef.current.init("so_arm100", "scene.xml", (msg) => {
             if (isMounted.current) setLoadingStatus(msg);
          }, { x: armInstances[0].x, y: armInstances[0].y, yaw: armInstances[0].yaw }, workcellConfig)
             .then(() => {
                 if (isMounted.current) {
                     setSceneIsFranka(simRef.current?.isFranka ?? false);
                     simRef.current?.setArmInstances(armInstances);
                     setIsLoading(false);
                 }
             })
             .catch(err => {
                 if (isMounted.current) {
                     setLoadError(err.message);
                     setIsLoading(false);
                 }
             });

      } catch (err: unknown) {
          if (isMounted.current) { setLoadError((err as Error).message); setIsLoading(false); }
      }
  }, [mujocoReady]);

  // Effect to move camera when sidebar toggles. The SO-101 + 0.83m worktop is ~3x smaller
  // than the Franka demo, so it needs a much closer framing.
  useEffect(() => {
    if (isLoading || !simRef.current || erLoading) return;
    const franka = simRef.current.isFranka;

    const standardPos = franka ? new THREE.Vector3(2.2, -1.2, 2.2) : new THREE.Vector3(0.85, -0.85, 0.7);
    const standardTarget = franka ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(0, 0, 0.08);

    const offsetPos = franka ? new THREE.Vector3(2.35, -0.7, 2.2) : new THREE.Vector3(0.95, -0.55, 0.7);
    const offsetTarget = franka ? new THREE.Vector3(0.15, 0.4, 0.05) : new THREE.Vector3(0.08, 0.12, 0.06);

    // Only offset camera on desktop/tablet (width >= 660px). On mobile, keep centered.
    if (showSidebar && window.innerWidth >= 660) {
      simRef.current.renderSys.moveCameraTo(offsetPos, offsetTarget, 1000);
    } else {
      simRef.current.renderSys.moveCameraTo(standardPos, standardTarget, 1000);
    }
  }, [showSidebar, isLoading, erLoading]);

  useEffect(() => {
      if (isLoading) return;
      let animId: number;
      let lastCamKey = '';
      const uiLoop = () => {
          if (simRef.current) {
              const s = simRef.current.getGizmoStats();
              setGizmoStats(s ? {
                  pos: `X: ${s.pos.x.toFixed(2)}, Y: ${s.pos.y.toFixed(2)}, Z: ${s.pos.z.toFixed(2)}`,
                  rot: `X: ${s.rot.x.toFixed(2)}, Y: ${s.rot.y.toFixed(2)}, Z: ${s.rot.z.toFixed(2)}`
              } : null);
              // Live sensor-camera world position (origin = table center). Only re-render the
              // HUD when it actually changes (rounded to mm) to avoid churn.
              const p = simRef.current.renderSys.cameraRig.sensorCamera.position;
              const key = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
              if (key !== lastCamKey) {
                  lastCamKey = key;
                  setCameraPos({ x: p.x, y: p.y, z: p.z });
              }
          }
          animId = requestAnimationFrame(uiLoop);
      };
      uiLoop();
      return () => cancelAnimationFrame(animId);
  }, [isLoading]);

  // Push initial camera-rig config once the sim is loaded, and wire the drag-end hook
  // so coverage recomputes whenever the user finishes moving/aiming the camera.
  useEffect(() => {
    const r = rig();
    if (isLoading || !r) return;
    r.setToggles(cameraToggles);
    r.setIntrinsics(intrinsics);
    r.setDragMode(dragMode);
    r.onDragEnd = () => {
      if (cameraTogglesRef.current.coverage) {
        const sg = simGroup();
        if (sg) r.computeCoverage(sg);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Attach the PIP renderer into the SensorView panel while it is shown.
  useEffect(() => {
    const r = rig();
    if (isLoading || !r) return;
    if (cameraToggles.sensorPip && showSidebar && sensorViewRef.current) {
      r.attachPip(sensorViewRef.current);
    }
    return () => { rig()?.detachPip(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, cameraToggles.sensorPip, showSidebar]);

  // Wrist cameras: one gripper-mounted feed PER arm (primary = live; ghost arms = static mount
  // preview). The master toggle enables them all; each arm's PIP attaches via a stable callback ref.
  const [wristView, setWristView] = useState(true);
  useEffect(() => {
    if (!isLoading && simRef.current) simRef.current.renderSys.wristEnabled = wristView;
  }, [isLoading, wristView]);
  // Dispose feeds for arms that were removed (created lazily on attach).
  useEffect(() => {
    if (!isLoading) simRef.current?.renderSys.syncWristArms(armInstances.map((a) => a.id));
  }, [armInstances, isLoading]);
  // Stable per-arm ref callbacks — created once per armId so React doesn't detach/reattach
  // (and tear down the canvas) on every render.
  const wristRefCbs = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const wristRefCb = (armId: string) => {
    let cb = wristRefCbs.current.get(armId);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        const rs = simRef.current?.renderSys;
        if (!rs) return;
        if (el) rs.ensureWristCamera(armId).attachPip(el);
        else rs.getWristCamera(armId)?.detachPip();
      };
      wristRefCbs.current.set(armId, cb);
    }
    return cb;
  };

  // Station overhead feeds (#6): one fixed downward camera per satellite workstation. Same stable-
  // callback-ref + master-toggle pattern as the wrist cams.
  const [stationView, setStationView] = useState(false);
  useEffect(() => {
    if (!isLoading && simRef.current) simRef.current.renderSys.stationEnabled = stationView;
  }, [isLoading, stationView]);
  useEffect(() => {
    if (!isLoading) simRef.current?.renderSys.syncStationCameras(workcellConfig.stations ?? []);
  }, [workcellConfig.stations, isLoading]);
  const stationRefCbs = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const stationRefCb = (id: string) => {
    let cb = stationRefCbs.current.get(id);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        const rs = simRef.current?.renderSys;
        if (!rs) return;
        if (el) rs.ensureStationCamera(id).attachPip(el);
        else rs.getStationCamera(id)?.detachPip();
      };
      stationRefCbs.current.set(id, cb);
    }
    return cb;
  };

  // Extra placeable overhead D435i cameras (#3) — same Map/toggle/callback-ref pattern again.
  const [extraCamView, setExtraCamView] = useState(false);
  useEffect(() => {
    if (!isLoading && simRef.current) simRef.current.renderSys.extraCamerasEnabled = extraCamView;
  }, [isLoading, extraCamView]);
  useEffect(() => {
    if (!isLoading) simRef.current?.renderSys.syncExtraCameras(workcellConfig.extraCameras ?? []);
  }, [workcellConfig.extraCameras, isLoading]);
  const extraCamRefCbs = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const extraCamRefCb = (id: string) => {
    let cb = extraCamRefCbs.current.get(id);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        const rs = simRef.current?.renderSys;
        if (!rs) return;
        if (el) rs.ensureExtraCamera(id).attachPip(el);
        else rs.getExtraCamera(id)?.detachPip();
      };
      extraCamRefCbs.current.set(id, cb);
    }
    return cb;
  };
  const nextExtraCamRef = useRef(2);
  const handleAddExtraCamera = () => {
    const wc = workcellConfigRef.current;
    const n = nextExtraCamRef.current++;
    handleWorkcellChange({ ...wc, extraCameras: [...(wc.extraCameras ?? []), { id: `cam-${n}`, x: 0, y: 0, z: 0.85, rotX: 0, rotY: 0, rotZ: 0 }] });
    setExtraCamView(true);
  };
  const handleRemoveExtraCamera = (id: string) => {
    const wc = workcellConfigRef.current;
    handleWorkcellChange({ ...wc, extraCameras: (wc.extraCameras ?? []).filter((c) => c.id !== id) });
  };
  // Move/aim an extra camera (from its viewport gizmo or the inspector) — live, no reload.
  const handleExtraCameraChange = (id: string, patch: Partial<{ x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number }>) => {
    const wc = workcellConfigRef.current;
    handleWorkcellChange({ ...wc, extraCameras: (wc.extraCameras ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };

  // Wrist-cam mount (gripper-local offset + tilt). A saved tuning (localStorage) overrides the
  // factory default, so you adjust it once and it sticks across reloads.
  // Baked from the tuned in-app mount (#8) so a fresh clone / hosted visitor gets the wrist cam at
  // the right spot on the wrist_roll gripper without re-adjusting. localStorage still overrides.
  const WRIST_FACTORY = { posX: -0.001, posY: 0.064, posZ: 0.05, fov: 58, tilt: 340 };
  const [wristMount, setWristMount] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('so101-wrist-mount') || 'null'); if (s && typeof s.posY === 'number') return { ...WRIST_FACTORY, ...s }; } catch { /* factory */ }
    return WRIST_FACTORY;
  });
  useEffect(() => {
    simRef.current?.renderSys.setWristMount(wristMount);
  }, [wristMount, isLoading, wristView]);
  const handleSaveWristMount = () => {
    localStorage.setItem('so101-wrist-mount', JSON.stringify(wristMount));
    // Also copy a paste-ready code line so the tuning can be baked into App.tsx (WRIST_FACTORY) and
    // shipped to everyone who clones the repo / opens the hosted site — see "permanent save" (#5).
    const m = wristMount;
    const snip = `const WRIST_FACTORY = { posX: ${+m.posX.toFixed(3)}, posY: ${+m.posY.toFixed(3)}, posZ: ${+m.posZ.toFixed(3)}, fov: ${m.fov}, tilt: ${m.tilt} };`;
    navigator.clipboard?.writeText(snip).catch(() => { /* clipboard blocked — localStorage save still applied */ });
  };

  const handleCameraToggle = (key: keyof CameraViewToggles, value: boolean) => {
    setCameraToggles(prev => ({ ...prev, [key]: value }));
    const r = rig();
    if (!r) return;
    r.setToggles({ [key]: value });
    if (key === 'coverage' && value) {
      const sg = simGroup();
      if (sg) r.computeCoverage(sg);
    }
  };

  const handleIntrinsic = (key: keyof CameraIntrinsics, value: number) => {
    setSelectedProfileId('custom');
    setIntrinsics(prev => ({ ...prev, [key]: value }));
    const r = rig();
    if (!r) return;
    r.setIntrinsics({ [key]: value });
    if (cameraTogglesRef.current.coverage) {
      const sg = simGroup();
      if (sg) r.computeCoverage(sg);
    }
  };

  const handleResetIntrinsics = () => {
    setIntrinsics({ ...D435I_PRESET });
    setSelectedProfileId(D435I_DEFAULT_PROFILE_ID);
    const r = rig();
    if (!r) return;
    r.resetIntrinsics();
    if (cameraTogglesRef.current.coverage) {
      const sg = simGroup();
      if (sg) r.computeCoverage(sg);
    }
  };

  const handleStreamProfile = (profileId: string) => {
    const profile = D435I_STREAM_PROFILES.find((p) => p.id === profileId);
    if (!profile) return;
    setSelectedProfileId(profile.id);
    setIntrinsics({ ...profile.intrinsics });
    const r = rig();
    if (!r) return;
    r.setIntrinsics(profile.intrinsics);
    if (cameraTogglesRef.current.coverage) {
      const sg = simGroup();
      if (sg) r.computeCoverage(sg);
    }
  };

  const handleDragMode = (mode: 'translate' | 'rotate') => {
    setDragMode(mode);
    rig()?.setDragMode(mode);
  };

  // Open the radial for whatever is under (clientX,clientY): an item → mode/delete/duplicate;
  // empty space → "create here". Shared by right-click AND double-click.
  const openRadialAt = (clientX: number, clientY: number) => {
    if (sceneIsFranka || isLoading) return;
    const sel = simRef.current?.renderSys.selection;
    const k = sel?.selectAt(clientX, clientY);
    if (k === 'arm' || k === 'camera' || k === 'station' || k === 'wristcam' || k === 'object' || k === 'prop') {
      setRadial({ x: clientX, y: clientY, kind: k });
    } else {
      const g = sel?.groundPointAt(clientX, clientY) ?? { x: 0, y: 0 };
      setRadial({ x: clientX, y: clientY, kind: 'create', gx: g.x, gy: g.y });
    }
  };
  const handleContextMenu = (e: React.MouseEvent) => { if (sceneIsFranka || isLoading) return; e.preventDefault(); openRadialAt(e.clientX, e.clientY); };
  // Double-click an object → same radial (a second, mouse-friendly way to reach it besides
  // right-click). Works in jog mode too (a dbl-click isn't a joint drag); only measure mode — which
  // consumes individual clicks to place points — is excluded.
  const handleDoubleClick = (e: React.MouseEvent) => { if (sceneIsFranka || isLoading || measureActive) return; openRadialAt(e.clientX, e.clientY); };
  // Build the radial items for the object under the cursor — reusing the existing add/remove/clone
  // handlers (DRY): Move / Aim live on the gizmo; Duplicate / Delete reuse the dock handlers.
  const radialItems = (kind: NonNullable<typeof radial>['kind']): RadialItem[] => {
    if (kind === 'create') return [
      { id: 'new-station', label: 'Workcell', icon: BoxIcon },
      { id: 'new-camera', label: 'D435i cam', icon: CameraIcon },
      { id: 'new-arm', label: 'SO-101', icon: Bot },
      { id: 'new-post', label: 'Mount post', icon: Pin },
      { id: 'new-prop', label: 'Object', icon: Package },
    ];
    if (kind === 'object') return [
      { id: 'move', label: 'Move', icon: MoveIcon },
      { id: 'aim', label: 'Aim', icon: RotateCw },
      { id: 'hide', label: 'Hide', icon: EyeOff },
    ];
    if (kind === 'prop') return [
      { id: 'move', label: 'Move', icon: MoveIcon },
      { id: 'aim', label: 'Aim', icon: RotateCw },
      { id: 'duplicate', label: 'Duplicate', icon: Copy },
      { id: 'delete', label: 'Delete', icon: Trash2 },
    ];
    if (kind === 'wristcam') return [
      { id: 'move', label: 'Move', icon: MoveIcon },
      { id: 'aim', label: 'Aim', icon: RotateCw },
    ];
    if (kind === 'arm') {
      const isPrimary = (armInstances.find((a) => a.id === selectedArmId)?.primary) ?? true;
      return [
        { id: 'jog', label: 'Jog joints', icon: Hand, active: poseMode },
        { id: 'move', label: 'Move', icon: MoveIcon },
        { id: 'aim', label: 'Aim · yaw', icon: RotateCw },
        { id: 'duplicate', label: 'Duplicate', icon: Copy },
        ...(isPrimary ? [] : [{ id: 'delete', label: 'Delete', icon: Trash2 } as RadialItem]),
      ];
    }
    if (kind === 'station') {
      const isPrimary = selection?.stationId === 'primary';
      return [
        { id: 'move', label: 'Move', icon: MoveIcon },
        { id: 'aim', label: 'Aim · yaw', icon: RotateCw },
        { id: 'duplicate', label: 'Duplicate', icon: Copy },
        ...(isPrimary ? [] : [{ id: 'delete', label: 'Delete', icon: Trash2 } as RadialItem]),
      ];
    }
    // camera: Move/Aim/Duplicate for all; Delete only for an extra (the primary D435i is the base cam).
    const isExtra = !!selection?.cameraId;
    return [
      { id: 'move', label: 'Move', icon: MoveIcon, active: kind === 'camera' && !isExtra && dragMode === 'translate' },
      { id: 'aim', label: 'Aim', icon: RotateCw, active: kind === 'camera' && !isExtra && dragMode === 'rotate' },
      { id: 'duplicate', label: 'Duplicate', icon: Copy } as RadialItem,
      ...(isExtra ? [{ id: 'delete', label: 'Delete', icon: Trash2 } as RadialItem] : []),
    ];
  };
  const handleRadialSelect = (id: string) => {
    const r = radial; const kind = r?.kind;
    const sel = simRef.current?.renderSys.selection;
    // ── Create-here actions (empty-space radial): place the new item at the clicked ground point ──
    if (kind === 'create') {
      const x = r?.gx ?? 0, y = r?.gy ?? 0;
      if (id === 'new-station') handleAddStationAt(x, y);
      else if (id === 'new-camera') handleAddExtraCameraAt(x, y);
      else if (id === 'new-arm') handleAddArmAt(x, y);
      else if (id === 'new-post') handleWorkcellChange({ ...workcellConfigRef.current, extraPosts: [...(workcellConfigRef.current.extraPosts ?? []), { x, y, height: workcellConfigRef.current.postHeight }] });
      else if (id === 'new-prop') handleAddPropAt(x, y);
      return;
    }
    if (id === 'jog') { if (!poseMode) togglePoseMode(); return; }
    if (poseMode) togglePoseMode(); // move/aim need jog OFF (jog disables selection gizmos)
    // ── Duplicate / Delete (reuse the dock handlers) ──
    if (id === 'duplicate') {
      if (kind === 'arm') handleAddArm();
      else if (kind === 'station') { if (selection?.stationId === 'primary') handleAddStation(); else if (selection?.stationId) handleCloneStation(selection.stationId); }
      else if (kind === 'camera') handleAddExtraCamera(); // duplicate primary OR extra → a new overhead cam
      else if (kind === 'prop' && selection?.propId) handleCloneProp(selection.propId);
      return;
    }
    if (id === 'delete') {
      if (kind === 'arm' && selectedArmId) handleRemoveArm(selectedArmId);
      else if (kind === 'station' && selection?.stationId && selection.stationId !== 'primary') handleRemoveStation(selection.stationId);
      else if (kind === 'camera' && selection?.cameraId) handleRemoveExtraCamera(selection.cameraId);
      else if (kind === 'prop' && selection?.propId) handleRemoveProp(selection.propId);
      return;
    }
    if (id === 'hide') {
      // Route through the tree's visibility state so the Objects eye-toggle stays in sync (re-showable).
      if (kind === 'object' && selection?.bodyId !== undefined) { toggleVisible({ key: `obj:${selection.bodyId}`, kind: 'object', bodyId: selection.bodyId }); sel?.deselect(); }
      return;
    }
    // ── Move / Aim mode toggles ──
    if (kind === 'camera') {
      if (selection?.cameraId) sel?.setCameraAim(id === 'aim');
      else handleDragMode(id === 'aim' ? 'rotate' : 'translate');
      return;
    }
    if (kind === 'arm') sel?.setArmAim(id === 'aim');
    if (kind === 'station') sel?.setStationAim(id === 'aim');
    if (kind === 'wristcam') sel?.setWristCamAim(id === 'aim');
    if (kind === 'object') sel?.setObjectAim(id === 'aim');
    if (kind === 'prop') sel?.setPropAim(id === 'aim');
  };

  // Type exact camera coordinates (origin = table centre) to replicate the real rig.
  const handleCameraMove = (x: number, y: number, z: number) => {
    rig()?.setPosition(x, y, z);
    setCameraPos({ x, y, z });
  };
  const handleCameraAimDown = () => rig()?.aimDown();

  // ── Rod snapping: mount the selected object onto a rod and slide it ALONG it ──
  const [rodSnap, setRodSnap] = useState<{ rodIndex: number; label: string } | null>(null);
  // Reset the snap when a DIFFERENT object is selected (not while sliding the same one).
  const selKey = selection ? `${selection.kind}:${selection.bodyId ?? selectedArmId ?? ''}` : null;
  useEffect(() => { setRodSnap(null); }, [selKey]);
  const rods = (): Rod[] => simRef.current?.renderSys.baseBuilder.rods ?? [];
  const getSelectedPos = (): THREE.Vector3 | null => {
    if (!selection) return null;
    if (selection.kind === 'camera' && cameraPos) return new THREE.Vector3(cameraPos.x, cameraPos.y, cameraPos.z);
    if (selection.kind === 'arm') { const a = armInstancesRef.current.find((x) => x.id === selectedArmId); return a ? new THREE.Vector3(a.x, a.y, 0) : null; }
    if (selection.kind === 'object') return new THREE.Vector3(selection.x, selection.y, selection.z);
    return null;
  };
  const writeSelectedPos = (p: THREE.Vector3) => {
    if (!selection) return;
    if (selection.kind === 'camera') handleCameraMove(p.x, p.y, p.z);
    else if (selection.kind === 'arm') { const a = armInstancesRef.current.find((x) => x.id === selectedArmId); if (a) handleArmChange(a.id, { x: p.x, y: p.y }); }
    else if (selection.kind === 'object' && selection.bodyId !== undefined) simRef.current?.setTaskBodyPosition(selection.bodyId, p.x, p.y, p.z);
  };
  const handleSnapToRod = () => {
    const pos = getSelectedPos(); if (!pos) return;
    const all = rods();
    // Arms stay on the floor, so they slide along horizontal RAILS, not the vertical post.
    const candidates = selection?.kind === 'arm' ? all.filter((r) => Math.abs(r.b.z - r.a.z) < 0.05) : all;
    const near = nearestRod(pos, candidates); if (!near) return;
    const fullIndex = all.indexOf(candidates[near.index]);
    writeSelectedPos(near.point);
    setRodSnap({ rodIndex: fullIndex, label: all[fullIndex]?.label ?? 'rod' });
  };
  const handleSlideAlongRod = (t: number) => {
    if (!rodSnap) return;
    const rod = rods()[rodSnap.rodIndex]; if (!rod) return;
    writeSelectedPos(rod.a.clone().addScaledVector(rod.b.clone().sub(rod.a), t));
  };
  // Current t of the selection along its snapped rod (drives the slider).
  const rodT = (() => {
    if (!rodSnap) return 0;
    const rod = rods()[rodSnap.rodIndex]; const pos = getSelectedPos();
    return rod && pos ? projectToRod(pos, rod).t : 0;
  })();

  // Snap an ARM base onto the nearest table EDGE (perimeter rail) AND rotate it to face INTO the
  // table — mirrors the real rig, where the SO-101 is clamped to an edge pointing at the worktop.
  // Reuses nearestRod (rail = rim edge) + the planner's reach-derived forward so we never hardcode
  // the model's facing convention. After snapping it still slides along the edge via the Along slider.
  const handleSnapArmToEdge = () => {
    if (selection?.kind !== 'arm') return;
    const a = armInstancesRef.current.find((x) => x.id === selectedArmId); if (!a) return;
    const all = rods();
    const edges = all.filter((r) => Math.abs(r.b.z - r.a.z) < 0.05 && r.label.includes('Rail'));
    const near = nearestRod(new THREE.Vector3(a.x, a.y, 0), edges); if (!near) return;
    const edge = edges[near.index];
    // Inward normal of the edge segment (perpendicular, pointing toward THIS worktop's centre —
    // the primary table is at the origin; satellite stations carry their own `center`).
    const cx = edge.center?.x ?? 0, cy = edge.center?.y ?? 0;
    const dx = edge.b.x - edge.a.x, dy = edge.b.y - edge.a.y;
    let nx = -dy, ny = dx;
    if (nx * (cx - near.point.x) + ny * (cy - near.point.y) < 0) { nx = -nx; ny = -ny; }
    const fwd = simRef.current?.planner?.localForwardAngle() ?? 0;
    const yaw = Math.atan2(ny, nx) - fwd;
    handleArmChange(a.id, { x: near.point.x, y: near.point.y, yaw });
    setRodSnap({ rodIndex: all.indexOf(edge), label: edge.label });
  };

  // Snap the camera onto the top of the aluminium post and aim it straight down —
  // one click to replicate "camera mounted N cm up the rod, looking at the worktop".
  const handleSnapCameraToPost = () => {
    const r = rig();
    const post = simRef.current?.renderSys.baseBuilder.postAxis;
    if (!r || !post) return;
    r.setPosition(post.x, post.y, post.height);
    r.aimDown();
    setCameraPos({ x: post.x, y: post.y, z: post.height });
  };

  const handleComputeCoverage = () => {
    const sg = simGroup();
    const r = rig();
    if (sg && r) r.computeCoverage(sg);
  };

  // --- Measure tool ---
  useEffect(() => {
    const mt = simRef.current?.renderSys.measureTool;
    if (isLoading || !mt) return;
    mt.onChange = (list) => setMeasurements(list);
    mt.setUnit(lengthUnit);
    // RenderSystem persists across base/arm reloads, so the MeasureTool does too — but guard
    // the case where the whole sim is recreated: re-apply the active toggle and drop stale rows.
    mt.setActive(measureActive);
    setMeasurements([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  useEffect(() => { simRef.current?.renderSys.measureTool?.setUnit(lengthUnit); }, [lengthUnit]);

  // Camera framing (OrcaSlicer/FreeCAD style): Home = reset to iso view, F = frame selection.
  const handleResetView = () => simRef.current?.renderSys.frameView(null, false);
  const handleFrameSelection = () => {
    const sim = simRef.current; if (!sim) return;
    sim.renderSys.frameView(sim.renderSys.selection?.focusTarget ?? null, true);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === 'Home') { e.preventDefault(); handleResetView(); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); handleFrameSelection(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click-to-select wiring: report the selection to the HUD; dragging the post gizmo writes
  // its X/Y back into the workcell config (live rebuild). RenderSystem persists across reloads.
  useEffect(() => {
    const sel = simRef.current?.renderSys.selection;
    if (isLoading || !sel) return;
    sel.onChange = (s) => {
      setSelection(s);
      // Target the arm carried by the selection (a ghost's id, or the primary). Using s.armId — not
      // always the primary — keeps the editor on the SAME arm across per-frame re-emits (no glitch).
      if (s?.kind === 'arm') setSelectedArmId(s.armId ?? armInstancesRef.current.find((a) => a.primary)?.id ?? 'so101-1');
    };
    sel.onPostMove = (x, y) => handleWorkcellChange({ ...workcellConfigRef.current, postX: x, postY: y });
    // Arm drag gizmo (like the camera's): the viewport gizmo sits on the arm base + writes it.
    sel.getArmPose = (armId) => { const a = armInstancesRef.current.find((x) => x.id === (armId ?? armInstancesRef.current.find((p) => p.primary)?.id)); return a ? { x: a.x, y: a.y, yaw: a.yaw } : null; };
    sel.onArmMove = (armId, x, y) => { const a = armInstancesRef.current.find((p) => p.id === (armId ?? armInstancesRef.current.find((q) => q.primary)?.id)); if (a) handleArmChange(a.id, { x, y }); };
    sel.onArmRotate = (armId, yaw) => { const a = armInstancesRef.current.find((p) => p.id === (armId ?? armInstancesRef.current.find((q) => q.primary)?.id)); if (a) handleArmChange(a.id, { yaw }); };
    // Stations reuse the same gizmo (DRY): move/rotate the worktop from the viewport.
    sel.getStationPose = (id) => {
      if (id === 'primary') { const wc = workcellConfigRef.current; return { x: wc.originX ?? 0, y: wc.originY ?? 0, yaw: wc.yaw ?? 0 }; }
      const s = workcellConfigRef.current.stations?.find((x) => x.id === id); return s ? { x: s.x, y: s.y, yaw: s.yaw } : null;
    };
    sel.onStationMove = (id, x, y) => handleStationChange(id, { x, y });
    sel.onStationRotate = (id, yaw) => handleStationChange(id, { yaw });
    // Extra overhead cameras: move (translate) + aim (rotate) via the same proxy gizmo.
    sel.getCameraPose = (id) => { const c = workcellConfigRef.current.extraCameras?.find((x) => x.id === id); return c ? { x: c.x, y: c.y, z: c.z, rotX: c.rotX, rotY: c.rotY, rotZ: c.rotZ } : null; };
    sel.onCameraMove = (id, x, y, z) => handleExtraCameraChange(id, { x, y, z });
    sel.onCameraAim = (id, rx, ry, rz) => handleExtraCameraChange(id, { rotX: rx, rotY: ry, rotZ: rz });
    // Wrist camera move/aim gizmo (gripper-relative): MOVE → local offset; AIM → tilt.
    sel.getWristPose = (armId) => { const c = simRef.current?.renderSys.getWristCamera(armId); return c ? { pos: c.getWorldPos(), quat: c.getWorldQuat() } : null; };
    sel.onWristMove = (armId, world) => { const c = simRef.current?.renderSys.getWristCamera(armId); if (c) { const o = c.worldToLocalOffset(world); setWristMount((m) => ({ ...m, posX: o.posX, posY: o.posY, posZ: o.posZ })); } };
    sel.onWristAim = (armId, quat) => { const c = simRef.current?.renderSys.getWristCamera(armId); if (c) { const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat); setWristMount((m) => ({ ...m, tilt: c.worldDirToTilt(dir) })); } };
    // Task objects (boxes): viewport move/aim gizmo → teleport / yaw the freejoint block.
    sel.onObjectMove = (bodyId, x, y, z) => simRef.current?.setTaskBodyPosition(bodyId, x, y, z);
    sel.onObjectRotate = (bodyId, yaw) => simRef.current?.setTaskBodyYaw(bodyId, yaw);
    // Decoupled props (Three.js cubes): gizmo move/aim → edit the config (live rebuild, no physics).
    sel.getPropPose = (id) => { const p = workcellConfigRef.current.props?.find((x) => x.id === id); return p ? { x: p.x, y: p.y, z: p.z, yaw: p.yaw } : null; };
    sel.onPropMove = (id, x, y, z) => handlePropChange(id, { x, y, z });
    sel.onPropRotate = (id, yaw) => handlePropChange(id, { yaw });
    setTaskBodies(simRef.current?.getTaskBodies() ?? []); // populate the object tree
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Object-tree entities (arm + camera + post + task blocks) and the currently-selected key.
  const objectEntities = (() => {
    const list: { key: string; kind: 'arm' | 'camera' | 'post' | 'object' | 'station' | 'wristcam' | 'prop'; label: string; bodyId?: number; armId?: string; stationId?: string; cameraId?: string; propId?: string }[] = [];
    list.push({ key: 'station:primary', kind: 'station', label: 'Workcell (table)', stationId: 'primary' });
    armInstances.forEach((a) => list.push({ key: `arm:${a.id}`, kind: 'arm', label: a.label, armId: a.id }));
    (workcellConfig.stations ?? []).forEach((s, i) => list.push({ key: `station:${s.id}`, kind: 'station', label: `Workstation ${i + 2}`, stationId: s.id }));
    list.push({ key: 'camera', kind: 'camera', label: 'D435i camera' });
    armInstances.forEach((a) => list.push({ key: `wristcam:${a.id}`, kind: 'wristcam', label: `Wrist camera · ${a.label}`, armId: a.id }));
    (workcellConfig.extraCameras ?? []).forEach((c, i) => list.push({ key: `camera:${c.id}`, kind: 'camera', label: `Overhead D435i ${i + 2}`, cameraId: c.id }));
    list.push({ key: 'post', kind: 'post', label: 'Camera post' });
    (workcellConfig.props ?? []).forEach((p, i) => list.push({ key: `prop:${p.id}`, kind: 'prop', label: `Prop ${i + 1}`, propId: p.id }));
    taskBodies.forEach((b) => list.push({ key: `obj:${b.bodyId}`, kind: 'object', label: b.name, bodyId: b.bodyId }));
    return list;
  })();
  const primaryArmId = armInstances.find((a) => a.primary)?.id ?? 'so101-1';
  const selectedKey = !selection ? null
    : selection.kind === 'object' ? `obj:${selection.bodyId}`
    : selection.kind === 'arm' ? `arm:${selectedArmId}` // the arm the inspector is editing
    : selection.kind === 'station' ? `station:${selection.stationId}`
    : selection.kind === 'wristcam' ? `wristcam:${selection.wristArmId}`
    : selection.kind === 'prop' ? `prop:${selection.propId}`
    : selection.kind === 'camera' && selection.cameraId ? `camera:${selection.cameraId}`
    : selection.kind; // 'camera' (primary) | 'post'
  const handleTreeSelect = (e: { kind: 'arm' | 'camera' | 'post' | 'object' | 'station' | 'wristcam' | 'prop'; bodyId?: number; armId?: string; stationId?: string; cameraId?: string; propId?: string }) => {
    const sel = simRef.current?.renderSys.selection;
    if (!sel) return;
    // selectByKind fires onChange (which resets selectedArmId→primary), so set the tree's arm LAST.
    if (e.kind === 'arm') { sel.selectByKind('arm', e.armId); if (e.armId) setSelectedArmId(e.armId); }
    else if (e.kind === 'station') sel.selectByKind('station', e.stationId);
    else if (e.kind === 'wristcam') sel.selectByKind('wristcam', e.armId);
    else if (e.kind === 'prop') sel.selectByKind('prop', e.propId);
    else if (e.kind === 'camera') sel.selectByKind('camera', e.cameraId);
    else if (e.kind === 'object' && e.bodyId !== undefined) sel.selectObjectByBodyId(e.bodyId);
    else if (e.kind !== 'object') sel.selectByKind(e.kind);
  };

  // Per-object visibility: eye toggle in the tree hides/shows an entity in the 3D view.
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const toggleVisible = (e: { key: string; kind: 'arm' | 'camera' | 'post' | 'object' | 'station' | 'wristcam' | 'prop'; bodyId?: number; armId?: string; stationId?: string; cameraId?: string; propId?: string }) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      const willHide = !next.has(e.key);
      if (willHide) next.add(e.key); else next.delete(e.key);
      const id = e.kind === 'object' ? e.bodyId : e.kind === 'station' ? e.stationId : e.kind === 'camera' ? e.cameraId : e.kind === 'prop' ? e.propId : e.armId;
      simRef.current?.setEntityVisible(e.kind, id, !willHide);
      return next;
    });
  };

  const handleMeasureActive = (v: boolean) => {
    setMeasureActive(v);
    simRef.current?.renderSys.measureTool?.setActive(v);
    // Measure and select both consume clicks — only one is live at a time.
    simRef.current?.renderSys.selection?.setEnabled(!v);
  };

  // --- Reachability planner ---
  const refreshBaseResult = () => {
    const r = planner()?.lastBaseResult;
    setBaseResult(r ? { covered: r.covered, total: r.total } : null);
  };

  // Re-apply React's planner state to a freshly (re)created planner (called on scene reload).
  const applyPlannerState = () => {
    const p = planner();
    if (!p) return;
    p.setToggles(plannerTogglesRef.current);
    p.computeReachability(reachResolutionRef.current);
    if (plannerTogglesRef.current.basePlacement) p.computeBasePlacement();
    refreshBaseResult();
  };

  const handlePlannerToggle = (key: keyof PlannerToggles, value: boolean) => {
    setPlannerToggles(prev => ({ ...prev, [key]: value }));
    const p = planner();
    if (!p) return;
    p.setToggles({ [key]: value });
    if (key === 'basePlacement' && value) { p.computeBasePlacement(); refreshBaseResult(); }
  };

  const handleRecompute = () => {
    const p = planner();
    if (!p) return;
    setComputingReach(true);
    // Defer so the spinner paints before the synchronous FK sweep blocks the main thread.
    setTimeout(() => {
      p.computeReachability(reachResolutionRef.current);
      refreshBaseResult();
      setComputingReach(false);
    }, 30);
  };

  const handleWorkcellChange = (next: WorkcellConfig) => {
    setWorkcellConfig(next);
    // Worktop is Three.js-only now → live rebuild on every slider change, no reload.
    simRef.current?.setWorkcell(next);
  };


  // The PRIMARY arm's base now moves LIVE (body_pos + mj_forward, no reload) — so dragging the
  // slider moves the real arm in real time, no "apply pose" step needed.
  const commitPrimaryPose = () => {
    const sim = simRef.current;
    const primary = armInstancesRef.current.find((a) => a.primary);
    if (!sim || !primary) return;
    sim.relocateBase(primary.x, primary.y, primary.yaw).then(() => applyPlannerState());
  };

  const handleArmChange = (id: string, patch: Partial<ArmInstance>) => {
    // Compute next + run side effects OUTSIDE the updater (a pure updater would double-fire
    // these under React 18 StrictMode). armInstancesRef mirrors the latest state.
    const next = armInstancesRef.current.map((arm) => arm.id === id ? { ...arm, ...patch } : arm);
    setArmInstances(next);
    const sim = simRef.current;
    sim?.setArmInstances(next); // live ghost + reach outline
    const changed = next.find((a) => a.id === id);
    if (changed?.primary && sim) {
      // Just move the base — relocateBase already redraws the reach overlay (setArms). Do NOT
      // recompute reachability here: the reachable set is BASE-RELATIVE (invariant under the base's
      // x/y/yaw), so a re-sweep is wasted work — and the heavier radial sweep made that re-sweep,
      // running on every slider tick, freeze/crash the page. Re-sweep only happens on the explicit
      // "Recompute reach" button or a model reload.
      sim.relocateBase(changed.x, changed.y, changed.yaw); // live, instant — no recompute
    }
  };


  // Suggest + apply a max-coverage arrangement for all current arms (greedy set-cover).
  const [layoutResult, setLayoutResult] = useState<{ covered: number; total: number } | null>(null);
  const handleSuggestLayout = () => {
    const sim = simRef.current; if (!sim) return;
    const arms = armInstancesRef.current;
    const res = sim.suggestArmLayout(arms.length);
    if (!res) return;
    const next = arms.map((a, i) => ({ ...a, x: res.poses[i].x, y: res.poses[i].y, yaw: res.poses[i].yaw }));
    setArmInstances(next);
    sim.setArmInstances(next);
    const primary = next.find((a) => a.primary);
    if (primary) sim.relocateBase(primary.x, primary.y, primary.yaw).then(() => applyPlannerState());
    setLayoutResult({ covered: res.covered, total: res.total });
  };

  const handleAddArm = () => {
    const armNumber = nextArmNumberRef.current++;
    const id = `so101-${armNumber}`;
    setArmInstances(prev => {
      const next: ArmInstance[] = [
        ...prev,
        { id, label: `SO101 ${armNumber}`, x: 0.18, y: -0.18 + prev.length * 0.08, yaw: Math.PI / 2 },
      ];
      setSelectedArmId(id);
      simRef.current?.setArmInstances(next);
      return next;
    });
  };

  const handleRemoveArm = (id: string) => {
    setArmInstances(prev => {
      const next = prev.filter((arm) => arm.id !== id || arm.primary);
      if (!next.some((arm) => arm.id === selectedArmId)) setSelectedArmId(next[0]?.id ?? 'so101-1');
      simRef.current?.setArmInstances(next);
      return next;
    });
  };

  // ── Workstations (#6): a station = its own worktop + an arm on it (a real "clone", not just a
  // table). Adding one drops a worktop to the +X and an arm clamped to that worktop's near edge,
  // facing in; its reach overlay renders automatically (the planner draws every arm). Removing a
  // station also removes its paired arm. Live — no reload (the worktop is Three.js-only).
  const nextStationNumberRef = useRef(2);
  // Spawn a workstation by CLONING a source worktop config (the primary or another station) so you
  // don't rebuild the setup each time — full shape/size/post copied. Placed in the +X aisle past the
  // rightmost worktop, with a paired arm clamped to its near edge.
  type StationShape = { shapeSides: number; length: number; width: number; postX: number; postY: number; postHeight: number };
  const spawnStation = (src: StationShape, pos?: { x: number; y: number }) => {
    const n = nextStationNumberRef.current++;
    const id = `station-${n}`;
    const wc = workcellConfigRef.current;
    const existing = wc.stations ?? [];
    // Place at an explicit point (right-click → create here) or auto-tuck into the +X aisle.
    const rightmost = existing.reduce((mx, s) => Math.max(mx, s.x + s.length / 2), wc.length / 2);
    const sx = pos?.x ?? rightmost + 0.2 + src.length / 2;
    const sy = pos?.y ?? 0;
    handleWorkcellChange({ ...wc, stations: [...existing, { id, x: sx, y: sy, yaw: 0, ...src }] });
    // Read the counter OUTSIDE the updater so React 18 StrictMode's double-invoke can't skip a number.
    const armNumber = nextArmNumberRef.current++;
    const armId = `so101-${armNumber}`;
    const fwd = simRef.current?.planner?.localForwardAngle() ?? -Math.PI / 2;
    const arm: ArmInstance = { id: armId, label: `SO101 ${armNumber}`, x: sx, y: sy - src.width / 2, yaw: Math.PI / 2 - fwd, stationId: id };
    setArmInstances(prev => { const next = [...prev, arm]; setSelectedArmId(armId); simRef.current?.setArmInstances(next); return next; });
  };
  // ── "Create here" handlers (empty-space radial) — place a new item at the clicked ground point ──
  const handleAddStationAt = (x: number, y: number) => { const wc = workcellConfigRef.current; spawnStation({ shapeSides: wc.shapeSides, length: wc.length, width: wc.width, postX: wc.postX, postY: wc.postY, postHeight: wc.postHeight }, { x, y }); };
  const handleAddExtraCameraAt = (x: number, y: number) => {
    const wc = workcellConfigRef.current; const n = nextExtraCamRef.current++;
    handleWorkcellChange({ ...wc, extraCameras: [...(wc.extraCameras ?? []), { id: `cam-${n}`, x, y, z: 0.85, rotX: 0, rotY: 0, rotZ: 0 }] });
    setExtraCamView(true);
  };
  const handleAddArmAt = (x: number, y: number) => {
    const armNumber = nextArmNumberRef.current++;
    const id = `so101-${armNumber}`;
    setArmInstances(prev => { const next: ArmInstance[] = [...prev, { id, label: `SO101 ${armNumber}`, x, y, yaw: Math.PI / 2 }]; setSelectedArmId(id); simRef.current?.setArmInstances(next); return next; });
  };
  // ── Decoupled props (Three.js cubes; no physics) — add/duplicate/delete/move live, no reload ──
  const nextPropRef = useRef(1);
  const handleAddPropAt = (x: number, y: number) => {
    const wc = workcellConfigRef.current; const n = nextPropRef.current++; const size = 0.05;
    handleWorkcellChange({ ...wc, props: [...(wc.props ?? []), { id: `prop-${n}`, x, y, z: size / 2, yaw: 0, size, color: '#e0772f' }] });
  };
  const handleAddProp = () => handleAddPropAt(0, 0);
  const handleRemoveProp = (id: string) => { const wc = workcellConfigRef.current; handleWorkcellChange({ ...wc, props: (wc.props ?? []).filter((p) => p.id !== id) }); };
  const handleCloneProp = (id: string) => { const wc = workcellConfigRef.current; const p = (wc.props ?? []).find((x) => x.id === id); if (p) { const n = nextPropRef.current++; handleWorkcellChange({ ...wc, props: [...(wc.props ?? []), { ...p, id: `prop-${n}`, x: p.x + 0.06, y: p.y + 0.06 }] }); } };
  const handlePropChange = (id: string, patch: Partial<{ x: number; y: number; z: number; yaw: number; size: number; color: string }>) => { const wc = workcellConfigRef.current; handleWorkcellChange({ ...wc, props: (wc.props ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)) }); };
  const handleAddStation = () => { const wc = workcellConfigRef.current; spawnStation({ shapeSides: wc.shapeSides, length: wc.length, width: wc.width, postX: wc.postX, postY: wc.postY, postHeight: wc.postHeight }); };
  const handleCloneStation = (id: string) => {
    const s = (workcellConfigRef.current.stations ?? []).find((x) => x.id === id);
    if (s) spawnStation({ shapeSides: s.shapeSides, length: s.length, width: s.width, postX: s.postX, postY: s.postY, postHeight: s.postHeight });
  };
  // Edge-snap worktops so they piece together flush (#4). Given a worktop's new centre, if one of
  // its edges lands within SNAP of another worktop's facing edge (and they overlap on the other
  // axis), snap it flush; also tidy-align the perpendicular axis when it's nearly aligned.
  const snapWorktop = (movingId: string, x: number, y: number): { x: number; y: number } => {
    const wc = workcellConfigRef.current;
    const foot = (fid: string) => {
      if (fid === 'primary') return { hx: wc.length / 2, hy: wc.width / 2 };
      const s = (wc.stations ?? []).find((st) => st.id === fid);
      return s ? { hx: s.length / 2, hy: s.width / 2 } : null;
    };
    const me = foot(movingId); if (!me) return { x, y };
    const others = ['primary', ...(wc.stations ?? []).map((s) => s.id)]
      .filter((oid) => oid !== movingId)
      .map((oid) => { const f = foot(oid); const c = oid === 'primary' ? { x: wc.originX ?? 0, y: wc.originY ?? 0 } : (wc.stations ?? []).find((s) => s.id === oid)!; return f ? { cx: c.x, cy: c.y, hx: f.hx, hy: f.hy } : null; })
      .filter(Boolean) as Array<{ cx: number; cy: number; hx: number; hy: number }>;
    const SNAP = 0.05; // 5 cm
    let nx = x, ny = y;
    for (const o of others) {
      // Abut along X (left/right edges touch) when the Y spans overlap.
      if (Math.abs(y - o.cy) < me.hy + o.hy + SNAP) {
        for (const t of [o.cx - o.hx - me.hx, o.cx + o.hx + me.hx]) if (Math.abs(x - t) <= SNAP) { nx = t; if (Math.abs(y - o.cy) <= SNAP) ny = o.cy; }
      }
      // Abut along Y (front/back edges touch) when the X spans overlap.
      if (Math.abs(x - o.cx) < me.hx + o.hx + SNAP) {
        for (const t of [o.cy - o.hy - me.hy, o.cy + o.hy + me.hy]) if (Math.abs(y - t) <= SNAP) { ny = t; if (Math.abs(x - o.cx) <= SNAP) nx = o.cx; }
      }
    }
    return { x: nx, y: ny };
  };

  // Edit a station like the arm — X/Y/Yaw + shape/size — live rebuild + station-cam re-sync. The
  // paired arm moves with the worktop as a unit (rotated about the centre).
  const handleStationChange = (id: string, patch: Partial<{ x: number; y: number; yaw: number; shapeSides: number; length: number; width: number; postHeight: number }>) => {
    const wc = workcellConfigRef.current;
    // Pure move → edge-snap against neighbouring worktops so they click together.
    if ((patch.x !== undefined || patch.y !== undefined) && patch.yaw === undefined && patch.shapeSides === undefined && patch.length === undefined && patch.width === undefined) {
      const cur = id === 'primary' ? { x: wc.originX ?? 0, y: wc.originY ?? 0 } : (wc.stations ?? []).find((s) => s.id === id) ?? { x: 0, y: 0 };
      const snapped = snapWorktop(id, patch.x ?? cur.x, patch.y ?? cur.y);
      patch = { ...patch, x: snapped.x, y: snapped.y };
    }
    // The primary worktop maps onto the top-level config (originX/originY/yaw + shape/size). The
    // primary arm is bolted to it, so a move/rotate carries the arm along (rotated about the table
    // centre) — same rigid-body rule as a satellite station + its arm.
    if (id === 'primary') {
      const prevOX = wc.originX ?? 0, prevOY = wc.originY ?? 0, prevYaw = wc.yaw ?? 0;
      const nextOX = patch.x ?? prevOX, nextOY = patch.y ?? prevOY, nextYaw = patch.yaw ?? prevYaw;
      handleWorkcellChange({
        ...wc, originX: nextOX, originY: nextOY, yaw: nextYaw,
        ...(patch.shapeSides !== undefined ? { shapeSides: patch.shapeSides } : {}),
        ...(patch.length !== undefined ? { length: patch.length } : {}),
        ...(patch.width !== undefined ? { width: patch.width } : {}),
      });
      const dx = nextOX - prevOX, dy = nextOY - prevOY, dyaw = nextYaw - prevYaw;
      const arm = armInstancesRef.current.find((a) => a.primary);
      if (arm && (dx || dy || dyaw)) {
        const ox = arm.x - prevOX, oy = arm.y - prevOY;
        const c = Math.cos(dyaw), s = Math.sin(dyaw);
        handleArmChange(arm.id, { x: prevOX + (ox * c - oy * s) + dx, y: prevOY + (ox * s + oy * c) + dy, yaw: arm.yaw + dyaw });
      }
      return;
    }
    const prev = (wc.stations ?? []).find((s) => s.id === id);
    if (!prev) return;
    const next = { ...prev, ...patch };
    handleWorkcellChange({ ...wc, stations: (wc.stations ?? []).map((s) => (s.id === id ? next : s)) });
    const dx = next.x - prev.x, dy = next.y - prev.y, dyaw = next.yaw - prev.yaw;
    const arm = armInstancesRef.current.find((a) => a.stationId === id);
    if (arm && (dx || dy || dyaw)) {
      const ox = arm.x - prev.x, oy = arm.y - prev.y;
      const c = Math.cos(dyaw), s = Math.sin(dyaw);
      handleArmChange(arm.id, { x: prev.x + (ox * c - oy * s) + dx, y: prev.y + (ox * s + oy * c) + dy, yaw: arm.yaw + dyaw });
    }
  };

  const handleRemoveStation = (id: string) => {
    const wc = workcellConfigRef.current;
    handleWorkcellChange({ ...wc, stations: (wc.stations ?? []).filter((s) => s.id !== id) });
    setArmInstances(prev => {
      const next = prev.filter((arm) => arm.stationId !== id);
      if (!next.some((arm) => arm.id === selectedArmId)) setSelectedArmId(next.find((a) => a.primary)?.id ?? 'so101-1');
      simRef.current?.setArmInstances(next);
      return next;
    });
  };

  // ── Compare A/B: capture the current LIVE layout as a full workstation setup, and snapshot it
  // into slot A or B. Compare mode then renders the two captured setups side-by-side (SceneMap).
  const captureSetup = (): CompareSetup => {
    const wc = workcellConfigRef.current;
    const arm = armInstancesRef.current.find((a) => a.primary) ?? armInstancesRef.current[0];
    const cam = cameraPos ?? { x: wc.postX, y: wc.postY, z: wc.postHeight };
    const pts = simRef.current?.planner?.taskWorldPoints() ?? [];
    return {
      table: { length: wc.length, width: wc.width, railH: wc.barHeight },
      post: { x: wc.postX, y: wc.postY, h: wc.postHeight },
      camera: { x: cam.x, y: cam.y, z: cam.z, fovH: intrinsics.hFovDeg },
      arm: arm ? { x: arm.x, y: arm.y, yawDeg: (arm.yaw * 180) / Math.PI } : { x: 0, y: 0, yawDeg: 0 },
      blocks: pts.map((p, i) => ({ id: `task${i}`, x: p.x, y: p.y, color: 'orange' as const })),
    };
  };
  const handleSnapshot = (slot: 'A' | 'B') => {
    const s = captureSetup();
    if (slot === 'A') setCompareA(s); else setCompareB(s);
  };
  const enterCompare = () => {
    // Seed A with the current layout on first entry so there's always something to compare against.
    setCompareA((a) => a ?? captureSetup());
    setMode('compare');
  };

  const handleApplyArmPose = () => {
    const selected = armInstances.find((arm) => arm.id === selectedArmId);
    const sim = simRef.current;
    if (!selected || !sim) return;
    if (!selected.primary) {
      sim.setArmInstances(armInstances);
      return;
    }
    setComputingReach(true);
    sim.relocateBase(selected.x, selected.y, selected.yaw)
      .then(() => {
        sim.setArmInstances(armInstances);
        applyPlannerState();
      })
      .finally(() => setComputingReach(false));
  };

  const toggleDarkMode = () => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
    simRef.current?.renderSys.setDarkMode(next);
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
        const sim = simRef.current;
        if (!sim || isLoading || erLoading || measureActive) return; // don't hijack measure clicks
        const markerPos = sim.renderSys.checkMarkerClick(e.clientX, e.clientY);
        if (!markerPos) return;
        if (sim.isFranka) {
            sim.moveIkTargetTo(markerPos, 2000); // Franka analytical IK
            sim.setIkEnabled(true);
        } else {
            sim.moveArmTo(markerPos); // SO-101 numeric IK → reach to the detected object
        }
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [isLoading, erLoading, measureActive]);

  const handleErSend = async (prompt: string, type: DetectType, temperature: number, enableThinking: boolean, modelId: string) => {
      if (!simRef.current || erLoading) return;
      if (!GEMINI_API_KEY) return;
      setErLoading(true);
      simRef.current.renderSys.clearErMarkers();
      detectedTargets.current = []; 
      setDetectedCount(0);
      setIsPickingUp(false);
      setPlaybackSpeed(1);

      const savedState = simRef.current.renderSys.getCameraState();
      const topPos = new THREE.Vector3(0, -0.01, 2.0); 
      const target = new THREE.Vector3(0, 0, 0);
      await simRef.current.renderSys.moveCameraTo(topPos, target, 1500);
      await new Promise(r => setTimeout(r, 100)); 

      setFlash(true);
      setTimeout(() => setFlash(false), 100);
      
      // Dynamic Resizing: Limit max dimension to 640px while preserving aspect ratio.
      const canvas = simRef.current.renderSys.renderer.domElement;
      const width = canvas.width;
      const height = canvas.height;
      const scaleFactor = Math.min(640 / width, 640 / height);
      const snapshotWidth = Math.floor(width * scaleFactor);
      const snapshotHeight = Math.floor(height * scaleFactor);
      
      // Serialization: Convert to PNG.
      const imageBase64 = simRef.current.renderSys.getCanvasSnapshot(snapshotWidth, snapshotHeight, 'image/png');
      // Payload Preparation: Strip data URI prefix.
      const base64Data = imageBase64.replace('data:image/png;base64,', '');

      const parts = defaultPromptParts[type];
      const subject = prompt.trim() || parts[1];
      const textPrompt = `${parts[0]} ${subject}${parts[2]}`;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config: any = {
          temperature,
          responseMimeType: "application/json",
      };

      if (!enableThinking) {
          config.thinkingConfig = { thinkingBudget: 0 };
      }

      const requestLogData = {
          model: modelId,
          contents: {
              parts: [
                  { inlineData: { data: "<IMAGE>", mimeType: "image/png" } },
                  { text: textPrompt }
              ]
          },
          config: config
      };

      const logId = uuidv4();
      const newLog: LogEntry = {
          id: logId,
          timestamp: new Date(),
          imageSrc: imageBase64,
          prompt,
          fullPrompt: textPrompt,
          type,
          result: null, 
          requestData: requestLogData
      };
      setLogs(prev => [newLog, ...prev]);

      await simRef.current.renderSys.moveCameraTo(savedState.position, savedState.target, 1500);

      try {
          const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
          const response = await ai.models.generateContent({
              model: modelId,
              contents: {
                  parts: [
                      { inlineData: { mimeType: 'image/png', data: base64Data } },
                      { text: textPrompt }
                  ]
              },
              // tslint:disable-next-line:no-any
              config: config
          });

          const text = response.text;
          if (!text) throw new Error("No response text returned.");

          let jsonText = text.replace(/```json|```/g, '').trim();
          const firstBracket = jsonText.indexOf('[');
          const lastBracket = jsonText.lastIndexOf(']');
          if (firstBracket !== -1 && lastBracket !== -1) {
              jsonText = jsonText.substring(firstBracket, lastBracket + 1);
          }

          let result: Array<{ box_2d?: number[]; point?: number[]; label: string }>;
          try { result = normalizeGeminiDetections(JSON.parse(jsonText)); } catch (e) { result = []; }

          setLogs(prev => prev.map(l => l.id === logId ? { ...l, result } : l));

          if (Array.isArray(result)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              result.forEach((item: any) => {
                  let center2d: {x: number, y: number} | null = null;
                  if (item.box_2d) {
                      const [ymin, xmin, ymax, xmax] = item.box_2d; 
                      center2d = { x: (xmin + xmax) / 2, y: (ymin + ymax) / 2 };
                  } else if (item.point) {
                      const [y, x] = item.point;
                      center2d = { x, y };
                  }

                  if (center2d) {
                      const projection = simRef.current?.renderSys.project2DTo3D(center2d.x, center2d.y, topPos, target);
                      if (projection) {
                          const markerId = Date.now() + Math.random();
                          simRef.current?.renderSys.addErMarker(projection.point, item.label, markerId);
                          detectedTargets.current.push({ pos: projection.point, markerId });
                      }
                  }
              });
              setDetectedCount(detectedTargets.current.length);
          }
      } catch (error: unknown) {
          console.error("Gemini API Error", error);
          const errorMsg = (error as Error).message || "Unknown error";
          setLogs(prev => prev.map(l => l.id === logId && l.result === null ? { ...l, result: { error: errorMsg } } : l));
      } finally {
          setErLoading(false);
      }
  };

  const handlePickup = () => {
    if (simRef.current) {
        // If already picking up, this button acts as a speed toggle
        if (isPickingUp) {
            let nextSpeed = 1;
            if (playbackSpeed === 1) nextSpeed = 2;
            else if (playbackSpeed === 2) nextSpeed = 5;
            else if (playbackSpeed === 5) nextSpeed = 10;
            else if (playbackSpeed === 10) nextSpeed = 20;
            else if (playbackSpeed === 20) nextSpeed = 2; // Cycle back to 2x for continuous fast forward feeling
            
            setPlaybackSpeed(nextSpeed);
            simRef.current.setSpeedMultiplier(nextSpeed);
            return;
        }

        // Otherwise start the pickup sequence
        if (detectedTargets.current.length > 0) {
            setIsPickingUp(true);
            setPlaybackSpeed(1);
            const positions = detectedTargets.current.map(t => t.pos);
            const markerIds = detectedTargets.current.map(t => t.markerId);
            
            simRef.current.pickupItems(positions, markerIds, () => {
                // On Finished
                setIsPickingUp(false);
                setPlaybackSpeed(1);
                setDetectedCount(0); // Deactivates the button
                detectedTargets.current = [];
                simRef.current?.setSpeedMultiplier(1);
            });
        }
    }
  };

  const handleReset = () => {
    simRef.current?.reset();
    setLogs([]);
    setDetectedCount(0);
    setIsPickingUp(false);
    setPlaybackSpeed(1);
    detectedTargets.current = [];
  };

  return (
    <div className={`w-full h-full relative overflow-hidden font-sans transition-colors duration-500 ${isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
      {/* 3D Container */}
      <div ref={containerRef} onContextMenu={handleContextMenu} onDoubleClick={handleDoubleClick} className="w-full h-full absolute inset-0 bg-slate-200" />
      
      {/* Robot Info Overlay — only for the Franka demo (it shows IK gizmo stats); the SO-101
          twin doesn't need the name pill (the dock header covers it), reclaiming screen space. */}
      {!loadError && sceneIsFranka && <RobotSelector gizmoStats={gizmoStats} isDarkMode={isDarkMode} robotName="Franka Panda" />}
      
      {/* Loading Screen */}
      {isLoading && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center z-50 backdrop-blur-md px-6 ${isDarkMode ? 'bg-slate-950/40' : 'bg-slate-50/20'}`}>
              <div className="flex flex-col min-[660px]:flex-row gap-8 max-w-4xl w-full items-stretch">
                  <div className={`glass-panel p-12 rounded-[3rem] flex-1 flex flex-col justify-center shadow-2xl transition-colors ${isDarkMode ? 'bg-slate-900/70 border-white/10' : 'bg-white/70 border-white/80'}`}>
                    <h3 className={`text-sm font-bold uppercase tracking-widest mb-4 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>System Overview</h3>
                    <p className={`text-sm leading-relaxed mb-6 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                      This demo showcases spatial reasoning for robotics. Using <strong>Gemini Robotics Embodied Reasoning 1.6</strong>, the system analyzes a 2D image to identify objects and calculate manipulation coordinates.
                    </p>
                    <ul className={`text-[13px] space-y-3 list-disc list-inside ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                        <li>Real-time MuJoCo physics simulation</li>
                        <li>Analytical Inverse Kinematics for Franka Panda</li>
                        <li>Call Gemini Robotics Embodied Reasoning 1.6 for detection</li>
                    </ul>
                  </div>

                  <div className={`glass-panel p-10 rounded-[3rem] flex flex-col items-center justify-center shrink-0 min-[660px]:w-[260px] shadow-2xl transition-colors ${isDarkMode ? 'bg-slate-900/70 border-white/10' : 'bg-white/70 border-white/80'}`}>
                      <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-100/20 animate-pulse-soft mb-6">
                        <Loader2 className="w-8 h-8 text-white animate-spin" />
                      </div>
                      <h2 className={`text-base font-bold text-center px-2 ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>{loadingStatus}</h2>
                  </div>
              </div>
          </div>
      )}
      
      {/* Flash Effect */}
      {flash && <div className="absolute inset-0 bg-white z-[60] pointer-events-none opacity-50" />}
      
      {/* Error State */}
      {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/40 backdrop-blur-xl z-50">
              <div className="glass-panel p-10 rounded-[2.5rem] border-red-100 max-w-md text-center">
                  <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertCircle className="w-8 h-8" />
                  </div>
                  <h3 className="text-2xl text-slate-800 font-bold mb-2">Simulation Halted</h3>
                  <p className="text-slate-500 mb-8 leading-relaxed">{loadError}</p>
                  <button 
                    onClick={() => window.location.reload()} 
                    className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-black transition-all shadow-xl active:scale-95"
                  >
                    Restart System
                  </button>
              </div>
          </div>
      )}
      
      {/* Main UI Controls */}
      {!isLoading && !loadError && (
        <>
          {!sceneIsFranka && layoutsOpen && (
            <LayoutProfiles
              profiles={profiles}
              onSave={handleSaveProfile}
              onLoad={handleLoadProfile}
              onDelete={handleDeleteProfile}
              onPublish={handlePublishProfiles}
              isDarkMode={isDarkMode}
            />
          )}

          {!sceneIsFranka && (
            <>
              <ModeRail
                mode={mode} onMode={(m) => (m === 'compare' ? enterCompare() : setMode(m))}
                dockOpen={dockOpen} onToggleDock={() => setDockOpen((v) => !v)}
                perceiveOpen={showSidebar} onTogglePerceive={() => setShowSidebar((v) => !v)}
                layoutsOpen={layoutsOpen} onToggleLayouts={() => setLayoutsOpen((v) => !v)}
                isDarkMode={isDarkMode}
              />
              {/* Status readout now lives in the sidebar header (MetricBar inline). When the panel is
                  closed, show the floating pill as a fallback so the sim state stays visible. */}
              {!showSidebar && <MetricBar armCount={armInstances.length} baseResult={baseResult} isPaused={isPaused} isDarkMode={isDarkMode} />}
              {/* NavCube sits to the LEFT of the right sidebar's top (beside the Camera Feeds card). */}
              <NavCube
                onView={(p) => simRef.current?.renderSys.snapToView(p)}
                isDarkMode={isDarkMode}
                dockOpen={dockOpen}
                sidebarOpen={showSidebar}
                onDragRotate={(dAz, dEl) => simRef.current?.renderSys.orbit(dAz, dEl)}
                getOrbit={() => {
                  const rs = simRef.current?.renderSys;
                  if (!rs) return null;
                  const p = rs.camera.position, t = rs.controls.target;
                  return { dx: p.x - t.x, dy: p.y - t.y, dz: p.z - t.z };
                }}
              />
              {mode === 'compare' && (
                <CompareView
                  setupA={compareA}
                  setupB={compareB}
                  isDarkMode={isDarkMode}
                  sidebarOpen={showSidebar}
                  onSnapshot={handleSnapshot}
                  onExit={() => setMode('edit')}
                />
              )}
            </>
          )}
          <TweaksPanel isDarkMode={isDarkMode} onToggleTheme={toggleDarkMode} open={tweaksOpen} onClose={() => setTweaksOpen(false)} sidebarOpen={showSidebar} />

          {/* Drawer toggles at the top corners — obvious open affordance for each side panel. Each
              panel closes from its own header (dock PanelLeftClose / sidebar X); these re-open it. */}
          {(() => {
            const drawerBtn = isDarkMode ? 'bg-slate-900/85 border-white/10 text-slate-200 hover:bg-slate-800' : 'bg-white/90 border-white/80 text-slate-700 hover:bg-white';
            return (
              <>
                {!sceneIsFranka && !dockOpen && (
                  <button onClick={() => setDockOpen(true)} title="Show workspace dock" aria-label="Show workspace dock"
                    className={`absolute top-3 left-[4.25rem] z-40 w-9 h-9 rounded-xl glass-panel border shadow-lg grid place-items-center transition-colors ${drawerBtn}`}>
                    <PanelLeft className="w-[18px] h-[18px]" />
                  </button>
                )}
                {!showSidebar && (
                  <button onClick={() => setShowSidebar(true)} title="Show panel" aria-label="Show panel"
                    className={`absolute top-3 right-3 z-40 w-9 h-9 rounded-xl glass-panel border shadow-lg grid place-items-center transition-colors ${drawerBtn}`}>
                    <PanelRight className="w-[18px] h-[18px]" />
                  </button>
                )}
              </>
            );
          })()}
          {radial && (
            <RadialMenu
              x={radial.x} y={radial.y}
              items={radialItems(radial.kind)}
              onSelect={handleRadialSelect}
              onClose={() => setRadial(null)}
              isDarkMode={isDarkMode}
            />
          )}

          {/* Click-to-select transform inspector (OrcaSlicer-style: act on the selected object).
              Docks into the reasoning sidebar when it's open; floats bottom-centre when it's closed. */}
          {(() => {
            const inspectorEl = (inline: boolean) => (
              <SelectionInspector
                inline={inline}
                selection={selection}
                unit={lengthUnit}
                isDarkMode={isDarkMode}
                arm={(() => { const a = armInstances.find((x) => x.id === selectedArmId) ?? armInstances.find((x) => x.primary); return a ? { x: a.x, y: a.y, yaw: a.yaw } : null; })()}
                station={(() => {
                  if (selection?.stationId === 'primary') { const w = workcellConfig; return { x: w.originX ?? 0, y: w.originY ?? 0, yaw: w.yaw ?? 0, shapeSides: w.shapeSides, length: w.length, width: w.width }; }
                  const s = workcellConfig.stations?.find((x) => x.id === selection?.stationId); return s ? { x: s.x, y: s.y, yaw: s.yaw, shapeSides: s.shapeSides, length: s.length, width: s.width } : null;
                })()}
                onStation={(patch) => { if (selection?.stationId) handleStationChange(selection.stationId, patch); }}
                onCloneStation={() => { if (selection?.stationId === 'primary') handleAddStation(); else if (selection?.stationId) handleCloneStation(selection.stationId); }}
                wristMount={wristMount}
                onWristMount={setWristMount}
                onSaveWristMount={handleSaveWristMount}
                onResetWristMount={() => setWristMount(WRIST_FACTORY)}
                camera={{
                  enabled: cameraToggles.enabled, onEnabled: (v) => handleCameraToggle('enabled', v),
                  toggles: cameraToggles, onToggle: handleCameraToggle,
                  intrinsics, onIntrinsic: handleIntrinsic, onReset: handleResetIntrinsics,
                  streamProfiles: D435I_STREAM_PROFILES, selectedProfileId, onStreamProfile: handleStreamProfile,
                  wristEnabled: wristView, onWristToggle: setWristView,
                }}
                armReach={{
                  toggles: plannerToggles, onToggle: handlePlannerToggle,
                  canRemove: !(armInstances.find((a) => a.id === selectedArmId)?.primary),
                  onRemove: () => handleRemoveArm(selectedArmId),
                }}
                workcell={{ config: workcellConfig, onChange: handleWorkcellChange }}
                extraCamera={(() => { const c = workcellConfig.extraCameras?.find((x) => x.id === selection?.cameraId); return c ? { x: c.x, y: c.y, z: c.z } : null; })()}
                onExtraCamera={(patch) => { if (selection?.cameraId) handleExtraCameraChange(selection.cameraId, patch); }}
                prop={(() => { const pr = workcellConfig.props?.find((x) => x.id === selection?.propId); return pr ? { x: pr.x, y: pr.y, z: pr.z, yaw: pr.yaw, size: pr.size, color: pr.color } : null; })()}
                onProp={(patch) => { if (selection?.propId) handlePropChange(selection.propId, patch); }}
                onCloneProp={() => { if (selection?.propId) handleCloneProp(selection.propId); }}
                onRemoveProp={() => { if (selection?.propId) handleRemoveProp(selection.propId); }}
                cameraPos={cameraPos}
                post={{ x: workcellConfig.postX, y: workcellConfig.postY }}
                onArm={(patch) => { const a = armInstancesRef.current.find((x) => x.id === selectedArmId) ?? armInstancesRef.current.find((x) => x.primary); if (a) handleArmChange(a.id, patch); }}
                onCamera={handleCameraMove}
                onPost={(x, y) => handleWorkcellChange({ ...workcellConfigRef.current, postX: x, postY: y })}
                onObject={(bodyId, x, y, z) => simRef.current?.setTaskBodyPosition(bodyId, x, y, z)}
                onAimDown={handleCameraAimDown}
                onSnapToPost={handleSnapCameraToPost}
                onDeselect={() => simRef.current?.renderSys.selection?.deselect()}
                onFrame={handleFrameSelection}
                onSnapToRod={handleSnapToRod}
                onSnapToEdge={handleSnapArmToEdge}
                onSlideAlongRod={handleSlideAlongRod}
                rodLabel={rodSnap?.label ?? null}
                rodT={rodT}
              />
            );
            // Camera Feeds section content (toggles + the live PIP cards), shown at the top of the sidebar.
            const feedsEl = (
              <FeedsDock
                inline
                isDarkMode={isDarkMode}
                open onToggle={() => {}} reasoningOpen={showSidebar} onReasoning={() => {}} sidebarOpen={showSidebar}
                toggles={{
                  overhead: cameraToggles.sensorPip, onOverhead: (v) => handleCameraToggle('sensorPip', v),
                  wrist: wristView, onWrist: setWristView,
                  station: (workcellConfig.stations ?? []).length > 0 ? { on: stationView, onToggle: setStationView } : undefined,
                  extraCam: (workcellConfig.extraCameras ?? []).length > 0 ? { on: extraCamView, onToggle: setExtraCamView } : undefined,
                }}
                feedCount={(cameraToggles.sensorPip ? 1 : 0) + (wristView ? armInstances.length : 0) + (stationView ? (workcellConfig.stations ?? []).length : 0) + (extraCamView ? (workcellConfig.extraCameras ?? []).length : 0)}
              >
                {cameraToggles.sensorPip && (
                  <SensorView inline canvasHostRef={sensorViewRef} isDarkMode={isDarkMode} sidebarOpen={showSidebar} aspect={intrinsics.aspect} onClose={() => handleCameraToggle('sensorPip', false)}
                    compare={{ src: sceneStreamUrl, fallbackSrc: '/fallback-overhead.jpg', onSrc: updateSceneStream, on: sceneOverlayOn, onToggle: setSceneOverlayOn, opacity: overlayOpacity, onOpacity: setOverlayOpacity, blend: overlayBlend, onBlend: setOverlayBlend }}
                    depth={{ on: depthView, onToggle: setDepthView }} />
                )}
                {wristView && armInstances.map((arm) => (
                  <SensorView inline key={arm.id} canvasHostRef={wristRefCb(arm.id)} isDarkMode={isDarkMode} sidebarOpen={showSidebar} aspect={16 / 9} title={`Wrist Cam · ${arm.label}`} onClose={() => setWristView(false)}
                    compare={arm.primary ? { src: wristStreamUrl, fallbackSrc: '/fallback-wrist.jpg', onSrc: updateWristStream, on: wristOverlayOn, onToggle: setWristOverlayOn, opacity: overlayOpacity, onOpacity: setOverlayOpacity, blend: overlayBlend, onBlend: setOverlayBlend } : undefined} />
                ))}
                {stationView && (workcellConfig.stations ?? []).map((st, i) => (
                  <SensorView inline key={st.id} canvasHostRef={stationRefCb(st.id)} isDarkMode={isDarkMode} sidebarOpen={showSidebar} aspect={4 / 3} title={`Station ${i + 2} · overhead`} onClose={() => setStationView(false)} />
                ))}
                {extraCamView && (workcellConfig.extraCameras ?? []).map((c, i) => (
                  <SensorView inline key={c.id} canvasHostRef={extraCamRefCb(c.id)} isDarkMode={isDarkMode} sidebarOpen={showSidebar} aspect={4 / 3} title={`Overhead D435i ${i + 2}`} onClose={() => setExtraCamView(false)} />
                ))}
              </FeedsDock>
            );
            // Controls section: the toolbar (incl. Jog + Measure toggles) plus their contextual
            // extras — jog hint / save-rest-pose, and the live measurements list — surfaced inline.
            const toolbarEl = (
              <div className="space-y-2">
                <Toolbar inline isPaused={isPaused} togglePause={() => setIsPaused(simRef.current?.togglePause() ?? false)} onReset={handleReset}
                  showSidebar={showSidebar} toggleSidebar={() => setShowSidebar(!showSidebar)} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}
                  onResetView={handleResetView} onFrameSelection={handleFrameSelection} tweaksOpen={tweaksOpen} onToggleTweaks={() => setTweaksOpen((v) => !v)}
                  jogActive={poseMode} onToggleJog={togglePoseMode}
                  measureActive={measureActive} onToggleMeasure={() => handleMeasureActive(!measureActive)} />
                {poseMode && (
                  <div className="flex flex-wrap items-center gap-2 px-0.5">
                    <span className="text-[10px] font-mono whitespace-nowrap">{hoveredJoint ? <>Joint: <span className="text-indigo-500 font-bold">{hoveredJoint}</span></> : 'Hover a link, drag to rotate'}</span>
                    <button onClick={handleSaveRestPose} title="Record the current jogged pose as the SO-101's default rest pose (persists across reloads)"
                      className={`ml-auto px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wide border transition-colors ${restSaved ? 'bg-emerald-600 text-white border-emerald-500' : isDarkMode ? 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10' : 'bg-black/5 border-black/10 text-slate-700 hover:bg-black/10'}`}>
                      {restSaved ? '✓ Saved as default' : 'Save as rest pose'}
                    </button>
                  </div>
                )}
                {measureActive && (
                  <div className="space-y-1 px-0.5">
                    {measurements.length === 0
                      ? <p className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Click two objects or points. Shift-click = free point.</p>
                      : measurements.map((m) => (
                        <div key={m.id} className={`rounded-lg px-2 py-1 text-[10px] tabular-nums flex items-center justify-between ${isDarkMode ? 'bg-slate-950/50' : 'bg-black/5'}`}>
                          <div>
                            <div className="font-bold">{m.label}: {lengthUnit === 'mm' ? Math.round(m.distance * 1000) : m.distance.toFixed(2)} {lengthUnit}</div>
                            <div className={isDarkMode ? 'text-slate-400' : 'text-slate-500'}>Δ {lengthUnit === 'mm' ? Math.round(m.dx * 1000) : m.dx.toFixed(2)}, {lengthUnit === 'mm' ? Math.round(m.dy * 1000) : m.dy.toFixed(2)}, {lengthUnit === 'mm' ? Math.round(m.dz * 1000) : m.dz.toFixed(2)} {lengthUnit}</div>
                          </div>
                          <button onClick={() => simRef.current?.renderSys.measureTool?.remove(m.id)} className={isDarkMode ? 'text-slate-400' : 'text-slate-500'}>✕</button>
                        </div>
                      ))}
                    {measurements.length > 0 && <button onClick={() => simRef.current?.renderSys.measureTool?.clear()} className={`w-full py-1 rounded-lg text-[9px] font-bold uppercase tracking-wide ${isDarkMode ? 'bg-white/5 text-slate-300' : 'bg-black/5 text-slate-600'}`}>Clear all</button>}
                  </div>
                )}
              </div>
            );
            const overlaysEl = <OverlayLegend inline camera={cameraToggles} planner={plannerToggles} isDarkMode={isDarkMode} dockOpen={dockOpen} />;
            return (
              <>
                <UnifiedSidebar
                  isOpen={showSidebar}
                  onClose={() => setShowSidebar(false)}
                  onSend={handleErSend}
                  onPickup={handlePickup}
                  isLoading={erLoading}
                  hasDetectedItems={detectedCount > 0}
                  logs={logs}
                  onOpenLog={(log) => setExpandedLogId(log.id)}
                  isDarkMode={isDarkMode}
                  isPickingUp={isPickingUp}
                  playbackSpeed={playbackSpeed}
                  geminiEnabled={Boolean(GEMINI_API_KEY)}
                  inspector={selection ? inspectorEl(true) : null}
                  headerContent={!sceneIsFranka ? (
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[9px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Units</span>
                      <div className="flex items-center gap-1" title="Display units for all length readouts">
                        {(['m', 'mm'] as const).map((u) => (
                          <button key={u} onClick={() => setLengthUnit(u)} className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${lengthUnit === u ? (isDarkMode ? 'bg-indigo-500/30 text-indigo-200' : 'bg-indigo-600 text-white') : (isDarkMode ? 'text-slate-400' : 'text-slate-500')}`}>{u}</button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  feeds={!sceneIsFranka ? feedsEl : null}
                  toolbar={toolbarEl}
                  overlays={!sceneIsFranka ? overlaysEl : null}
                />
                {selection && !showSidebar && inspectorEl(false)}
              </>
            );
          })()}

          {/* Consolidated object-centric control dock (SO-101 twin) */}
          {!sceneIsFranka && dockOpen && mode === 'edit' && (
            <WorkspaceDock
              isDarkMode={isDarkMode}
              onSaveWorkspace={() => setLayoutsOpen(true)}
              onClose={() => setDockOpen(false)}
              templates={{ profiles, onLoad: handleLoadProfile, onSave: handleSaveProfile }}
              objects={{ entities: objectEntities, selectedKey, onSelect: handleTreeSelect, hidden: hiddenKeys, onToggleVisible: toggleVisible }}
              scene={{
                unit: lengthUnit,
                onUnit: setLengthUnit,
                axesVisible,
                onAxesToggle: (v) => { setAxesVisible(v); simRef.current?.renderSys.setAxesVisible(v); },
                cameraPos,
              }}
              workcell={{ config: workcellConfig, onChange: handleWorkcellChange, onAddStation: handleAddStation, onRemoveStation: handleRemoveStation, onCloneStation: handleCloneStation, onAddExtraCamera: handleAddExtraCamera, onRemoveExtraCamera: handleRemoveExtraCamera }}
              arms={{
                list: armInstances,
                selectedId: selectedArmId,
                onSelect: setSelectedArmId,
                onChange: handleArmChange,
                onAdd: handleAddArm,
                onAddProp: handleAddProp,
                onRemove: handleRemoveArm,
                onApplyPose: handleApplyArmPose,
                toggles: plannerToggles,
                onToggle: handlePlannerToggle,
                resolution: reachResolution,
                onResolution: setReachResolution,
                onRecompute: handleRecompute,
                computing: computingReach,
                baseResult,
                onSuggestLayout: handleSuggestLayout,
                layoutResult,
              }}
            />
          )}

          {/* Expanded View Modal - Overlay everything */}
          {activeLog && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center min-[660px]:p-10 bg-slate-950/20 backdrop-blur-xl animate-in fade-in" onClick={() => setExpandedLogId(null)}>
              <div className={`glass-panel overflow-hidden flex flex-col shadow-2xl transition-colors fixed top-4 bottom-4 left-4 right-4 rounded-[2.5rem] min-[660px]:relative min-[660px]:inset-auto min-[660px]:w-full min-[660px]:max-w-4xl min-[660px]:max-h-[85vh] ${isDarkMode ? 'bg-slate-900 border-white/10 text-slate-100' : 'bg-white border-white/80 text-slate-800'}`} onClick={e => e.stopPropagation()}>
                 <div className={`p-6 border-b flex justify-between items-center shrink-0 ${isDarkMode ? 'border-white/5 bg-white/5' : 'border-slate-100 bg-white/40'}`}>
                    <div>
                      <h3 className="text-xl font-bold">API Call</h3>
                      <p className={`text-xs font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{activeLog.timestamp.toLocaleString()}</p>
                    </div>
                    <button onClick={() => setExpandedLogId(null)} className={`w-10 h-10 flex items-center justify-center rounded-full shadow-sm border transition-colors ${isDarkMode ? 'bg-slate-800 border-white/10 text-slate-400 hover:text-slate-200' : 'bg-white border-slate-100 text-slate-400 hover:text-slate-600'}`}>
                      <X className="w-5 h-5" />
                    </button>
                 </div>
                 <div className="flex-1 flex max-[659px]:flex-col max-[659px]:overflow-y-auto custom-scrollbar min-[660px]:flex-row min-[660px]:overflow-hidden">
                    <div className={`flex items-center justify-center border-b min-[660px]:border-b-0 min-[660px]:border-r min-[660px]:flex-1 min-[660px]:p-6 min-[660px]:overflow-hidden max-[659px]:shrink-0 max-[659px]:p-6 ${isDarkMode ? 'bg-slate-950/50 border-white/5' : 'bg-slate-50/30 border-slate-100'}`}>
                       <div className={`relative rounded-2xl overflow-hidden shadow-lg border-2 flex items-center justify-center min-[660px]:w-auto min-[660px]:h-auto min-[660px]:max-w-full min-[660px]:max-h-full max-[659px]:w-full max-[659px]:h-auto ${isDarkMode ? 'border-white/10 bg-black/20' : 'border-white bg-black/5'}`}>
                          <img src={activeLog.imageSrc} className={`block w-full h-auto min-[660px]:max-w-full min-[660px]:max-h-full`} alt="Detailed log" />
                          <LogOverlay log={activeLog} />
                       </div>
                    </div>
                    <div className={`min-[660px]:w-[320px] p-6 flex flex-col gap-5 min-[660px]:overflow-y-auto min-[660px]:custom-scrollbar ${isDarkMode ? 'bg-white/5' : 'bg-white/20'}`}>
                       <div className="space-y-1">
                          <h4 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">User Prompt</h4>
                          <p className="text-sm font-bold leading-tight">{activeLog.prompt}</p>
                       </div>
                       <div className="space-y-1">
                          <h4 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Full Prompt</h4>
                          <p className={`text-[10px] font-mono p-3 rounded-xl leading-relaxed border whitespace-pre-wrap ${isDarkMode ? 'bg-slate-950 border-white/5 text-slate-400' : 'bg-slate-50 border-slate-200/50 text-slate-500'}`}>{activeLog.fullPrompt}</p>
                       </div>
                       <div className="space-y-3 flex flex-col min-[660px]:flex-1 min-[660px]:min-h-0">
                          <h4 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">API Call Results</h4>
                          <div className={`p-3 rounded-xl font-mono text-[10px] border overflow-y-auto shadow-inner min-[660px]:flex-1 max-[659px]:h-96 ${isDarkMode ? 'bg-slate-950 border-white/5 text-indigo-400' : 'bg-slate-50/50 border-slate-100 text-indigo-600'}`}>
                            {activeLog.result === null ? (
                                <div className="h-full flex flex-col items-center justify-center gap-3 text-indigo-400 animate-pulse">
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                    <span className="font-sans font-bold text-[8px] uppercase tracking-widest">Processing...</span>
                                </div>
                            ) : (
                                <pre className="whitespace-pre-wrap break-all leading-relaxed">{JSON.stringify(activeLog.result, null, 2)}</pre>
                            )}
                          </div>
                       </div>
                       <div className="min-[660px]:hidden h-8 shrink-0" />
                    </div>
                 </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
