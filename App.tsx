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
import { Toolbar } from './components/Toolbar';
import { UnifiedSidebar } from './components/UnifiedSidebar';
import { ArmInstance, CameraIntrinsics, CameraViewToggles, D435I_DEFAULT_PROFILE_ID, D435I_PRESET, D435I_STREAM_PROFILES, DEFAULT_CAMERA_TOGGLES, DEFAULT_WORKCELL_CONFIG, DetectedItem, DetectType, LengthUnit, LogEntry, MujocoModule, WorkcellConfig } from './types';
import type { SelectionInfo } from './SelectionController';
import { SelectionInspector } from './components/SelectionInspector';
import { PlannerToggles } from './WorkspacePlanner';

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
  // Initialize sidebar based on screen width (hidden on mobile by default)
  const [showSidebar, setShowSidebar] = useState(() => window.innerWidth >= 660); 
  const [isDarkMode, setIsDarkMode] = useState(false);
  
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
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>('m');
  const [axesVisible, setAxesVisible] = useState(true);
  const [cameraPos, setCameraPos] = useState<{ x: number; y: number; z: number } | null>(null);
  const [measureActive, setMeasureActive] = useState(false);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  // --- Sensor-camera planner state ---
  const [cameraToggles, setCameraToggles] = useState<CameraViewToggles>({ ...DEFAULT_CAMERA_TOGGLES });
  const [intrinsics, setIntrinsics] = useState<CameraIntrinsics>({ ...D435I_PRESET });
  const [selectedProfileId, setSelectedProfileId] = useState(D435I_DEFAULT_PROFILE_ID);
  const [dragMode, setDragMode] = useState<'translate' | 'rotate'>('translate');
  const sensorViewRef = useRef<HTMLDivElement>(null);
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
    if (cameraToggles.sensorPip && sensorViewRef.current) {
      r.attachPip(sensorViewRef.current);
    }
    return () => { rig()?.detachPip(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, cameraToggles.sensorPip]);

  // Wrist camera: a gripper-mounted feed (tracks the arm). Toggle attaches its own PIP.
  const [wristView, setWristView] = useState(false);
  const wristViewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wc = simRef.current?.renderSys.wristCamera;
    if (isLoading || !wc) return;
    wc.enabled = wristView;
    if (wristView && wristViewRef.current) wc.attachPip(wristViewRef.current);
    return () => { simRef.current?.renderSys.wristCamera?.detachPip(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, wristView]);

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

  // Type exact camera coordinates (origin = table centre) to replicate the real rig.
  const handleCameraMove = (x: number, y: number, z: number) => {
    rig()?.setPosition(x, y, z);
    setCameraPos({ x, y, z });
  };
  const handleCameraAimDown = () => rig()?.aimDown();

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
      // Clicking the (physics) arm in the viewport targets the primary arm in the inspector.
      if (s?.kind === 'arm') setSelectedArmId(armInstancesRef.current.find((a) => a.primary)?.id ?? 'so101-1');
    };
    sel.onPostMove = (x, y) => handleWorkcellChange({ ...workcellConfigRef.current, postX: x, postY: y });
    setTaskBodies(simRef.current?.getTaskBodies() ?? []); // populate the object tree
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Object-tree entities (arm + camera + post + task blocks) and the currently-selected key.
  const objectEntities = (() => {
    const list: { key: string; kind: 'arm' | 'camera' | 'post' | 'object'; label: string; bodyId?: number; armId?: string }[] = [];
    armInstances.forEach((a) => list.push({ key: `arm:${a.id}`, kind: 'arm', label: a.label, armId: a.id }));
    list.push({ key: 'camera', kind: 'camera', label: 'D435i camera' });
    list.push({ key: 'post', kind: 'post', label: 'Camera post' });
    taskBodies.forEach((b) => list.push({ key: `obj:${b.bodyId}`, kind: 'object', label: b.name, bodyId: b.bodyId }));
    return list;
  })();
  const primaryArmId = armInstances.find((a) => a.primary)?.id ?? 'so101-1';
  const selectedKey = !selection ? null
    : selection.kind === 'object' ? `obj:${selection.bodyId}`
    : selection.kind === 'arm' ? `arm:${selectedArmId}` // the arm the inspector is editing
    : selection.kind; // 'camera' | 'post'
  const handleTreeSelect = (e: { kind: 'arm' | 'camera' | 'post' | 'object'; bodyId?: number; armId?: string }) => {
    const sel = simRef.current?.renderSys.selection;
    if (!sel) return;
    // selectByKind fires onChange (which resets selectedArmId→primary), so set the tree's arm LAST.
    if (e.kind === 'arm') { sel.selectByKind('arm', e.armId); if (e.armId) setSelectedArmId(e.armId); }
    else if (e.kind === 'object' && e.bodyId !== undefined) sel.selectObjectByBodyId(e.bodyId);
    else if (e.kind !== 'object') sel.selectByKind(e.kind);
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
      sim.relocateBase(changed.x, changed.y, changed.yaw).then(() => applyPlannerState()); // live, instant
    }
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
          const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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

          let result;
          try { result = JSON.parse(jsonText); } catch (e) { result = []; }

          // Remove absolute duplicates
          if (Array.isArray(result)) {
              const seen = new Set();
              result = result.filter((item: unknown) => {
                  const serialized = JSON.stringify(item);
                  if (seen.has(serialized)) return false;
                  seen.add(serialized);
                  return true;
              });
          }

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
      <div ref={containerRef} className="w-full h-full absolute inset-0 bg-slate-200" />
      
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
          <Toolbar 
            isPaused={isPaused} 
            togglePause={() => setIsPaused(simRef.current?.togglePause() ?? false)} 
            onReset={handleReset} 
            showSidebar={showSidebar}
            toggleSidebar={() => setShowSidebar(!showSidebar)}
            isDarkMode={isDarkMode}
            toggleDarkMode={toggleDarkMode}
            onResetView={handleResetView}
            onFrameSelection={handleFrameSelection}
          />
          
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
          />

          {/* Click-to-select transform inspector (OrcaSlicer-style: act on the selected object). */}
          <SelectionInspector
            selection={selection}
            unit={lengthUnit}
            isDarkMode={isDarkMode}
            arm={(() => { const a = armInstances.find((x) => x.id === selectedArmId) ?? armInstances.find((x) => x.primary); return a ? { x: a.x, y: a.y, yaw: a.yaw } : null; })()}
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
          />

          {/* Explicit launcher to REOPEN the Embodied Reasoning panel once it's closed. */}
          {!showSidebar && (
            <button
              onClick={() => setShowSidebar(true)}
              title="Open Embodied Reasoning"
              className={`absolute top-6 right-0 z-30 flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-l-2xl glass-panel shadow-xl text-[11px] font-bold uppercase tracking-widest transition-transform hover:-translate-x-0.5 ${isDarkMode ? 'bg-slate-900/80 border-white/10 text-slate-100' : 'bg-white/80 border-white/80 text-slate-800'}`}
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" /> Reasoning
            </button>
          )}

          {cameraToggles.sensorPip && (
            <SensorView
              canvasHostRef={sensorViewRef}
              isDarkMode={isDarkMode}
              sidebarOpen={showSidebar}
              aspect={intrinsics.aspect}
              onClose={() => handleCameraToggle('sensorPip', false)}
            />
          )}

          {wristView && (
            <SensorView
              canvasHostRef={wristViewRef}
              isDarkMode={isDarkMode}
              sidebarOpen={showSidebar}
              aspect={16 / 9}
              title="Wrist Cam · HBVCAM"
              secondary={cameraToggles.sensorPip}
              onClose={() => setWristView(false)}
            />
          )}

          {/* Consolidated object-centric control dock (SO-101 twin) */}
          {!sceneIsFranka && (
            <WorkspaceDock
              isDarkMode={isDarkMode}
              objects={{ entities: objectEntities, selectedKey, onSelect: handleTreeSelect }}
              scene={{
                unit: lengthUnit,
                onUnit: setLengthUnit,
                axesVisible,
                onAxesToggle: (v) => { setAxesVisible(v); simRef.current?.renderSys.setAxesVisible(v); },
                cameraPos,
              }}
              workcell={{ config: workcellConfig, onChange: handleWorkcellChange }}
              arms={{
                list: armInstances,
                selectedId: selectedArmId,
                onSelect: setSelectedArmId,
                onChange: handleArmChange,
                onAdd: handleAddArm,
                onRemove: handleRemoveArm,
                onApplyPose: handleApplyArmPose,
                toggles: plannerToggles,
                onToggle: handlePlannerToggle,
                resolution: reachResolution,
                onResolution: setReachResolution,
                onRecompute: handleRecompute,
                computing: computingReach,
                baseResult,
              }}
              camera={{
                toggles: cameraToggles,
                onToggle: handleCameraToggle,
                intrinsics,
                onIntrinsic: handleIntrinsic,
                onReset: handleResetIntrinsics,
                streamProfiles: D435I_STREAM_PROFILES,
                selectedProfileId,
                onStreamProfile: handleStreamProfile,
                dragMode,
                onDragMode: handleDragMode,
                onComputeCoverage: handleComputeCoverage,
                pos: cameraPos,
                onMove: handleCameraMove,
                onAimDown: handleCameraAimDown,
                onSnapToPost: handleSnapCameraToPost,
                wristEnabled: wristView,
                onWristToggle: setWristView,
              }}
              measure={{
                active: measureActive,
                onToggleActive: handleMeasureActive,
                unit: lengthUnit,
                measurements,
                onClear: () => simRef.current?.renderSys.measureTool?.clear(),
                onRemove: (id) => simRef.current?.renderSys.measureTool?.remove(id),
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
