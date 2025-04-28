const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const http = require('http');
const ngrok = require('ngrok');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 정적 파일 서비스 (HTML 테스트 페이지 제공)
app.use(express.static(path.join(__dirname, 'public')));

// Multer 설정: 업로드된 파일을 'uploads/' 폴더에 임시 저장
const upload = multer({ dest: 'uploads/' });

// 1. 카메라 절대좌표 추정
app.post('/estimate-pose', upload.single('file'), async (req, res) => {
    console.log("Node.js: /estimate-pose 요청 받음"); // 추가
    if (!req.file) {
        console.error("Node.js: 파일이 업로드되지 않았습니다."); // 추가
        return res.status(400).json({ error: 'File not uploaded' });
    }
    console.log("Node.js: 업로드된 파일:", req.file); // 추가
    console.log("Node.js: intrinsics:", req.body.intrinsics); // 추가

    const filePath = req.file.path;
    const intrinsicsMatrix = req.body.intrinsics;

    const formData = new FormData();
    const fileStream = fs.createReadStream(filePath);

    // FastAPI 서버로 전송할 FormData에 파일 스트림 추가
    formData.append('file', fileStream, {
        filename: req.file.originalname,
        contentType: req.file.mimetype
    });
    formData.append('intrinsics', intrinsicsMatrix);

    // 파일 스트림 완료 또는 에러 발생 시 임시 파일 삭제 로직
    // fetch 요청 결과와 상관없이 파일 스트림 처리가 끝나면 삭제해야 합니다.
    const cleanup = (err) => {
        fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) console.error("Node.js: 임시 파일 삭제 실패:", unlinkErr);
            // else console.log("Node.js: 임시 파일 삭제 완료:", filePath); // 삭제 완료 로그는 너무 많을 수 있어 주석 처리
        });
        if (err) console.error("Node.js: 파일 스트림 처리 중 오류 발생:", err);
    };

    fileStream.on('end', () => cleanup(null));
    fileStream.on('error', cleanup);


    try {
        // Python FastAPI 서버로 POST 요청 전송
        const response = await fetch('http://localhost:8000/estimate-pose', {
            method: 'POST',
            body: formData
            // FormData 객체 사용 시 'Content-Type': 'multipart/form-data; boundary=...' 헤더는 node-fetch가 자동으로 설정합니다.
        });
        console.log("Node.js: Python 서버 응답 상태:", response.status); // 추가

        // 응답 상태 체크 및 에러 처리 강화
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Node.js: Python 서버 에러 (${response.status}): ${errorText}`);
                try {
                    const errorJson = JSON.parse(errorText);
                    return res.status(response.status).json(errorJson);
                } catch (e) {
                    // JSON 파싱 실패 시, Python 서버의 원본 응답 텍스트를 포함하여 일반 에러 메시지 전달
                    return res.status(response.status).json({
                        error: `Python server returned an error (${response.status})`,
                        details: errorText
                    });
                }
        }

        // Python 서버로부터 성공적인 응답 (JSON) 받기
        const data = await response.json();
        console.log("Node.js: Python 서버로부터 받은 데이터:", data); // 추가

        // 클라이언트로 Python 서버 응답 전달
        res.json(data);

    } catch (error) {
        // fetch 자체에서 발생한 오류 (예: 네트워크 연결 실패)
        console.error('Error in estimate-pose:', error);
        res.status(500).json({
            error: 'Failed to communicate with FastAPI server',
            details: error.message // 에러 메시지 포함
        });
    }
});

// 2. 좌표 변환 행렬 생성
app.post('/match-pairs', async (req, res) => {
    console.log("Node.js: /match-pairs 요청 받음");
    // 요청 본문 (req.body)는 이미 express.json() 미들웨어에 의해 파싱되어 JSON 객체입니다.

    try {
        // Python FastAPI 서버로 POST 요청 전송
        const response = await fetch('http://localhost:8000/match-pairs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)  // 받은 JSON 본문을 문자열화하여 전송
        });

        console.log("Node.js: Python 서버 응답 상태:", response.status);

        // 응답 상태 체크 및 에러 처리
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Node.js: Python server error (${response.status}) on /match-pairs: ${errorText}`);
            try {
                const errorJson = JSON.parse(errorText);
                return res.status(response.status).json(errorJson);
            } catch (e) {
                return res.status(response.status).json({
                    error: `Python server returned an error (${response.status}) on /match-pairs`,
                    details: errorText
                });
            }
        }

        // Python 서버 응답 (JSON) 받기
        const data = await response.json();
        // console.log("Transformation Result:", data);

        // 클라이언트로 응답 전달
        res.json(data);

    } catch (error) {
        console.error('Error communicating with FastAPI server on /match-pairs:', error);
        res.status(500).json({
            error: 'Failed to communicate with FastAPI server on /match-pairs',
            details: error.message
        });
    }
});

// 3. 경로 계산 (FastAPI 서버로 중계)
app.post('/path-finding', async (req, res) => {
    console.log("Node.js: /path-finding 요청 받음");
    // 요청 본문 (req.body)는 이미 express.json() 미들웨어에 의해 파싱되어 JSON 객체입니다.
    console.log("Node.js: Pathfinding data:", req.body);

    try {
        // Python FastAPI 서버로 POST 요청 전송
        const response = await fetch('http://localhost:8000/path-finding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        console.log("Node.js: Python 서버 응답 상태:", response.status);

        // 응답 상태 체크 및 에러 처리
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Node.js: Python server error (${response.status}) on /path-finding: ${errorText}`);
            try {
                const errorJson = JSON.parse(errorText);
                return res.status(response.status).json(errorJson);
            } catch (e) {
                return res.status(response.status).json({
                    error: `Python server returned an error (${response.status}) on /path-finding`,
                    details: errorText
                });
            }
        }

        // Python 서버 응답 (JSON) 받기 (경로 목록)
        const data = await response.json();
        console.log("Node.js: Pathfinding Result received."); // 결과 로그가 너무 길 수 있어 주석 처리

        // 클라이언트로 응답 전달 (경로 목록)
        res.json(data);
    } catch (error) {
        console.error('Error communicating with FastAPI server on /path-finding:', error);
        res.status(500).json({
            error: 'Failed to communicate with FastAPI server on /path-finding',
            details: error.message
        });
    }
});

const port = 3000;
//app.listen(PORT, () => console.log(`Node.js server running at http://localhost:${PORT}`));

// HTTP 서버 + ngrok 연동
const server = http.createServer(app).listen(port, async () => {
    console.log(`✅ HTTP 서버 실행 중! 접속: http://localhost:${port}`);

    try {
        const url = await ngrok.connect({
        addr: port,
        proto: 'http'
        });
        console.log(`🌐 Ngrok 터널 열림! 외부 접속 주소: ${url}`);
    } catch (err) {
        console.error('❌ ngrok 연결 실패:', err);
    }
});