<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/bundled/robotics_franka_pick_and_place

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Optional: to enable the browser-only Gemini demo locally, set `GEMINI_API_KEY` and `EXPOSE_GEMINI_API_KEY_TO_BROWSER=true` in [.env.local](.env.local). Do not use this for public deploys.
3. Run the app:
   `npm run dev`
