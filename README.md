<img width="1280" height="640" alt="git (1)" src="https://github.com/user-attachments/assets/8920b256-2ba8-4988-b824-5351134eb4bd" />

# AirFlop 🎯

## Basic Details
### Team Name: Seraphin J Raphy's Team

### Team Members
- Team Lead: Seraphin J Raphy - Government Model Engineering College

### Project Description
AirFlop is a completely ridiculous way to send files from your laptop to your phone using a violently flashing disco grid of colors. It turns your screen into a palli perunal and your phone camera into an epilepsy patient. 

### The Problem (that doesn't exist)
Cables are annoying, Bluetooth is moody, and AirDrop only works when it feels like it. Plus, sending data over Wi-Fi is just too invisible. We needed a way to send files that you can *actually see* happening in real time, preferably with enough flashing lights to wake the whole room up.

### The Solution (that nobody asked for)
We chop your file into tiny pieces, assign a color to every piece, and blast them onto your laptop screen as a 40x40 grid flashing 20 times a second. Just point your phone camera at this chaotic light show, and the app magically stitches the blinking colors back into your original file. It's wildly impractical, completely wireless, and an incredibly annoying way to move 3 KB of data.

## Technical Details
### Technologies/Components Used
For Software:
- TypeScript, HTML5, CSS
- React, Vite
- Lucide React
- Browser APIs: Canvas API, WebRTC API, Web Workers

For Hardware:
- None (pure software leveraging consumer laptop screens and smartphone cameras)

### Implementation
For Software:
# Installation
```bash
npm install
```

# Run
```bash
npm run dev
```

### Project Documentation
For Software:

# Screenshots (Add at least 3)
![Screenshot1](screenshots/homepage.png)
*Laptop transmitter view showing the 40x40 chromatic matrix, alignment anchors, and real-time transmission telemetry.*

![Screenshot2](screenshots/sender.png)
*Mobile camera viewfinder with alignment overlay, active WebRTC stream, and chunk reception progress bar.*

![Screenshot3](screenshots/receiver.jpeg)
*Successful client-side reassembly, integrity verification, and automatic payload download trigger.*

# Diagrams
```mermaid
graph TD
    subgraph Sender [Laptop Transmitter]
        F[Original File] --> C[Chunking & Frame 0 Manifest]
        C --> MUX[2-bit Color Multiplexer]
        MUX --> ASM[Frame Assembly: Anchors, Header, Clock]
        ASM --> CAN[HTML5 Canvas @ 20 FPS]
    end

    CAN -.->|Photons / Air Gap| CAM

    subgraph Receiver [Mobile Phone Camera]
        CAM[WebRTC Capture] --> WW
        
        subgraph WW [Web Worker Pipeline]
            CV[Anchor Detect & Homography Warp] --> CAL[Color Calibration & Tearing Guard]
            CAL --> DEMUX[Demultiplex & Sequence ID Extraction]
            DEMUX --> POOL[(Frame Memory Pool)]
            POOL --> CHK{All Frames Received?}
            CHK -- Yes --> DEC[Reassemble Binary Buffer]
        end
        
        DEC --> DL[Reassembled Blob & Download]
    end
    
    classDef sender fill:#1E293B,stroke:#334155,color:#fff;
    classDef receiver fill:#047857,stroke:#065f46,color:#fff;
    classDef airgap fill:none,stroke:#FB7185,stroke-width:2px,stroke-dasharray: 5 5;
    
    class Sender sender;
    class Receiver receiver;
```
*End-to-end data pipeline: File chunking -> Reed-Solomon parity -> 2-bit color multiplexing -> 20 FPS Canvas rendering -> WebRTC frame capture -> Web Worker perspective warp & demux -> Binary reassembly.*



### Project Demo
# Video
(https://drive.google.com/file/d/1Qrsb4kMXuVAZQvxU7ltCn2TJmRc8MJ3G/view?usp=sharing)

*Demonstration showing end-to-end optical transmission of a sample payload from laptop screen to phone camera across an air gap.*

# Live Demo
https://air-flop.vercel.app/


## Team Contributions
- Seraphin J Raphy: Sole developer. Architected the 2-bit color multiplexing pipeline, implemented the HTML5 Canvas transmitter, built the WebRTC camera capture orchestration, and developed the Web Worker decoding logic for perspective transform and binary reassembly.

---
Made with ❤️ at TinkerHub Useless Projects 

![Static Badge](https://img.shields.io/badge/TinkerHub-24?color=%23000000&link=https%3A%2F%2Fwww.tinkerhub.org%2F)
![Static Badge](https://img.shields.io/badge/UselessProjects--26-26?link=https%3A%2F%2Ftinkerhub.org%2Fevents%2F1M8ORET9A1%2Fuseless-projects-3.0)
