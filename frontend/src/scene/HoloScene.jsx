import { useRef, useMemo, createContext, useContext } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { playPinch, playRelease, playHover, playDismiss, playRespawn } from "../audio";

const _tv = new THREE.Vector3();
const _sv = new THREE.Vector3();

// Shared grab state — tracks which hand is grabbing which object
// Map: handIndex -> groupRef (or null)
const GrabContext = createContext(null);

function useGrabLock() {
  return useContext(GrabContext);
}

// 3D cursor — one per hand
function HandCursor({ gestureRef, handIndex = 0, color = "#aaddff", ringColor = "#88ccff" }) {
  const ref = useRef();
  const ringRef = useRef();
  const fadeTimer = useRef(0);
  const lastPos = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    if (!ref.current) return;
    const data = gestureRef.current?.[handIndex];
    const hasData = !!data?.cursorPosition;

    if (hasData) {
      fadeTimer.current = 0.3; // hold visible for 300ms after losing tracking
      lastPos.current.set(
        (data.cursorPosition.x - 0.5) * 6,
        -(data.cursorPosition.y - 0.5) * 4,
        0.5
      );
    } else {
      fadeTimer.current -= delta;
    }

    const visible = fadeTimer.current > 0;
    ref.current.visible = visible;
    if (!visible) return;

    ref.current.position.lerp(lastPos.current, 0.25);

    const pinch = data?.pinchAmount || 0;
    const s = 0.08 + pinch * 0.06;
    _sv.set(s, s, s);
    ref.current.scale.lerp(_sv, 0.2);

    // Fade opacity when losing tracking
    const opacity = Math.min(1, fadeTimer.current / 0.15);
    ref.current.children[0].material.opacity = 0.9 * opacity;
    ref.current.children[1].material.opacity = 0.35 * opacity;

    if (ringRef.current) ringRef.current.rotation.z += delta * 1.5;
  });

  return (
    <group ref={ref} visible={false}>
      <mesh>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      <mesh ref={ringRef}>
        <torusGeometry args={[2.2, 0.1, 6, 24]} />
        <meshBasicMaterial color={ringColor} transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

// Generic interactive holographic object
function HoloObject({ gestureRef, startPos, shape, size = 0.7 }) {
  const groupRef = useRef();
  const edgeMatRef = useRef();
  const faceMatRef = useRef();
  const glowRef = useRef();
  const grabLock = useGrabLock();

  const objPos = useRef(new THREE.Vector3(...startPos));
  const homePos = useRef(new THREE.Vector3(...startPos));
  const grabbed = useRef(false);
  const grabbedByHand = useRef(-1);
  const grabOffset = useRef(new THREE.Vector3());
  const hovering = useRef(false);
  const wasHovering = useRef(false);
  const dismissed = useRef(false);
  const dismissVel = useRef(new THREE.Vector3());
  const lastPinching = useRef([false, false]);
  const dismissCooldown = useRef(false);

  const GRAB_RADIUS = size + 1;

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const hands = gestureRef.current || [];
    const locks = grabLock.current;

    // If already grabbed, stick with that hand
    if (grabbed.current) {
      const hi = grabbedByHand.current;
      const data = hands[hi];
      const pinch = data?.pinchAmount || 0;
      const isPinching = pinch > 0.6;
      const wasPinching = lastPinching.current[hi] || false;
      lastPinching.current[hi] = isPinching;

      const cursorPos = data?.cursorPosition
        ? new THREE.Vector3(
            (data.cursorPosition.x - 0.5) * 6,
            -(data.cursorPosition.y - 0.5) * 4, 0)
        : null;

      // Release
      if (!isPinching && wasPinching) {
        grabbed.current = false;
        locks[hi] = null;
        grabbedByHand.current = -1;
        playRelease();
      }

      // Drag
      if (grabbed.current && cursorPos) {
        objPos.current.copy(cursorPos).add(grabOffset.current);
      }
    } else {
      // Find closest available hand (not locked to another object)
      let closestHand = null;
      let closestDist = Infinity;
      let closestCursor = null;

      for (let i = 0; i < hands.length; i++) {
        const h = hands[i];
        if (!h?.cursorPosition) continue;
        if (locks[i] && locks[i] !== groupRef.current) continue; // hand is grabbing something else
        const cp = new THREE.Vector3(
          (h.cursorPosition.x - 0.5) * 6,
          -(h.cursorPosition.y - 0.5) * 4, 0
        );
        const d = cp.distanceTo(objPos.current);
        if (d < closestDist) {
          closestDist = d;
          closestHand = i;
          closestCursor = cp;
        }
      }

      hovering.current = !dismissed.current && closestDist < GRAB_RADIUS;

      if (closestHand !== null && hovering.current && !dismissed.current) {
        const data = hands[closestHand];
        const pinch = data?.pinchAmount || 0;
        const isPinching = pinch > 0.6;
        const wasPinching = lastPinching.current[closestHand] || false;
        lastPinching.current[closestHand] = isPinching;

        if (isPinching && !wasPinching) {
          grabbed.current = true;
          grabbedByHand.current = closestHand;
          locks[closestHand] = groupRef.current;
          grabOffset.current.copy(objPos.current).sub(closestCursor);
          playPinch();
        }
      }
    }

    // --- DISMISS ---
    let anyDismiss = false;
    for (const h of hands) {
      if (h?.action === "dismiss") { anyDismiss = true; break; }
    }

    if (!anyDismiss && dismissCooldown.current) {
      dismissCooldown.current = false;
      if (dismissed.current) {
        dismissed.current = false;
        objPos.current.copy(homePos.current);
        groupRef.current.rotation.set(0, 0, 0);
        groupRef.current.visible = true;
        if (edgeMatRef.current) edgeMatRef.current.opacity = 0.6;
        if (faceMatRef.current) faceMatRef.current.opacity = 0.04;
        playRespawn();
      }
    }

    if (anyDismiss && !dismissCooldown.current
        && (hovering.current || grabbed.current) && !dismissed.current) {
      dismissed.current = true;
      dismissCooldown.current = true;
      playDismiss();
      if (grabbed.current && grabbedByHand.current >= 0) {
        locks[grabbedByHand.current] = null;
      }
      grabbed.current = false;
      grabbedByHand.current = -1;
      const dir = objPos.current.clone().normalize();
      dismissVel.current.set(
        dir.x * 5 + (Math.random() - 0.5) * 3,
        3 + Math.random() * 3,
        -6
      );
    }

    // --- DISMISS ANIMATION ---
    if (dismissed.current) {
      objPos.current.add(dismissVel.current.clone().multiplyScalar(delta));
      dismissVel.current.y -= delta * 10;
      groupRef.current.rotation.x += delta * 4;
      groupRef.current.rotation.z += delta * 3;
      if (edgeMatRef.current) edgeMatRef.current.opacity -= delta * 0.8;
      if (faceMatRef.current) faceMatRef.current.opacity -= delta * 0.3;

      if (objPos.current.y < -10 || (edgeMatRef.current && edgeMatRef.current.opacity <= 0)) {
        groupRef.current.visible = false;
      }

      groupRef.current.position.copy(objPos.current);
      return;
    }

    // --- HOVER SOUND ---
    if (hovering.current && !wasHovering.current) playHover();
    wasHovering.current = hovering.current;

    // --- POSITION ---
    groupRef.current.position.lerp(objPos.current, grabbed.current ? 0.3 : 0.08);

    // --- SCALE ---
    const ts = grabbed.current ? 1.15 : hovering.current ? 1.08 : 1;
    _sv.set(ts, ts, ts);
    groupRef.current.scale.lerp(_sv, 0.1);

    // --- VISUAL FEEDBACK ---
    if (edgeMatRef.current) {
      const to = grabbed.current ? 1 : hovering.current ? 0.85 : 0.6;
      edgeMatRef.current.opacity += (to - edgeMatRef.current.opacity) * 0.1;
    }
    if (faceMatRef.current) {
      const tf = grabbed.current ? 0.12 : hovering.current ? 0.08 : 0.04;
      faceMatRef.current.opacity += (tf - faceMatRef.current.opacity) * 0.1;
    }
    if (glowRef.current) {
      const gt = grabbed.current ? 0.3 : hovering.current ? 0.15 : 0;
      glowRef.current.material.opacity += (gt - glowRef.current.material.opacity) * 0.08;
      glowRef.current.visible = glowRef.current.material.opacity > 0.01;
    }
  });

  const { solidGeo, edgesGeo, glowGeo } = useMemo(() => {
    let geo;
    switch (shape) {
      case "sphere":
        geo = new THREE.IcosahedronGeometry(size, 1);
        break;
      case "pyramid":
        geo = new THREE.ConeGeometry(size, size * 1.4, 4);
        break;
      case "torus":
        geo = new THREE.TorusGeometry(size * 0.7, size * 0.25, 8, 16);
        break;
      case "octahedron":
        geo = new THREE.OctahedronGeometry(size);
        break;
      case "diamond":
        geo = new THREE.OctahedronGeometry(size, 0);
        break;
      default: // cube
        geo = new THREE.BoxGeometry(size, size, size);
    }
    return {
      solidGeo: geo,
      edgesGeo: new THREE.EdgesGeometry(geo),
      glowGeo: new THREE.SphereGeometry(size * 1.1, 12, 12),
    };
  }, [shape, size]);

  return (
    <group ref={groupRef} position={startPos}>
      <mesh ref={glowRef} visible={false}>
        <primitive object={glowGeo} />
        <meshBasicMaterial color="#88ccff" transparent opacity={0} side={THREE.BackSide} />
      </mesh>
      <mesh>
        <primitive object={solidGeo} />
        <meshBasicMaterial ref={faceMatRef} color="#aaddff" transparent opacity={0.04} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edgesGeo}>
        <lineBasicMaterial ref={edgeMatRef} color="#ccefff" transparent opacity={0.6} />
      </lineSegments>
    </group>
  );
}

