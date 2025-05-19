import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.175.0/build/three.module.js';

// 0. 변수 정의
// WebXR 변수
let xrSession = null;
let xrReferenceSpace = null;
let renderer = null;
let scene = null;
let cubesAdded = [false, false, false, false];
let latestXRFrame = null;
let latestViewerPose = null;
let markerBases = [];

// 좌표 변환 변수
let nodes = [];
let markers = [];
let transformedNodes = [];

// 걸음 수 측정 변수
let stepCount = 0;
let lastPeakTime = 0;
let accBuffer = [];
const stepLength = 0.7; // 평균 보폭 (단위: m)


// 1. 좌표 변환 (마커 정보를 이용해 json 노드 객체들의 좌표를 변환)
function transformPosition(pos, marker) {
    const dx = pos[0] - marker.position[0];
    const dy = pos[1] - marker.position[1];
    const dz = pos[2];
    const rad = marker.orientation[0];
    const rotatedY = dy * Math.cos(rad) - dz * Math.sin(rad);
    const rotatedZ = dy * Math.sin(rad) + dz * Math.cos(rad);
    return new THREE.Vector3(dx, rotatedY, rotatedZ);
}


// 2. 걸음 수 측정
window.addEventListener("devicemotion", (event) => {
    const acc = event.accelerationIncludingGravity;
    const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);

    accBuffer.push(magnitude);
    if (accBuffer.length > 10) accBuffer.shift();

    const avg = accBuffer.reduce((a, b) => a + b, 0) / accBuffer.length;
    const now = Date.now();

    if (magnitude - avg > 3 && now - lastPeakTime > 400) {
        stepCount++;
        lastPeakTime = now;
        console.log(`걸음 인식됨. 총 걸음 수: ${stepCount}`);
    }
});


// 3. AR 세션 시작
const startAR = async () => {
    const imgIds = ["marker-1"];
    const img = document.getElementById(imgIds[0]);
    await img.decode();
    const bitmap = await createImageBitmap(img);
    const trackedImages = [{ image: bitmap, widthInMeters: 0.2 }];

    try {
        xrSession = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["local", "hit-test", "camera-access", "image-tracking"],
        trackedImages,
        optionalFeatures: ["dom-overlay"],
        domOverlay: { root: document.body },
        });

        document.getElementById('start-ar').classList.add('hidden');
        document.getElementById('log-position').classList.remove('hidden');

        xrSession.addEventListener('end', () => {
        document.getElementById('start-ar').classList.remove('hidden');
        document.getElementById('log-position').classList.add('hidden');
        });

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.xr.enabled = true;
        renderer.xr.setReferenceSpaceType('local');
        document.body.appendChild(renderer.domElement);
        await renderer.xr.setSession(xrSession);
        xrReferenceSpace = await xrSession.requestReferenceSpace("local");
        scene = new THREE.Scene();
        scene.background = null;

        // json 맵데이터 로드
        const res = await fetch('./3F_graph_map.json');
        const data = await res.json();
        nodes = data.nodes;
        markers = data.markers;

        const marker = markers[0];
        transformedNodes = nodes.map((node) => {
        return {
            ...node,
            worldPos: transformPosition(node.position, marker),
        };
        });
        
        // transformedNodes의 노드들 AR 시각화
        transformedNodes.forEach((node) => {
        const sphere = new THREE.Mesh(  // 3D 객체 생성
            new THREE.SphereGeometry(0.1),  // 오브젝트(구체)
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        sphere.position.copy(node.worldPos);  // 해당 노드의 변환된 AR 공간 상 좌표에 오브젝트 이동
        scene.add(sphere);  // AR 렌더링 공간에 오브젝트 배치
        });


        // edge 시각화 (선 연결)
        data.edges.forEach((edge) => {
            const startNode = transformedNodes.find(n => n.id === edge.start);
            const endNode = transformedNodes.find(n => n.id === edge.end);
            if (startNode && endNode) {
                const curve = new THREE.LineCurve3(startNode.worldPos, endNode.worldPos);
                const tubeGeometry = new THREE.TubeGeometry(curve, 20, 0.03, 8, false);  // 튜브를 선처럼 표현
                const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
                const tube = new THREE.Mesh(tubeGeometry, material);
                scene.add(tube);
            }
        });

        let viewerPoseReady = false;

        renderer.setAnimationLoop((timestamp, xrFrame) => {
        if (!xrFrame || !xrReferenceSpace) return;

        const pose = xrFrame.getViewerPose(xrReferenceSpace);
        if (pose) {
            latestViewerPose = pose;
            latestXRFrame = xrFrame;
            if (!viewerPoseReady) {
            document.getElementById('log-position').disabled = false;
            viewerPoseReady = true;
            console.log("viewerPose 확보됨. 위치 버튼 활성화");
            }

            const camera = renderer.xr.getCamera();
            renderer.render(scene, camera);
        }
        });
    } catch (err) {
        console.error("AR 세션 시작 실패:", err);
        alert("AR 세션을 시작할 수 없습니다: " + err.message);
    }
};

document.getElementById('start-ar').addEventListener('click', startAR);

document.getElementById('log-position').addEventListener('click', () => {
    if (!latestViewerPose || !xrReferenceSpace) {
        console.warn("viewerPose가 아직 준비되지 않았습니다.");
        return;
    }

    const pos = latestViewerPose.transform.position;
    console.log(`현재 위치: x=${pos.x.toFixed(3)}, y=${pos.y.toFixed(3)}, z=${pos.z.toFixed(3)}`);
});