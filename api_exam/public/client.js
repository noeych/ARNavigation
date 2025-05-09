import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.175.0/build/three.module.js';

const posePairs = [];   // 페어 저장용 배열
const intrinsicsMatrix = [[500, 0, 320], [0, 500, 240], [0, 0, 1]]; // 임시 intrinsics (캘리브레이션 필요)

let xrSession = null;
let xrReferenceSpace = null;
let renderer = null;
let scene = null;
let cubesAdded = false;

// AR 세션 시작
document.getElementById('start-ar').addEventListener('click', async () => {
    const img = document.getElementById("marker-image");
    
    console.log("AR 세션 시작 클릭됨");
    if (!navigator.xr) {
        alert("WebXR을 지원하지 않는 브라우저입니다.");
        return;
    }

    if (!img.complete || img.naturalWidth === 0) {
        await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        });
    }

    const imageBitmap = await createImageBitmap(img);
    const trackedImages = [{ image: imageBitmap, widthInMeters: 0.2 }];

    try {
        xrSession = await navigator.xr.requestSession("immersive-ar", {
            requiredFeatures: ["local", "hit-test", "camera-access", "image-tracking"],
            trackedImages,
            optionalFeatures: ["dom-overlay"],
            domOverlay: { root: document.body }
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

        // 애니메이션 루프
        renderer.setAnimationLoop((timestamp, xrFrame) => {
            if (!xrFrame || !xrReferenceSpace) return;

            const results = xrFrame.getImageTrackingResults();
            for (const result of results) {
                const pose = xrFrame.getPose(result.imageSpace, xrReferenceSpace);
                if (pose && result.trackingState === "tracked" && !cubesAdded) {
                    console.log("마커 감지됨. 좌표계 기준 객체 배치 시작");

                    // 마커 기준으로 노드 위치를 하드코딩하여 표시
                    const base = pose.transform.position;

                    const nodePositions = [
                        new THREE.Vector3(base.x, base.y, base.z - 0.5),
                        new THREE.Vector3(base.x + 0.2, base.y, base.z - 1.0),
                        new THREE.Vector3(base.x + 0.4, base.y, base.z - 1.5)
                    ];

                    nodePositions.forEach((pos, i) => {
                        const color = i === 0 ? 0x00ff00 : (i === nodePositions.length - 1 ? 0xff0000 : 0xffff00);
                        const cube = new THREE.Mesh(
                            new THREE.BoxGeometry(0.15, 0.15, 0.15),
                            new THREE.MeshBasicMaterial({ color })
                        );
                        cube.position.copy(pos);
                        scene.add(cube);
                    });

                    // 화살표 표시
                    for (let i = 0; i < nodePositions.length - 1; i++) {
                        const from = nodePositions[i];
                        const to = nodePositions[i + 1];
                        const direction = new THREE.Vector3().subVectors(to, from).normalize();
                        const length = from.distanceTo(to);
                        const arrow = new THREE.ArrowHelper(direction, from, length, 0x0000ff);
                        scene.add(arrow);
                    }

                    // 경로 선
                    const pathGeometry = new THREE.BufferGeometry().setFromPoints(nodePositions);
                    const pathLine = new THREE.Line(
                        pathGeometry,
                        new THREE.LineBasicMaterial({ color: 0xffffff })
                    );
                    scene.add(pathLine);

                    cubesAdded = true;
                }
            }

            const viewerPose = xrFrame.getViewerPose(xrReferenceSpace);
            if (viewerPose) {
                const camera = renderer.xr.getCamera();
                renderer.render(scene, camera);
            }
        });

    } catch (err) {
        console.error("AR 세션 시작 실패:", err);
        alert("AR 세션을 시작할 수 없습니다: " + err.message);
    }
});