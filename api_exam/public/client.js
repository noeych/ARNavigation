import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.175.0/build/three.module.js';

// 0. 변수 정의
// WebXR 변수
let xrSession = null;  // WebXR 세션
let xrReferenceSpace = null;  // 좌표계 기준
let renderer = null;  // three.js renderer
let scene = null;  // 실제 3D 공간
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
// 스마트폰 가속도 센서로부터 연속 데이터를 받아오는 형식 
window.addEventListener("devicemotion", (event) => {
    const acc = event.accelerationIncludingGravity;  // 중력을 포함한 x,y,z축 가속도 값 반환 
    const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);  // 가속도 벡터의 크기(진폭) 계산 

    // 이동평균 버퍼
    accBuffer.push(magnitude);  // 가속도 크기를 accBuffer 배열에 추가 (슬라이딩 윈도우 역할)
    if (accBuffer.length > 10) accBuffer.shift();  // 최근 10개의 진폭 값만 유지 

    const avg = accBuffer.reduce((a, b) => a + b, 0) / accBuffer.length; // 평균 진폭 계산 
    const now = Date.now();

    if (magnitude - avg > 3 && now - lastPeakTime > 400) {  // 진폭이 평균보다 3 이상 튀는 순간 => 한 걸음으로 간주, 쿨타임 400ms로 설정 
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
    const trackedImages = [{ image: bitmap, widthInMeters: 0.173 }];

    // json 맵데이터 로드
    const res = await fetch('./3F_graph_map.json');
    const data = await res.json();  // 위 json 응답을 js 객체로 파싱
    nodes = data.nodes;  // json nodes
    markers = data.markers;  // json markers

    const marker = markers[0];  // 첫번째 마커 기준
    transformedNodes = nodes.map((node) => {
    return {
        ...node,
        worldPos: transformPosition(node.position, marker),  // 각 노드의 position을 AR 공간(worldPos) 좌표로 변환 
    };
    });

    try {
        xrSession = await navigator.xr.requestSession("immersive-ar", {  // AR 세션 요청청
        requiredFeatures: ["local", "hit-test", "camera-access", "image-tracking"],  // 활성화 기능
        trackedImages,
        optionalFeatures: ["dom-overlay"],  // 선택 기능
        domOverlay: { root: document.body },
        });

        // AR 세션 시작 시 AR START 버튼 숨김
        document.getElementById('start-ar').classList.add('hidden');
        document.getElementById('log-position').classList.remove('hidden');

        // AR 세션 종료 시 UI 복원
        xrSession.addEventListener('end', () => {
        document.getElementById('start-ar').classList.remove('hidden');
        document.getElementById('log-position').classList.add('hidden');
        });

        // Three.js 렌더러 초기화 
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.xr.enabled = true;
        renderer.xr.setReferenceSpaceType('local');  // 사용자 위치 기준 좌표계 사용 
        document.body.appendChild(renderer.domElement);
        await renderer.xr.setSession(xrSession);  // Three.js 렌더러에 WebXR 세션 연결 
        xrReferenceSpace = await xrSession.requestReferenceSpace("local");  // AR 공간 기준 좌표계 (사용자 중심)
        scene = new THREE.Scene();
        scene.background = null;

        let viewerPoseReady = false;

        let mapPlaced = false; // 중복 시각화 방지용

        // 애니메이션 루프
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

        // 이미지 트래킹 결과 확인
        if (mapPlaced) return; // 한 번만 실행
        const results = xrFrame.getImageTrackingResults();
        for (const result of results) {
            if (result.trackingState !== "tracked") continue;

            const pose = xrFrame.getPose(result.imageSpace, xrReferenceSpace);
            if (!pose) continue;

            const markerPos = pose.transform.position;
            const markerRot = pose.transform.orientation; // 회전 쿼터니언

            // Quaternion으로 회전 행렬 생성
            const quaternion = new THREE.Quaternion(
            markerRot.x,
            markerRot.y,
            markerRot.z,
            markerRot.w
            );
            const matrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);

            // 1. 좌표 변환 및 노드 시각화
            transformedNodes = nodes.map((node) => {
                const relative = new THREE.Vector3(
                    node.position[0] - markers[0].position[0],
                    node.position[1] - markers[0].position[1],
                    node.position[2] - markers[0].position[2]
                );
                const rotated = relative.clone().applyMatrix4(matrix);
                const worldPos = new THREE.Vector3(
                    markerPos.x + rotated.x,
                    markerPos.y + rotated.y,
                    markerPos.z + rotated.z
                );
                return {
                    ...node,
                    worldPos: worldPos
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

            mapPlaced = true; // 다음부터는 실행 안 함
            console.log("마커 인식 및 맵 시각화 완료");
            break;
        }
        });


    } catch (err) {
        console.error("AR 세션 시작 실패:", err);
        alert("AR 세션을 시작할 수 없습니다: " + err.message);
    }
};


// 4. 이벤트리스너
// AR START 버튼
document.getElementById('start-ar').addEventListener('click', startAR);

// 현재 위치 출력 버튼
document.getElementById('log-position').addEventListener('click', () => {
    if (!latestViewerPose || !xrReferenceSpace) {
        console.warn("viewerPose가 아직 준비되지 않았습니다.");
        return;
    }

    const pos = latestViewerPose.transform.position;
    console.log(`현재 위치: x=${pos.x.toFixed(3)}, y=${pos.y.toFixed(3)}, z=${pos.z.toFixed(3)}`);
});