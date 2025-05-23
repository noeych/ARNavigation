/*
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

// 위치 보정 변수수
let referenceOffset = { x: 0, y: 0, z: 0 };  // 기준 좌표계 튐 보정
let previousCameraPose = null;              // 직전 카메라 위치 (for 튐 판단)

// 칼만 필터 클래스 정의
class Kalman1D {
    constructor(R = 0.1, Q = 0.01) {
        this.R = R;
        this.Q = Q;
        this.A = 1;
        this.B = 0;
        this.C = 1;
        this.cov = NaN;
        this.x = NaN;
    }

    filter(z) {
        if (isNaN(this.x)) {
            this.x = z;
            this.cov = 1;
        } else {
            const predX = this.A * this.x;
            const predCov = this.A * this.cov * this.A + this.Q;
            const K = predCov * this.C / (this.C * predCov * this.C + this.R);
            this.x = predX + K * (z - this.C * predX);
            this.cov = (1 - K * this.C) * predCov;
        }
        return this.x;
    }
}

// 칼만 필터 인스턴스 생성
const kalmanOffsetX = new Kalman1D();
const kalmanOffsetY = new Kalman1D();
const kalmanOffsetZ = new Kalman1D();




// // 1. 좌표 변환 (마커 정보를 이용해 json 노드 객체들의 좌표를 변환)
// function transformPosition(pos, marker) {
//     const dx = pos[0] - marker.position[0];
//     const dy = pos[1] - marker.position[1];
//     const dz = pos[2];
//     const rad = marker.orientation[0];
//     const rotatedY = dy * Math.cos(rad) - dz * Math.sin(rad);
//     const rotatedZ = dy * Math.sin(rad) + dz * Math.cos(rad);
//     return new THREE.Vector3(dx, rotatedY, rotatedZ);
// }


// path 찾기
function findPathByName(startName, endName, nodes, edges) {
    // 1. name으로 node id 찾기
    const startNode = nodes.find(n => n.name === startName);
    const endNode = nodes.find(n => n.name === endName);

    if (!startNode || !endNode) {
        console.error("시작 또는 도착 노드 이름이 잘못되었습니다.");
        return null;
    }

    const startId = startNode.id;
    const endId = endNode.id;

    // 2. 인접 리스트 생성
    const graph = {};
    edges.forEach(edge => {
        if (!graph[edge.start]) graph[edge.start] = [];
        if (!graph[edge.end]) graph[edge.end] = [];
        graph[edge.start].push({ id: edge.end, weight: edge.length, edge });
        if (edge.directionality === "bidirectional") {
            graph[edge.end].push({ id: edge.start, weight: edge.length, edge: { ...edge, start: edge.end, end: edge.start } });
        }
    });

    // 3. Dijkstra 알고리즘
    const distances = {};
    const prev = {};         // prev[nodeId] = { nodeId, viaEdge }
    const visited = new Set();
    const pq = [];

    nodes.forEach(n => distances[n.id] = Infinity);
    distances[startId] = 0;
    pq.push({ id: startId, dist: 0 });

    while (pq.length > 0) {
        pq.sort((a, b) => a.dist - b.dist);
        const { id: current } = pq.shift();
        if (visited.has(current)) continue;
        visited.add(current);

        const neighbors = graph[current] || [];
        neighbors.forEach(({ id: neighbor, weight, edge }) => {
            const newDist = distances[current] + weight;
            if (newDist < distances[neighbor]) {
                distances[neighbor] = newDist;
                prev[neighbor] = { node: current, edge };
                pq.push({ id: neighbor, dist: newDist });
            }
        });
    }

    // 4. 경로 역추적 (노드-엣지-노드-엣지... 순서로 구성)
    const path = [];
    let cur = endId;

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    if (!prev[cur]) {
        console.error("경로를 찾을 수 없습니다.");
        return null;
    }

    path.unshift(nodeMap.get(cur)); // 마지막 노드

    while (prev[cur]) {
        const { node: prevNodeId, edge } = prev[cur];
        path.unshift(edge); // edge 먼저
        path.unshift(nodeMap.get(prevNodeId)); // 그 앞 노드
        cur = prevNodeId;
    }

    return path;  // [node, edge, node, edge, ..., node] 형식
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
    var nodes = null;
    nodes = data.nodes;  // json nodes
    var markers = null;
    markers = data.markers;  // json markers
    var edges = null;
    edges = data.edges; // json edges


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

        let lastTime = null;
        let lastPos = null;
        let frameCount = 0;
        let fpsLastTime = performance.now();

        // 애니메이션 루프
        renderer.setAnimationLoop((timestamp, xrFrame) => {
        if (!xrFrame || !xrReferenceSpace) return;

        const pose = xrFrame.getViewerPose(xrReferenceSpace);
        if (pose) {
            const cameraPos = pose.transform.position;
            const currentCameraPose = { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z };

            // 기준 좌표계 튐 감지 (1.5m 이상 튀었을 경우)
            if (previousCameraPose) {
                const dx = currentCameraPose.x - previousCameraPose.x;
                const dy = currentCameraPose.y - previousCameraPose.y;
                const dz = currentCameraPose.z - previousCameraPose.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (dist > 0.1) {
                    referenceOffset.x = kalmanOffsetX.filter(referenceOffset.x + dx);
                    referenceOffset.y = kalmanOffsetY.filter(referenceOffset.y + dy);
                    referenceOffset.z = kalmanOffsetZ.filter(referenceOffset.z + dz);
                    console.warn("좌표계 튐 감지 — 칼만 필터 보정 오프셋:", referenceOffset);
                }

            }
            previousCameraPose = currentCameraPose;


            latestViewerPose = pose;
            latestXRFrame = xrFrame;

            if (!viewerPoseReady) {
                document.getElementById('log-position').disabled = false;
                viewerPoseReady = true;
                console.log("viewerPose 확보됨. 위치 버튼 활성화");
            }

            const camera = renderer.xr.getCamera();
            renderer.render(scene, camera);

            const currentTime = timestamp;
            const currentPos = pose.transform.position;

            if (lastTime !== null && lastPos !== null) {
                const delta = (currentTime - lastTime) / 1000; // 초 단위 시간 차이
                const dx = currentPos.x - lastPos.x;
                const dy = currentPos.y - lastPos.y;
                const dz = currentPos.z - lastPos.z;
                const distanceXZ = Math.sqrt(dx * dx + dz * dz);
                const distanceY = Math.sqrt(dy * dy);
                const speedXZ = distanceXZ / delta; // m/s
                const speedY = distanceY / delta; // m/s

                console.log(`📏 평균 속도: ${speedXZ.toFixed(4)} m/s, ${speedY.toFixed(4)} m/s`);
            }

            lastTime = currentTime;
            lastPos = { x: currentPos.x, y: currentPos.y, z: currentPos.z };
            }

            // FPS 측정
            frameCount++;
            const now = performance.now();
            if (now - fpsLastTime >= 1000) {
                console.log(`🖥️ FPS: ${frameCount} frames/sec`);
                frameCount = 0;
                fpsLastTime = now;
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
            // path는 [node, edge, node, edge, ..., node] 형식의 리스트
            const path = findPathByName("1340", "3F 엘리베이터 입구", nodes, edges);
            // const path = findPathByName("1340", "1362", nodes, edges);
            console.log(path.length);

            const nodePath = [];
            const edgePath = [];

            path.forEach((item, index) => {
            if (index % 2 === 0) {
                nodePath.push(item); // 0, 2, 4,... → node
            } else {
                edgePath.push(item); // 1, 3, 5,... → edge
            }
            });

            // const marker = markers[0];  // 첫번째 마커 기준
            // transformedNodes = nodePath.map((node) => {
            // return {
            //     ...node,
            //     worldPos: transformPosition(node.position, marker),  // 각 노드의 position을 AR 공간(worldPos) 좌표로 변환 
            //     };
            // });

            transformedNodes = nodePath.map((node) => {
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

            // 기존 worldPos에 offset 적용 (보정)
            const corrected = new THREE.Vector3(
                node.worldPos.x - referenceOffset.x,
                node.worldPos.y - referenceOffset.y,
                node.worldPos.z - referenceOffset.z
            );

            sphere.position.copy(corrected);  // 해당 노드의 변환된 AR 공간 상 좌표에 오브젝트 이동
            scene.add(sphere);  // AR 렌더링 공간에 오브젝트 배치
            });

            // edge 시각화 (선 연결)
            data.edges.forEach((edge) => {
                const startNode = transformedNodes.find(n => n.id === edge.start);
                const endNode = transformedNodes.find(n => n.id === edge.end);

                if (startNode && endNode) {
                    // 보정된 위치 적용
                    const startPos = new THREE.Vector3(
                        startNode.worldPos.x - referenceOffset.x,
                        startNode.worldPos.y - referenceOffset.y,
                        startNode.worldPos.z - referenceOffset.z
                    );
                    const endPos = new THREE.Vector3(
                        endNode.worldPos.x - referenceOffset.x,
                        endNode.worldPos.y - referenceOffset.y,
                        endNode.worldPos.z - referenceOffset.z
                    );

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
*/