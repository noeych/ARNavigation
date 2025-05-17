import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.175.0/build/three.module.js';

// WebXR 변수
let xrSession = null;  // WebXR 세션
let xrReferenceSpace = null;  // 좌표계 기준
let renderer = null;  // three.js renderer
let scene = null;  // 실제 3D 공간
let cubesAdded = [false, false, false, false];
let latestXRFrame = null; // 최신 XRFrame
let latestViewerPose = null;

// 걸음 수 측정 변수
let stepCount = 0;
let lastPeakTime = 0;
let accBuffer = [];
const stepLength = 0.7; // 평균 보폭 (단위: m)

// DeviceMotion 기반 걸음 수 측정
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
        console.log(`\u{1F6B6} 걸음 인식됨! 총 걸음 수: ${stepCount}`);
    }
});

// AR 세션 시작
document.getElementById('start-ar').addEventListener('click', async () => {
    const imgIds = ["marker-1", "marker-2", "marker-3", "marker-4"];
    const imageBitmaps = [];

    for (const id of imgIds) {
        const img = document.getElementById(id);
        if (!img.complete || img.naturalWidth === 0) {
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });
        }
        // WebXR용 이미지 포맷으로 변환
        imageBitmaps.push(await createImageBitmap(img));
    }

    const trackedImages = imageBitmaps.map(bitmap => ({ image: bitmap, widthInMeters: 0.2 }));

    // WebXR 세션 요청
    try {
        xrSession = await navigator.xr.requestSession("immersive-ar", {
            requiredFeatures: ["local", "hit-test", "camera-access", "image-tracking"],
            trackedImages,
            optionalFeatures: ["dom-overlay"],
            domOverlay: { root: document.body }
        });

        // AR 세션 요청 직후 버튼 표시/숨김 제어
        document.getElementById('start-ar').classList.add('hidden'); // AR START 버튼 숨김
        document.getElementById('log-position').classList.remove('hidden'); // 현재 위치 출력 버튼 보이기

        // 세션 종료 시 버튼 초기화
        xrSession.addEventListener('end', () => {
            document.getElementById('start-ar').classList.remove('hidden');
            document.getElementById('log-position').classList.add('hidden');
        });


        // renderer, scene 설정
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.xr.enabled = true;
        renderer.xr.setReferenceSpaceType('local');
        document.body.appendChild(renderer.domElement);
        await renderer.xr.setSession(xrSession);
        cubesAdded = [false, false, false, false];

        xrReferenceSpace = await xrSession.requestReferenceSpace("local");

        scene = new THREE.Scene();
        scene.background = null;

        // 경로 정의 (마커 index 기준)
        const markerPaths = [
            [ // Marker 1
                [0, 0, 0],
                [-0.1, -0.1, 0],
                [0, 0, -0.5],
                [0.2, 0, -1.0],
                [0.4, 0, -1.5]
            ],
            [ // Marker 2
                [0, 0, 0],
                [0.1, 0, -0.3],
                [0.3, 0, -0.7],
                [0.5, 0, -1.2]
            ],
            [ // Marker 3
                [0, 0, 0],
                [-0.2, 0.1, -0.2],
                [-0.3, 0.1, -0.8]
            ],
            [ // Marker 4
                [0, 0, 0],
                [0.15, -0.05, -0.2],
                [0.25, -0.1, -0.6],
                [0.35, -0.1, -1.0]
            ]
        ];

        let viewerPoseReady = false;

        // 애니메이션 루프
        renderer.setAnimationLoop((timestamp, xrFrame) => {
            if (!xrFrame || !xrReferenceSpace) return;

            // viewerPose 있는 경우에만 프레임 저장
            const pose = xrFrame.getViewerPose(xrReferenceSpace);
            if (pose) {
                latestViewerPose = pose;
                latestXRFrame = xrFrame;
                if (!viewerPoseReady) {
                    document.getElementById('log-position').disabled = false;
                    viewerPoseReady = true;
                    console.log("viewerPose 확보됨. 위치 버튼 활성화");
                }

                // 렌더링
                const camera = renderer.xr.getCamera();
                renderer.render(scene, camera);
            }

            // 이미지 트래킹 결과
            const results = xrFrame.getImageTrackingResults();
            for (const result of results) {
                const pose = xrFrame.getPose(result.imageSpace, xrReferenceSpace);
                const idx = result.index;

            // AR 렌더링
            const viewerPose = xrFrame.getViewerPose(xrReferenceSpace);
            if (viewerPose) {
                // 최초 pose 확보 시 버튼 활성화
                if (!viewerPoseReady) {
                    document.getElementById('log-position').disabled = false;
                    viewerPoseReady = true;
                    console.log("viewerPose 확보됨. 위치 버튼 활성화");
                }

                const camera = renderer.xr.getCamera();
                renderer.render(scene, camera);
            }

                // 트래킹된 마커 처리
                if (pose && result.trackingState === "tracked" && !cubesAdded[idx]) {
                    console.log(`인식된 마커: ${imgIds[idx]}`);
                    markerBases[idx] = pose.transform.position;

                    const nodePositions = markerPaths[idx].map(offset =>
                        new THREE.Vector3(
                            base.x + offset[0],
                            base.y + offset[1],
                            base.z + offset[2] - walkedDistance // 사용자의 걸음만큼 z축 방향으로 보정 적용
                        )
                    );

                    // 경로, 오브젝트 추가
                    nodePositions.forEach((pos, i) => {
                        const color = i === 0 ? 0x00ff00 : (i === nodePositions.length - 1 ? 0xff0000 : 0xffff00);
                        const cube = new THREE.Mesh(
                            new THREE.BoxGeometry(0.15, 0.15, 0.15),
                            new THREE.MeshBasicMaterial({ color })
                        );
                        cube.position.copy(pos);
                        scene.add(cube);
                    });

                    for (let i = 0; i < nodePositions.length - 1; i++) {
                        const from = nodePositions[i];
                        const to = nodePositions[i + 1];
                        const direction = new THREE.Vector3().subVectors(to, from).normalize();
                        const length = from.distanceTo(to);
                        const arrow = new THREE.ArrowHelper(direction, from, length, 0x0000ff);
                        scene.add(arrow);
                    }

                    const pathGeometry = new THREE.BufferGeometry().setFromPoints(nodePositions);
                    const pathLine = new THREE.Line(
                        pathGeometry,
                        new THREE.LineBasicMaterial({ color: 0xffffff })
                    );
                    scene.add(pathLine);

                    cubesAdded[idx] = true;
                }
            }
        });

    } catch (err) {
        console.error("AR 세션 시작 실패:", err);
        alert("AR 세션을 시작할 수 없습니다: " + err.message);
    }

    document.getElementById('log-position').addEventListener('click', () => {
    if (!latestViewerPose || !xrReferenceSpace) {
        console.warn("viewerPose가 아직 준비되지 않았습니다.");
        return;
    }

    const pos = latestViewerPose.transform.position;
    console.log(`현재 위치: x=${pos.x.toFixed(3)}, y=${pos.y.toFixed(3)}, z=${pos.z.toFixed(3)}`);
});

}
);
