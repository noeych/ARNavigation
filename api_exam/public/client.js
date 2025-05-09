// WebXR 카메라 사용 코드
import { sendPoseEstimation, sendTransformation, sendPathRequest } from './api_script.js';
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
    console.log("AR 세션 시작 클릭됨");
    if (!navigator.xr) {
        alert("WebXR을 지원하지 않는 브라우저입니다.");
        return;
    }

    if (xrSession) {
        console.warn("AR 세션이 이미 실행 중입니다. 중복 실행을 막습니다.");
        return;
    }

    try {
        xrSession = await navigator.xr.requestSession("immersive-ar", {
            requiredFeatures: ["local", "hit-test", "camera-access"],
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

        const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
                const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });

        // 노드 좌표 리스트 (하드코딩)
        if (!cubesAdded) {
            const nodePositions = [
                { x: 0, y: 0, z: -1.5 }
            ];

            // 각 노드를 3D 씬에 추가
            nodePositions.forEach(pos => {
                const node = new THREE.Mesh(geometry, material);
                node.position.set(pos.x, pos.y, pos.z);
                scene.add(node);
            });

            cubesAdded = true;
        }

        // 애니메이션 루프
        renderer.setAnimationLoop((timestamp, xrFrame) => {
            if (!xrFrame || !xrReferenceSpace)
                return;
            const pose = xrFrame.getViewerPose(xrReferenceSpace);
            if (!pose)
                return;

            const camera = renderer.xr.getCamera();
            renderer.render(scene, camera);
        });

    } catch (err) {
        console.error("AR 세션 시작 실패:", err);
        alert("AR 세션을 시작할 수 없습니다: " + err.message);
    }
});



