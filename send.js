const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path'); // Importing the path module

let sockets = new Map();

async function initializeSocket(phoneNumber) {
  const authFolder = path.join(__dirname, 'auth_info_baileys', phoneNumber);
  if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    browser: ['AQSA', '', ''],
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const qrCodeBase64 = await QRCode.toDataURL(qr); // Convert QR to Base64 for web use
      console.log(`QR Code for ${phoneNumber}:`, qr); // Print QR in terminal
      sockets.set(phoneNumber, { qrCodeBase64 }); // Store QR code in the map
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(`Connection closed for ${phoneNumber} due to:`, lastDisconnect?.error, 'Reason:', reason);

      if (reason === DisconnectReason.loggedOut) {
        console.log(`Logged out for ${phoneNumber}. Deleting session files...`);
        // Delete the auth folder for this phone number
        fs.rm(authFolder, { recursive: true, force: true }, (err) => {
          if (err) {
            console.error(`Error deleting auth folder for ${phoneNumber}:`, err);
          } else {
            console.log(`Auth folder for ${phoneNumber} deleted successfully.`);
          }
        });
        sockets.delete(phoneNumber);
      } else {
        console.log(`Reconnecting for ${phoneNumber}...`);
        setTimeout(() => initializeSocket(phoneNumber), 5000); // Retry after 5 seconds
      }
    } else if (connection === 'open') {
      console.log(`WhatsApp connection opened for ${phoneNumber}!`);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sockets.set(phoneNumber, { sock });
}

function getSocket(phoneNumber) {
  return sockets.get(phoneNumber);
}

module.exports = { initializeSocket, getSocket };
