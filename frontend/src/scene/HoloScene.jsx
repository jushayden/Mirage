import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const _targetVec = new THREE.Vector3();
const _scaleVec = new THREE.Vector3();

// 3D cursor that follows the index finger
function HandCursor({ gestureRef }) {
  const ref = useRef();
  const ringRef = useRef();

  useFrame((_, delta) => {
    if (!ref.current) return;
    const data = gestureRef.current?.[0];
    const visible = !!data?.cursorPosition;
    ref.current.visible = visible;
    if (!visible) return;

    _targetVec.set(
      (data.cursorPosition.x - 0.5) * 6,
      -(data.cursorPosition.y - 0.5) * 4,
      0.5
    );
    ref.current.position.lerp(_targetVec, 0.25);

    const pinch = data.pinchAmount || 0;
    const s = 0.08 + pinch * 0.06;
    _scaleVec.set(s, s, s);
    ref.current.scale.lerp(_scaleVec, 0.2);

    if (ringRef.current) ringRef.current.rotation.z += delta * 1.5;
  });

  return (
    <group ref={ref} visible={false}>
      <mesh>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
      </mesh>
      <mesh ref={ringRef}>
        <torusGeometry args={[2.2, 0.1, 6, 24]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

// Static holographic cube — no auto-rotation, responds to gestures
function HoloCube({ gestureRef }) {
  const groupRef = useRef();
  const matRef = useRef();
  const targetPos = useRef(new THREE.Vector3(0, 0, 0));
  const grabbed = useRef(false);
  const dismissed = useRef(false);
  const dismissVel = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const data = gestureRef.current?.[0];
    const action = data?.action;

    if (action === "grab" && !dismissed.current) {
      grabbed.current = true;
      targetPos.current.set(
        (data.palmPosition.x - 0.5) * 6,
        -(data.palmPosition.y - 0.5) * 4,
        0
      );
    } else if (action === "drag" && !dismissed.current) {
      grabbed.current = true;
      targetPos.current.set(
        (data.cursorPosition.x - 0.5) * 6,
        -(data.cursorPosition.y - 0.5) * 4,
        0
      );
    } else if (action === "dismiss" && grabbed.current) {
      dismissed.current = true;
      dismissVel.current.set(
        (Math.random() - 0.5) * 8,
        3 + Math.random() * 4,
        -5
      );
      grabbed.current = false;
    } else {
      grabbed.current = false;
    }

    if (dismissed.current) {
      groupRef.current.position.add(dismissVel.current.clone().multiplyScalar(delta));
      dismissVel.current.y -= delta * 8;
      groupRef.current.rotation.x += delta * 3;
      groupRef.current.rotation.z += delta * 2;
      if (matRef.current) matRef.current.opacity -= delta * 0.5;

      if (groupRef.current.position.y < -8 || (matRef.current && matRef.current.opacity <= 0)) {
        dismissed.current = false;
        groupRef.current.position.set(0, 0, 0);
        groupRef.current.rotation.set(0, 0, 0);
        if (matRef.current) matRef.current.opacity = 0.6;
        targetPos.current.set(0, 0, 0);
      }
      return;
    }

    // No auto-rotation — cube stays still when idle
    if (!grabbed.current) {
      targetPos.current.set(0, 0, 0);
    }

    groupRef.current.position.lerp(targetPos.current, grabbed.current ? 0.12 : 0.04);

    const s = grabbed.current ? 1.1 : 1;
    _scaleVec.set(s, s, s);
    groupRef.current.scale.lerp(_scaleVec, 0.08);
  });

  const edgesGeo = useMemo(() => {
    return new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  }, []);

  return (
    <group ref={groupRef}>
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.04} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edgesGeo}>
        <lineBasicMaterial ref={matRef} color="#ffffff" transparent opacity={0.6} />
      </lineSegments>
    </group>
  );
}

// Grid floor — static, no useFrame needed
function HoloGrid() {
  return (
    <group position={[0, -2, 0]}>
      <gridHelper args={[20, 40, "#222222", "#141414"]} />
    </group>
  );
}

// Floating particles — very light animation
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
      <pointsMaterial color="#ffffff" size={0.025} transparent opacity={0.2} sizeAttenuation />
    </points>
  );
}

export function HoloScene({ gestureRef }) {
  return (
    <>
      <HoloGrid />
      <HoloParticles />
      <HoloCube gestureRef={gestureRef} />
      <HandCursor gestureRef={gestureRef} />
    </>
  );
}