/*
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(0, 0, -1);
        scene.add(cube);

        gl = renderer.getContext();
        if (!gl) {
            console.error("WebGL 컨텍스트를 가져올 수 없습니다.");
            alert("WebGL 컨텍스트 없음");
            return;
        }

        renderer.setAnimationLoop((timestamp, xrFrame) => {
            if (!xrFrame) {
                console.warn("xrFrame 없음");
                return;
            }
        
            const pose = xrFrame.getViewerPose(xrReferenceSpace);
            if (!pose) {
                console.warn("viewerPose 없음");
                return;
            }

            // tracking이 가능한 첫 순간
            if (!trackingReady) {
                trackingReady = true;
                console.log("AR tracking 준비 완료 - viewerPose 확보됨");
            }


            const camera = renderer.xr.getCamera();
            renderer.render(scene, camera);

            if (isCaptureRequested && !isCapturing && gl) {
                console.log("캡처 조건 만족 - captureAndSendPose 호출 예정");
                isCapturing = true;
                isCaptureRequested = false;

                captureAndSendPose(xrFrame)
                    .catch(error => {
                        console.error("캡처 및 전송 중 오류:", error);
                        alert("캡처 중 오류가 발생했습니다: " + error.message);
                    })
                    .finally(() => {
                        isCapturing = false;
                    });
            }
        });

    } catch (err) {
        console.error("AR 세션 시작 오류:", err);
        alert("AR 세션 시작 실패: " + err.message);
    }
});


window.captureAndEstimatePose = () => {
    console.log("Capture & Estimate Pose 버튼 클릭됨");
    if (!xrSession) {
        alert("AR 세션이 시작되지 않았습니다.");
        return;
    }
    if (!trackingReady) {
        alert("AR tracking이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.");
        return;
    }
    if (isCapturing) {
        console.warn("현재 캡처 진행 중입니다. 기다려주세요.");
        return;
    }
    isCaptureRequested = true;
};


// 캡처하고 서버에 전송하는 async 함수
async function captureAndSendPose(xrFrame) {
    const capturePose = xrFrame.getViewerPose(xrReferenceSpace);
    if (!capturePose) throw new Error("캡처 시점 pose를 얻지 못했습니다.");

    const { position, orientation } = capturePose.transform;
    const relPosition = [position.x, position.y, position.z];
    const relRotation = [orientation.x, orientation.y, orientation.z, orientation.w];
    console.log("상대 pose:", relPosition, relRotation);

    const video = document.getElementById("cameraFeed");
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    const glCanvas = renderer.domElement;
    const glWidth = glCanvas.width;
    const glHeight = glCanvas.height;

    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = glWidth;
    finalCanvas.height = glHeight;
    const ctx = finalCanvas.getContext("2d");

    ctx.drawImage(video, 0, 0, glWidth, glHeight);

    const pixels = new Uint8Array(glWidth * glHeight * 4);
    gl.readPixels(0, 0, glWidth, glHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const imageData = new ImageData(new Uint8ClampedArray(pixels), glWidth, glHeight);

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = glWidth;
    tempCanvas.height = glHeight;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.putImageData(imageData, 0, 0);

    ctx.save();
    ctx.translate(0, glHeight);
    ctx.scale(1, -1);
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.restore();

    const imageBlob = await new Promise((resolve, reject) => {
        finalCanvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error("Canvas toBlob 실패"));
        }, 'image/jpeg', 0.9);
    });

    const imageFile = new File([imageBlob], "captured.jpg", { type: "image/jpeg" });
    console.log("서버에 Pose 요청 전송 중...");

    const result = await sendPoseEstimation(imageFile, intrinsicsMatrix);
    console.log("서버 응답 수신:", result);

    if (result.error) throw new Error("Pose 추정 실패: " + result.error);

    posePairs.push({
        relative: [relPosition, relRotation],
        absolute: [result.position, result.rotation]
    });

    console.log(`pose 페어 저장 완료 (${posePairs.length}개)`);
    alert(`Pose 추정 및 저장 성공! (총 ${posePairs.length}개)`);
}


// Capture & Estimate Pose 버튼
window.captureAndEstimatePose = () => {
    console.log("Capture 버튼 클릭됨");
    if (!xrSession) {
        alert("AR 세션이 시작되지 않았습니다.");
        return;
    }
    if (isCapturing) {
        console.warn("이미 캡처 중입니다. 대기하세요.");
        return;
    }
    isCaptureRequested = true;
};

// Send Final Transformation 버튼
window.sendFinalTransformation = async () => {
    console.log("Send Transformation 버튼 클릭됨");

    if (posePairs.length < 2) {
        alert("최소 2개 페어가 필요합니다.");
        return;
    }

    try {
        const result = await sendTransformation(posePairs);
        console.log("변환 결과:", result);
        if (result.error) {
            alert("변환 실패: " + result.error);
        } else {
            console.log("abs_to_rel:");
            console.table(result.abs_to_rel);
            console.log("rel_to_abs:");
            console.table(result.rel_to_abs);
            alert("변환 행렬 계산 성공!");
        }
    } catch (error) {
        console.error("변환 전송 실패:", error);
        alert("변환 전송 중 오류 발생.");
    }
};

// Test Send Path 버튼
window.testSendPath = async () => {
    console.log("Test Send Path 버튼 클릭");

    const absToRel = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const relToAbs = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const start = [0.5, 0.5, 0.5];
    const destinationId = "node-02";

    try {
        const resultPath = await sendPathRequest(absToRel, relToAbs, start, destinationId);
        if (resultPath && Array.isArray(resultPath)) {
            console.log("경로:");
            resultPath.forEach((p, i) => {
                console.log(`${i}: [${p.join(', ')}]`);
            });
            alert(`경로 계산 성공! (${resultPath.length} 포인트)`);
        } else {
            console.error("잘못된 경로 형식:", resultPath);
            alert("경로 형식 오류");
        }
    } catch (error) {
        console.error("경로 요청 실패:", error);
        alert("경로 요청 실패");
    }
};

*/







