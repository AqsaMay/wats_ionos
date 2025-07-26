const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

let sockets = new Map();
let exportedNumbers = new Map(); // key: phoneNumber, value: Set of numbers

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

//**************************************
//=====================================

exportedNumbers.set(phoneNumber, new Set());

// From chats history
sock.ev.on('messaging-history.set', ({ contacts }) => {
  const current = exportedNumbers.get(phoneNumber);
  contacts.forEach(contact => {
    if (contact.id?.endsWith('@s.whatsapp.net')) {
      current.add(contact.id.replace('@s.whatsapp.net', ''));
    }
  });
  console.log(`[${phoneNumber}] Chat history numbers loaded`);
});

// From contact sync
sock.ev.on('contacts.upsert', (contacts) => {
  const current = exportedNumbers.get(phoneNumber);
  contacts.forEach(contact => {
    if (contact.id?.endsWith('@s.whatsapp.net')) {
      current.add(contact.id.replace('@s.whatsapp.net', ''));
    }
  });
  console.log(`[${phoneNumber}] Contact list numbers loaded`);
});




//=====================================
//**************************************


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

      if (reason === DisconnectReason.loggedOut) {
        console.log(`🔒 Logged out: cleaning up for ${phoneNumber}`);
        
        sockets.delete(phoneNumber); // Prevent duplicate reconnects

        fs.rm(authFolder, { recursive: true, force: true }, (err) => {
          if (!err) {
            console.log(`🧹 Auth cleared for ${phoneNumber}, reinitializing...`);
            initializeSocket(phoneNumber);
          } else {
            console.error(`Failed to delete auth folder: ${err}`);
          }
        });
      } else {
        console.log(`Reconnecting ${phoneNumber} in 5 seconds...`);
        setTimeout(() => initializeSocket(phoneNumber), 5000);
      }
    }

    // Handle successful connection
    if (connection === 'open') {
      console.log(`✅ Connected: ${phoneNumber}`);
      sockets.set(phoneNumber, { sock, qrCodeBase64: null });
	 // sockets.set(phoneNumber, { sock, qrCodeBase64: null, connected: true });


      try {
        // 🛠 Force sync of chats and contacts
        //const chats = await sock.chatFetchAll();
		const chats = store.chats;
		console.log('Synced chats:', chats);
        const contacts = await sock.onWhatsApp(phoneNumber);

        console.log(`📥 Synced ${chats.length} chats and ${contacts.length} contacts`);
      } catch (err) {
        console.error(`❌ Error syncing chats/contacts:`, err);
      }
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
		  await connection.query("SET time_zone = 'Asia/Jerusalem'");
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

//module.exports = { initializeSocket, getSocket };
module.exports = { initializeSocket, getSocket, exportedNumbers };

