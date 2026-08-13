# MeshMeet — Private P2P Video Calls

Private, encrypted group video calls for up to 6 people. No accounts, no servers storing your data — pure peer-to-peer WebRTC.

## Features

- **Full Mesh P2P** — Every participant connects directly to every other participant
- **DTLS-SRTP Encryption** — All audio/video is encrypted end-to-end by WebRTC
- **Two Connection Modes:**
  - ⚡ **Quick Connect** — Share a short room code; auto-connects via PeerJS signaling
  - 🔒 **Secure Connect** — Manual PassKey exchange with zero third-party servers
- **In-Call Customization:**
  - Per-user volume control and mute
  - Hide remote video locally
  - Request lower receive quality per-peer (HD/SD/LD)
  - Adjust your send quality to save upload bandwidth
  - Emoji reactions visible to all participants (👍❤️😂😮👏🎉🔥💯✋💀)
  - Change your display name mid-call
- **Screen Sharing** — Share your screen with all participants
- **Up to 6 Participants** — Full mesh supports up to 6 people

## Run It Locally

MeshMeet is a static site — no build tools, no npm install, no bundler. Just serve the files.

### Prerequisites

- A modern web browser (Chrome, Firefox, Edge, Safari)
- Any static file server (Python, Node, etc.)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/hamman247/p2p-video-confernce-platform.git
cd p2p-video-confernce-platform

# Serve with Python (built-in, no install needed)
python3 -m http.server 8090

# Or with Node.js
npx serve -p 8090
```

Then open **http://localhost:8090** in your browser.

### Using HTTPS (required for camera/mic on remote networks)

Browsers require HTTPS to access the camera and microphone when not on `localhost`. For local development, `localhost` works fine. For sharing over a network, use a tool like [mkcert](https://github.com/FiloSottile/mkcert) or deploy behind a reverse proxy with TLS.

## How to Use

### Quick Connect (Easiest)

1. **Host** — Enter your name, click **Host** under Quick Connect
2. Share the **room code** or **invite link** with participants
3. **Joiners** — Enter the room code and click **Join**
4. Everyone auto-connects and enters the call

### Secure Connect (No Signaling Server)

1. **Host** — Enter your name, click **Host** under Secure Connect
2. Click **Add Participant** to generate a **Meeting PassKey**
3. Send the PassKey (or link) to the joiner via any secure channel
4. **Joiner** — Paste the PassKey, click **Generate Response Key**
5. Send the **Response Key** back to the host
6. **Host** — Paste the Response Key and click **Connect**
7. Both sides click **Enter Call**

### In-Call Controls

| Button | Function |
|--------|----------|
| 🎤 Mic | Toggle your microphone on/off |
| 📷 Camera | Toggle your camera on/off |
| 🖥 Screen | Share/stop sharing your screen |
| 😀 React | Send an emoji reaction visible to everyone |
| 📶 Quality | Adjust your outgoing video quality (HD/SD/LD) |
| 👤 Add | (Host only) Add another participant via Secure Connect |
| 📞 End | Leave the call |
| ⛶ Fullscreen | Toggle fullscreen mode |

### Per-Peer Controls

Hover over any remote participant's video tile to access:
- **Volume slider** — Adjust their audio volume (only affects you)
- **Mute button** — Mute/unmute their audio (only affects you)
- **Eye button** — Hide/show their video (only affects you)
- **HD/SD/LD** — Request they send you lower quality video to save bandwidth

### Changing Your Name

Click your name label on your own video tile during a call. Type a new name and press Enter. The change is broadcast to all participants.

## Project Structure

```
├── index.html      # Single-page HTML with all views
├── styles.css      # All styling (vanilla CSS, no frameworks)
├── app.js          # All application logic (WebRTC, PeerJS, UI)
├── favicon.svg     # Browser tab icon
└── README.md       # This file
```

## Technology

- **WebRTC** — Peer-to-peer audio, video, and data channels
- **PeerJS** — Signaling for Quick Connect mode (media stays P2P)
- **Vanilla JS/CSS/HTML** — No frameworks, no build step

## License

MIT
