# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a SolidJS application using SolidStart that integrates audio frequency analysis with device control via the Buttplug library. The app analyzes microphone input and controls connected devices based on frequency and volume thresholds.

## Development Commands

### Core Development
- `npm run dev` - Start both development server and Firebase emulators concurrently
- `npm run dev:server` - Start only the Vinxi development server
- `npm run dev:firebase` - Start only Firebase emulators (Firestore, Hosting, Auth)

### Building and Production
- `npm run build` - Build the application using Vinxi
- `npm run start` - Start the production server

### Code Quality
- `npm run lint` - Run Biome linter with automatic fixes
- `npm run format` - Format code using Biome

### Testing
- `npm test` - Run tests with Firebase emulators and Vitest concurrently
- `npm run test:vitest` - Run Vitest tests only (requires emulators to be running)

## Architecture

### Tech Stack
- **Framework**: SolidJS with SolidStart
- **Backend**: Firebase (Firestore, Auth, Hosting)
- **Build Tool**: Vinxi
- **Hardware Integration**: Buttplug library for device communication
- **Audio Processing**: Web Audio API for frequency analysis
- **Testing**: Vitest with Solid Testing Library

### Key Components
- **Audio Processing** (`src/routes/index.tsx:27-66`): Initializes Web Audio API for microphone input and frequency analysis
- **Device Control** (`src/routes/index.tsx:189-213`): Controls connected devices based on audio thresholds and vibration modes
- **Firebase Integration** (`src/lib/firebase.ts`): Handles Firebase app initialization, auth, and Firestore connection

### Project Structure
- `src/app.tsx` - Main app component with router setup
- `src/routes/index.tsx` - Primary application logic with audio processing and device control
- `src/lib/firebase.ts` - Firebase configuration and initialization
- `src/lib/schema.d.ts` - TypeScript type definitions

### Configuration
- **Biome**: Code formatting and linting with strict rules enabled
- **TypeScript**: Strict mode enabled with SolidJS JSX configuration
- **Vite**: WASM plugin enabled for Buttplug library, Firebase modules excluded from optimization
- **Firebase**: Development emulators configured for local development

### Development Notes
- The app requires microphone permissions for audio analysis
- Firebase emulators must be running for proper development workflow
- SSR is disabled (`ssr: false` in app.config.ts)
- Uses file-based routing via SolidStart
- Local Buttplug WASM package is used from `../buttplug-js/wasm`
- **IMPORTANT**: Always run `npm run format` after editing TypeScript files to maintain consistent code formatting