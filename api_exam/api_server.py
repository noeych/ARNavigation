import uvicorn
from fastapi import FastAPI, UploadFile, File, Form
from typing import List
from pydantic import BaseModel
import numpy as np
import cv2
import json
from scipy.spatial.transform import Rotation as ScipyRotation
import warnings
import time
import os

###########################################
# 계산용 함수들

def estimate_camera_pose(image, camera_matrix, dist_coeffs, marker_length=0.1):
    """
    ArUco 마커를 사용하여 카메라의 3D 위치와 회전(quaternion) 값을 추정하는 함수

    :param image: 입력 이미지 (OpenCV BGR 이미지)
    :param camera_matrix: 카메라 내부 행렬 (3x3)
    :param dist_coeffs: 왜곡 계수 (1x5 또는 1x8)
    :param marker_length: 마커의 한 변 길이 (미터 단위, 기본값 0.1m)
    :return: (translation_vector, quaternion) -> (카메라 3D 위치, 회전 쿼터니언)
    """
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_6X6_250)
    parameters = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)

    print("Python: ArUco 마커 검출 시도...")
    corners, ids, rejected = detector.detectMarkers(image)

    if ids is not None and len(ids) > 0:
        half_len = marker_length / 2
        objp = np.array([
            [-half_len,  half_len, 0],
            [ half_len,  half_len, 0],
            [ half_len, -half_len, 0],
            [-half_len, -half_len, 0]
        ], dtype=np.float32)

        image_points = corners[0].squeeze().astype(np.float32)

        print("Python: cv2.solvePnP 호출 시도...")
        try:
            # solvePnP 함수는 다양한 플래그를 가짐, IPPE_SQUARE는 평면 마커에 더 강인할 수 있음
            success, rvec, tvec = cv2.solvePnP(objp, image_points, camera_matrix, dist_coeffs, flags=cv2.SOLVEPNP_IPPE_SQUARE) # 플래그 추가 시도
            if not success:
                print('Python: solvePnP 호출은 성공했으나, success=False 반환') # 로그 추가
                return None, None
            print(f"Python: solvePnP 성공! rvec={rvec.flatten()}, tvec={tvec.flatten()}") # 로그 추가
        except Exception as e:
            # solvePnP 자체가 에러를 발생시킬 수도 있음
            print(f"Python: solvePnP 실행 중 예외 발생: {e}") # 로그 추가
            return None, None

        rotation_matrix, _ = cv2.Rodrigues(rvec)
        camera_rotation = rotation_matrix.T
        camera_position = -camera_rotation @ tvec

        quaternion = ScipyRotation.from_matrix(camera_rotation).as_quat()
        print("Python: 포즈 계산 완료")

        return camera_position.flatten(), quaternion
    else:
        print('Python: 이미지에서 마커를 검출하지 못했습니다.')
        if rejected: # 검출은 시도했으나 ArUco 마커가 아니라고 판단된 후보들
            print(f"Python: {len(rejected)} 개의 후보가 있었지만 마커로 판단되지 않음.")
        return None, None