// Grid floor
function HoloGrid() {
  return (
    <group position={[0, -2, 0]}>
      <gridHelper args={[20, 40, "#1a3344", "#0d1a22"]} />
    </group>
  );
}

// Floating particles
function HoloParticles() {
  const ref = useRef();
  const count = 100;

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 6 - 2;
    }
    return pos;
  }, []);

  useFrame((state) => {
    if (!ref.current) return;
    const arr = ref.current.geometry.attributes.position.array;
    const t = state.clock.elapsedTime * 0.3;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += Math.sin(t + i * 0.5) * 0.0003;
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial color="#88ccff" size={0.025} transparent opacity={0.25} sizeAttenuation />
    </points>
  );
}

// Scene layout
const OBJECTS = [
  { shape: "cube",       pos: [0, 0, 0],      size: 0.6 },
  { shape: "sphere",     pos: [-2.2, 0.8, -1], size: 0.5 },
  { shape: "pyramid",    pos: [2.2, 0.5, -1],  size: 0.5 },
  { shape: "diamond",    pos: [-1.5, -0.8, -0.5], size: 0.45 },
  { shape: "torus",      pos: [1.5, -0.7, -0.5],  size: 0.5 },
];

export function HoloScene({ gestureRef }) {
  const grabLock = useRef([null, null]); // per-hand: which object each hand is grabbing

  return (
    <GrabContext.Provider value={grabLock}>
      <HoloGrid />
      <HoloParticles />
      {OBJECTS.map((obj, i) => (
        <HoloObject
          key={i}
          gestureRef={gestureRef}
          startPos={obj.pos}
          shape={obj.shape}
          size={obj.size}
        />
      ))}
      <HandCursor gestureRef={gestureRef} handIndex={0} color="#aaddff" ringColor="#88ccff" />
      <HandCursor gestureRef={gestureRef} handIndex={1} color="#ffaa88" ringColor="#ff8866" />
    </GrabContext.Provider>
  );
}
