# AI4Healthcare Technical Workshop

## Overview
Interactive Apple Health explorer with a right-aligned AI coach. Upload/export your data, view Records, Sleep, and Vitals, and chat for concise, actionable insights with context-aware suggested questions.

## Tech Stack
- Next.js (app router) + TypeScript + TailwindCSS
- React hooks for data flow and UI state
- OpenAI Chat Completions proxy (`/api/chat`) with GPT-4o-style model (configurable)

## Quick Start
1) Install deps: `npm install`  
2) Set env in `.env.local`:
```
OPENAI_API_KEY=sk-...
# Optional: OPENAI_MODEL (default gpt-5-mini)
```
3) Run dev server: `npm run dev` (default http://localhost:3000)

## Usage
- Records tab: load Apple Health export (XML zip), then browse parsed records.
- Sleep tab: view nightly aggregates and segments.
- Vitals tab: trend charts (incl. resp. rate & wrist temperature).
- Chat column: fixed, scrollable, resizable; markdown replies; suggested questions appear as soon as data is loaded. First batch always includes: “What 3 practical changes would improve my REM and deep sleep based on these records?”

## Testing
- Frontend tests pending: vitals load/error and count.

## Notes
- Keep API keys local; do not commit `.env.local`.