def estimate_transform_with_orientation(pose_pairs):
    """
    쿼터니언 정보를 우선 사용하여 회전(R)을 추정하고,
    이를 바탕으로 위치 정보를 이용하여 스케일(s)과 이동(t)을 추정합니다.

    Args:
        pose_pairs: 리스트 형태의 데이터. 각 요소는 튜플 ((pos_a, quat_a), (pos_b, quat_b)) 형태.
            쿼터니언은 [x, y, z, w] 순서로 가정합니다.

    Returns:
        tuple: 다음 값들을 포함하는 튜플:
            - scale (float): 추정된 스케일 팩터 (A -> B)
            - R (np.ndarray): 추정된 회전 행렬 (A -> B, shape: (3, 3))
            - t (np.ndarray): 추정된 이동 벡터 (A -> B, shape: (3,))
            - T_AtoB (np.ndarray): A에서 B로의 4x4 변환 행렬
            - T_BtoA (np.ndarray): B에서 A로의 4x4 변환 행렬 (T_AtoB의 역행렬)
    """
    if len(pose_pairs) < 2:
        raise ValueError("최소 2개 이상의 점-회전 쌍이 필요합니다.")
    if len(pose_pairs) < 3:
        warnings.warn("3개 미만의 점 쌍이 사용되었습니다. 결과가 노이즈에 민감할 수 있습니다.")

    # 데이터 분리
    points_a = np.array([pair[0][0] for pair in pose_pairs]) # N x 3
    quats_a = np.array([pair[0][1] for pair in pose_pairs]) # N x 4
    points_b = np.array([pair[1][0] for pair in pose_pairs]) # N x 3
    quats_b = np.array([pair[1][1] for pair in pose_pairs]) # N x 4
    N = points_a.shape[0]
    print('points_a -> ', points_a.shape)
    print('quats_a -> ', quats_a.shape)
    print('points_b -> ', points_b.shape)
    print('quats_b -> ', quats_b.shape)

    # --- 1. 쿼터니언 정보를 이용한 회전 R 추정 ---
    try:
        # Scipy Rotation 객체 생성 (순서: xyzw)
        scipy_quats_a = ScipyRotation.from_quat(quats_a)
        scipy_quats_b = ScipyRotation.from_quat(quats_b)

        # 상대 회전 계산: q_rel = q_b * q_a^-1
        relative_rotations = scipy_quats_b * scipy_quats_a.inv()

        # 상대 회전들의 평균 계산
        # Scipy >= 1.4.0: Rotation.mean() 사용 가능
        mean_relative_rotation = relative_rotations.mean()
        R_est = mean_relative_rotation.as_matrix()

    except Exception as e:
        raise RuntimeError(f"쿼터니언 처리 중 오류 발생: {e}")

    # --- 2. 추정된 R과 위치 정보를 이용한 스케일 s 및 이동 t 추정 ---
    # points_a 를 추정된 R로 회전시킴
    # 방법 1: apply 사용 (N,3) -> (N,3)
    # points_a_rotated = mean_relative_rotation.apply(points_a)
    # 방법 2: 행렬 곱 사용 (3,3) @ (3,N) -> (3,N) -> 전치 -> (N,3)
    points_a_rotated = (R_est @ points_a.T).T

    # 중심 계산
    centroid_a = np.mean(points_a, axis=0) # 원본 A의 중심
    centroid_b = np.mean(points_b, axis=0)
    centroid_a_rotated = np.mean(points_a_rotated, axis=0) # 회전된 A의 중심

    # 중심화된 벡터 계산
    points_b_centered = points_b - centroid_b
    points_a_rotated_centered = points_a_rotated - centroid_a_rotated

    # 스케일 s 계산 (최소 자승법)
    # s = sum(dot(b_centered_i, a_rotated_centered_i)) / sum(dot(a_rotated_centered_i, a_rotated_centered_i))
    numerator = np.sum(np.sum(points_b_centered * points_a_rotated_centered, axis=1)) # 벡터 내적의 합
    denominator = np.sum(np.sum(points_a_rotated_centered**2, axis=1)) # 벡터 크기 제곱의 합

    if abs(denominator) < 1e-10: # 분모가 0에 가까우면 스케일 추정 불가
        raise ValueError("스케일 추정 실패: 중심화된 회전 벡터들의 크기 제곱 합이 0에 가깝습니다.")
    s_est = numerator / denominator

    # 이동 t 계산: t = centroid_b - s * centroid_a_rotated
    t_est = centroid_b - s_est * centroid_a_rotated

    # --- 3. 4x4 변환 행렬 생성 ---
    T_AtoB = np.identity(4)
    T_AtoB[:3, :3] = s_est * R_est
    T_AtoB[:3, 3] = t_est

    # 역행렬 계산
    try:
        R_inv = R_est.T
        s_inv = 1.0 / s_est
        t_inv = -s_inv * (R_inv @ t_est)
        T_BtoA = np.identity(4)
        T_BtoA[:3, :3] = s_inv * R_inv
        T_BtoA[:3, 3] = t_inv
    except ZeroDivisionError:
        warnings.warn("스케일 인자가 0에 가까워 역행렬 계산에 실패했습니다.")
        T_BtoA = np.full((4, 4), np.nan) # 또는 다른 에러 처리

    return s_est, R_est, t_est, T_AtoB, T_BtoA

###########################################


app = FastAPI()

# 저장할 폴더 생성 (없으면)
UPLOAD_FOLDER = "received_images"
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)


