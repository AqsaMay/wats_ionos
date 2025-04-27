const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

let sockets = new Map();

// Database connection pool
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'mix',
  waitForConnections: true,
  connectionLimit: 10
});

async function initializeSocket(phoneNumber) {
  const authFolder = path.join(__dirname, 'auth_info_baileys', phoneNumber);
  
  // Ensure auth directory exists
  if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder, { recursive: true });
  }

  // Load or create auth state
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  // Create new socket instance
  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    browser: ['AQSA', '', ''],
  });

  // Store socket instance
  sockets.set(phoneNumber, { sock });

  // Connection event handler
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Handle QR code generation
    if (qr) {
      const qrCodeBase64 = await QRCode.toDataURL(qr);
      sockets.set(phoneNumber, { ...sockets.get(phoneNumber), qrCodeBase64 });
    }

    // Handle connection close
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(`Connection closed for ${phoneNumber}. Reason: ${reason}`);

      // Handle logout cleanup
      if (reason === DisconnectReason.loggedOut) {
        console.log(`Performing cleanup for ${phoneNumber}...`);
        
        // Delete auth files
        fs.rm(authFolder, { recursive: true, force: true }, (err) => {
          if (err) console.error(`Cleanup failed for ${phoneNumber}:`, err);
          else console.log(`Auth files deleted for ${phoneNumber}`);
        });

        // Remove from active sockets
        sockets.delete(phoneNumber);
        
        // Reinitialize socket with fresh auth
        console.log(`Reinitializing socket for ${phoneNumber}...`);
        return initializeSocket(phoneNumber); // Fresh initialization
      }

      // Regular reconnection
      console.log(`Reconnecting ${phoneNumber} in 5 seconds...`);
      setTimeout(() => initializeSocket(phoneNumber), 5000);
    }

    // Handle successful connection
    if (connection === 'open') {
      console.log(`✅ Connected: ${phoneNumber}`);
      sockets.set(phoneNumber, { sock, qrCodeBase64: null });
    }
  });

  // Credentials update handler
  sock.ev.on('creds.update', saveCreds);

  // Message handler with DB integration
  sock.ev.on('messages.upsert', async (msgUpdate) => {
    const messages = msgUpdate.messages;
    if (!messages?.length) return;

    for (const msg of messages) {
      try {
        if (msg.key.fromMe) continue;
        
        const text = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text || '';
        const senderNumber = msg.key.remoteJid.replace('@s.whatsapp.net', '');

        // Handle confirmation
        if (['1', '١'].includes(text.trim())) {
          await sock.sendMessage(msg.key.remoteJid, { text: "تم قبول طلبك" });
          
          const connection = await pool.getConnection();
          await connection.execute(
            'DELETE FROM events_2_t WHERE DATE(start) = CURDATE() AND tel = ?',
            [senderNumber]
          );
          connection.release();
          
          console.log(`Processed confirmation from ${senderNumber}`);
        }
      } catch (err) {
        console.error('Message processing error:', err);
      }
    }
  });
}

function getSocket(phoneNumber) {
  return sockets.get(phoneNumber);
}

module.exports = { initializeSocket, getSocket };
