import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.175.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.175.0/examples/jsm/loaders/GLTFLoader.js';

// 0. 변수 정의

// WebXR 변수
let xrSession = null;  // WebXR 세션
let xrReferenceSpace = null;  // 좌표계 기준
let renderer = null;  // three.js renderer
let scene = null;  // 실제 3D 공간

// 좌표 변환 변수
let transformedNodes = [];

// 걸음 수 측정 변수 (개발자 확인용)
let stepCount = 0;
let lastPeakTime = 0;
let accBuffer = [];
const stepLength = 0.7; // 평균 보폭 (단위: m)

// 위치 보정 변수
let referenceOffset = { x: 0, y: 0, z: 0 };  // 기준 좌표계 튐 보정
let previousCameraPose = null;              // 직전 카메라 위치 (for 튐 판단)

// 목적지 검색 변수
let endnName = null; // 사용자가 입력한 목적지

// 미니맵을 위해 마커 정보 전역으로 저장
let markerPos = null;  // 전역으로 선언
let markerQuat = null;  // markerRot에서 만든 쿼터니언 저장


// 1. 목적지 입력
document.getElementById('confirm-destination').addEventListener('click', () => {
    const input = document.getElementById('destination-input').value.trim();
    if (input) {
        endnName = input;

        document.getElementById('map-ui').style.display = 'none';

        // 목적지 텍스트 표시
        document.getElementById('destination-text').innerText = `선택된 목적지: ${endnName}`;
        document.getElementById('destination-display').classList.remove('hidden');

        // 안내 텍스트 + AR 버튼 표시
        document.getElementById('start-info').classList.remove('hidden');
        document.getElementById('start-ar').classList.remove('hidden');
    } else {
        alert("목적지를 입력하세요.");
    }
});