# 1. 카메라 절대좌표 추정
@app.post("/estimate-pose")
async def estimate_pose(
    file: UploadFile = File(...),
    intrinsics: str = Form(...)
):
    image_data = await file.read() # 데이터를 먼저 읽음

    # --- 이미지 저장 로직 추가 ---
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    # 원본 파일 이름에서 확장자 제거 (혹시 있을 경우)
    original_base_name = file.filename
    if '.' in original_base_name:
        original_base_name = original_base_name.rsplit('.', 1)[0]
    # 파일 이름이 비어있을 경우 대비
    if not original_base_name:
        original_base_name = "captured_image"

    # 항상 .jpg 확장자를 붙여서 파일명 생성
    filename = f"{timestamp}_{original_base_name}.jpg"
    save_path = os.path.join(UPLOAD_FOLDER, filename)
    
    try:
        with open(save_path, "wb") as f:
            f.write(image_data)
        print(f"Python: 이미지를 다음 경로에 저장했습니다: {save_path}")
    except Exception as e:
        print(f"Python: 이미지 저장 실패: {e}")
    # --- 이미지 저장 로직 끝 ---

    image = np.frombuffer(image_data, np.uint8) # 저장 후 처리
    img = cv2.imdecode(image, cv2.IMREAD_COLOR)

    if img is None:
        print("Python: 이미지 디코딩 실패")
        return {"error": "Failed to decode image", "position": None, "rotation": None} # 에러 반환

    # ... intrinsics 파싱 ...
    try:
        intrinsics_matrix = np.array(json.loads(intrinsics))
        print("Python: intrinsics -> : ", intrinsics_matrix.shape)
    except Exception as e:
        print(f"Python: Intrinsics 파싱 오류: {e}")
        return {"error": "Failed to parse intrinsics", "position": None, "rotation": None} # 에러 반환

    print("Python: estimate_camera_pose 호출 시도...") # 추가
    position_np, quaternion_np = estimate_camera_pose(img, intrinsics_matrix, None, marker_length=0.066)

    if position_np is not None and quaternion_np is not None:
        print(f"Python: 포즈 추정 성공. Position: {position_np}, Quaternion: {quaternion_np}") # 추가
        position = position_np.tolist()
        quaternion = quaternion_np.tolist()
        return {"position": position, "rotation": quaternion}
    else:
        print("Python: 마커 감지 실패 또는 포즈 추정 실패") # 추가
        # 클라이언트가 처리할 수 있도록 명시적인 에러 메시지 반환
        return {"error": "Marker not detected or pose estimation failed", "position": None, "rotation": None}
    
    #intrinsics_matrix = np.array(json.loads(intrinsics))
    #print("img -> ", img.shape)
    #print("intrinsics -> : ", intrinsics_matrix.shape)

    #position, quaternion = estimate_camera_pose(img, intrinsics_matrix, None, marker_length=0.066)
    #position = position.tolist()
    #quaternion = quaternion.tolist()

    #
    # visual localization 함수구동...
    #
    # 가상의 절대좌표 결과
    # position = [1.0, 2.0, 3.0]
    # rotation_matrix = np.identity(3)
    # quaternion = ScipyRotation.from_matrix(rotation_matrix).as_quat().tolist()
    
    return {"position": position, "rotation": quaternion}



class PosePair(BaseModel):
    absolute: List[List[float]]  # [[x,y,z], [qx,qy,qz,qw]]
    relative: List[List[float]]  # [[x,y,z], [qx,qy,qz,qw]]

# 2. 좌표 변환 행렬 생성
@app.post("/match-pairs")
async def match_pairs(pose_pairs: List[PosePair]):
    print("페어 개수: ", len(pose_pairs))

    # pose_pairs = [
    #     {
    #         "absolute": [[x, y, z], [qx, qy, qz, qw]],
    #         "relative": [[x, y, z], [qx, qy, qz, qw]]
    #     },
    #     ...
    # ]
    #
    # matching 함수 구동...

    pose_pairs_li = []
    for pair in pose_pairs:
        pose_pairs_li.append([pair.absolute, pair.relative])
    print(pose_pairs_li)

    s_est, R_est, t_est, T_AtoB, T_BtoA = estimate_transform_with_orientation(pose_pairs_li)
    print('s_est ->', s_est)
    print('R_est ->', R_est)
    print('t_est ->', t_est)

    # 변환 행렬 계산 (예제)
    abs_to_rel = T_AtoB.tolist()
    rel_to_abs = T_BtoA.tolist()

    return {"abs_to_rel": abs_to_rel, "rel_to_abs": rel_to_abs}

# 3. 경로 계산
@app.post("/path-finding")
async def path_finding(data: dict):
    abs_to_rel = np.array(data["abs_to_rel"])
    rel_to_abs = np.array(data["rel_to_abs"])
    start = data["start"]
    destination_id = data["destination_id"]

    print("abs_to_rel -> ", abs_to_rel)
    print("rel_to_abs -> ", rel_to_abs)
    print("start -> ", start)
    print("destination_id -> ", destination_id)
    #
    # path 산출 함수 구동
    #

    # path = [{"x": 1, "y": 2, "z": 3}, {"x": 4, "y": 5, "z": 6}]
    path = [[0.0, 0.0, 0.5], [0.0 ,0.0 ,1.0]]
    
    return path

if __name__ == "__main__":
    uvicorn.run("api_server:app", host="localhost", port=8000, reload=True)