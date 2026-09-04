<img width="1280" height="640" alt="git (1)" src="https://github.com/user-attachments/assets/8920b256-2ba8-4988-b824-5351134eb4bd" />

# AirFlop 🎯

## Basic Details
### Team Name: VoidLink

### Team Members
- Team Lead: Seraphin J Raphy - Government Model Engineering College

### Project Description
AirFlop is an air-gapped optical file transmission bridge that serializes arbitrary files into high-density 40x40 chromatic matrices on a laptop screen and reconstructs them via a phone camera at 20 FPS using client-side computer vision and forward error correction.

### The Problem (that doesn't exist)
Cables tangle, cloud storage requires an internet connection, and AirDrop assumes your devices like each other. Sometimes you need to beam a 3 KB file using raw, unadulterated visual photons because radio frequencies are entirely too invisible and boring.

### The Solution (that nobody asked for)
Turn your laptop display into a chaotic, strobe-lit optical transmitter and point your smartphone camera at it. By multiplexing bytes into 2-bit color assignments, correcting perspective warp on-the-fly, and recovering dropped frames with Reed-Solomon erasure coding, we move files across an air gap using only light.

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
![Screenshot1](screenshots/transmitter.png)
*Laptop transmitter view showing the 40x40 chromatic matrix, alignment anchors, and real-time transmission telemetry.*

![Screenshot2](screenshots/receiver.png)
*Mobile camera viewfinder with alignment overlay, active WebRTC stream, and chunk reception progress bar.*

![Screenshot3](screenshots/success.png)
*Successful client-side reassembly, integrity verification, and automatic payload download trigger.*

# Diagrams
![Workflow](diagrams/pipeline.png)
*End-to-end data pipeline: File chunking -> Reed-Solomon parity -> 2-bit color multiplexing -> 20 FPS Canvas rendering -> WebRTC frame capture -> Web Worker perspective warp & demux -> Binary reassembly.*

For Hardware:

# Schematic & Circuit
![Circuit]()
*Not applicable*

![Schematic]()
*Not applicable*

# Build Photos
![Components]()
*Not applicable*

![Build]()
*Not applicable*

![Final]()
*Not applicable*

### Project Demo
# Video
[Add your demo video link here]
*Demonstration showing end-to-end optical transmission of a sample payload from laptop screen to phone camera across an air gap.*

# Additional Demos
[Add any extra demo materials/links]

## Team Contributions
- Seraphin J Raphy: Optical transmission engine, frame assembly logic, Web Worker decoding pipeline, and canvas render loops.
- Simon Puthur Binu: Computer vision perspective transform, corner anchor detection algorithms, and color calibration matrix.
- Johan Abraham: Responsive UI layout, transmission telemetry HUD, camera capture orchestration, and deployment.

---
Made with ❤️ at TinkerHub Useless Projects 

![Static Badge](https://img.shields.io/badge/TinkerHub-24?color=%23000000&link=https%3A%2F%2Fwww.tinkerhub.org%2F)
![Static Badge](https://img.shields.io/badge/UselessProjects--26-26?link=https%3A%2F%2Ftinkerhub.org%2Fevents%2F1M8ORET9A1%2Fuseless-projects-3.0)