// 2. path 찾기
function findPathByName(startName, endName, nodes, edges) {
    // 2-1. name으로 node id 찾기
    const startNode = nodes.find(n => n.name === startName);
    const endNode = nodes.find(n => n.name === endName);

    if (!startNode || !endNode) {
        console.error("시작 또는 도착 노드 이름이 잘못되었습니다.");
        return null;
    }

    const startId = startNode.id;
    const endId = endNode.id;

    // 2-2. 인접 리스트 생성
    const graph = {};
    edges.forEach(edge => {
        if (!graph[edge.start]) graph[edge.start] = [];
        if (!graph[edge.end]) graph[edge.end] = [];
        graph[edge.start].push({ id: edge.end, weight: edge.length, edge });
        if (edge.directionality === "bidirectional") {
            graph[edge.end].push({ id: edge.start, weight: edge.length, edge: { ...edge, start: edge.end, end: edge.start } });
        }
    });

    // 2-3. Dijkstra 알고리즘
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

    // 2-4. 경로 역추적 (노드-엣지-노드-엣지... 순서로 구성)
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


// 걸음 수 측정 (개발자 확인용)
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
    // 3-1. 초기 UI 설정
    document.getElementById('map-ui').style.display = 'none';
    document.getElementById('destination-display').classList.add('hidden');
    document.getElementById('start-info').classList.add('hidden');

    const imgIds = ["marker-1"];
    const img = document.getElementById(imgIds[0]);
    await img.decode();
    const bitmap = await createImageBitmap(img);
    const trackedImages = [{ image: bitmap, widthInMeters: 0.173 }];


    // 3-2. json 맵데이터 로드
    const res = await fetch('./3F_graph_map.json');
    const data = await res.json();  // 위 json 응답을 js 객체로 파싱
    var nodes = null;
    nodes = data.nodes;  // json nodes
    var markers = null;
    markers = data.markers;  // json markers
    var edges = null;
    edges = data.edges; // json edges


    // 3-3. 3d 모델 파일 로드
    let baseArrow = null;
    let baseArrival = null;

    const loader = new GLTFLoader();
    loader.load('./arrow2.gltf', (gltf) => {
    baseArrow = gltf.scene;

    // 로드 후 재질 수정 (자체발광 처리)
    baseArrow.traverse((child) => {
        if (child.isMesh && child.material && 'emissive' in child.material) {
            // child.material.emissive = new THREE.Color(0xffffff);       // 발광 없음 (색상 유지)
            // child.material.emissiveIntensity = 0.1;
            child.material.needsUpdate = true;
        }
    });

    loader.load('./arrivals1.gltf', (gltf) => {
        baseArrival = gltf.scene;
        console.log("arrivals1.gltf 로드 완료");
    });

    console.log("arrow1.gltf 로드 완료");
    });


    // 3-4. AR 세션 준비
    try {
        xrSession = await navigator.xr.requestSession("immersive-ar", {  // AR 세션 요청
            requiredFeatures: ["local", "hit-test", "camera-access", "image-tracking"],  // 활성화 기능
            trackedImages,
            optionalFeatures: ["dom-overlay"],  // 선택 기능
            domOverlay: { root: document.body },
        });

        // AR 세션 시작 시 UI 숨김
        document.getElementById('start-ar').classList.add('hidden');
        document.getElementById('minimap-container').style.display = 'block';
        // document.getElementById('log-position').classList.remove('hidden');
        const header = document.querySelector('header');
        if (header) header.style.display = 'none';

        // AR 세션 종료 시 UI 복원
        xrSession.addEventListener('end', () => {
            document.getElementById('start-ar').classList.remove('hidden');
            document.getElementById('log-position').classList.add('hidden');
            if (header) header.style.display = 'block';
            document.getElementById('minimap-container').style.display = 'none';
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

        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 5.0);
        scene.add(hemi);
        const offsetGroup = new THREE.Group();
        scene.add(offsetGroup);


        let mapPlaced = false; // 중복 시각화 방지용

        let lastTime = null;
        let lastPos = null;
        let frameCount = 0;
        let fpsLastTime = performance.now();

        let arrivalInstance = null;  // 도착지 모델 인스턴스를 추적할 전역 변수


        // 3-5. 애니메이션 루프
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
                    referenceOffset.x += dx;
                    referenceOffset.y += dy;
                    referenceOffset.z += dz;
                    console.warn("좌표계 튐 감지 — 보정 오프셋 누적됨:", referenceOffset);
                
                    // offsetGroup 전체를 이동
                    offsetGroup.position.set(
                        referenceOffset.x,
                        referenceOffset.y,
                        referenceOffset.z
                    );
                }
            }
            previousCameraPose = currentCameraPose;


            latestViewerPose = pose;
            latestXRFrame = xrFrame;


            /* 개발자 확인용
            if (!viewerPoseReady) {
                document.getElementById('log-position').disabled = false;
                viewerPoseReady = true;
                console.log("viewerPose 확보됨. 위치 버튼 활성화");
            }
            */
            

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

                console.log(`평균 속도: ${speedXZ.toFixed(4)} m/s, ${speedY.toFixed(4)} m/s`);
            }

            lastTime = currentTime;
            lastPos = { x: currentPos.x, y: currentPos.y, z: currentPos.z };
        

            const minimapWrapper = document.getElementById("minimap-wrapper");

            if (markerPos && minimapWrapper) {
                const relX = currentCameraPose.x - markerPos.x;
                const relZ = currentCameraPose.z - markerPos.z;

                const containerWidth = 500;
                const wrapperWidth = 600;
                const MAP_SCALE = 10; // 지도상 보폭
                const offsetCenterX = wrapperWidth / 2;
                const offsetCenterY = wrapperWidth / 2;
                
                // 위치 미세 조정 (보정값)
                const offsetFixX = -352;  // 음수면 오른쪽으로 이동
                const offsetFixY = -245; // 음수면 아래로 이동

                const bgX = -(relX * MAP_SCALE) + offsetCenterX - containerWidth / 2 + offsetFixX ;
                const bgY = -(relZ * MAP_SCALE) + offsetCenterY - containerWidth / 2 + offsetFixY ;

                minimapWrapper.style.left = `${bgX}px`;
                minimapWrapper.style.top = `${bgY}px`;

                console.log("bgX:", bgX, "bgY:", bgY);
                console.log("relX:", relX, "relZ:", relZ);
            }
        }

        // FPS 측정
        frameCount++;
        const now = performance.now();
        if (now - fpsLastTime >= 1000) {
            console.log(`🖥️ FPS: ${frameCount} frames/sec`);
            frameCount = 0;
            fpsLastTime = now;
        }

        // 도착지 모델링 회전
        if (arrivalInstance) {
            arrivalInstance.rotation.y += 0.05; // 빙글빙글 회전
        }

        // 이미지 트래킹 결과 확인
        if (mapPlaced) return; // 한 번만 실행
        const results = xrFrame.getImageTrackingResults();
        for (const result of results) {
            if (result.trackingState !== "tracked") continue;

            const pose = xrFrame.getPose(result.imageSpace, xrReferenceSpace);
            if (!pose) continue;

            // ################## 전역변수에 선언됨 갱신으로 변경 ##################
            markerPos = pose.transform.position;
            const markerRot = pose.transform.orientation; // 회전 쿼터니언
            markerPos = pose.transform.position;
            markerQuat = new THREE.Quaternion(
                markerRot.x,
                markerRot.y,
                markerRot.z,
                markerRot.w
            );
            // ################## 전역변수에 선언됨 갱신으로 변경 ##################
            
            // const matrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);

            // ############################ x90 y0 z? 회전 강제 ############################
            // Quaternion → Euler (XYZ 순서)
            const originalEuler = new THREE.Euler().setFromQuaternion(markerQuat, 'XYZ');
            
            // 고정된 회전값 (rad 단위)
            const fixedX = THREE.MathUtils.degToRad(90);  // 90도
            const fixedY = 0;                              // 0도
            const measuredZ = originalEuler.z;            // 실제 Z 값만 사용
            
            // 새 Euler로 구성
            const modifiedEuler = new THREE.Euler(fixedX, fixedY, measuredZ, 'XYZ');
            
            // Euler → Matrix4
            const matrix = new THREE.Matrix4().makeRotationFromEuler(modifiedEuler);
            
            // 필요 시 출력 확인
            const radToDeg = THREE.MathUtils.radToDeg;
            console.log(`고정 회전: X=90°, Y=0°, Z=${radToDeg(measuredZ).toFixed(2)}°`);
            // ############################ x90 y0 z? 회전 강제 ############################

            // 4. 좌표 변환 및 노드 시각화
            // path는 [node, edge, node, edge, ..., node] 형식의 리스트
            // const path = findPathByName("1340", "3F 엘리베이터 입구", nodes, edges);
            // const path = findPathByName("1340", "1362", nodes, edges);
            const path = findPathByName("1340", endnName, nodes, edges);
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

            // ############################## 스플라인 arrow 배치 ##############################

            // 1. 스플라인 생성
            const points = transformedNodes.map(node =>
                new THREE.Vector3(
                    node.worldPos.x - referenceOffset.x, // 이거 referenceOffset을 더해야 하는거 아닌가? 에초에 초반이라 referenceOffset적용을 안해야 하지 않나?
                    // node.worldPos.y - referenceOffset.y,
                    -0.8,
                    node.worldPos.z - referenceOffset.z
                )
            );

            if (points.length < 2) {
                console.warn("스플라인 생성을 위해 최소 두 점 이상이 필요합니다.");
                return;
            }

            const spline = new THREE.CatmullRomCurve3(points);
            spline.curveType = 'catmullrom';
            spline.closed = false;

            // 2. 곡선을 세밀하게 샘플링
            const fineSamples = 2000;
            const sampled = spline.getSpacedPoints(fineSamples);

            const interval = 5.0;
            let lastPoint = sampled[0];
            let accumulatedDistance = 0;

            const positions = [lastPoint];
            const tangents = [spline.getTangentAt(0)];

            for (let i = 1; i < sampled.length; i++) {
                const current = sampled[i];
                const dist = current.distanceTo(lastPoint);
                accumulatedDistance += dist;

                if (accumulatedDistance >= interval) {
                    positions.push(current);
                    const t = i / (sampled.length - 1);
                    tangents.push(spline.getTangentAt(t));
                    accumulatedDistance = 0;
                    lastPoint = current;
                }
            }

            // 3. 화살표 모델 각 위치에 배치
            if (!baseArrow || !baseArrival) {
                console.warn("arrow1.gltf가 아직 로드되지 않았습니다.");
                return;
            }

            positions.forEach((pos, idx) => {
                const tangent = tangents[idx].clone().normalize();
                const zAxis = new THREE.Vector3(0, 0, 1);
                const quat = new THREE.Quaternion().setFromUnitVectors(zAxis, tangent);

                if (idx === positions.length - 1) {
                    const model = baseArrival.clone(true);
                    model.setRotationFromQuaternion(quat);
                    model.position.copy(pos);
                    offsetGroup.add(model);
                    // scene.add(model);
                    arrivalInstance = model;  // 회전시키기 위해 추적
                } else {
                    const model = baseArrow.clone(true);
                    model.setRotationFromQuaternion(quat);
                    model.position.copy(pos);
                    offsetGroup.add(model);
                    // scene.add(model);
                }
            });


            // ############################## 스플라인 arrow 배치 ##############################

            /* 디버깅용 시각화
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
            */

            // 안내 문구 2초간 표시
            const arNotice = document.getElementById('ar-notice');
            if (arNotice) {
                arNotice.classList.remove('hidden');
                setTimeout(() => {
                    arNotice.classList.add('hidden');
                }, 2000);
            }

            document.getElementById('start-point-text').innerText = '1340';
            document.getElementById('end-point-text').innerText = endnName;
            document.getElementById('start-point-display').classList.remove('hidden');

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


// 5. 이벤트리스너
// 카메라 켜지기 전 숨겨놓을 요소들
window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('start-ar').classList.add('hidden');
    document.getElementById('destination-display').classList.add('hidden');
    document.getElementById('start-info').classList.add('hidden');
    document.getElementById('start-point-display').classList.add('hidden');
});

// AR START 버튼
document.getElementById('start-ar').addEventListener('click', async () => {
    document.getElementById('map-ui').style.display = 'none';
    document.getElementById('destination-display').classList.add('hidden');
    document.getElementById('start-info').classList.add('hidden');

    await startAR();
});

// // 현재 위치 출력 버튼 (개발자 확인용)
// document.getElementById('log-position').addEventListener('click', () => {
//     if (!latestViewerPose || !xrReferenceSpace) {
//         console.warn("viewerPose가 아직 준비되지 않았습니다.");
//         return;
//     }

//     const pos = latestViewerPose.transform.position;
//     console.log(`현재 위치: x=${pos.x.toFixed(3)}, y=${pos.y.toFixed(3)}, z=${pos.z.toFixed(3)}`);
// });