/* >>>2<<<
// WebXR 카메라 사용 코드
import { sendPoseEstimation, sendTransformation, sendPathRequest } from './api_script.js';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.175.0/build/three.module.js';

const posePairs = [];   // 페어 저장용 배열
const intrinsicsMatrix = [[500, 0, 320], [0, 500, 240], [0, 0, 1]];   // instrinsics 행렬 (캘리브레이션 값으로 대체 필요)

// WebXR 관련 변수
let xrSession = null;
let xrReferenceSpace = null;
let renderer = null;

// 캡처 요청 상태 변수
let isCaptureRequested = false;

// AR 세션 시작 버튼
document.getElementById('start-ar').addEventListener('click', async () => {
    if (!navigator.xr) {
        alert("WebXR을 지원하지 않는 브라우저입니다.");
        return;
    }

    try {
        xrSession = await navigator.xr.requestSession("immersive-ar", {
            requiredFeatures: ["local", "hit-test"],
            optionalFeatures: ["dom-overlay"],
            domOverlay: { root: document.body }
        });

        // Renderer 생성 (alpha: true 유지, preserveDrawingBuffer: true 유지)
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.xr.enabled = true;
        renderer.xr.setReferenceSpaceType('local');
        document.body.appendChild(renderer.domElement);
        await renderer.xr.setSession(xrSession);

        xrReferenceSpace = await xrSession.requestReferenceSpace("local");

        const scene = new THREE.Scene();
        scene.background = null; // AR 배경은 카메라 피드가 오도록 null 설정

        // --- 테스트용 큐브 추가 ---
        const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 }); // 초록색
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(0, 0, -0.5); // 카메라 앞에 위치
        scene.add(cube);
        console.log("Test cube added to the scene.");
        // --- 테스트용 큐브 추가 끝 ---


        // WebGL 컨텍스트 가져오기 (캡처에 사용)
        const gl = renderer.getContext();
        if (!gl) {
            console.error("Failed to get WebGL context from renderer.");
            // WebGL 사용 불가 알림 또는 대체 처리
            alert("WebGL을 사용할 수 없습니다. 카메라 캡처 기능이 제한됩니다.");
            // WebGL 없이는 픽셀 읽기 방식 캡처 불가
        } else {
            console.log("WebGL context obtained successfully.");
            // XRWebGLBinding은 프레임 내에서 유효한 세션과 GL 컨텍스트로 생성해야 할 수 있습니다.
        }


        // WebXR 애니메이션 루프 설정
        renderer.setAnimationLoop(async (timestamp, xrFrame) => { // async 키워드 추가
            if (xrFrame) {
                const pose = xrFrame.getViewerPose(xrReferenceSpace);
                if (pose) {
                    const { position, orientation } = pose.transform;
                    // console.log("WebXR 현재 위치:", position, orientation); // 너무 자주 찍히므로 주석 처리 또는 제거

                    // --- 캡처 요청이 들어오면 이미지 캡처 및 전송 로직 실행 ---
                    if (isCaptureRequested && gl) { // WebGL context가 유효한 경우에만 시도
                        isCaptureRequested = false; // 요청 처리했으니 플래그 초기화
                        console.log("캡처 요청 감지됨. 이미지 캡처 및 포즈 추정 시작...");

                        // 이 블록 안에서 실제 이미지 캡처 및 서버 전송 로직 수행
                        // 이전 답변에서 제시한 gl.readPixels + Canvas 2D 변환 코드 삽입

                        const baseLayer = xrSession.renderState.baseLayer;
                        if (!baseLayer || !baseLayer.texture) {
                            console.warn("XR Base Layer 또는 카메라 텍스처를 가져올 수 없습니다. 캡처 실패.");
                            // alert("카메라 텍스처에 접근할 수 없어 캡처 실패."); // 루프 안에서 alert 남발 방지
                            return; // 현재 프레임에서의 캡처 시도 중단
                        }

                        const cameraTexture = baseLayer.texture;
                        const imageWidth = baseLayer.textureWidth;
                        const imageHeight = baseLayer.textureHeight;

                        let pixels = null;
                        let fbo = null;

                        try {
                            fbo = gl.createFramebuffer();
                            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
                            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cameraTexture, 0);

                            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
                            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                                console.error("Framebuffer가 완전하지 않습니다:", status);
                                throw new Error("Framebuffer incomplete");
                            }

                            pixels = new Uint8Array(imageWidth * imageHeight * 4);
                            gl.readPixels(0, 0, imageWidth, imageHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

                            console.log(`WebGL에서 ${imageWidth}x${imageHeight} 크기의 픽셀 데이터 읽기 성공.`);

                        } catch (error) {
                            console.error("WebGL 픽셀 읽기 중 오류 발생:", error);
                            alert("카메라 픽셀 데이터 읽기 실패.");
                            // 에러 발생 시 FBO 정리
                            if (fbo) {
                                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                                gl.deleteFramebuffer(fbo);
                            }
                            return; // 현재 프레임에서의 캡처 시도 중단
                        } finally {
                            // 읽기 완료 후 FBO 바인딩 해제 (성공/실패 무관)
                            if (fbo) {
                                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                                // FBO 삭제는 readPixels 후 해도 됨 (위에서 에러 시 삭제)
                            }
                        }


                        // --- RGBA 픽셀 데이터를 JPEG Blob으로 변환 ---
                        let imageBlob = null;
                        try {
                            const canvas2D = document.createElement('canvas');
                            canvas2D.width = imageWidth;
                            canvas2D.height = imageHeight;
                            const ctx2D = canvas2D.getContext('2d');

                            if (!ctx2D) {
                                throw new Error("Failed to get 2D context from canvas");
                            }

                            // RGBA 픽셀 데이터를 ImageData 객체로 변환
                            // gl.readPixels 결과는 상하 반전될 수 있습니다. Canvas에 그릴 때 뒤집어 그립니다.
                            const imageData = new ImageData(new Uint8ClampedArray(pixels), imageWidth, imageHeight);

                            // Canvas에 이미지 그리기 (상하 반전 고려)
                            ctx2D.save(); // 현재 컨텍스트 상태 저장
                            ctx2D.translate(0, imageHeight); // Y축 원점을 이미지 높이로 이동
                            ctx2D.scale(1, -1); // Y축 스케일을 -1로 설정하여 이미지를 뒤집음
                            ctx2D.putImageData(imageData, 0, 0); // 뒤집힌 컨텍스트에 이미지 데이터 그리기
                            ctx2D.restore(); // 컨텍스트 상태 복원 (변환 되돌리기)


                            // Canvas 2D에서 JPEG Blob 생성
                            imageBlob = await new Promise((resolve, reject) => {
                                canvas2D.toBlob(blob => {
                                    if (blob) {
                                        console.log("Canvas 2D에서 Blob 생성 성공:", blob);
                                        resolve(blob);
                                    } else {
                                        console.error("Canvas 2D에서 Blob 생성 실패 (null 반환)");
                                        reject(new Error("Failed to create blob from canvas"));
                                    }
                                }, 'image/jpeg', 0.9); // 'image/jpeg' 형식, 품질 0.9
                        });

                        // 임시 Canvas 요소는 메모리에서 제거
                        canvas2D.remove();

                        // WebGL FBO 삭제
                        if (fbo) { // finally 블록에서 이미 삭제될 수 있지만, 확실하게
                            // gl.deleteFramebuffer(fbo); // 이미 readPixels try/catch/finally에서 처리됨
                        }


                        } catch (error) {
                            console.error("픽셀 데이터 -> Blob 변환 중 오류 발생:", error);
                            alert("이미지 데이터 변환 실패.");
                            // Blob 생성 실패 시 함수 종료
                            return;
                        }
                        // --- 변환 완료, imageBlob에 JPEG 데이터가 담겨있음 ---


                        // 이제 imageBlob을 사용하여 Node.js 서버로 전송합니다.
                        const imageFile = new File([imageBlob], "captured.jpg", { type: "image/jpeg" });

                        // 현재 프레임의 상대 pose 가져오기
                        // viewerPose는 이미 이 루프 시작 부분에서 가져왔으므로 재사용
                        const position = new THREE.Vector3();
                        const quaternion = new THREE.Quaternion();
                        viewerPose.transform.decompose(position, quaternion, new THREE.Vector3()); // viewerPose에서 바로 가져옴

                        const relPosition = [position.x, position.y, position.z];
                        const relRotation = [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
                        console.log("상대 pose:", relPosition, relRotation);


                        console.log("서버로 pose 추정 요청 전송 시도...");
                        try {
                            const result = await sendPoseEstimation(imageFile, intrinsicsMatrix); // intrinsicsMatrix는 캘리브레이션 값 사용
                            console.log("서버 응답 받음:", result);

                            if (result.error) {
                                console.error("서버에서 에러 반환:", result.error);
                                alert(`포즈 추정 실패: ${result.error}`);
                                return;
                            }

                            const absPosition = result.position;
                            const absRotation = result.rotation;

                            console.log("절대 pose:", absPosition, absRotation);

                            posePairs.push({
                                relative: [relPosition, relRotation],
                                absolute: [absPosition, absRotation]
                            });

                            console.log(`pose 페어 저장 (${posePairs.length})개`);
                        } catch (error) {
                            console.error("sendPoseEstimation 호출 중 오류 발생:", error);
                            // alert("서버 요청 중 오류가 발생했습니다. 콘솔을 확인하세요."); // 루프 안에서 alert 남발 방지
                        }
                        // --- 캡처 및 전송 로직 끝 ---
                    } // if (isCaptureRequested && gl) 끝
                } // if (pose) 끝
            } // if (xrFrame) 끝

            // Three.js 렌더링
            const camera = renderer.xr.getCamera();
            renderer.render(scene, camera);
        }); // setAnimationLoop 끝

    } catch (err) {
        console.error("AR 세션 시작 실패:", err);
        alert("AR 세션 시작 실패: " + err.message);
    }
});

// captureAndEstimatePose 버튼 클릭 핸들러
// 실제 캡처 로직 대신 캡처 요청 플래그만 설정
async function captureAndEstimatePose() {
    console.log("Capture & Estimate Pose 버튼 클릭됨. 캡처 요청.");
    if (!xrSession) {
        console.warn("XR 세션이 아직 시작되지 않았습니다.");
        alert("AR START 버튼을 먼저 눌러 AR 세션을 시작하세요.");
        return;
    }
    if (!renderer || !renderer.getContext()) {
        console.warn("WebGL 렌더링 컨텍스트가 준비되지 않아 이미지 캡처를 할 수 없습니다.");
        alert("이미지 캡처를 위한 WebGL 컨텍스트를 가져오지 못했습니다.");
        return;
    }
    isCaptureRequested = true; // 캡처 요청 플래그 설정
}


// sendFinalTransformation 버튼 - 변환 요청
async function sendFinalTransformation() {
    if (posePairs.length < 2) {
        alert("최소 2개 이상의 페어(캡처)가 필요합니다.");
        return;
    }

    console.log("변환 행렬 계산 요청...");
    try {
        const result = await sendTransformation(posePairs);
        console.log("변환 결과 받음:", result);
        console.log("변환 행렬 abs_to_rel:");
        console.table(result.abs_to_rel);
        console.log("변환 행렬 rel_to_abs:");
        console.table(result.rel_to_abs);
    } catch (error) {
        console.error("sendTransformation 호출 중 오류 발생:", error);
        alert("좌표 변환 행렬 계산 요청 중 오류 발생. 콘솔을 확인하세요.");
    }
}

// testSendPath 버튼 - 경로 요청
async function testSendPath() {
    // 실제 사용 시에는 이전에 계산된 absToRel, relToAbs 행렬 사용
    // 여기서는 예시 값 사용
    const absToRel = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const relToAbs = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const start = [0.5, 0.5, 0.5];
    const destinationId = "node-02"; // 실제 목적지 ID 사용

    console.log(`경로 탐색 요청: 시작=${start}, 목적지 ID=${destinationId}`);
    try {
        const result = await sendPathRequest(absToRel, relToAbs, start, destinationId);
        console.log("경로 탐색 결과 받음:", result);
        if (result && Array.isArray(result)) {
            console.log("경로 포인트:");
            result.forEach((point, i) => {
                console.log(`  ${i}: [${point.join(', ')}]`);
            });
        } else {
            console.warn("경로 결과 형식이 예상과 다릅니다.", result);
            alert("경로 정보를 받지 못했습니다.");
        }
    } catch (error) {
        console.error("sendPathRequest 호출 중 오류 발생:", error);
        alert("경로 탐색 요청 중 오류 발생. 콘솔을 확인하세요.");
    }
}


// 전역 함수 등록
window.captureAndEstimatePose = captureAndEstimatePose;
window.sendFinalTransformation = sendFinalTransformation;
window.testSendPath = testSendPath;

// WebGL Framebuffer 및 Pixel read 관련 헬퍼 함수는 필요시 별도로 구현하거나 라이브러리 사용 고려
// 현재는 captureAndEstimatePose 함수 내부에 직접 구현되어 있습니다.
*/