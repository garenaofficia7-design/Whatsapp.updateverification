const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('./whatsapp.db');

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    name TEXT,
    online INTEGER DEFAULT 0,
    last_seen TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user TEXT,
    to_user TEXT,
    content TEXT,
    timestamp TEXT,
    status TEXT DEFAULT 'sent'
  )
`);

// Seed users
const seedUsers = [
  { phone: '1234567890', name: 'Alessia' },
  { phone: '0987654321', name: 'Dante' },
  { phone: '1122334455', name: 'Elena' },
];

seedUsers.forEach(user => {
  db.run(
    'INSERT OR IGNORE INTO users (phone, name) VALUES (?, ?)',
    [user.phone, user.name]
  );
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  let currentUser = null;

  // Login
  socket.on('login', ({ phone, name }) => {
    currentUser = { phone, name };
    socket.data.phone = phone;

    db.run(
      'UPDATE users SET online = 1, last_seen = datetime("now") WHERE phone = ?',
      [phone]
    );

    // Send user list
    db.all('SELECT phone, name, online, last_seen FROM users', (err, users) => {
      socket.emit('users', users);
      socket.broadcast.emit('user_online', { phone, name });
    });

    // Send chat history
    db.all(
      `SELECT * FROM messages WHERE from_user = ? OR to_user = ? ORDER BY timestamp ASC`,
      [phone, phone],
      (err, messages) => {
        socket.emit('messages', messages);
      }
    );
  });

  // Send message
  socket.on('send_message', ({ to, content }) => {
    if (!currentUser) return;

    const timestamp = new Date().toISOString();

    db.run(
      'INSERT INTO messages (from_user, to_user, content, timestamp) VALUES (?, ?, ?, ?)',
      [currentUser.phone, to, content, timestamp],
      function(err) {
        if (err) return;

        const message = {
          id: this.lastID,
          from_user: currentUser.phone,
          to_user: to,
          content,
          timestamp,
          status: 'sent'
        };

        // Send to sender
        socket.emit('message_sent', message);

        // Send to recipient if online
        socket.broadcast.emit('new_message', message);
      }
    );
  });

  // Typing indicator
  socket.on('typing', ({ to, isTyping }) => {
    socket.broadcast.emit('typing_indicator', {
      from: currentUser?.phone,
      to,
      isTyping
    });
  });

  // Mark as delivered
  socket.on('mark_delivered', ({ messageId, to }) => {
    db.run(
      'UPDATE messages SET status = "delivered" WHERE id = ?',
      [messageId]
    );
    socket.broadcast.emit('message_delivered', { messageId, to });
  });

  // Mark as read
  socket.on('mark_read', ({ messageId, from }) => {
    db.run(
      'UPDATE messages SET status = "read" WHERE id = ?',
      [messageId]
    );
    socket.broadcast.emit('message_read', { messageId, from });
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (currentUser) {
      db.run(
        'UPDATE users SET online = 0, last_seen = datetime("now") WHERE phone = ?',
        [currentUser.phone]
      );
      socket.broadcast.emit('user_offline', { phone: currentUser.phone });
    }
    console.log('User disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
