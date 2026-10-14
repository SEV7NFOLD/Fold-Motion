# FOLD Motion

Code-first motion production tools and a static studio preview.

## Run locally

```powershell
npm ci
npm start
```

Open `http://127.0.0.1:4173/`. The studio uses the local mock provider to
generate and validate scene specifications; generation does not render video.

## Deploy to Vercel

Deploy from the repository root. The `vercel.json` configuration publishes
`public/` as the static site, while `api/generate.js` serves `POST /api/generate`
as a Vercel Node.js function. In Vercel project settings, use the repository
root as the Root Directory and select the **Other** framework preset rather
than Next.js; this repository does not contain a Next.js app.

After deployment, `/` should show the studio and `POST /api/generate` should
return a validated scene specification. The included provider is local/mock;
this does not produce a rendered video.

To enable Gemini scene generation, add `GEMINI_API_KEY` to the Vercel project's
environment variables for the Production environment, then redeploy. The key is
read only by the serverless API function and sent to Google's API in a request
header; it is never sent to the browser. If the variable is absent, generation
uses the local mock provider. If Gemini is configured but its request fails or
returns an invalid specification, the API reports an error rather than silently
substituting mock output. The provider is Gemini 2.5 Flash by default.

## Verify

```powershell
npm test
```