const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const crypto = require('crypto');

// Хеш SHA-256 от 'auth:<login>:<password>' — сам логин и пароль в коде не хранятся
const AUTH_HASH = process.env.AUTH_HASH || '971ae3f90682598853f30f2f8f58af94b60a0f3bbd66bc4035aba2b2e3f9dc5f';

const app = express();
const server = http.createServer(app);
// Пинг чаще стандартного: «умерший» телефон обнаружится за ~15 с, а не за 45
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 5000 });

app.use(express.static(path.join(__dirname, 'public')));

// Одна трансляция на весь сайт: id сокета устройства, которое снимает (или null)
let broadcasterId = null;

// Авторизация на уровне сокета: без верного логина/пароля сокет не подключится
io.use((socket, next) => {
  const { login = '', password = '' } = socket.handshake.auth || {};
  const hash = crypto.createHash('sha256').update(`auth:${login}:${password}`).digest('hex');
  if (hash === AUTH_HASH) return next();
  next(new Error('auth'));
});

function stopBroadcast(socket) {
  if (broadcasterId !== socket.id) return;
  broadcasterId = null;
  socket.broadcast.emit('broadcaster-left');
}

io.on('connection', (socket) => {
  // Сразу сообщаем, идёт ли трансляция: клиент решит — смотреть или предложить создать
  socket.emit('state', { live: !!broadcasterId });

  socket.on('start-broadcast', () => {
    // Пользователь один, поэтому новый стример просто перехватывает эфир.
    // Это важно при переподключении телефона: сервер мог ещё не заметить, что старый сокет мёртв.
    if (broadcasterId && broadcasterId !== socket.id) {
      io.to(broadcasterId).emit('error-msg', 'Трансляцию перехватило другое устройство');
    }
    broadcasterId = socket.id;
    socket.emit('broadcast-ok');
    socket.broadcast.emit('broadcast-started'); // зрители (пере)подключатся сами
  });

  socket.on('stop-broadcast', () => stopBroadcast(socket));

  socket.on('watch', () => {
    if (!broadcasterId) return socket.emit('state', { live: false });
    if (broadcasterId === socket.id) return;
    socket.emit('joined', { broadcasterId });
    io.to(broadcasterId).emit('viewer-joined', { viewerId: socket.id });
  });

  // Чистый релей SDP/ICE между пирами — сервер в содержимое не вникает
  socket.on('signal', ({ to, data } = {}) => {
    if (to) io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('disconnect', () => {
    stopBroadcast(socket);
    if (broadcasterId) io.to(broadcasterId).emit('viewer-left', { viewerId: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🐶 dog-cam запущен: http://localhost:${PORT}`));
