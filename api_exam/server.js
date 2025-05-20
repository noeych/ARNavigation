const express = require('express');
const path = require('path');
const http = require('http');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const httpServer = http.createServer(app);

httpServer.listen(port, () => {
    console.log(`HTTP 서버가 http://localhost:${port} 에서 실행 중입니다.`);
    console.log('WebXR 테스트를 위해서는 ngrok를 사용하여 HTTPS로 터널링하세요.');
    console.log('예: ngrok http 3000');
});